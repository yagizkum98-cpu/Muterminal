import { createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { MongoClient } from 'mongodb';
import { ensureSchema, pool, transaction, type Document, type Entity } from '../server/database';

const mapping = {
  stores: 'stores',
  users: 'accounts',
  passwordOverrides: 'account_password_overrides',
  settings: 'system_settings',
  products: 'products',
} as const satisfies Record<string, Entity>;

type Snapshot = { source: string; target: Entity; rows: { id: string; document: Document }[] }[];

async function readSource(client: MongoClient): Promise<Snapshot> {
  const db = client.db(process.env.MONGODB_DATABASE ?? 'muterminal');
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const unknown = collections.filter(item => !Object.hasOwn(mapping, item.name) && !item.name.startsWith('system.'));
  if (unknown.length) throw new Error(`Aktarım tanımı olmayan koleksiyonlar: ${unknown.map(item => item.name).join(', ')}`);
  return Promise.all(Object.entries(mapping).map(async ([source, target]) => {
    const documents = await db.collection(source).find().sort({ _id: 1 }).toArray();
    const rows = documents.map(({ _id, ...fields }) => ({ id: _id.toString(), document: JSON.parse(JSON.stringify(fields)) as Document }));
    return { source, target, rows };
  }));
}

const digest = (snapshot: Snapshot) => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

async function main() {
  loadEnvConfig(process.cwd(), true);
  const apply = process.argv.slice(2).includes('--apply');
  const mongo = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 3000 });
  let postgresStarted = false;
  try {
    const snapshot = await readSource(mongo);
    for (const { source, target, rows } of snapshot) console.log(`${source} → ${target} · ${rows.length}`);
    const products = snapshot.find(item => item.source === 'products')!.rows;
    const decisions = products.reduce((count, row) => count + (Array.isArray(row.document.decisions) ? row.document.decisions.length : 0), 0);
    console.log(`Ürünlere bağlı kararlar · ${decisions}`);
    if (!apply) {
      console.log('Ön inceleme tamamlandı. PostgreSQL’e yazmak için --apply seçeneği gerekir.');
      return;
    }
    postgresStarted = true;
    await ensureSchema();
    const report = await transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(682947302)');
      const results = [];
      for (const { source, target, rows } of snapshot) {
        let inserted = 0;
        for (const { id, document } of rows) {
          const values = [id, JSON.stringify(document)];
          const result = await client.query(`INSERT INTO ${target} (id, document) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, values);
          if (result.rowCount) inserted++;
          const verified = await client.query(`SELECT 1 FROM ${target} WHERE id = $1 AND document = $2::jsonb`, values);
          if (!verified.rowCount) throw new Error(`${target}/${id} hedefte farklı içerikle kayıtlı. Aktarım geri alındı.`);
        }
        results.push({ source, inserted, verified: rows.length });
      }
      if (digest(await readSource(mongo)) !== digest(snapshot)) {
        throw new Error('Aktarım sırasında kaynak değişti. PostgreSQL aktarımı geri alındı.');
      }
      return results;
    });
    for (const row of report) console.log(`${row.source} · ${row.inserted} yeni, ${row.verified} doğrulandı`);
  } finally {
    await mongo.close();
    if (postgresStarted && process.env.DATABASE_URL) await pool().end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

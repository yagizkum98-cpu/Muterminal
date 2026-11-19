import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export type Document = Record<string, unknown>;
type Filter = Record<string, unknown>;
type Projection = Record<string, 0 | 1>;
type Update = { $set?: Document; $unset?: Document; $push?: Document };
export type Entity = 'products' | 'accounts' | 'stores' | 'account_password_overrides' | 'system_settings' | 'department_options';
type EntityRow = { id: string; document: Document };

type SchemaInitialization = { revision: string; ready: Promise<void> };
const runtime = globalThis as typeof globalThis & { muPostgres?: Pool; muSchemaInitialization?: SchemaInitialization };

export function pool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL ayarlı değil.');
  return runtime.muPostgres ??= new Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000 });
}

async function initializeSchema() {
  const path = join(process.cwd(), 'server/schema.sql');
  let revision = path;
  if (process.env.NODE_ENV === 'development') {
    // Next.js hot reload keeps globals alive when the SQL schema changes.
    const { mtimeMs, size } = await stat(path);
    revision = `${path}:${mtimeMs}:${size}`;
  }
  let initialization = runtime.muSchemaInitialization;
  if (initialization?.revision !== revision) {
    const ready = (async () => {
      const sql = await readFile(path, 'utf8');
      await transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(682947301)');
        await client.query(sql);
      });
    })();
    initialization = { revision, ready };
    runtime.muSchemaInitialization = initialization;
  }
  try {
    await initialization.ready;
    return initialization;
  } catch (error) {
    if (runtime.muSchemaInitialization === initialization) delete runtime.muSchemaInitialization;
    throw error;
  }
}

export async function ensureSchema() {
  await initializeSchema();
}

export async function query<R extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
  const initialization = await initializeSchema();
  try {
    return await pool().query<R>(sql, values);
  } catch (error) {
    // A restored database can lose tables while the application is running.
    if ((error as { code?: string }).code !== '42P01') throw error;
    if (runtime.muSchemaInitialization === initialization) delete runtime.muSchemaInitialization;
    await ensureSchema();
    return pool().query<R>(sql, values);
  }
}

export async function transaction<R>(work: (client: PoolClient) => Promise<R>) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function newRecordId() {
  const seconds = Math.floor(Date.now() / 1_000).toString(16).padStart(8, '0');
  return seconds + randomBytes(8).toString('hex');
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

class SqlParameters {
  values: unknown[] = [];

  add(value: unknown) {
    return `$${this.values.push(value)}`;
  }

  field(key: string) {
    switch (key) {
      case '_id': return 'to_jsonb(id)';
      default: return `(document #> ${this.add(key.split('.'))}::text[])`;
    }
  }

  where(filter: Filter): string {
    const terms = Object.entries(filter).map(([key, value]) => {
      if (key === '$or') return `(${(value as Filter[]).map(branch => this.where(branch)).join(' OR ')})`;
      if (key === '_id' && typeof value === 'string') return `id = ${this.add(value)}`;
      const field = this.field(key);
      if (value === null) return `(${field} IS NULL OR ${field} = 'null'::jsonb)`;
      if (typeof value === 'object' && !Array.isArray(value) && value) {
        if ('$exists' in value) return `${field} IS ${value.$exists ? 'NOT ' : ''}NULL`;
        if ('$in' in value) {
          const options = value.$in as unknown[];
          return options.length ? `(${options.map(item => item === null
            ? `(${field} IS NULL OR ${field} = 'null'::jsonb)`
            : `${field} = ${this.add(JSON.stringify(item))}::jsonb`).join(' OR ')})` : 'FALSE';
        }
      }
      return `${field} = ${this.add(JSON.stringify(value))}::jsonb`;
    });
    return terms.length ? terms.join(' AND ') : 'TRUE';
  }

  order(sort: Record<string, 1 | -1>) {
    const terms = Object.entries(sort).map(([key, direction]) => `${key === '_id' ? 'id' : this.field(key)} ${direction === -1 ? 'DESC' : 'ASC'} NULLS LAST`);
    return terms.length ? ` ORDER BY ${terms.join(', ')}` : '';
  }
}

function project(row: EntityRow, projection?: Projection): Document {
  const record = { ...row.document, _id: row.id };
  if (!projection) return record;
  if (Object.values(projection).some(Boolean)) {
    return Object.fromEntries(Object.entries(record).filter(([key]) => projection[key] === 1 || (key === '_id' && projection[key] !== 0)));
  }
  return Object.fromEntries(Object.entries(record).filter(([key]) => projection[key] !== 0));
}

function applyUpdate(document: Document, update: Update) {
  const edited = structuredClone(document);
  for (const [path, value] of Object.entries(update.$set ?? {})) {
    const keys = path.split('.');
    const key = keys.pop()!;
    let target = edited;
    for (const part of keys) {
      if (!target[part] || typeof target[part] !== 'object') target[part] = {};
      target = target[part] as Document;
    }
    target[key] = value;
  }
  for (const key of Object.keys(update.$unset ?? {})) delete edited[key];
  for (const [key, value] of Object.entries(update.$push ?? {})) {
    const current = (edited[key] ?? []) as unknown[];
    edited[key] = [...current, value];
  }
  return edited;
}

class Results {
  #orderBy: Record<string, 1 | -1> = {};

  constructor(private table: Entity, private filter: Filter, private projection?: Projection) {}

  sort(orderBy: Record<string, 1 | -1>) {
    this.#orderBy = orderBy;
    return this;
  }

  async toArray() {
    const sql = new SqlParameters();
    const where = sql.where(this.filter);
    const ordering = sql.order(this.#orderBy);
    const { rows } = await query<EntityRow>(`SELECT id, document FROM ${this.table} WHERE ${where}${ordering}`, sql.values);
    return rows.map(row => project(row, this.projection));
  }

  async *[Symbol.asyncIterator]() {
    yield* await this.toArray();
  }
}

export class Table {
  constructor(private table: Entity) {}

  find(filter: Filter = {}, options?: { projection: Projection }) {
    return new Results(this.table, filter, options?.projection);
  }

  async findOne(filter: Filter, options?: { projection: Projection }) {
    const sql = new SqlParameters();
    const where = sql.where(filter);
    const { rows } = await query<EntityRow>(`SELECT id, document FROM ${this.table} WHERE ${where} LIMIT 1`, sql.values);
    return rows[0] ? project(rows[0], options?.projection) : null;
  }

  async insertOne(record: Document) {
    const { _id, ...document } = record;
    const id = typeof _id === 'string' ? _id : newRecordId();
    await query(`INSERT INTO ${this.table} (id, document) VALUES ($1, $2)`, [id, JSON.stringify(document)]);
    return { insertedId: id };
  }

  async updateOne(filter: Filter, update: Update, options?: { upsert?: boolean; beforeUpdate?: (client: PoolClient) => Promise<void> }) {
    await ensureSchema();
    return transaction(async client => {
      await options?.beforeUpdate?.(client);
      const sql = new SqlParameters();
      const where = sql.where(filter);
      const { rows } = await client.query<EntityRow>(`SELECT id, document FROM ${this.table} WHERE ${where} LIMIT 1 FOR UPDATE`, sql.values);
      const existing = rows[0];
      if (existing) {
        await client.query(`UPDATE ${this.table} SET document = $2 WHERE id = $1`, [existing.id, JSON.stringify(applyUpdate(existing.document, update))]);
      } else if (options?.upsert && typeof filter._id === 'string') {
        await client.query(`INSERT INTO ${this.table} (id, document) VALUES ($1, $2)
          ON CONFLICT (id) DO UPDATE SET document = ${this.table}.document || EXCLUDED.document`,
        [filter._id, JSON.stringify(applyUpdate({}, update))]);
      }
      return { matchedCount: existing ? 1 : 0 };
    });
  }

  async deleteOne(filter: { _id: string }) {
    const result = await query(`DELETE FROM ${this.table} WHERE id = $1`, [filter._id]);
    return { deletedCount: result.rowCount };
  }
}

export async function createSession(token: string, account: string, expiresAt: Date, credentialTag: string, payload: Document) {
  await ensureSchema();
  await transaction(async client => {
    await client.query('DELETE FROM sessions WHERE expires_at <= now()');
    await client.query('INSERT INTO sessions VALUES ($1, $2, $3, $4, $5)', [hashToken(token), account, expiresAt, credentialTag, JSON.stringify(payload)]);
  });
}

export async function findSession(token: string) {
  const result = await query<{ payload: Document; credential_tag: string }>(
    'SELECT payload, credential_tag FROM sessions WHERE token_hash = $1 AND expires_at > now()', [hashToken(token)],
  );
  return result.rows[0];
}

export async function deleteSession(token: string) {
  await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function revokeSessions(account: string) {
  await query('DELETE FROM sessions WHERE account_key = $1', [account]);
}

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ensureSchema, query, transaction } from './database';
import { traceStages, type TraceStage } from '../components/trace-model';
import type { TraceAccess } from '../components/trace-policy';

export class TraceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Scope = string | null;
type TraceKey = { storeId: string; barcode: string; lot: string };
type TraceProduct = TraceKey & { name: string };

export function traceBarcode(code: string) {
  return /^(?:\d{8}|\d{12,14})$/.test(code) ? code.padStart(14, '0') : code;
}

export function barcodeVariants(input: string) {
  const code = traceBarcode(input);
  if (!/^\d{14}$/.test(code)) return [code];
  return [14, 13, 12, 8].filter(length => /^0*$/.test(code.slice(0, 14 - length))).map(length => code.slice(-length));
}

export function traceLookupInput(input: string, lot: string | null) {
  if (!input || input.length > 512 || (lot && lot.length > 80)) throw new TraceError(400, 'Geçerli bir barkod veya QR içeriği girin.');
  const webLink = /^https?:\/\//i.test(input);
  if (webLink && URL.canParse(input)) {
    const url = new URL(input);
    const path = url.pathname.split('/');
    const index = path.indexOf('01');
    if (['https:', 'http:'].includes(url.protocol) && index >= 0 && /^\d{14}$/.test(path[index + 1] ?? '')) {
      let linkLot: string | null = null;
      for (let part = index + 2; part + 1 < path.length; part += 2) {
        if (path[part] !== '10') continue;
        try { linkLot = decodeURIComponent(path[part + 1]); } catch { throw new TraceError(400, 'QR içindeki lot kodu geçersiz.'); }
        if (!linkLot || linkLot.length > 20 || (lot && lot !== linkLot)) throw new TraceError(400, 'QR içindeki lot kodu geçersiz veya seçilen lotla uyuşmuyor.');
      }
      return { code: path[index + 1], lot: linkLot ?? lot };
    }
  }
  if (!webLink && input.length <= 80) return { code: traceBarcode(input), lot };
  throw new TraceError(400, 'Ürün kodu veya GS1 Digital Link QR kullanın.');
}

const storeColumn = "COALESCE(p.store_id, 'pilot')";
const activeRecall = "e.kind = 'recall_opened' AND NOT EXISTS (SELECT 1 FROM trace_events closed WHERE closed.recall_id = e.id)";
const eventColumns = 'e.id, e.store_id AS "storeId", e.barcode, e.lot, e.product_name AS name, e.kind, e.actor, e.occurred_at AS time, e.note, e.stage, e.origin, e.location, e.quantity, e.recall_id AS "recallId"';

export async function lookupOperations(code: string, stores: string[]) {
  const { rows } = await query<{ id: string; document: Record<string, unknown> }>(`
    WITH codes AS (
      SELECT DISTINCT barcode FROM products p
      WHERE ${storeColumn} = ANY($2::text[])
        AND (barcode = ANY($1::text[]) OR document->>'productCode' = ANY($1::text[]))
    )
    SELECT id, document FROM products p
    WHERE barcode IN (SELECT barcode FROM codes) AND ${storeColumn} = ANY($2::text[])
    ORDER BY document->>'createdAt' DESC NULLS LAST, id DESC`, [barcodeVariants(code), stores]);
  return rows.map(({ id, document }) => ({ ...document, _id: id }));
}

export async function lookupEvents(codes: string[], access: TraceAccess, lot: string | null) {
  const { rows } = await query(`
    SELECT ${eventColumns}, (${activeRecall}) AS "activeRecall"
    FROM trace_events e
    WHERE e.barcode = ANY($1::text[]) AND e.store_id = ANY($2::text[])
      AND ($3::text IS NULL OR e.lot = $3)
      AND (NOT $4::boolean OR (${activeRecall}))
      AND ($5::text IS NULL OR e.warehouse_id = $5 OR (${activeRecall}))
    ORDER BY e.occurred_at DESC, e.id DESC`, [codes, access.storeIds, lot, access.role === 'staff', access.warehouseId]);
  return rows;
}

export function traceLotKey(key: TraceKey) {
  return JSON.stringify([key.storeId, traceBarcode(key.barcode), key.lot]);
}

export async function openRecallKeys(scope: Scope, barcode: string | null = null) {
  const { rows } = await query<TraceKey>(`
    SELECT e.store_id AS "storeId", e.barcode, e.lot FROM trace_events e
    WHERE ($1::text IS NULL OR e.store_id = $1) AND ($2::text IS NULL OR e.barcode = $2) AND ${activeRecall}`,
  [scope, barcode ? traceBarcode(barcode) : null]);
  return new Set(rows.map(traceLotKey));
}

async function lockLot(client: PoolClient, key: TraceKey) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    ['mu-trace:' + traceLotKey(key)]);
}

export async function assertNoRecall(client: PoolClient, key: TraceKey) {
  await lockLot(client, key);
  const { rowCount } = await client.query(`
    SELECT 1 FROM trace_events e WHERE e.store_id = $1 AND e.barcode = $2 AND e.lot = $3 AND ${activeRecall}`,
  [key.storeId, traceBarcode(key.barcode), key.lot]);
  if (rowCount) throw new TraceError(409, 'Bu lot için açık geri çağırma kaydı var.');
}

export function isTraceStage(stage: unknown): stage is TraceStage {
  return typeof stage === 'string' && Object.hasOwn(traceStages, stage);
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function addMovement(product: TraceProduct, actor: string, movement: {
  id: string; stage: TraceStage; origin: string | null; location: string; quantity: number | null; note: string; warehouseId: string | null;
}) {
  const { id, stage, origin, location, quantity, note, warehouseId } = movement;
  const barcode = traceBarcode(product.barcode);
  const values = [id, product.storeId, barcode, product.lot, product.name, actor, note, stage, origin, location, quantity, warehouseId];
  await ensureSchema();
  return transaction(async client => {
    if (warehouseId && !(await client.query(`
      SELECT 1 FROM trace_warehouse_lots WHERE warehouse_id = $1 AND barcode = $2 AND lot = $3 FOR SHARE`,
      [warehouseId, barcode, product.lot])).rowCount) throw new TraceError(404, 'Lot depoya atanmamış.');
    const inserted = await client.query(`
      INSERT INTO trace_events (id, store_id, barcode, lot, product_name, kind, actor, note, stage, origin, location, quantity, warehouse_id)
      VALUES ($1,$2,$3,$4,$5,'movement',$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO NOTHING`, values);
    if (inserted.rowCount) return true;
    const prior = await client.query(`
      SELECT 1 FROM trace_events WHERE id = $1 AND store_id = $2 AND barcode = $3 AND lot = $4
        AND kind = 'movement' AND actor = $5 AND note = $6 AND stage = $7 AND origin IS NOT DISTINCT FROM $8::text
        AND location = $9 AND quantity IS NOT DISTINCT FROM $10::integer AND warehouse_id IS NOT DISTINCT FROM $11::text`,
    [id, product.storeId, barcode, product.lot, actor, note, stage, origin, location, quantity, warehouseId]);
    if (!prior.rowCount) throw new TraceError(409, 'Bu hareket kimliği başka bir kayıt için kullanıldı.');
    return false;
  });
}

export async function openRecall(product: TraceProduct, actor: string, note: string) {
  await ensureSchema();
  return transaction(async client => {
    await assertNoRecall(client, product);
    const id = randomUUID();
    await client.query(`
      INSERT INTO trace_events (id, store_id, barcode, lot, product_name, kind, actor, note)
      VALUES ($1,$2,$3,$4,$5,'recall_opened',$6,$7)`,
    [id, product.storeId, traceBarcode(product.barcode), product.lot, product.name, actor, note]);
    return id;
  });
}

export async function closeRecall(id: string, scope: string[], actor: string, note: string) {
  await ensureSchema();
  return transaction(async client => {
    const { rows: [recall] } = await client.query<TraceProduct>(`
      SELECT store_id AS "storeId", barcode, lot, product_name AS name FROM trace_events
      WHERE id = $1 AND kind = 'recall_opened' AND store_id = ANY($2::text[])`, [id, scope]);
    if (!recall) throw new TraceError(404, 'Geri çağırma kaydı bulunamadı.');
    await lockLot(client, recall);
    const inserted = await client.query(`
      INSERT INTO trace_events (id, store_id, barcode, lot, product_name, kind, actor, note, recall_id)
      VALUES ($1,$2,$3,$4,$5,'recall_closed',$6,$7,$8)
      ON CONFLICT (recall_id) WHERE recall_id IS NOT NULL DO NOTHING`,
    [randomUUID(), recall.storeId, recall.barcode, recall.lot, recall.name, actor, note, id]);
    if (!inserted.rowCount) throw new TraceError(409, 'Bu geri çağırma zaten kapatıldı.');
  });
}

export async function report(access: TraceAccess, today: string, warningDate: string) {
  await ensureSchema();
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const scope = [access.storeIds, access.warehouseId];
    const operationScope = `${storeColumn} = ANY($1::text[]) AND ($2::text IS NULL OR EXISTS (
      SELECT 1 FROM trace_warehouse_lots l WHERE l.warehouse_id = $2 AND l.lot = p.lot
      AND l.barcode = CASE WHEN p.barcode ~ '^([0-9]{8}|[0-9]{12,14})$' THEN lpad(p.barcode, 14, '0') ELSE p.barcode END))`;
    const eventScope = `e.store_id = ANY($1::text[]) AND ($2::text IS NULL OR EXISTS (
      SELECT 1 FROM trace_warehouse_lots l WHERE l.warehouse_id = $2 AND l.lot = e.lot AND l.barcode = e.barcode))`;
    const { rows } = await client.query(`
    WITH operations AS (
      SELECT id, ${storeColumn} AS store_id, barcode, lot, document
      FROM products p WHERE ${operationScope}
    ), events AS (
      SELECT * FROM trace_events e WHERE ${eventScope} AND ($2::text IS NULL OR e.warehouse_id = $2 OR (${activeRecall}))
    ), controls AS (
      SELECT c.*, r.control_id IS NULL AS pending FROM trace_controls c LEFT JOIN trace_reviews r ON c.id = r.control_id
      WHERE c.store_id = ANY($1::text[]) AND ($2::text IS NULL OR (c.warehouse_id = $2 AND EXISTS (
        SELECT 1 FROM trace_warehouse_lots l WHERE l.warehouse_id = $2 AND l.lot = c.lot AND l.barcode = c.barcode)))
    ), lots AS (
      SELECT store_id, CASE WHEN barcode ~ '^([0-9]{8}|[0-9]{12,14})$' THEN lpad(barcode, 14, '0') ELSE barcode END AS barcode, lot
      FROM operations WHERE barcode IS NOT NULL AND lot IS NOT NULL
      UNION SELECT store_id, barcode, lot FROM events
      UNION SELECT store_id, barcode, lot FROM controls
    ), totals AS (
      SELECT store_id, count(*)::int AS "operations",
        CASE WHEN $2::text IS NULL THEN COALESCE(sum(jsonb_array_length(document->'decisions')), 0)::int ELSE 0 END AS decisions
      FROM operations GROUP BY store_id
    ), movements AS (
      SELECT store_id, count(*) FILTER (WHERE kind = 'movement')::int AS movements,
        count(*) FILTER (WHERE ${activeRecall})::int AS "openRecalls"
      FROM events e GROUP BY store_id
    )
    SELECT s.store_id AS "storeId", COALESCE(l.lots, 0) AS lots, COALESCE(t.operations, 0) AS operations,
      COALESCE(t.decisions, 0) + COALESCE(c.reviewed, 0) AS decisions, COALESCE(c.pending, 0) AS pending,
      COALESCE(m.movements, 0) AS movements, COALESCE(m."openRecalls", 0) AS "openRecalls"
    FROM (SELECT store_id FROM operations UNION SELECT store_id FROM events UNION SELECT store_id FROM controls) s
    LEFT JOIN (SELECT store_id, count(*)::int AS lots FROM lots GROUP BY store_id) l USING (store_id)
    LEFT JOIN totals t USING (store_id) LEFT JOIN movements m USING (store_id)
    LEFT JOIN (SELECT store_id, count(*) FILTER (WHERE pending)::int AS pending,
      count(*) FILTER (WHERE NOT pending)::int AS reviewed FROM controls GROUP BY store_id) c USING (store_id)
    ORDER BY s.store_id`, scope);
    const recalls = await client.query(`
    SELECT ${eventColumns} FROM trace_events e
    WHERE ${eventScope} AND ${activeRecall}
    ORDER BY e.occurred_at DESC, e.id DESC`, scope);
    const risks = await client.query(`
    WITH flagged AS (
      SELECT ${storeColumn} AS "storeId", p.barcode, p.lot, p.document->>'name' AS name,
        CASE
          WHEN p.document->>'expired' = 'true' OR p.document #>> '{details,expiryDate}' < $3 THEN 1
          WHEN p.document->>'type' = 'RKS Blokaj' THEN 2
          WHEN p.document->>'locked' = 'true' THEN 3
          WHEN p.document #>> '{details,expiryDate}' <= $4 THEN 4
        END AS priority
      FROM products p WHERE ${operationScope} AND p.barcode IS NOT NULL AND p.lot IS NOT NULL
    )
    SELECT DISTINCT "storeId", barcode, lot, name, priority,
      (ARRAY['SKT geçmiş', 'RKS blokajı', 'Blokajlı', 'SKT yaklaşıyor'])[priority] AS risk
    FROM flagged WHERE priority IS NOT NULL ORDER BY priority, "storeId", barcode, lot LIMIT 100`, [...scope, today, warningDate]);
    const pending = await client.query(`
      SELECT e.id, e.store_id AS "storeId", e.barcode, e.lot, e.product_name AS name, e.choice, e.checked_at AS time
      FROM trace_controls e WHERE ${eventScope} AND ($2::text IS NULL OR e.warehouse_id = $2)
        AND NOT EXISTS (SELECT 1 FROM trace_reviews r WHERE r.control_id = e.id)
      ORDER BY time DESC, e.id LIMIT 100`, scope);
    return { stores: rows, recalls: recalls.rows, risks: risks.rows, pending: pending.rows };
  });
}

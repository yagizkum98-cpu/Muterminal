import { randomUUID } from 'node:crypto';
import { ensureSchema, query, transaction } from './database';
import { TraceError, traceBarcode } from './trace';
import { traceChoices, warehouseChoice, type TraceAccess } from '../components/trace-policy';

type Product = { id: string; storeId: string; barcode: string; lot: string; name: string };
type Control = { choice: string; note: string; location: string; checks: Record<string, unknown>; followupOf: string | null };

export function canReviewControl(access: TraceAccess, email: string, control: { actor: string; choice: string; warehouseId: string | null }) {
  return access.canReview && control.actor !== email &&
    (access.role !== 'warehouse' || (control.warehouseId === access.warehouseId && control.choice === warehouseChoice));
}

const selectControls = `
  SELECT c.id, c.store_id AS "storeId", c.warehouse_id AS "warehouseId", c.product_id AS "productId",
    c.barcode, c.lot, c.product_name AS name, c.actor, c.location, c.checked_at AS time, c.checks, c.choice, c.note,
    c.followup_of AS "followupOf", r.actor AS reviewer, r.reviewed_at AS "reviewedAt", r.outcome, r.note AS "reviewNote",
    EXISTS (SELECT 1 FROM trace_controls child WHERE child.followup_of = c.id) AS "hasFollowup"
  FROM trace_controls c LEFT JOIN trace_reviews r ON r.control_id = c.id`;

export async function lookupControls(access: TraceAccess, email: string, codes: string[], lot: string | null) {
  const { rows } = await query(`${selectControls}
    WHERE c.store_id = ANY($1::text[]) AND c.barcode = ANY($2::text[]) AND ($3::text IS NULL OR c.lot = $3)
      AND ($4::text IS NULL OR c.warehouse_id = $4) AND ($5::text IS NULL OR c.actor = $5)
    ORDER BY c.checked_at DESC, c.id`, [access.storeIds, codes, lot, access.warehouseId, access.role === 'staff' ? email : null]);
  return rows.map(row => ({ ...row, canReview: !row.outcome && canReviewControl(access, email, {
    actor: row.actor, choice: row.choice, warehouseId: row.warehouseId,
  }) }));
}

export async function addControl(access: TraceAccess, actor: string, product: Product, input: Control) {
  if (!access.canControl || !access.storeIds.includes(product.storeId)) throw new TraceError(403, 'Kontrol kaydı için yetkiniz yok.');
  if (!traceChoices.some(choice => choice === input.choice) || (input.choice === warehouseChoice && !access.warehouseId)) {
    throw new TraceError(400, 'Geçerli bir operasyon kararı seçin. Satışa açma yetkili kaynak sistemde doğrulanır.');
  }
  const barcode = traceBarcode(product.barcode);
  await ensureSchema();
  return transaction(async client => {
    if (access.warehouseId) {
      const assigned = await client.query('SELECT 1 FROM trace_warehouse_lots WHERE warehouse_id = $1 AND barcode = $2 AND lot = $3 FOR SHARE', [access.warehouseId, barcode, product.lot]);
      if (!assigned.rowCount) throw new TraceError(404, 'Lot depoya atanmamış.');
    }
    if (input.followupOf) {
      const prior = await client.query(`
        SELECT 1 FROM trace_controls c JOIN trace_reviews r ON r.control_id = c.id
        WHERE c.id = $1 AND c.store_id = $2 AND c.barcode = $3 AND c.lot = $4 AND c.actor = $5
          AND c.warehouse_id IS NOT DISTINCT FROM $6::text AND r.outcome = 'recheck'`,
      [input.followupOf, product.storeId, barcode, product.lot, actor, access.warehouseId]);
      if (!prior.rowCount) throw new TraceError(404, 'Takip edilebilir ek kontrol bulunamadı.');
    }
    const id = randomUUID();
    const inserted = await client.query(`
      INSERT INTO trace_controls (id, store_id, warehouse_id, product_id, barcode, lot, product_name, actor, location, checks, choice, note, followup_of)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (followup_of) DO NOTHING`,
    [id, product.storeId, access.warehouseId, product.id, barcode, product.lot, product.name, actor, input.location,
      JSON.stringify(input.checks), input.choice, input.note, input.followupOf]);
    if (!inserted.rowCount) throw new TraceError(409, 'Bu talep için ek kontrol zaten kaydedilmiş.');
    return id;
  });
}

export async function reviewControl(access: TraceAccess, actor: string, id: string, outcome: string, note: string) {
  if (!access.canReview) throw new TraceError(403, 'Karar inceleme yetkisi gerekir.');
  if (!['approve', 'reject', 'recheck'].includes(outcome)) throw new TraceError(400, 'Geçerli bir inceleme sonucu seçin.');
  await ensureSchema();
  await transaction(async client => {
    const { rows: [control] } = await client.query<{ actor: string; choice: string; warehouseId: string | null }>(`
      SELECT actor, choice, warehouse_id AS "warehouseId" FROM trace_controls c
      WHERE id = $1 AND store_id = ANY($2::text[]) AND ($3::text IS NULL OR warehouse_id = $3)
        AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM trace_warehouse_lots l
          WHERE l.warehouse_id = $3 AND l.barcode = c.barcode AND l.lot = c.lot))`, [id, access.storeIds, access.warehouseId]);
    if (!control) throw new TraceError(404, 'Karar talebi bulunamadı.');
    if (!canReviewControl(access, actor, control)) throw new TraceError(403, 'Bu talebi bağımsız ve yetkili bir değerlendirici incelemelidir.');
    const result = await client.query('INSERT INTO trace_reviews (control_id, actor, outcome, note) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [id, actor, outcome, note]);
    if (!result.rowCount) throw new TraceError(409, 'Talep daha önce incelendi.');
  });
}

export async function personalReport(access: TraceAccess, actor: string) {
  const { rows: [summary] } = await query(`
    SELECT count(*)::int AS controls, count(r.control_id)::int AS reviewed,
      count(*) FILTER (WHERE r.control_id IS NULL)::int AS pending
    FROM trace_controls c LEFT JOIN trace_reviews r ON r.control_id = c.id
    WHERE c.store_id = ANY($1::text[]) AND c.actor = $2`, [access.storeIds, actor]);
  return summary;
}

import { randomBytes, randomUUID } from 'node:crypto';
import { ensureSchema, hashToken, query, transaction } from './database';
import type { TraceAccess } from '../components/trace-policy';
import { TraceError } from './trace';

type Source = 'core' | 'trace';
type Session = { role: string; email: string; storeId: string; scope?: { role: string; tenantId: string | null }; mobileApproval?: string };
export type MobileStaffState = 'allowed' | 'unassigned' | 'challenge';

function staffKey(session: Session) {
  if (session.role === 'staff') return { tenant: 'pilot', source: 'core' as const, email: session.email, store: session.storeId };
  if (session.role === 'trace' && session.scope?.role === 'staff' && session.scope.tenantId) {
    return { tenant: session.scope.tenantId, source: 'trace' as const, email: session.email, store: session.storeId };
  }
  return null;
}

export async function mobileStaffState(session: Session): Promise<MobileStaffState> {
  const key = staffKey(session);
  if (!key) return 'allowed';
  const { rows: [assignment] } = await query<{ revision: string }>(`
    SELECT revision FROM trace_mobile_staff_codes
    WHERE tenant_id = $1 AND source = $2 AND email = $3 AND store_id = $4`,
  [key.tenant, key.source, key.email, key.store]);
  if (!assignment) return 'unassigned';
  return assignment.revision === session.mobileApproval ? 'allowed' : 'challenge';
}

export async function verifyMobileStaffCode(session: Session, token: string, input: string) {
  const key = staffKey(session);
  if (!key) return false;
  const code = input.trim().replaceAll(/[\s-]/g, '').toUpperCase();
  if (!/^[A-F0-9]{20}$/.test(code)) return false;
  const { rowCount } = await query(`
    UPDATE sessions s SET payload = s.payload || jsonb_build_object('mobile', true, 'mobileApproval', a.revision)
    FROM trace_mobile_staff_codes a
    WHERE s.token_hash = $1 AND s.account_key = $2 AND s.expires_at > now()
      AND a.email = $2 AND a.tenant_id = $3 AND a.source = $4 AND a.store_id = $5 AND a.code_hash = $6`,
  [hashToken(token), key.email, key.tenant, key.source, key.store, hashToken(code)]);
  return Boolean(rowCount);
}

function canManageCodes(access: TraceAccess) {
  return access.role === 'company' || access.role === 'manager';
}

const traceStaff = "document->>'active' = 'true' AND document->>'role' = 'staff' AND document->>'tenantId' = $1";
const coreStaff = "document->>'active' = 'true' AND document->'roles' ? 'staff' AND $1 = 'pilot'";
const coreStore = "COALESCE(document->>'storeId', 'pilot')";

export async function listMobileStaff(access: TraceAccess) {
  if (!canManageCodes(access)) return [];
  const { rows } = await query<{ email: string; name: string; source: Source; storeId: string; assigned: boolean }>(`
    WITH staff AS (
      SELECT email, document->>'displayName' AS name, 'trace' AS source, document->>'storeId' AS store_id
      FROM trace_users WHERE ${traceStaff}
      UNION ALL
      SELECT id, document->>'displayName', 'core', ${coreStore} FROM accounts WHERE ${coreStaff}
    )
    SELECT s.email, COALESCE(s.name, s.email) AS name, s.source, s.store_id AS "storeId", a.revision IS NOT NULL AS assigned
    FROM staff s LEFT JOIN trace_mobile_staff_codes a
      ON a.tenant_id = $1 AND a.source = s.source AND a.email = s.email AND a.store_id = s.store_id
    WHERE s.store_id = ANY($2::text[]) ORDER BY name, s.email, s.source`, [access.tenantId, access.storeIds]);
  return rows;
}

export async function manageMobileCode(access: TraceAccess, actor: string, body: Record<string, unknown>) {
  if (!canManageCodes(access)) throw new TraceError(403, 'Mobil onay kodu yönetimi yetkisi gerekir.');
  const { source, email, action } = body;
  if ((source !== 'trace' && source !== 'core') || typeof email !== 'string' || !email || email.length > 100 ||
      (action !== 'issue' && action !== 'revoke')) throw new TraceError(400, 'Geçerli bir personel ve işlem seçin.');
  await ensureSchema();
  return transaction(async client => {
    const staffQuery = source === 'trace'
      ? `SELECT document->>'storeId' AS store FROM trace_users WHERE ${traceStaff} AND email = $2 FOR SHARE`
      : `SELECT ${coreStore} AS store FROM accounts WHERE ${coreStaff} AND id = $2 FOR SHARE`;
    const { rows: [person] } = await client.query<{ store: string }>(staffQuery, [access.tenantId, email]);
    if (!person || !access.storeIds.includes(person.store)) throw new TraceError(404, 'Kapsamınızda etkin personel bulunamadı.');
    const values = [access.tenantId, source, email, person.store];
    const code = action === 'issue' ? randomBytes(10).toString('hex').toUpperCase() : null;
    if (code) {
      await client.query(`
        INSERT INTO trace_mobile_staff_codes (tenant_id, source, email, store_id, code_hash, revision) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (tenant_id, source, email) DO UPDATE
        SET store_id = EXCLUDED.store_id, code_hash = EXCLUDED.code_hash, revision = EXCLUDED.revision`,
      [...values, hashToken(code), randomUUID()]);
    } else {
      await client.query('DELETE FROM trace_mobile_staff_codes WHERE tenant_id = $1 AND source = $2 AND email = $3 AND store_id = $4', values);
    }
    await client.query('INSERT INTO trace_admin_audit (tenant_id, actor, action, target) VALUES ($1,$2,$3,$4)',
      [access.tenantId, actor, code ? 'Mobil onay kodu tanımlandı' : 'Mobil personel erişimi kilitlendi', `${email} · ${source}`]);
    return { code: code?.match(/.{4}/g)?.join('-') ?? null };
  });
}

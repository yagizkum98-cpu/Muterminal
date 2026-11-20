import { query, ensureSchema, transaction } from './database';
import type { PoolClient } from 'pg';
import { TraceError, traceBarcode } from './trace';
import { traceRoles, type TraceAccess, type TraceRole } from '../components/trace-policy';
import type { TraceStage } from '../components/trace-model';

export interface AccountScope {
  role: TraceRole;
  tenantId: string | null;
  storeId: string | null;
  warehouseId: string | null;
  control: boolean;
  review: boolean;
}

type TraceAccount = AccountScope & { email: string; displayName: string; passwordHash: string; salt: string; active: boolean };
const allStages: TraceStage[] = ['production', 'processing', 'storage', 'logistics', 'store', 'consumer'];
const warehouseStages: TraceStage[] = ['storage', 'logistics'];
const companyRoles = ['manager', 'warehouse', 'staff', 'auditor'];

export async function activeTraceAccount(email: string) {
  const { rows } = await query<{ document: TraceAccount }>("SELECT document FROM trace_users WHERE email = $1 AND document->>'active' = 'true'", [email]);
  return rows[0]?.document;
}

export async function changeTracePassword(email: string, previousHash: string, credentials: { passwordHash: string; salt: string }) {
  const { rowCount } = await query(`
    UPDATE trace_users SET document = document || $3::jsonb
    WHERE email = $1 AND document->>'passwordHash' = $2 AND document->>'active' = 'true'
  `, [email, previousHash, JSON.stringify(credentials)]);
  return rowCount === 1;
}

export async function seedTraceAccount(account: TraceAccount, passwordRevision?: string) {
  if (!passwordRevision) {
    await query('INSERT INTO trace_users VALUES ($1, $2) ON CONFLICT DO NOTHING', [account.email, JSON.stringify(account)]);
    return;
  }
  const { passwordHash, salt } = account;
  await query(`
    INSERT INTO trace_users (email, document) VALUES ($1, $2)
    ON CONFLICT (email) DO UPDATE SET document = trace_users.document || $3::jsonb
    WHERE trace_users.document->>'role' = $5
      AND trace_users.document->>'tenantId' = 'pilot'
      AND trace_users.document->>'passwordRevision' IS DISTINCT FROM $4
  `, [account.email, JSON.stringify({ ...account, passwordRevision }), JSON.stringify({ passwordHash, salt, passwordRevision }), passwordRevision, account.role]);
}

export async function traceStoreLocations(tenantId: string) {
  const { rows } = await query<{ id: string; name: string }>(`
    SELECT ts.store_id AS id, COALESCE(ts.name, s.document->>'name',
      CASE WHEN ts.store_id = 'pilot' THEN 'Pilot Mağaza' ELSE ts.store_id END) AS name
    FROM trace_stores ts LEFT JOIN stores s ON s.id = ts.store_id WHERE ts.tenant_id = $1
    UNION ALL
    SELECT s.id, COALESCE(s.document->>'name', s.id) FROM stores s
    LEFT JOIN trace_stores ts ON ts.store_id = s.id
    WHERE s.id <> 'pilot' AND ts.store_id IS NULL AND $1 = 'pilot'
    ORDER BY name, id`, [tenantId]);
  return rows;
}

export async function retailChains() {
  const { rows } = await query<{ id: string; name: string }>('SELECT id, name FROM trace_tenants ORDER BY name');
  return rows;
}

export async function createRetailChain(id: string, name: string) {
  await query(`
    INSERT INTO trace_tenants (id, name, expiry_warning_days)
    SELECT $1, $2, default_warning_days FROM trace_platform_settings WHERE id
  `, [id, name]);
}

export async function createRetailStore(id: string, tenantId: string, store: { name: string; province?: string; district?: string }) {
  await ensureSchema();
  await transaction(async client => {
    const tenant = await client.query('SELECT 1 FROM trace_tenants WHERE id = $1 FOR KEY SHARE', [tenantId]);
    if (!tenant.rowCount) throw new TraceError(400, 'Geçerli bir market zinciri seçin.');
    await client.query('INSERT INTO stores (id, document) VALUES ($1, $2)', [id, JSON.stringify(store)]);
    await client.query('INSERT INTO trace_stores (store_id, tenant_id) VALUES ($1, $2)', [id, tenantId]);
  });
}

export async function resolveTraceAccess(session: { role: string; storeId: string; scope?: AccountScope; canApprove: boolean }): Promise<TraceAccess> {
  let scope = session.scope;
  if (!scope) {
    const role = session.role === 'admin' ? 'company' : session.role === 'manager' ? 'manager' : 'staff';
    const tenant = session.storeId === 'pilot' ? null
      : await query<{ tenant_id: string }>('SELECT tenant_id FROM trace_stores WHERE store_id = $1', [session.storeId]);
    scope = {
      role, tenantId: tenant?.rows[0]?.tenant_id ?? 'pilot',
      storeId: role === 'company' ? null : session.storeId, warehouseId: null,
      control: false, review: role === 'company' && session.canApprove,
    };
  }
  const { role, tenantId, storeId, warehouseId, control, review } = scope;
  const locations = tenantId ? await traceStoreLocations(tenantId) : [];
  const storeIds = locations.map(location => location.id).filter(id => !storeId || storeId === id);
  return {
    role, tenantId, storeIds, warehouseId,
    canControl: role === 'staff' || role === 'manager' || role === 'warehouse' || (role === 'company' && control),
    canReview: role === 'manager' || role === 'warehouse' || (role === 'company' && review),
    canRecall: role === 'manager' || (role === 'company' && review),
    canManage: ['super', 'company', 'manager'].includes(role),
    stages: role === 'company' ? allStages : role === 'warehouse' ? warehouseStages : role === 'manager' ? ['store'] : [],
  };
}

export async function traceWarningDays(tenantId: string | null) {
  const { rows } = await query<{ expiry_warning_days: number }>('SELECT expiry_warning_days FROM trace_tenants WHERE id = $1', [tenantId]);
  return rows[0]?.expiry_warning_days ?? 7;
}

export async function warehousesInStores(storeIds: string[]) {
  const { rows } = await query<{ id: string; name: string; storeId: string }>(
    'SELECT id, name, store_id AS "storeId" FROM trace_warehouses WHERE store_id = ANY($1::text[]) ORDER BY name', [storeIds]);
  return rows;
}

export async function warehouseSignInScope(storeId: string, warehouseId?: string): Promise<AccountScope | undefined> {
  const { rows } = await query<{ id: string; tenant_id: string }>(`
    SELECT w.id, s.tenant_id FROM trace_warehouses w
    JOIN trace_stores s ON s.store_id = w.store_id
    WHERE w.store_id = $1 AND ($2::text IS NULL OR w.id = $2)
    LIMIT 2
  `, [storeId, warehouseId ?? null]);
  if (rows.length === 1) return {
    role: 'warehouse', tenantId: rows[0].tenant_id, storeId, warehouseId: rows[0].id, control: false, review: false,
  };
}

export async function warehouseLots(warehouseId: string) {
  const { rows } = await query<{ barcode: string; lot: string }>('SELECT barcode, lot FROM trace_warehouse_lots WHERE warehouse_id = $1', [warehouseId]);
  return new Set(rows.map(({ barcode, lot }) => JSON.stringify([barcode, lot])));
}

function mayManageRole(access: TraceAccess, role: string, tenantId: string | null, storeId: string | null) {
  if (access.role === 'super') return role === 'company' && Boolean(tenantId);
  if (tenantId !== access.tenantId) return false;
  if (access.role === 'company') return companyRoles.includes(role);
  return access.role === 'manager' && role === 'staff' && Boolean(storeId && access.storeIds.includes(storeId));
}

function text(value: unknown, label: string, max: number) {
  if (typeof value === 'string' && value.trim() && value.trim().length <= max) return value.trim();
  throw new TraceError(400, `${label} için geçerli bir değer girin.`);
}

function locationId(value: unknown) {
  const id = text(value, 'Kod', 50);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new TraceError(400, 'Kod küçük harf, sayı ve tire içerebilir.');
  return id;
}

async function audit(client: PoolClient, tenantId: string | null, actor: string, action: string, target: string, platform = false) {
  await client.query('INSERT INTO trace_admin_audit (tenant_id, actor, action, target, platform) VALUES ($1,$2,$3,$4,$5)',
    [tenantId, actor, action, target, platform]);
}

export async function traceManagement(access: TraceAccess) {
  if (!access.canManage) throw new TraceError(403, 'MU TRACE kullanıcı yönetimi yetkisi gerekir.');
  const platform = access.role === 'super';
  const [tenants, people, stores, warehouses, warningDays, history] = await Promise.all([
    query('SELECT id, name FROM trace_tenants WHERE $1::boolean OR id = $2 ORDER BY name', [platform, access.tenantId]),
    query<{ document: Omit<TraceAccount, 'passwordHash' | 'salt'> }>(`
      SELECT document - 'passwordHash' - 'salt' AS document FROM trace_users
      WHERE ($1::boolean AND document->>'role' = 'company') OR document->>'tenantId' = $2 ORDER BY email`, [platform, access.tenantId]),
    access.tenantId ? traceStoreLocations(access.tenantId) : [],
    warehousesInStores(access.storeIds),
    platform ? query<{ default_warning_days: number }>('SELECT default_warning_days FROM trace_platform_settings WHERE id')
      .then(result => result.rows[0].default_warning_days) : traceWarningDays(access.tenantId),
    access.role === 'manager' ? { rows: [] } : query(`
      SELECT actor, action, target, occurred_at AS time FROM trace_admin_audit
      WHERE ($1::boolean AND platform) OR tenant_id = $2 ORDER BY occurred_at DESC, id DESC LIMIT 100`, [platform, access.tenantId]),
  ]);
  const users = people.rows.map(row => row.document).filter(user => mayManageRole(access, user.role, user.tenantId, user.storeId))
    .map(({ email, displayName, active, role, tenantId, storeId, warehouseId, control, review }) =>
      ({ email, displayName, active, role, tenantId, storeId, warehouseId, control, review }));
  return { tenants: tenants.rows, users, stores: stores.filter(store => access.storeIds.includes(store.id)),
    warehouses, warningDays, history: history.rows };
}

export async function changeTraceManagement(access: TraceAccess, actor: string, action: string, body: Record<string, unknown>,
  passwordCredentials: (password: unknown) => Promise<{ salt: string; passwordHash: string }>) {
  if (!access.canManage) throw new TraceError(403, 'MU TRACE yönetim yetkisi gerekir.');
  await ensureSchema();
  return transaction(async client => {
    const tenant = access.tenantId;
    if (action === 'tenants' && access.role === 'super') {
      const id = locationId(body.id);
      await client.query(`INSERT INTO trace_tenants (id,name,expiry_warning_days)
        SELECT $1,$2,default_warning_days FROM trace_platform_settings WHERE id`, [id, text(body.name, 'Firma adı', 100)]);
      return audit(client, id, actor, 'Firma oluşturuldu', id, true);
    }
    if (action === 'stores' && access.role === 'company') {
      const id = locationId(body.id);
      if ((await client.query('SELECT 1 FROM stores WHERE id = $1', [id])).rowCount) throw new TraceError(409, 'Bu mağaza kodu kullanılıyor.');
      await client.query('INSERT INTO trace_stores (store_id, tenant_id, name) VALUES ($1,$2,$3)', [id, tenant, text(body.name, 'Mağaza adı', 100)]);
      return audit(client, tenant, actor, 'Mağaza oluşturuldu', id);
    }
    if (action === 'warehouses' && access.role === 'company') {
      const id = locationId(body.id);
      const store = locationId(body.storeId);
      if (!access.storeIds.includes(store)) throw new TraceError(404, 'Mağaza bulunamadı.');
      await client.query('INSERT INTO trace_stores (store_id,tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [store, tenant]);
      await client.query('INSERT INTO trace_warehouses VALUES ($1,$2,$3)', [id, store, text(body.name, 'Depo adı', 100)]);
      return audit(client, tenant, actor, 'Depo oluşturuldu', id);
    }
    if (action === 'settings' && ['super', 'company'].includes(access.role)) {
      const days = body.warningDays;
      if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 90) throw new TraceError(400, 'SKT uyarısı 0–90 gün olmalıdır.');
      if (access.role === 'super') await client.query('UPDATE trace_platform_settings SET default_warning_days = $1 WHERE id', [days]);
      else await client.query('UPDATE trace_tenants SET expiry_warning_days = $2 WHERE id = $1', [tenant, days]);
      return audit(client, tenant, actor, 'SKT uyarısı güncellendi', String(days), access.role === 'super');
    }
    if (!['users', 'permissions', 'status', 'password'].includes(action)) throw new TraceError(403, 'Bu yönetim işlemi için yetkiniz yok.');
    const email = text(body.email, 'Kullanıcı adı', 100).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TraceError(400, 'Geçerli bir e-posta girin.');
    const { rows: [existing] } = await client.query<{ document: TraceAccount }>('SELECT document FROM trace_users WHERE email = $1 FOR UPDATE', [email]);
    if (action !== 'users' && (!existing || !mayManageRole(access, existing.document.role, existing.document.tenantId, existing.document.storeId))) {
      throw new TraceError(404, 'Yönetilebilir kullanıcı bulunamadı.');
    }
    if (action === 'status') {
      if (typeof body.active !== 'boolean') throw new TraceError(400, 'Hesap durumu geçersiz.');
      await client.query("UPDATE trace_users SET document = jsonb_set(document, '{active}', to_jsonb($2::boolean)) WHERE email = $1", [email, body.active]);
      await client.query("DELETE FROM sessions WHERE account_key = $1 AND payload->>'role' = 'trace'", [email]);
      return audit(client, existing!.document.tenantId, actor, 'Kullanıcı durumu güncellendi', email, access.role === 'super');
    }
    if (action === 'password') {
      const credentials = await passwordCredentials(body.password);
      await client.query('UPDATE trace_users SET document = document || $2::jsonb WHERE email = $1', [email, JSON.stringify(credentials)]);
      await client.query("DELETE FROM sessions WHERE account_key = $1 AND payload->>'role' = 'trace'", [email]);
      return audit(client, existing!.document.tenantId, actor, 'Kullanıcı şifresi yenilendi', email, access.role === 'super');
    }
    const role = text(body.role, 'Rol', 30) as TraceRole;
    if (!Object.hasOwn(traceRoles, role)) throw new TraceError(400, 'Geçerli bir rol seçin.');
    const tenantId = access.role === 'super' ? locationId(body.tenantId) : tenant;
    const storeId = body.storeId ? locationId(body.storeId) : null;
    const warehouseId = body.warehouseId ? locationId(body.warehouseId) : null;
    if (!mayManageRole(access, role, tenantId, storeId)) throw new TraceError(403, 'Bu rol veya kapsam atanamaz.');
    if (['manager', 'staff', 'warehouse'].includes(role) && !storeId) throw new TraceError(400, 'Bu rol için mağaza seçin.');
    if (role === 'company' && storeId) throw new TraceError(400, 'Firma admini firma kapsamında atanır.');
    if (storeId && !access.storeIds.includes(storeId)) throw new TraceError(404, 'Mağaza bulunamadı.');
    if (role === 'warehouse') {
      const found = await client.query('SELECT 1 FROM trace_warehouses WHERE id = $1 AND store_id = $2', [warehouseId, storeId]);
      if (!found.rowCount) throw new TraceError(404, 'Seçilen mağazaya bağlı depo bulunamadı.');
    } else if (warehouseId) throw new TraceError(400, 'Depo ataması depo yetkilisi rolüne aittir.');
    if (!(await client.query('SELECT 1 FROM trace_tenants WHERE id = $1', [tenantId])).rowCount) throw new TraceError(404, 'Firma bulunamadı.');
    const fields = { role, tenantId, storeId, warehouseId, control: role === 'company' && body.control === true,
      review: role === 'company' && body.review === true, displayName: text(body.displayName, 'Ad soyad', 100) };
    if (action === 'users') {
      await client.query('INSERT INTO trace_users VALUES ($1,$2)', [email, JSON.stringify({
        ...fields, email, active: true, ...await passwordCredentials(body.password),
      })]);
    } else {
      if (existing!.document.tenantId !== tenantId) throw new TraceError(400, 'Mevcut hesabın firması değiştirilemez.');
      await client.query('UPDATE trace_users SET document = document || $2::jsonb WHERE email = $1', [email, JSON.stringify(fields)]);
      await client.query("DELETE FROM sessions WHERE account_key = $1 AND payload->>'role' = 'trace'", [email]);
    }
    await audit(client, tenantId, actor, action === 'users' ? 'Kullanıcı oluşturuldu' : 'Kullanıcı yetkisi güncellendi', email, access.role === 'super');
  });
}

export async function assignWarehouseLot(access: TraceAccess, actor: string, key: { storeId: string; barcode: string; lot: string }, id: unknown, enabled: boolean) {
  if (access.role !== 'company' || !access.storeIds.includes(key.storeId)) throw new TraceError(403, 'Depo lot ataması firma adminine aittir.');
  const warehouse = locationId(id);
  await ensureSchema();
  await transaction(async client => {
    const found = await client.query('SELECT 1 FROM trace_warehouses WHERE id = $1 AND store_id = $2', [warehouse, key.storeId]);
    if (!found.rowCount) throw new TraceError(404, 'Depo bulunamadı.');
    const values = [warehouse, traceBarcode(key.barcode), key.lot];
    if (enabled) await client.query('INSERT INTO trace_warehouse_lots VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', values);
    else await client.query('DELETE FROM trace_warehouse_lots WHERE warehouse_id = $1 AND barcode = $2 AND lot = $3', values);
    await audit(client, access.tenantId, actor, enabled ? 'Depoya lot atandı' : 'Depodan lot kaldırıldı', values.join(' · '));
  });
}

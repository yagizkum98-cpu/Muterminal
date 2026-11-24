import { createECDH, ECDH, timingSafeEqual } from 'node:crypto';
import webPush from 'web-push';
import { ensureSchema, hashToken, query, transaction } from './database';
import { resolveTraceAccess, type AccountScope } from './trace-access';
import { mobileStaffKey } from './mobile-access';
import { languageFromCookie, translate, type Language } from '../lib/language';
import { notificationCategories, type NotificationCategory } from '../lib/notification-categories';

interface Session {
  email: string;
  role: 'admin' | 'manager' | 'staff' | 'trace';
  storeId: string;
  scope?: AccountScope;
  canApprove: boolean;
  coreWarehouseId?: string;
  mobileApproval?: string;
  canSwitchPanels?: boolean;
}

const expiryMessages = {
  approaching: 'Bir lotun son kullanma tarihi yaklaşıyor.',
  today: 'Bir lotun son kullanma tarihi bugün.',
  expired: 'Bir lotun son kullanma tarihi geçti.',
} as const;
const messages = {
  control: 'Yeni bir kontrol veya inceleme kaydı var.',
  expiry: 'Son kullanma tarihi uyarısı var.',
  operation: 'Önemli bir operasyon güncellendi.',
  warehouse: 'Yeni bir depo işlemi veya lot ataması var.',
} as const;

export function pushConfiguration() {
  if (process.env.MUTERMINAL_NOTIFICATIONS_ENABLED !== 'true') return null;
  const publicKey = process.env.MUTERMINAL_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.MUTERMINAL_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.MUTERMINAL_VAPID_SUBJECT?.trim();
  if (!subject || !publicKey || !privateKey) return null;
  try {
    if (!validKey(privateKey, 32)) return null;
    const keyPair = createECDH('prime256v1');
    keyPair.setPrivateKey(privateKey, 'base64url');
    if (keyPair.getPublicKey('base64url', 'uncompressed') !== publicKey) return null;
    webPush.setVapidDetails(subject, publicKey, privateKey);
    return { subject, publicKey, privateKey };
  } catch {
    return null;
  }
}

export function authorizedDispatch(header: unknown) {
  const secret = process.env.MUTERMINAL_NOTIFICATION_DISPATCH_TOKEN;
  if (!secret || secret.length < 32 || typeof header !== 'string') return false;
  return timingSafeEqual(Buffer.from(hashToken(header), 'hex'), Buffer.from(hashToken(`Bearer ${secret}`), 'hex'));
}

function supportedEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const { protocol, username, password, port, hostname, hash, pathname } = new URL(value);
    return protocol === 'https:' && !username && !password && !port && !hash && pathname.length > 1 &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(hostname) ||
        hostname.endsWith('.push.apple.com') || hostname.endsWith('.notify.windows.com'));
  } catch {
    return false;
  }
}

function validKey(value: unknown, size: number): value is string {
  return typeof value === 'string' && /^[\w-]+$/.test(value) && Buffer.from(value, 'base64url').length === size;
}

function validDeviceId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
}

function accountSource(session: Session) {
  return session.role === 'trace' && !session.coreWarehouseId ? 'trace' : 'core';
}

export async function deviceSettings(session: Session, id: unknown, token: string) {
  const config = pushConfiguration();
  const { rows } = validDeviceId(id) ? await query<{ categories: NotificationCategory[] }>(`
    WITH signed_in AS (
      SELECT token_hash FROM sessions WHERE token_hash = $4 AND expires_at > now() FOR SHARE
    ), rebound AS (
      UPDATE notification_subscriptions SET session_key = signed_in.token_hash FROM signed_in
      WHERE id = $1 AND account = $2 AND account_source = $3 AND session_key <> signed_in.token_hash RETURNING categories
    ) SELECT categories FROM rebound UNION ALL
      SELECT ns.categories FROM notification_subscriptions ns JOIN signed_in ON ns.session_key = signed_in.token_hash
      WHERE id = $1 AND account = $2 AND account_source = $3
  `, [id, session.email, accountSource(session), hashToken(token)]) : { rows: [] };
  return { publicKey: config?.publicKey ?? null, categories: rows[0]?.categories ?? [] };
}

export async function removeDevice(session: Session, id: unknown) {
  if (!validDeviceId(id)) return;
  await query('DELETE FROM notification_subscriptions WHERE id = $1 AND account = $2 AND account_source = $3',
    [id, session.email, accountSource(session)]);
}

export async function saveDevice(session: Session, token: string, body: Record<string, unknown>, cookie: string | undefined, mobile: boolean) {
  const { endpoint, keys, categories } = body;
  if (!supportedEndpoint(endpoint) || !keys || typeof keys !== 'object' || !Array.isArray(categories) ||
    categories.length === 0 || categories.length > Object.keys(notificationCategories).length ||
    !categories.every(key => typeof key === 'string' && Object.hasOwn(notificationCategories, key))) return false;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (!validKey(p256dh, 65) || !validKey(auth, 16)) return false;
  try {
    if (ECDH.convertKey(p256dh, 'prime256v1', 'base64url', 'base64url', 'uncompressed') !== p256dh) return false;
  } catch {
    return false;
  }
  const { role, storeIds, tenantId, warehouseId } = await resolveTraceAccess(session);
  const personal = session.role === 'staff' || role === 'staff';
  const coreStores = session.role === 'admin' ? null : session.role !== 'trace' ? [session.storeId] : [];
  const target = mobile ? '/mobil' : session.role !== 'trace' ? `/${session.role}` : warehouseId ? '/trace?panel=depo' : '/trace';
  const id = hashToken(endpoint);
  await ensureSchema();
  return transaction(async client => {
    const sessionCheck = await client.query('SELECT 1 FROM sessions WHERE token_hash = $1 AND expires_at > now() FOR SHARE', [hashToken(token)]);
    if (!sessionCheck.rowCount) return false;
    const mobileStaff = mobile ? mobileStaffKey(session) : null;
    if (mobileStaff) {
      const approval = await client.query(`SELECT 1 FROM trace_mobile_staff_codes WHERE tenant_id = $1 AND source = $2
        AND email = $3 AND store_id = $4 AND revision::text = $5 FOR SHARE`,
      [mobileStaff.tenant, mobileStaff.source, mobileStaff.email, mobileStaff.store, session.mobileApproval]);
      if (!approval.rowCount) return false;
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
    await client.query('DELETE FROM notification_subscriptions WHERE id = $1', [id]);
    await client.query(`INSERT INTO notification_subscriptions
      (id, account, account_source, session_key, endpoint, p256dh, auth, language, categories,
       core_stores, trace_stores, tenant_id, warehouse_id, personal, mobile, target)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [
      id, session.email, accountSource(session), hashToken(token), endpoint, p256dh, auth,
      languageFromCookie(cookie), [...new Set(categories)], coreStores, storeIds, tenantId, warehouseId, personal, mobile, target,
    ]);
    return true;
  });
}

async function queueExpiryNotices() {
  await ensureSchema();
  await transaction(async client => {
    const check = await client.query(`INSERT INTO notification_expiry_check VALUES (true, now())
      ON CONFLICT (id) DO UPDATE SET checked_at = now()
      WHERE notification_expiry_check.checked_at <= now() - interval '1 minute' RETURNING id`);
    if (!check.rowCount) return;
    await client.query(`DELETE FROM notification_deliveries WHERE expires_at <= now()`);
    await client.query(`DELETE FROM notification_events WHERE created_at < now() - interval '100 days'`);
    await client.query(`WITH settings AS (
      SELECT (now() AT TIME ZONE 'Europe/Istanbul')::date AS today,
        COALESCE((SELECT CASE WHEN document->>'expiryWarningDays' ~ '^[0-9]{1,2}$'
          THEN LEAST(90, (document->>'expiryWarningDays')::int) END FROM system_settings WHERE id = 'system'), 7) AS warning_days
    ), lots AS (
      SELECT COALESCE(store_id, 'pilot') AS store,
        CASE WHEN barcode ~ '^([0-9]{8}|[0-9]{12,14})$' THEN lpad(barcode, 14, '0') ELSE barcode END AS normalized_barcode,
        lot, array_agg(DISTINCT document->>'createdBy') AS owners, document#>>'{details,expiryDate}' AS expiry, settings.today
      FROM products CROSS JOIN settings
      WHERE document#>>'{details,expiryDate}' BETWEEN to_char(today - 1, 'YYYY-MM-DD') AND to_char(today + warning_days, 'YYYY-MM-DD')
        AND document#>>'{details,expiryDate}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND EXISTS (SELECT 1 FROM notification_subscriptions WHERE 'expiry' = ANY(categories))
      GROUP BY store, normalized_barcode, lot, expiry, settings.today
    ), notices AS (
      SELECT *, CASE WHEN expiry = to_char(today, 'YYYY-MM-DD') THEN 'today'
        WHEN expiry < to_char(today, 'YYYY-MM-DD') THEN 'expired' ELSE 'approaching' END AS phase FROM lots
    ) SELECT queue_notification('expiry:' || md5(jsonb_build_array(store, normalized_barcode, lot, expiry, phase)::text),
      'expiry', store, normalized_barcode, lot, NULL, owners, NULL, NULL, phase) FROM notices`);
  });
}

interface Delivery {
  event_id: string;
  subscription_id: string;
  category: NotificationCategory;
  expiry_status: keyof typeof expiryMessages | null;
  attempts: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  language: Language;
  target: string;
}

export async function dispatchNotifications() {
  const vapidDetails = pushConfiguration();
  if (!vapidDetails) return { enabled: false, processed: 0 };
  await queueExpiryNotices();
  const { rows } = await query<Delivery>(`WITH ready AS (
    SELECT event_id, subscription_id FROM notification_deliveries WHERE available_at <= now() AND expires_at > now()
    ORDER BY available_at LIMIT 16 FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE notification_deliveries d SET attempts = d.attempts + 1, available_at = now() + interval '2 minutes'
    FROM ready WHERE d.event_id = ready.event_id AND d.subscription_id = ready.subscription_id RETURNING d.*
  ) SELECT claimed.*, s.endpoint, s.p256dh, s.auth, s.language, s.target
    FROM claimed JOIN notification_subscriptions s ON s.id = claimed.subscription_id`);
  await Promise.all(rows.map(async delivery => {
    const { event_id, subscription_id, category, expiry_status, language, endpoint, p256dh, auth, target, attempts } = delivery;
    const tag = hashToken(event_id).slice(0, 32);
    const body = category === 'expiry' && expiry_status ? expiryMessages[expiry_status] : messages[category];
    const push = JSON.stringify({ title: `MuTerminal · ${translate(language, notificationCategories[category])}`,
      body: translate(language, body), target, tag });
    let status: number | undefined;
    try {
      if (!supportedEndpoint(endpoint)) status = 410;
      else {
        await webPush.sendNotification({ endpoint, keys: { p256dh, auth } }, push,
          { vapidDetails, TTL: 3600, timeout: 5000, topic: tag, urgency: category === 'operation' ? 'high' : 'normal' });
        status = 201;
      }
    } catch (error) {
      status = (error as { statusCode?: number }).statusCode;
    }
    if (status === 404 || status === 410) {
      await query('DELETE FROM notification_subscriptions WHERE id = $1 AND endpoint = $2 AND auth = $3', [subscription_id, endpoint, auth]);
    } else if ((status == null || status === 429 || status >= 500) && attempts < 5) {
      await query(`UPDATE notification_deliveries SET available_at = now() + $4 * interval '1 minute'
        WHERE event_id = $1 AND subscription_id = $2 AND attempts = $3`, [event_id, subscription_id, attempts, 2 ** (attempts - 1)]);
    } else {
      await query('DELETE FROM notification_deliveries WHERE event_id = $1 AND subscription_id = $2 AND attempts = $3', [event_id, subscription_id, attempts]);
    }
  }));
  return { enabled: true, processed: rows.length };
}

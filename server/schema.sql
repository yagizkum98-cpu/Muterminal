CREATE TABLE IF NOT EXISTS stores (
  id text PRIMARY KEY,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object')
);

CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  store_id text GENERATED ALWAYS AS (document->>'storeId') STORED
);
CREATE INDEX IF NOT EXISTS accounts_store_idx ON accounts (store_id);

CREATE TABLE IF NOT EXISTS account_password_overrides (
  id text PRIMARY KEY,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object')
);

CREATE TABLE IF NOT EXISTS system_settings (
  id text PRIMARY KEY,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object')
);

CREATE TABLE IF NOT EXISTS department_options (
  id text PRIMARY KEY,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object')
);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  store_id text GENERATED ALWAYS AS (document->>'storeId') STORED,
  barcode text GENERATED ALWAYS AS (document->>'code') STORED,
  lot text GENERATED ALWAYS AS (document->>'lot') STORED,
  CHECK (NOT (document ? 'decisions') OR jsonb_typeof(document->'decisions') = 'array')
);
CREATE INDEX IF NOT EXISTS products_store_barcode_lot_idx ON products (store_id, barcode, lot);

CREATE TABLE IF NOT EXISTS pilot_catalog (
  id text PRIMARY KEY,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object')
);
CREATE INDEX IF NOT EXISTS pilot_catalog_product_code_idx ON pilot_catalog ((document->>'storeId'), (document->>'productCode'));

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  store_id text NOT NULL,
  barcode text NOT NULL,
  warehouse_code text NOT NULL,
  quantity integer NOT NULL,
  source_updated_at timestamptz NOT NULL,
  imported_by text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, barcode, warehouse_code)
);

CREATE TABLE IF NOT EXISTS product_evidence (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  actor text NOT NULL,
  photo bytea NOT NULL CHECK (octet_length(photo) BETWEEN 4 AND 524288)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  credential_tag text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account_key);
CREATE INDEX IF NOT EXISTS sessions_expiration_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS login_challenges (
  id text PRIMARY KEY,
  code text NOT NULL,
  image bytea NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS login_challenges_expiration_idx ON login_challenges (expires_at);

CREATE TABLE IF NOT EXISTS login_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS login_limits_expiration_idx ON login_limits (expires_at);

CREATE INDEX IF NOT EXISTS products_trace_barcode_idx ON products (barcode, store_id, lot);
CREATE INDEX IF NOT EXISTS products_trace_product_code_idx ON products ((document->>'productCode'));

CREATE TABLE IF NOT EXISTS trace_events (
  id uuid PRIMARY KEY,
  store_id text NOT NULL,
  barcode text NOT NULL,
  lot text NOT NULL,
  product_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('movement', 'recall_opened', 'recall_closed')),
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000),
  stage text CHECK (stage IN ('production', 'processing', 'storage', 'logistics', 'store', 'consumer')),
  origin text,
  location text,
  quantity integer CHECK (quantity > 0),
  recall_id uuid REFERENCES trace_events(id),
  CHECK (
    (kind = 'movement' AND stage IS NOT NULL AND location IS NOT NULL AND recall_id IS NULL)
    OR (kind = 'recall_opened' AND stage IS NULL AND origin IS NULL AND location IS NULL AND quantity IS NULL AND recall_id IS NULL)
    OR (kind = 'recall_closed' AND stage IS NULL AND origin IS NULL AND location IS NULL AND quantity IS NULL AND recall_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS trace_events_lookup_idx ON trace_events (barcode, store_id, lot, occurred_at DESC);
CREATE INDEX IF NOT EXISTS trace_events_store_idx ON trace_events (store_id, kind, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS trace_events_one_recall_close_idx ON trace_events (recall_id) WHERE recall_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS trace_tenants (
  id text PRIMARY KEY,
  name text NOT NULL,
  expiry_warning_days integer NOT NULL DEFAULT 7 CHECK (expiry_warning_days BETWEEN 0 AND 90)
);
INSERT INTO trace_tenants (id, name) VALUES ('pilot', 'FİLE Market · Pilot') ON CONFLICT DO NOTHING;
INSERT INTO trace_tenants (id, name) VALUES
  ('migros', 'Migros'),
  ('macrocenter', 'Macrocenter')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS trace_stores (
  store_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES trace_tenants(id)
);
ALTER TABLE trace_stores ADD COLUMN IF NOT EXISTS name text;
INSERT INTO trace_stores (store_id, tenant_id) VALUES ('pilot', 'pilot') ON CONFLICT DO NOTHING;
INSERT INTO stores (id, document) VALUES ('f373', jsonb_build_object(
  'name', 'F373 · FİLE Market · Fethiye / Muğla',
  'province', 'Muğla', 'district', 'Fethiye'
)) ON CONFLICT DO NOTHING;
INSERT INTO trace_stores (store_id, tenant_id) VALUES ('f373', 'pilot') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS trace_platform_settings (
  id boolean PRIMARY KEY CHECK (id),
  default_warning_days integer NOT NULL DEFAULT 7 CHECK (default_warning_days BETWEEN 0 AND 90)
);
INSERT INTO trace_platform_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS trace_warehouses (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES trace_stores(store_id),
  name text NOT NULL
);
INSERT INTO trace_warehouses VALUES ('pilot-depo', 'pilot', 'Pilot Depo') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS trace_warehouse_lots (
  warehouse_id text NOT NULL REFERENCES trace_warehouses(id),
  barcode text NOT NULL,
  lot text NOT NULL,
  PRIMARY KEY (warehouse_id, barcode, lot)
);
ALTER TABLE trace_events ADD COLUMN IF NOT EXISTS warehouse_id text REFERENCES trace_warehouses(id);

CREATE TABLE IF NOT EXISTS trace_users (
  email text PRIMARY KEY,
  document jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS trace_controls (
  id uuid PRIMARY KEY,
  store_id text NOT NULL,
  warehouse_id text REFERENCES trace_warehouses(id),
  product_id text NOT NULL,
  barcode text NOT NULL,
  lot text NOT NULL,
  product_name text NOT NULL,
  actor text NOT NULL,
  location text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  checks jsonb NOT NULL,
  choice text NOT NULL,
  note text NOT NULL,
  followup_of uuid UNIQUE REFERENCES trace_controls(id)
);
CREATE INDEX IF NOT EXISTS trace_controls_lot_idx ON trace_controls (store_id, barcode, lot, checked_at DESC);

CREATE TABLE IF NOT EXISTS trace_reviews (
  control_id uuid PRIMARY KEY REFERENCES trace_controls(id),
  actor text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  outcome text NOT NULL CHECK (outcome IN ('approve', 'reject', 'recheck')),
  note text NOT NULL
);

CREATE TABLE IF NOT EXISTS trace_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text REFERENCES trace_tenants(id),
  actor text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE trace_admin_audit ADD COLUMN IF NOT EXISTS platform boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS trace_mobile_staff_codes (
  tenant_id text NOT NULL REFERENCES trace_tenants(id),
  source text NOT NULL CHECK (source IN ('core', 'trace')),
  email text NOT NULL,
  store_id text NOT NULL,
  code_hash text NOT NULL,
  revision uuid NOT NULL,
  PRIMARY KEY (tenant_id, source, email)
);

CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id text PRIMARY KEY,
  account text NOT NULL,
  account_source text NOT NULL CHECK (account_source IN ('core', 'trace')),
  session_key text NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  language text NOT NULL CHECK (language IN ('tr', 'en')),
  categories text[] NOT NULL,
  core_stores text[],
  trace_stores text[] NOT NULL,
  tenant_id text,
  warehouse_id text REFERENCES trace_warehouses(id) ON DELETE CASCADE,
  personal boolean NOT NULL,
  mobile boolean NOT NULL,
  target text NOT NULL
);
CREATE INDEX IF NOT EXISTS notification_subscriptions_account_idx ON notification_subscriptions (account, account_source);
CREATE INDEX IF NOT EXISTS notification_subscriptions_session_idx ON notification_subscriptions (session_key);

CREATE TABLE IF NOT EXISTS notification_events (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  event_id text NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  subscription_id text NOT NULL REFERENCES notification_subscriptions(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('control', 'expiry', 'operation', 'warehouse')),
  expiry_status text,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day',
  PRIMARY KEY (event_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS notification_deliveries_ready_idx ON notification_deliveries (available_at);

CREATE TABLE IF NOT EXISTS notification_expiry_check (
  id boolean PRIMARY KEY CHECK (id),
  checked_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION queue_notification(event_key text, event_category text, event_store text,
  event_barcode text, event_lot text, event_actor text, event_owners text[], event_warehouse text,
  is_trace boolean, event_expiry_status text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  WITH recipients AS MATERIALIZED (
    SELECT ns.id FROM notification_subscriptions ns
    WHERE event_category = ANY(ns.categories)
      AND ((is_trace IS NOT TRUE AND (ns.core_stores IS NULL OR event_store = ANY(ns.core_stores))) OR
        (is_trace IS NOT FALSE AND event_store = ANY(ns.trace_stores)
          AND ns.tenant_id = COALESCE((SELECT tenant_id FROM trace_stores WHERE store_id = event_store), 'pilot')))
      AND (NOT ns.personal OR ns.account = event_actor OR ns.account = ANY(event_owners))
      AND (ns.warehouse_id IS NULL OR event_warehouse = ns.warehouse_id OR EXISTS (
        SELECT 1 FROM trace_warehouses w JOIN trace_warehouse_lots l ON l.warehouse_id = w.id
        WHERE w.id = ns.warehouse_id AND w.store_id = event_store AND l.lot = event_lot
          AND l.barcode = CASE WHEN event_barcode ~ '^(\d{8}|\d{12,14})$' THEN lpad(event_barcode, 14, '0') ELSE event_barcode END
      ))
    FOR KEY SHARE OF ns
  ), created AS (
    INSERT INTO notification_events (id) SELECT event_key WHERE EXISTS (SELECT 1 FROM recipients)
    ON CONFLICT DO NOTHING RETURNING id
  )
  INSERT INTO notification_deliveries (event_id, subscription_id, category, expiry_status)
  SELECT created.id, recipients.id, event_category, event_expiry_status FROM created CROSS JOIN recipients;
$$;

CREATE OR REPLACE FUNCTION notify_product_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  category text;
  decision jsonb;
  scan_event boolean;
  event_key text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.document->'decisions' IS NOT DISTINCT FROM OLD.document->'decisions'
      AND NEW.document->'proposal' IS NOT DISTINCT FROM OLD.document->'proposal'
      AND NEW.document->>'status' IS NOT DISTINCT FROM OLD.document->>'status' THEN RETURN NEW; END IF;
  END IF;
  decision := NEW.document->'decisions'->-1;
  scan_event := COALESCE(decision->>'source' = 'scan', false) OR NEW.document#>'{proposal,scanCheck}' IS NOT NULL;
  event_key := 'product:' || NEW.id || ':' || txid_current();
  IF scan_event THEN
    PERFORM queue_notification(event_key || ':control', 'control', COALESCE(NEW.store_id, 'pilot'), NEW.barcode, NEW.lot,
      decision->>'actor', ARRAY[decision->>'requestedBy', NEW.document->>'createdBy'], NULL, false);
  END IF;
  category := CASE
    WHEN NEW.document->>'type' IN ('Depo İade', 'Depo Fark', 'Cross-Dock') THEN 'warehouse'
    WHEN NEW.document->>'type' IN ('RKS Blokaj', 'Delist Blokaj', 'Geçici Blokaj') OR (decision IS NOT NULL AND NOT scan_event) THEN 'operation'
  END;
  IF category IS NOT NULL THEN
    PERFORM queue_notification(event_key || ':' || category, category,
      COALESCE(NEW.store_id, 'pilot'), NEW.barcode, NEW.lot,
      decision->>'actor', ARRAY[decision->>'requestedBy', NEW.document->>'createdBy'], NULL, false);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_trace_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  control trace_controls%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'trace_controls' THEN
    PERFORM queue_notification('control:' || NEW.id, 'control', NEW.store_id, NEW.barcode, NEW.lot, NEW.actor, NULL, NEW.warehouse_id, true);
  ELSIF TG_TABLE_NAME = 'trace_reviews' THEN
    SELECT * INTO control FROM trace_controls WHERE id = NEW.control_id;
    PERFORM queue_notification('review:' || NEW.control_id, 'control', control.store_id, control.barcode, control.lot,
      NEW.actor, ARRAY[control.actor], control.warehouse_id, true);
  ELSE
    PERFORM queue_notification('trace:' || NEW.id, CASE WHEN NEW.kind = 'movement' THEN 'warehouse' ELSE 'operation' END,
      NEW.store_id, NEW.barcode, NEW.lot, NEW.actor, NULL, NEW.warehouse_id, true);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION revoke_notification_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'trace_users' THEN
    DELETE FROM notification_subscriptions WHERE account_source = 'trace' AND account = OLD.email;
  ELSIF TG_OP = 'INSERT' THEN
    DELETE FROM notification_subscriptions WHERE account_source = 'core' AND account = NEW.id;
  ELSE
    DELETE FROM notification_subscriptions WHERE account_source = 'core' AND account = OLD.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION notify_warehouse_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  assignment trace_warehouse_lots%ROWTYPE;
  assignment_store text;
BEGIN
  assignment := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT store_id INTO assignment_store FROM trace_warehouses WHERE id = assignment.warehouse_id;
  PERFORM queue_notification('assignment:' || md5(jsonb_build_array(assignment.warehouse_id, assignment.barcode,
    assignment.lot, TG_OP, txid_current())::text), 'warehouse', assignment_store, assignment.barcode, assignment.lot,
    NULL, NULL, assignment.warehouse_id, true);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER notification_products AFTER INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION notify_product_change();
CREATE OR REPLACE TRIGGER notification_controls AFTER INSERT ON trace_controls FOR EACH ROW EXECUTE FUNCTION notify_trace_change();
CREATE OR REPLACE TRIGGER notification_reviews AFTER INSERT ON trace_reviews FOR EACH ROW EXECUTE FUNCTION notify_trace_change();
CREATE OR REPLACE TRIGGER notification_trace_events AFTER INSERT ON trace_events FOR EACH ROW EXECUTE FUNCTION notify_trace_change();
CREATE OR REPLACE TRIGGER notification_warehouse_assignments AFTER INSERT OR DELETE ON trace_warehouse_lots FOR EACH ROW EXECUTE FUNCTION notify_warehouse_assignment();
CREATE OR REPLACE TRIGGER notification_core_accounts AFTER UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION revoke_notification_account();
CREATE OR REPLACE TRIGGER notification_trace_accounts AFTER UPDATE OR DELETE ON trace_users FOR EACH ROW EXECUTE FUNCTION revoke_notification_account();
CREATE OR REPLACE TRIGGER notification_password_overrides AFTER INSERT OR UPDATE OR DELETE ON account_password_overrides FOR EACH ROW EXECUTE FUNCTION revoke_notification_account();

WITH legacy AS (
  SELECT p.id, COALESCE(p.store_id, 'pilot') AS store_id, p.barcode, p.lot, p.document->>'name' AS name,
    p.document->'proposal' AS proposal
  FROM products p
  WHERE p.document #>> '{proposal,source}' = 'trace'
    AND p.document #>> '{proposal,id}' ~ '^[0-9a-f]{24}$'
    AND p.barcode IS NOT NULL AND p.lot IS NOT NULL
), copied AS (
  INSERT INTO trace_controls (id, store_id, product_id, barcode, lot, product_name, actor, location, checked_at, checks, choice, note)
  SELECT md5('mu-trace-legacy:' || (proposal->>'id'))::uuid, store_id, id,
    CASE WHEN barcode ~ '^([0-9]{8}|[0-9]{12,14})$' THEN lpad(barcode, 14, '0') ELSE barcode END,
    lot, name, proposal->>'actor', store_id, (proposal->>'time')::timestamptz,
    jsonb_build_object('rks', 'unknown', 'expiryDate', NULL, 'condition', 'unknown', 'expired', NULL, 'legacyChoice', proposal->>'choice'),
    CASE proposal->>'choice' WHEN 'Satılamaz' THEN 'Satılamaz'
      WHEN 'Depo İade' THEN 'Depo iade incelemesi' ELSE 'İncelemeye sevk' END,
    proposal->>'reason'
  FROM legacy
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
UPDATE products p SET document = p.document - 'proposal'
FROM legacy l
WHERE p.id = l.id AND p.document->'proposal' = l.proposal
  AND EXISTS (SELECT 1 FROM copied c WHERE c.id = md5('mu-trace-legacy:' || (l.proposal->>'id'))::uuid);

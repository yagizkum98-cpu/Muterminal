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

CREATE TABLE IF NOT EXISTS trace_stores (
  store_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES trace_tenants(id)
);
ALTER TABLE trace_stores ADD COLUMN IF NOT EXISTS name text;
INSERT INTO trace_stores (store_id, tenant_id) VALUES ('pilot', 'pilot') ON CONFLICT DO NOTHING;

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

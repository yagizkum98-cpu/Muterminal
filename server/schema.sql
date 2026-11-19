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

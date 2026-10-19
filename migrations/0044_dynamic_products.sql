-- Merchant-managed product catalog.
-- Existing products keep their hardcoded storefront experience; products created
-- here render through the generic catalog templates and use the generic checkout.

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'tool' CHECK(category IN ('ai','learning','mail','tool')),
  tagline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  pitch TEXT NOT NULL DEFAULT '',
  badge TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '份',
  quantity TEXT NOT NULL DEFAULT '1 份',
  template TEXT NOT NULL DEFAULT 'card' CHECK(template IN ('card','orbit','mail','ticket','account')),
  accent TEXT NOT NULL DEFAULT '#2563eb' CHECK(length(accent)=7 AND substr(accent,1,1)='#'),
  image_url TEXT,
  faq TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(faq) AND json_type(faq)='array'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX products_visible ON products(enabled, sort_order, created_at);

-- Generic fulfillment modes. Legacy products leave this NULL and keep their
-- existing per-plan routes (email delivery, X gift, SMS, supplier purchase).
ALTER TABLE catalog_plans ADD COLUMN fulfillment TEXT
  CHECK(fulfillment IS NULL OR fulfillment IN ('card','account','recharge','manual'));
-- Buyer-supplied fields for generic products, e.g.
-- [{"key":"username","label":"X 用户名","type":"text","required":true,"maxLength":64,"placeholder":"@name"}]
ALTER TABLE catalog_plans ADD COLUMN input_fields TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(input_fields) AND json_type(input_fields)='array');
ALTER TABLE catalog_plans ADD COLUMN features TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(features) AND json_type(features)='array');
ALTER TABLE catalog_plans ADD COLUMN subtitle TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_plans ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_plans ADD COLUMN unit TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_plans ADD COLUMN product_slug TEXT;

-- Orders snapshot the delivery mode so later plan edits cannot rewrite history.
ALTER TABLE orders ADD COLUMN fulfillment TEXT;
ALTER TABLE orders ADD COLUMN product_slug TEXT;
ALTER TABLE orders ADD COLUMN input_json TEXT NOT NULL DEFAULT '{}'
  CHECK(json_valid(input_json) AND json_type(input_json)='object');

-- Sealed buyer-supplied data (AES-GCM). Only ciphertext and a fingerprint that
-- supports duplicate detection are stored; plaintext never reaches the database.
CREATE TABLE order_inputs (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  fields TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE INDEX order_inputs_expiry ON order_inputs(expires_at);

-- Sealed merchant fulfillment payloads (card keys, account credentials).
CREATE TABLE order_deliveries (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  kind TEXT NOT NULL CHECK(kind IN ('card','account','recharge','manual')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  delivered_at INTEGER NOT NULL,
  delivered_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX order_deliveries_fingerprint ON order_deliveries(fingerprint);

-- Every read or write of sealed buyer/merchant data is recorded.
CREATE TABLE delivery_access_log (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX delivery_access_order ON delivery_access_log(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id          TEXT PRIMARY KEY,
  po_number   TEXT UNIQUE NOT NULL,
  supplier_id TEXT NOT NULL,
  item_count  INTEGER NOT NULL,
  expected_by TEXT NOT NULL,
  status      TEXT DEFAULT 'open',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id   TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  tier TEXT DEFAULT 'standard'
);

CREATE TABLE IF NOT EXISTS exceptions (
  id                TEXT PRIMARY KEY,
  po_number         TEXT NOT NULL,
  supplier_id       TEXT NOT NULL,
  delay_reason      TEXT,
  days_delayed      INTEGER,
  asn_missing       INTEGER DEFAULT 0,
  status            TEXT DEFAULT 'open',
  decision          TEXT,
  decision_reason   TEXT,
  supplier_response TEXT,
  raw_document      TEXT,
  input_type        TEXT,
  overridden        INTEGER DEFAULT 0,
  resolved_at       TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

-- Many-to-many: which suppliers are approved for each PO
CREATE TABLE IF NOT EXISTS po_suppliers (
  po_number   TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  PRIMARY KEY (po_number, supplier_id)
);

CREATE TABLE IF NOT EXISTS agent_log (
  id           TEXT PRIMARY KEY,
  exception_id TEXT NOT NULL,
  agent        TEXT NOT NULL,
  action       TEXT NOT NULL,
  result       TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO suppliers VALUES
  ('sup-001', 'Nordic Furnishings AS', 'ops@nordic-furnishings.com', 'preferred'),
  ('sup-002', 'Coastal Goods Ltd',     'shipping@coastalgoods.com',  'standard'),
  ('sup-003', 'MegaFlat Inc',          'logistics@megaflat.com',     'probation'),
  ('sup-004', 'Baltic Home Group',     'ops@baltichome.com',         'preferred'),
  ('sup-005', 'Suncoast Furniture',    'logistics@suncoast.com',     'standard');

INSERT OR IGNORE INTO purchase_orders VALUES
  ('po-001', 'PO-2026-4821', 'sup-001', 240, '2026-05-20', 'delayed',  datetime('now')),
  ('po-002', 'PO-2026-4822', 'sup-002', 80,  '2026-05-24', 'delayed',  datetime('now')),
  ('po-003', 'PO-2026-4823', 'sup-003', 400, '2026-05-10', 'delayed',  datetime('now')),
  ('po-004', 'PO-2026-4824', 'sup-001', 160, '2026-06-01', 'open',     datetime('now')),
  ('po-005', 'PO-2026-4825', 'sup-004', 320, '2026-06-05', 'open',     datetime('now'));

-- PO-2026-4821: 3 approved suppliers (good demo — shows the combo)
INSERT OR IGNORE INTO po_suppliers VALUES
  ('PO-2026-4821', 'sup-001'),
  ('PO-2026-4821', 'sup-002'),
  ('PO-2026-4821', 'sup-004');

-- PO-2026-4822: 2 suppliers
INSERT OR IGNORE INTO po_suppliers VALUES
  ('PO-2026-4822', 'sup-002'),
  ('PO-2026-4822', 'sup-003');

-- PO-2026-4823: probation only
INSERT OR IGNORE INTO po_suppliers VALUES
  ('PO-2026-4823', 'sup-003');

-- PO-2026-4824: 2 preferred suppliers
INSERT OR IGNORE INTO po_suppliers VALUES
  ('PO-2026-4824', 'sup-001'),
  ('PO-2026-4824', 'sup-004');

-- PO-2026-4825: mixed
INSERT OR IGNORE INTO po_suppliers VALUES
  ('PO-2026-4825', 'sup-004'),
  ('PO-2026-4825', 'sup-005');

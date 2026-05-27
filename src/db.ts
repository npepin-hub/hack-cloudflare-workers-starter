export interface Supplier {
  id: string
  name: string
  email: string
  tier: 'preferred' | 'standard' | 'probation'
}

export interface PurchaseOrder {
  id: string
  po_number: string
  supplier_id: string
  item_count: number
  expected_by: string
  status: string
  created_at: string
}

export interface Exception {
  id: string
  po_number: string
  supplier_id: string
  delay_reason: string | null
  days_delayed: number | null
  asn_missing: number
  status: string
  decision: string | null
  decision_reason: string | null
  supplier_response: string | null
  raw_document: string | null
  input_type: string | null
  overridden: number
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface AgentLogEntry {
  id: string
  exception_id: string
  agent: string
  action: string
  result: string | null
  created_at: string
}

export async function getSuppliersByPO(db: D1Database, poNumber: string): Promise<Supplier[]> {
  const result = await db.prepare(`
    SELECT s.* FROM suppliers s
    INNER JOIN po_suppliers ps ON s.id = ps.supplier_id
    WHERE ps.po_number = ?
    ORDER BY s.tier ASC, s.name ASC
  `).bind(poNumber).all<Supplier>()
  return result.results
}

export async function getSupplier(db: D1Database, id: string): Promise<Supplier | null> {
  return db.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).first<Supplier>()
}

export async function getPurchaseOrder(db: D1Database, poNumber: string): Promise<PurchaseOrder | null> {
  return db.prepare('SELECT * FROM purchase_orders WHERE po_number = ?').bind(poNumber).first<PurchaseOrder>()
}

export async function getOpenException(db: D1Database, poNumber: string): Promise<Exception | null> {
  return db
    .prepare("SELECT * FROM exceptions WHERE po_number = ? AND status NOT IN ('closed', 'cancelled')")
    .bind(poNumber)
    .first<Exception>()
}

export async function insertException(db: D1Database, ex: Omit<Exception, 'created_at' | 'updated_at'>): Promise<void> {
  await db.prepare(`
    INSERT INTO exceptions
      (id, po_number, supplier_id, delay_reason, days_delayed, asn_missing, status, raw_document, input_type)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).bind(ex.id, ex.po_number, ex.supplier_id, ex.delay_reason, ex.days_delayed, ex.asn_missing ? 1 : 0, ex.raw_document ?? null, ex.input_type).run()
}

export async function updateExceptionStatus(
  db: D1Database,
  id: string,
  status: string,
  extra: Partial<Pick<Exception, 'decision' | 'decision_reason' | 'supplier_response' | 'resolved_at' | 'overridden'>> = {}
): Promise<void> {
  const sets = ['status = ?', "updated_at = datetime('now')"]
  const vals: unknown[] = [status]

  if (extra.decision !== undefined)          { sets.push('decision = ?');          vals.push(extra.decision) }
  if (extra.decision_reason !== undefined)   { sets.push('decision_reason = ?');   vals.push(extra.decision_reason) }
  if (extra.supplier_response !== undefined) { sets.push('supplier_response = ?'); vals.push(extra.supplier_response) }
  if (extra.resolved_at !== undefined)       { sets.push('resolved_at = ?');       vals.push(extra.resolved_at) }
  if (extra.overridden !== undefined)        { sets.push('overridden = ?');         vals.push(extra.overridden) }

  vals.push(id)
  await db.prepare(`UPDATE exceptions SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
}

export async function getException(db: D1Database, id: string): Promise<(Exception & { supplier_name: string }) | null> {
  return db.prepare(`
    SELECT e.*, s.name as supplier_name
    FROM exceptions e
    LEFT JOIN suppliers s ON e.supplier_id = s.id
    WHERE e.id = ?
  `).bind(id).first<Exception & { supplier_name: string }>()
}

export async function listExceptions(db: D1Database): Promise<(Exception & { supplier_name: string })[]> {
  const result = await db.prepare(`
    SELECT e.*, s.name as supplier_name
    FROM exceptions e
    LEFT JOIN suppliers s ON e.supplier_id = s.id
    ORDER BY e.created_at DESC
  `).all<Exception & { supplier_name: string }>()
  return result.results
}

export async function logAgentAction(
  db: D1Database,
  exceptionId: string,
  agent: string,
  action: string,
  result: string
): Promise<void> {
  const id = crypto.randomUUID()
  await db.prepare(
    'INSERT INTO agent_log (id, exception_id, agent, action, result) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, exceptionId, agent, action, result).run()
}

export async function getSupplierByName(db: D1Database, name: string): Promise<Supplier | null> {
  const exact = await db.prepare('SELECT * FROM suppliers WHERE LOWER(name) = LOWER(?) LIMIT 1')
    .bind(name).first<Supplier>()
  if (exact) return exact
  const word = name.split(' ')[0]
  return db.prepare("SELECT * FROM suppliers WHERE LOWER(name) LIKE LOWER(?) LIMIT 1")
    .bind(`${word}%`).first<Supplier>()
}

export async function updateExceptionPO(
  db: D1Database,
  id: string,
  po_number: string,
  supplier_id: string,
  extra: Partial<Pick<Exception, 'delay_reason' | 'days_delayed' | 'asn_missing'>> = {}
): Promise<void> {
  const sets = ["po_number = ?", "supplier_id = ?", "updated_at = datetime('now')"]
  const vals: unknown[] = [po_number, supplier_id]

  if (extra.delay_reason !== undefined) { sets.push('delay_reason = ?'); vals.push(extra.delay_reason) }
  if (extra.days_delayed !== undefined) { sets.push('days_delayed = ?'); vals.push(extra.days_delayed) }
  if (extra.asn_missing  !== undefined) { sets.push('asn_missing = ?');  vals.push(extra.asn_missing) }

  vals.push(id)
  await db.prepare(`UPDATE exceptions SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
}

export async function getAgentLog(db: D1Database, exceptionId: string): Promise<AgentLogEntry[]> {
  const result = await db
    .prepare('SELECT * FROM agent_log WHERE exception_id = ? ORDER BY created_at ASC')
    .bind(exceptionId)
    .all<AgentLogEntry>()
  return result.results
}

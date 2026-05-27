import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import {
  insertException, getOpenException, getPurchaseOrder, getSupplier, getSuppliersByPO,
  getException, listExceptions, getAgentLog, updateExceptionStatus, logAgentAction,
  updateExceptionPO,
} from './db'
import {
  runInvestigationAgent, runOutreachAgent, runDecisionAgent, runNotificationAgent,
  runDocumentExtractionAgent,
} from './agents'
import { DelayEventSchema, ResolveSchema, SimulateSupplierSchema } from './validators'

const app = new Hono<{ Bindings: Env }>()
app.use('/api/*', cors())

app.get('/api/health', (c) => c.json({ ok: true, service: 'supplier-delay-agent' }))

// GET /po/:po_number/suppliers — suppliers approved for a PO
app.get('/po/:po_number/suppliers', async (c) => {
  const suppliers = await getSuppliersByPO(c.env.DB, c.req.param('po_number'))
  return c.json(suppliers)
})

// POST /exceptions — submit a delay event and run the full pipeline
app.post('/exceptions', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = DelayEventSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

  const event = parsed.data

  // Document type: extract PO/supplier from document content in background
  if (event.type === 'document') {
    if (!event.document) return c.json({ error: 'document field required for document type' }, 400)
    const id = crypto.randomUUID()
    await insertException(c.env.DB, {
      id,
      po_number: 'pending',
      supplier_id: 'pending',
      delay_reason: null,
      days_delayed: null,
      asn_missing: 0,
      status: 'open',
      decision: null,
      decision_reason: null,
      supplier_response: null,
      raw_document: event.document,
      input_type: 'document',
      overridden: 0,
      resolved_at: null,
    })
    await updateExceptionStatus(c.env.DB, id, 'investigating')
    c.executionCtx.waitUntil(runDocumentPipeline(c.env, id, event.document))
    return c.json({ id, status: 'investigating' }, 201)
  }

  // Manual / API: require po_number and supplier_id
  if (!event.po_number) return c.json({ error: 'po_number required' }, 400)
  if (!event.supplier_id) return c.json({ error: 'supplier_id required' }, 400)

  const po = await getPurchaseOrder(c.env.DB, event.po_number)
  if (!po) return c.json({ error: `PO ${event.po_number} not found` }, 404)

  const existing = await getOpenException(c.env.DB, event.po_number)
  if (existing) return c.json({ error: 'Open exception already exists for this PO', id: existing.id }, 409)

  const supplier = await getSupplier(c.env.DB, event.supplier_id)
  if (!supplier) return c.json({ error: `Supplier ${event.supplier_id} not found` }, 404)

  const id = crypto.randomUUID()
  await insertException(c.env.DB, {
    id,
    po_number: event.po_number,
    supplier_id: event.supplier_id,
    delay_reason: event.delay_reason ?? null,
    days_delayed: event.days_delayed ?? null,
    asn_missing: event.asn_missing ? 1 : 0,
    status: 'open',
    decision: null,
    decision_reason: null,
    supplier_response: null,
    raw_document: event.document ?? null,
    input_type: event.type,
    overridden: 0,
    resolved_at: null,
  })

  await updateExceptionStatus(c.env.DB, id, 'investigating')
  c.executionCtx.waitUntil(runPipeline(c.env, id, event, po, supplier))
  return c.json({ id, status: 'investigating' }, 201)
})

// GET /exceptions — list all exceptions
app.get('/exceptions', async (c) => {
  const exceptions = await listExceptions(c.env.DB)
  return c.json(exceptions)
})

// GET /exceptions/:id — single exception with agent log
app.get('/exceptions/:id', async (c) => {
  const ex = await getException(c.env.DB, c.req.param('id'))
  if (!ex) return c.json({ error: 'Not found' }, 404)
  const log = await getAgentLog(c.env.DB, ex.id)
  return c.json({ ...ex, agent_log: log })
})

// POST /exceptions/:id/resolve — human override
app.post('/exceptions/:id/resolve', async (c) => {
  const ex = await getException(c.env.DB, c.req.param('id'))
  if (!ex) return c.json({ error: 'Not found' }, 404)
  if (!['decided', 'awaiting_supplier', 'escalated'].includes(ex.status)) {
    return c.json({ error: `Cannot override exception with status: ${ex.status}` }, 403)
  }

  const body = await c.req.json().catch(() => null)
  const parsed = ResolveSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

  const { decision, reason } = parsed.data
  await updateExceptionStatus(c.env.DB, ex.id, 'decided', {
    decision,
    decision_reason: reason,
    overridden: 1,
  })
  await logAgentAction(c.env.DB, ex.id, 'human', 'overrode_decision', JSON.stringify({ decision, reason }))
  return c.json({ ok: true, decision })
})

// POST /exceptions/:id/simulate-supplier-response — demo helper
app.post('/exceptions/:id/simulate-supplier-response', async (c) => {
  const ex = await getException(c.env.DB, c.req.param('id'))
  if (!ex) return c.json({ error: 'Not found' }, 404)
  if (ex.status !== 'awaiting_supplier') {
    return c.json({ error: `Exception is not awaiting supplier response (status: ${ex.status})` }, 409)
  }

  const body = await c.req.json().catch(() => null)
  const parsed = SimulateSupplierSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

  const response = JSON.stringify(parsed.data)
  await updateExceptionStatus(c.env.DB, ex.id, 'investigating', { supplier_response: response })
  await logAgentAction(c.env.DB, ex.id, 'supplier', 'responded', response)

  const supplier = await getSupplier(c.env.DB, ex.supplier_id)
  if (!supplier) return c.json({ error: 'Supplier not found' }, 404)

  const investigation = {
    po_found: true,
    days_delayed: ex.days_delayed,
    asn_missing: false, // supplier responded with ASN — treat as provided
    missing_fields: [],
    supplier_tier: supplier.tier,
    summary: `PO ${ex.po_number} delayed ${ex.days_delayed ?? '?'} days. Supplier responded with ASN details.`,
  }

  c.executionCtx.waitUntil((async () => {
    const decision = await runDecisionAgent(c.env, ex.id, investigation, response)
    const updatedEx = await getException(c.env.DB, ex.id)
    if (updatedEx) await runNotificationAgent(c.env, ex.id, decision, updatedEx)
  })())

  return c.json({ ok: true, status: 'deciding' })
})

// Serve static assets (dashboard)
app.all('*', async (c) => c.env.ASSETS.fetch(c.req.raw))

// Shared core: investigation → auto-decide or outreach
async function runPipelineCore(
  env: Env,
  exceptionId: string,
  event: { delay_reason?: string; days_delayed?: number; asn_missing: boolean },
  po: NonNullable<Awaited<ReturnType<typeof getPurchaseOrder>>>,
  supplier: NonNullable<Awaited<ReturnType<typeof getSupplier>>>
): Promise<void> {
  const investigation = await runInvestigationAgent(env, exceptionId, event, po, supplier)

  const cancelDays = parseInt(env.AUTO_CANCEL_THRESHOLD_DAYS, 10)
  const daysDelayed = investigation.days_delayed ?? 0
  const isProbation = supplier.tier === 'probation'
  const autoDecide = (isProbation && daysDelayed >= 7) || daysDelayed >= cancelDays

  if (autoDecide) {
    const decision = await runDecisionAgent(env, exceptionId, investigation, null)
    const ex = await getException(env.DB, exceptionId)
    if (ex) await runNotificationAgent(env, exceptionId, decision, ex)
  } else {
    await runOutreachAgent(env, exceptionId, investigation, supplier)
    // Pipeline pauses here — resumes via /simulate-supplier-response
  }
}

// Manual/API pipeline — wraps core with error handling
async function runPipeline(
  env: Env,
  exceptionId: string,
  event: { delay_reason?: string; days_delayed?: number; asn_missing: boolean },
  po: Awaited<ReturnType<typeof getPurchaseOrder>>,
  supplier: Awaited<ReturnType<typeof getSupplier>>
): Promise<void> {
  try {
    if (!po || !supplier) return
    await runPipelineCore(env, exceptionId, event, po, supplier)
  } catch (err) {
    await updateExceptionStatus(env.DB, exceptionId, 'escalated')
    await logAgentAction(env.DB, exceptionId, 'system', 'pipeline_error',
      err instanceof Error ? err.message : String(err))
  }
}

// Document pipeline — extract PO/supplier from document, then run core
async function runDocumentPipeline(env: Env, exceptionId: string, base64Content: string): Promise<void> {
  try {
    const extracted = await runDocumentExtractionAgent(env, exceptionId, base64Content)

    const po = await getPurchaseOrder(env.DB, extracted.po_number)
    if (!po) {
      await updateExceptionStatus(env.DB, exceptionId, 'escalated')
      await logAgentAction(env.DB, exceptionId, 'system', 'pipeline_error',
        `PO ${extracted.po_number} extracted from document but not found in database`)
      return
    }

    // Find the matching supplier from this PO's approved list
    const suppliers = await getSuppliersByPO(env.DB, extracted.po_number)
    const firstWord = extracted.supplier_name.split(' ')[0].toLowerCase()
    const supplier = suppliers.find(s => s.name.toLowerCase().includes(firstWord)) ?? suppliers[0]

    if (!supplier) {
      await updateExceptionStatus(env.DB, exceptionId, 'escalated')
      await logAgentAction(env.DB, exceptionId, 'system', 'pipeline_error',
        `No suppliers found for PO ${extracted.po_number}`)
      return
    }

    // Update exception with real PO and supplier data extracted from document
    await updateExceptionPO(env.DB, exceptionId, extracted.po_number, supplier.id, {
      delay_reason: extracted.delay_reason ?? undefined,
      days_delayed: extracted.days_delayed ?? undefined,
      asn_missing:  extracted.asn_missing ? 1 : 0,
    })

    await runPipelineCore(env, exceptionId, {
      delay_reason: extracted.delay_reason ?? undefined,
      days_delayed: extracted.days_delayed ?? undefined,
      asn_missing:  extracted.asn_missing,
    }, po, supplier)
  } catch (err) {
    await updateExceptionStatus(env.DB, exceptionId, 'escalated')
    await logAgentAction(env.DB, exceptionId, 'system', 'pipeline_error',
      err instanceof Error ? err.message : String(err))
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    // Cron: escalate any exception awaiting supplier for more than 24h
    const exceptions = await listExceptions(env.DB)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    for (const ex of exceptions) {
      if (ex.status === 'awaiting_supplier' && ex.updated_at < cutoff) {
        const supplier = await getSupplier(env.DB, ex.supplier_id)
        if (!supplier) continue
        const investigation = {
          po_found: true,
          days_delayed: ex.days_delayed,
          asn_missing: ex.asn_missing === 1,
          missing_fields: [],
          supplier_tier: supplier.tier,
          summary: `PO ${ex.po_number} — no supplier response after 24h.`,
        }
        const decision = await runDecisionAgent(env, ex.id, investigation, null)
        await runNotificationAgent(env, ex.id, decision, ex)
      }
    }
  },
}

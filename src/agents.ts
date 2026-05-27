import OpenAI from 'openai'
import { createSubconscious, SUBCONSCIOUS_MODEL } from './subconscious/client'
import { InvestigationOutputSchema, DecisionOutputSchema, DocumentExtractionSchema, type InvestigationOutput, type DecisionOutput, type DocumentExtraction } from './validators'
import { logAgentAction, updateExceptionStatus, type Supplier, type PurchaseOrder, type Exception } from './db'
import type { Env } from './types'

function client(env: Env) {
  return createSubconscious(env.SUBCONSCIOUS_API_KEY, { enableThinking: false })
}

async function callLLM(env: Env, systemPrompt: string, userPrompt: string): Promise<string> {
  const chat = client(env).chat(SUBCONSCIOUS_MODEL)
  const res = await chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 1000,
    temperature: 0.2,
  })
  return res.choices[0]?.message?.content ?? ''
}

function detectMimeType(base64: string): 'image' | 'pdf' | 'unknown' {
  try {
    const header = atob(base64.slice(0, 16))
    if (header.startsWith('%PDF')) return 'pdf'
    if (header.startsWith('\x89PNG') || header.startsWith('\xFF\xD8') || header.startsWith('GIF')) return 'image'
  } catch {}
  return 'unknown'
}

function extractTextFromPDF(base64: string): string {
  const binary = atob(base64)
  const runs: string[] = []
  let cur = ''
  for (let i = 0; i < binary.length; i++) {
    const c = binary.charCodeAt(i)
    if (c >= 32 && c < 127) { cur += binary[i] } else {
      if (cur.length >= 8) runs.push(cur.trim())
      cur = ''
    }
  }
  if (cur.length >= 8) runs.push(cur.trim())
  return runs.filter(Boolean).join('\n').slice(0, 4000)
}

function extractJson(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) return raw.slice(start, end + 1)
  return raw.trim()
}

export async function runDocumentExtractionAgent(
  env: Env,
  exceptionId: string,
  base64Content: string
): Promise<DocumentExtraction> {
  const system = `You are a shipping manifest parser for a furniture supply chain system.
Extract delay details and return ONLY valid JSON matching this schema exactly:
{
  "po_number": string (format: PO-YYYY-NNNN),
  "supplier_name": string (full company name),
  "days_delayed": number | null,
  "delay_reason": string | null,
  "asn_missing": boolean,
  "confidence": "high" | "medium" | "low"
}
Return ONLY valid JSON. No preamble, no markdown.`

  let raw: string
  const mimeType = detectMimeType(base64Content)

  if (mimeType === 'image') {
    const chat = client(env).chat(SUBCONSCIOUS_MODEL)
    const res = await chat.completions.create({
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Content}` } } as OpenAI.Chat.Completions.ChatCompletionContentPartImage,
            { type: 'text', text: 'Extract shipment delay details from this manifest. Return ONLY valid JSON.' } as OpenAI.Chat.Completions.ChatCompletionContentPartText,
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.1,
    })
    raw = res.choices[0]?.message?.content ?? ''
  } else {
    // PDF or unknown: extract readable text then use text prompt
    const text = mimeType === 'pdf'
      ? extractTextFromPDF(base64Content)
      : base64Content.slice(0, 2000)
    raw = await callLLM(env, system, `Extract shipment delay details from this manifest text:\n\n${text}`)
  }

  const parsed = DocumentExtractionSchema.parse(JSON.parse(extractJson(raw)))
  await logAgentAction(env.DB, exceptionId, 'extraction', 'parsed_document', JSON.stringify(parsed))
  return parsed
}

export async function runInvestigationAgent(
  env: Env,
  exceptionId: string,
  event: { delay_reason?: string; days_delayed?: number; asn_missing: boolean },
  po: PurchaseOrder,
  supplier: Supplier
): Promise<InvestigationOutput> {
  const system = `You are a supply chain operations agent at a large furniture retailer.
Assess a delay notification and return ONLY a JSON object matching this schema exactly:
{
  "po_found": boolean,
  "days_delayed": number | null,
  "asn_missing": boolean,
  "missing_fields": string[],
  "supplier_tier": "preferred" | "standard" | "probation",
  "summary": string
}
Be specific. Do not guess at values not in the data. Return ONLY valid JSON.`

  const user = `Delay event:
- Delay reason: ${event.delay_reason ?? 'not provided'}
- Days delayed: ${event.days_delayed ?? 'not provided'}
- ASN missing: ${event.asn_missing}

Purchase order: PO ${po.po_number}, ${po.item_count} items, expected ${po.expected_by}, status: ${po.status}
Supplier: ${supplier.name} (tier: ${supplier.tier}, email: ${supplier.email})`

  const raw = await callLLM(env, system, user)
  const parsed = InvestigationOutputSchema.parse(JSON.parse(extractJson(raw)))

  await logAgentAction(env.DB, exceptionId, 'investigation', 'assessed_exception', JSON.stringify(parsed))
  return parsed
}

export async function runOutreachAgent(
  env: Env,
  exceptionId: string,
  investigation: InvestigationOutput,
  supplier: Supplier
): Promise<string> {
  const system = `You are drafting an urgent supplier outreach message for a delayed shipment.
Write a concise, professional message asking for the missing information.
Adjust tone: firm for probation suppliers, collaborative for preferred.
List exactly what you need, numbered. Keep it under 150 words.
Return ONLY the message text — no JSON, no preamble.`

  const user = `Supplier: ${supplier.name} (tier: ${supplier.tier})
Exception summary: ${investigation.summary}
Missing fields: ${investigation.missing_fields.join(', ') || 'none'}`

  const message = await callLLM(env, system, user)
  await logAgentAction(env.DB, exceptionId, 'outreach', 'drafted_message', message)
  await updateExceptionStatus(env.DB, exceptionId, 'awaiting_supplier')
  return message
}

export async function runDecisionAgent(
  env: Env,
  exceptionId: string,
  investigation: InvestigationOutput,
  supplierResponse: string | null
): Promise<DecisionOutput> {
  const escalationDays = parseInt(env.ESCALATION_THRESHOLD_DAYS, 10)
  const cancelDays = parseInt(env.AUTO_CANCEL_THRESHOLD_DAYS, 10)
  const daysDelayed = investigation.days_delayed ?? 0

  const system = `You are making a routing decision for a delayed shipment exception.
Apply these rules IN PRIORITY ORDER — stop at the first rule that matches:

1. Probation supplier AND delay ≥ 7 days → CANCEL (highest priority, always overrides)
2. Delay ≥ ${cancelDays} days (any tier) → escalate
3. No supplier response received → escalate
4. Supplier responded + ASN confirmed + delay ≤ ${escalationDays} days → hold
5. Supplier responded + delay 4–${cancelDays - 1} days + preferred tier → reroute
6. Supplier responded + delay 4–${cancelDays - 1} days + standard/probation → escalate

Return ONLY a JSON object:
{
  "decision": "hold" | "reroute" | "escalate" | "cancel",
  "reason": string,
  "supplier_message": string,
  "internal_note": string
}`

  const user = `Supplier tier: ${investigation.supplier_tier}
Days delayed: ${daysDelayed}
ASN missing: ${investigation.asn_missing}
Investigation summary: ${investigation.summary}
Supplier response: ${supplierResponse ?? 'No response received'}`

  const raw = await callLLM(env, system, user)
  const parsed = DecisionOutputSchema.parse(JSON.parse(extractJson(raw)))

  await logAgentAction(env.DB, exceptionId, 'decision', 'routed_exception', JSON.stringify(parsed))
  await updateExceptionStatus(env.DB, exceptionId, 'decided', {
    decision: parsed.decision,
    decision_reason: parsed.reason,
  })
  return parsed
}

export async function runNotificationAgent(
  env: Env,
  exceptionId: string,
  decision: DecisionOutput,
  _ex: Exception
): Promise<void> {
  const note = `Decision: ${decision.decision}. ${decision.reason}. Supplier notified: "${decision.supplier_message}". Internal: "${decision.internal_note}"`
  await logAgentAction(env.DB, exceptionId, 'notification', 'closed_exception', note)

  const finalStatus = decision.decision === 'cancel' ? 'cancelled' : 'closed'
  await updateExceptionStatus(env.DB, exceptionId, finalStatus, {
    resolved_at: new Date().toISOString(),
  })
}

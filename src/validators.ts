import { z } from 'zod'

export const DelayEventSchema = z.object({
  type:         z.enum(['manual', 'document', 'api']),
  po_number:    z.string().default(''),   // empty allowed for document type
  supplier_id:  z.string().default(''),   // empty allowed for document type
  delay_reason: z.string().optional(),
  days_delayed: z.number().int().positive().optional(),
  asn_missing:  z.boolean().default(false),
  document:     z.string().optional(), // base64 for document type
})

export const DocumentExtractionSchema = z.object({
  po_number:     z.string(),
  supplier_name: z.string(),
  days_delayed:  z.number().nullable(),
  delay_reason:  z.string().nullable(),
  asn_missing:   z.boolean(),
  confidence:    z.enum(['high', 'medium', 'low']),
})

export const InvestigationOutputSchema = z.object({
  po_found:       z.boolean(),
  days_delayed:   z.number().nullable(),
  asn_missing:    z.boolean(),
  missing_fields: z.array(z.string()),
  supplier_tier:  z.enum(['preferred', 'standard', 'probation']),
  summary:        z.string(),
})

export const DecisionOutputSchema = z.object({
  decision:         z.enum(['hold', 'reroute', 'escalate', 'cancel']),
  reason:           z.string(),
  supplier_message: z.string(),
  internal_note:    z.string(),
})

export const ResolveSchema = z.object({
  decision: z.enum(['hold', 'reroute', 'escalate', 'cancel']),
  reason:   z.string().min(1),
})

export const SimulateSupplierSchema = z.object({
  asn_number:      z.string(),
  new_eta:         z.string(),
  items_confirmed: z.number().int().positive(),
  carrier:         z.string(),
})

export type DelayEvent          = z.infer<typeof DelayEventSchema>
export type InvestigationOutput = z.infer<typeof InvestigationOutputSchema>
export type DecisionOutput      = z.infer<typeof DecisionOutputSchema>
export type DocumentExtraction  = z.infer<typeof DocumentExtractionSchema>

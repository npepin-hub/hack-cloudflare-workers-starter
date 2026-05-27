# Supplier Delay Agent — Hackathon Spec v3
### Supply Chain Track · Subconscious + Baseten + Cloudflare · TypeScript

---

## What It Does

> TL;DR: A multi-turn agent that handles inbound supplier delay notifications end-to-end. When a shipment is flagged as delayed or missing an ASN, the agent investigates, gathers missing information, makes a routing decision, and logs the outcome — without human intervention for routine cases.

### The situation
Wayfair orders furniture from hundreds of suppliers around the world. Every order has a Purchase Order — "send us 240 sofas by May 20." Before the shipment arrives, the supplier is supposed to send an Advance Ship Notice — "we shipped 220 sofas, XPO Logistics has them, arriving June 2."
When that notice doesn't show up, or the delivery is late, someone at Wayfair has to chase it down manually. That means emailing the supplier, waiting for a reply, figuring out what to do with the delayed shipment, and updating all the internal systems. Multiply that by hundreds of shipments a week.

### What the app does
It automates that entire chase.
Someone flags a delay — either by filling out a form or uploading a shipping document. The app takes it from there:

Looks up the order — what was supposed to arrive, from who, how late is it
Reaches out to the supplier — asks for the missing details in a professional message, adjusting the tone based on whether the supplier is trusted or on probation
Waits for the response — the supplier replies with the shipment details
Makes a decision — based on how late it is and who the supplier is:

Small delay, good supplier → hold, wait for it
Bigger delay, good supplier → reroute, find another option
Bad supplier or no response → escalate to a human
Probation supplier, long delay → cancel the order


Logs everything — every action, every decision, timestamped


### What the human sees
A dashboard with every delayed shipment and where it is in the process. For routine cases they just watch it resolve. For edge cases — flagged exceptions — they can override the agent's decision with one click.

The 10-second version for judges
Supplier delay comes in. Agent investigates, asks for missing info, gets the answer, decides what to do. Ops team only sees the hard ones.

---

## The Problem

Wayfair ships hundreds of thousands of pieces of furniture weekly across a vast
supplier network. When a shipment is delayed or an ASN (Advance Ship Notice) is
missing, someone has to:

1. Find the open PO and what's expected
2. Contact the supplier to get the missing details
3. Decide how to route the exception — hold, reroute, escalate, or cancel
4. Communicate the decision back to the supplier and internal teams

Today that's manual. The agent does it automatically.

---

## Demo Flow

1. Operator submits a delay event — supplier name, PO number, expected delivery, reason
2. **Subconscious** parses any attached documents (manifests, carrier notes, PO PDFs) via multimodal input — Baseten runs in the background automatically
3. **Investigation Agent** looks up the PO, checks what's missing
4. **Outreach Agent** sends a structured information request to the supplier (simulated)
5. **Decision Agent** evaluates the response and routes the exception
6. **Notification Agent** logs the outcome and drafts supplier + internal comms
7. Live dashboard shows every exception and its current status

---

## Stack

| Layer | Tool |
|---|---|
| Document inference | Baseten (via Subconscious — no direct API call needed) |
| Agent orchestration | Subconscious (`subconscious/tim-qwen3.6-27b`) |
| API + cron | Cloudflare Workers + Hono |
| Database | Cloudflare D1 (SQLite) |
| Frontend | Cloudflare Worker Assets (single HTML file) |
| Validation | Zod |
| Language | TypeScript throughout |

---

## Project Structure

Build on top of **`hack-cloudflare-workers-starter`**. Files marked `[existing]` are already there — update them. Files marked `[new]` need to be created.

```
hack-cloudflare-workers-starter/
├── src/
│   ├── index.ts              [existing] update — replace starter routes with exception routes
│   ├── types.ts              [existing] update — extend Env with DB, Baseten, threshold vars
│   ├── db.ts                 [new] D1 query helpers
│   ├── agents.ts             [new] all four agents
│   ├── validators.ts         [new] Zod schemas
│   └── subconscious/
│       └── client.ts         [existing] import SUBCONSCIOUS_MODEL + createSubconscious from here
├── public/
│   └── index.html            [existing] replace with two-panel exception UI
├── schema.sql                [new]
├── seed.sql                  [new] demo POs, suppliers, shipments
└── wrangler.toml             [existing] update — add D1 binding + threshold vars
```

---

## Environment

**`.dev.vars`** (copy from `.dev.vars.example`, never commit)
```
SUBCONSCIOUS_API_KEY=sky_your_key_here
```

**wrangler.toml** — update the existing starter file to add D1 and threshold vars:
```toml
name = "supplier-delay-agent"
main = "src/index.ts"
compatibility_date = "2025-05-05"
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = ["0 * * * *"]

[[kv_namespaces]]
binding = "AGENT_KV"
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_YOUR_PREVIEW_KV_NAMESPACE_ID"

[[d1_databases]]
binding = "DB"
database_name = "supply-chain-db"
database_id = "YOUR_DB_ID"

[assets]
directory = "./public"
binding = "ASSETS"

[vars]
ESCALATION_THRESHOLD_DAYS = "3"
AUTO_CANCEL_THRESHOLD_DAYS = "14"
```

**TypeScript Env interface (`src/types.ts`)** — extend the existing Env interface to add:
```typescript
export interface Env {
  // existing — keep these
  SUBCONSCIOUS_API_KEY: string;
  WEBHOOK_SECRET?: string;
  AGENT_KV: KVNamespace;
  ASSETS: Fetcher;
  // new — add these
  DB: D1Database;
  ESCALATION_THRESHOLD_DAYS: string;
  AUTO_CANCEL_THRESHOLD_DAYS: string;
}
```

> Secrets set via CLI for deploy — never hardcoded, never committed.
> ```bash
> npx wrangler secret put SUBCONSCIOUS_API_KEY
> ```

---

## Database

**schema.sql**
```sql
-- Many-to-many: approved suppliers per PO
CREATE TABLE IF NOT EXISTS po_suppliers (
  po_number   TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  PRIMARY KEY (po_number, supplier_id)
);

-- Purchase orders
CREATE TABLE IF NOT EXISTS purchase_orders (
  id           TEXT PRIMARY KEY,
  po_number    TEXT UNIQUE NOT NULL,
  supplier_id  TEXT NOT NULL,
  item_count   INTEGER NOT NULL,
  expected_by  TEXT NOT NULL,
  status       TEXT DEFAULT 'open',   -- open | delayed | fulfilled | cancelled
  created_at   TEXT DEFAULT (datetime('now'))
);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id      TEXT PRIMARY KEY,
  name    TEXT UNIQUE NOT NULL,
  email   TEXT NOT NULL,
  tier    TEXT DEFAULT 'standard'     -- preferred | standard | probation
);

-- Delay exceptions
CREATE TABLE IF NOT EXISTS exceptions (
  id               TEXT PRIMARY KEY,
  po_number        TEXT NOT NULL,
  supplier_id      TEXT NOT NULL,
  delay_reason     TEXT,
  days_delayed     INTEGER,
  asn_missing      INTEGER DEFAULT 0, -- 1 = ASN not received
  status           TEXT DEFAULT 'open',
  -- open | investigating | awaiting_supplier | decided | escalated | closed
  decision         TEXT,
  -- hold | reroute | escalate | cancel
  decision_reason  TEXT,
  supplier_response TEXT,
  raw_document     TEXT,              -- extracted text from Baseten
  input_type       TEXT,              -- manual | document | api
  overridden       INTEGER DEFAULT 0, -- 1 = human overrode agent decision
  resolved_at      TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);

-- Agent activity log — full audit trail
CREATE TABLE IF NOT EXISTS agent_log (
  id          TEXT PRIMARY KEY,
  exception_id TEXT NOT NULL,
  agent       TEXT NOT NULL,          -- investigation | outreach | decision | notification
  action      TEXT NOT NULL,
  result      TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

**seed.sql** (demo data)
```sql
INSERT OR IGNORE INTO suppliers VALUES
  ('sup-001', 'Nordic Furnishings AS', 'ops@nordic-furnishings.com', 'preferred'),
  ('sup-002', 'Coastal Goods Ltd',     'shipping@coastalgoods.com',  'standard'),
  ('sup-003', 'MegaFlat Inc',          'logistics@megaflat.com',     'probation'),
  ('sup-004', 'Baltic Home Group',     'ops@baltichome.com',         'preferred'),
  ('sup-005', 'Suncoast Furniture',    'logistics@suncoast.com',     'standard');

INSERT OR IGNORE INTO purchase_orders VALUES
  ('po-001', 'PO-2026-4821', 'sup-001', 240, '2026-05-20', 'delayed', datetime('now')),
  ('po-002', 'PO-2026-4822', 'sup-002', 80,  '2026-05-24', 'delayed', datetime('now')),
  ('po-003', 'PO-2026-4823', 'sup-003', 400, '2026-05-10', 'delayed', datetime('now')),
  ('po-004', 'PO-2026-4824', 'sup-001', 160, '2026-06-01', 'open',    datetime('now')),
  ('po-005', 'PO-2026-4825', 'sup-004', 320, '2026-06-05', 'open',    datetime('now'));

-- PO-supplier assignments (many-to-many)
INSERT OR IGNORE INTO po_suppliers VALUES
  ('PO-2026-4821', 'sup-001'), ('PO-2026-4821', 'sup-002'), ('PO-2026-4821', 'sup-004'),
  ('PO-2026-4822', 'sup-002'), ('PO-2026-4822', 'sup-003'),
  ('PO-2026-4823', 'sup-003'),
  ('PO-2026-4824', 'sup-001'), ('PO-2026-4824', 'sup-004'),
  ('PO-2026-4825', 'sup-004'), ('PO-2026-4825', 'sup-005');
```

---

## Zod Schemas (validators.ts)

```typescript
import { z } from 'zod'

// Incoming delay event
export const DelayEventSchema = z.object({
  type:       z.enum(['manual', 'document', 'api']),
  po_number:  z.string().min(1),
  supplier_id: z.string().min(1),
  delay_reason: z.string().optional(),
  days_delayed: z.number().int().positive().optional(),
  asn_missing:  z.boolean().default(false),
  document:   z.string().optional(), // base64 for document type
})

// Investigation Agent output
export const InvestigationOutputSchema = z.object({
  po_found:       z.boolean(),
  days_delayed:   z.number().nullable(),
  asn_missing:    z.boolean(),
  missing_fields: z.array(z.string()),
  supplier_tier:  z.enum(['preferred', 'standard', 'probation']),
  summary:        z.string(),
})

// Decision Agent output
export const DecisionOutputSchema = z.object({
  decision:        z.enum(['hold', 'reroute', 'escalate', 'cancel']),
  reason:          z.string(),
  supplier_message: z.string(),
  internal_note:   z.string(),
})
```

---

## API Endpoints

### POST /exceptions
Entry point. Accepts a delay event, triggers the full agent pipeline.

**Request**
```json
{
  "type": "manual",
  "po_number": "PO-2026-4821",
  "supplier_id": "sup-001",
  "delay_reason": "Port congestion",
  "days_delayed": 5,
  "asn_missing": true
}
```

**Guards**
- Validate with `DelayEventSchema` — return 400 on failure
- PO must exist in DB — return 404 if not found
- Duplicate open exception on same PO — return 409

**Response**
```json
{ "id": "uuid", "status": "investigating" }
```

---

### GET /exceptions
Returns full exception ledger, newest first.

**Response includes:** exception fields + po_number + supplier name + agent log summary

---

### GET /exceptions/:id
Single exception with full agent log.

---

### GET /po/:po_number/suppliers
Returns all approved suppliers for a PO. Used by the UI to populate the supplier dropdown after a PO is entered.

**Response:** array of `{ id, name, email, tier }`

---

### POST /exceptions/:id/resolve
UI only. Human overrides agent decision.

**Request**
```json
{ "decision": "hold | reroute | escalate | cancel", "reason": "string" }
```

**Guards**
- Status must be `decided` or `awaiting_supplier` — return 403 otherwise
- Sets `overridden = 1`, logs human decision

---

### POST /exceptions/:id/simulate-supplier-response
Demo helper. Simulates a supplier replying with missing ASN details.
Triggers the Decision Agent with the response.

**Request**
```json
{
  "asn_number": "ASN-88821",
  "new_eta": "2026-06-02",
  "items_confirmed": 220,
  "carrier": "XPO Logistics"
}
```

---

## Agent Pipeline (agents.ts)

### Flow

```
POST /exceptions
  └── Baseten (document type only) → extracted text
        └── Investigation Agent → missing fields, supplier tier, delay severity
              └── Outreach Agent → structured info request (simulated send)
                    └── [supplier responds via /simulate-supplier-response]
                          └── Decision Agent → hold | reroute | escalate | cancel
                                └── Notification Agent → supplier message + internal note → closed
```

---

### Agent 1 — Investigation
**Engine:** `subconscious/tim-qwen3.6-27b` — import `SUBCONSCIOUS_MODEL` and `createSubconscious` from `src/subconscious/client.ts`
**Job:** Look up the PO, assess what's missing and how severe the delay is.

```typescript
const instructions = `
You are a supply chain operations agent at a large furniture retailer.

You have received a delay notification with this data: {event}
The purchase order record is: {po}
The supplier record is: {supplier}

Assess the situation:
- Is the ASN missing?
- How many days delayed?
- What information is still missing to make a routing decision?
- What is the supplier tier and does it affect urgency?

Return a structured summary with missing_fields as an array of strings.
Be specific. Do not guess at values not in the data.
`
```

---

### Agent 2 — Outreach
**Engine:** `subconscious/tim-qwen3.6-27b` — same client as Agent 1
**Job:** Draft a structured information request to send to the supplier.
For the demo this is simulated — the message is stored, not sent.

```typescript
const instructions = `
You are drafting an urgent supplier outreach message for a delayed shipment.

Exception summary: {investigation_summary}
Missing fields: {missing_fields}
Supplier name: {supplier_name}
Supplier tier: {supplier_tier}

Write a concise, professional message asking for the missing information.
Adjust tone based on tier: firm for probation, collaborative for preferred.
List exactly what you need, numbered.
Keep it under 150 words.
`
```

---

### Agent 3 — Decision
**Engine:** `subconscious/tim-qwen3.6-27b` — same client as Agent 1
**Job:** Given investigation + supplier response, route the exception.

**Decision rules (enforced in agent instructions):**

| Condition | Decision |
|---|---|
| Supplier responded, ASN provided, delay ≤ 3 days | `hold` |
| Supplier responded, delay 4–13 days, preferred tier | `reroute` |
| Supplier responded, delay 4–13 days, standard/probation | `escalate` |
| No supplier response after 24h OR delay ≥ 14 days | `escalate` |
| Probation supplier + delay ≥ 7 days | `cancel` |

```typescript
const instructions = `
You are making a routing decision for a delayed shipment exception.

Investigation: {investigation}
Supplier response: {supplier_response}
Supplier tier: {supplier_tier}
Days delayed: {days_delayed}
Escalation threshold: {ESCALATION_THRESHOLD_DAYS} days
Auto-cancel threshold: {AUTO_CANCEL_THRESHOLD_DAYS} days

Apply the routing rules and return:
- decision: hold | reroute | escalate | cancel
- reason: one sentence explaining the decision
- supplier_message: what to tell the supplier
- internal_note: what to flag for the ops team

Return ONLY valid JSON.
`
```

---

### Agent 4 — Notification
**Engine:** `subconscious/tim-qwen3.6-27b` — same client as Agent 1
**Job:** Log the decision, store supplier message and internal note, close the exception.

---

### Document Input (multimodal via Subconscious)

Subconscious calls Baseten internally — no direct API call needed. For `document` input type, pass the file as a base64 data URL in the user message content array when calling `chat.completions.create`. Subconscious handles OCR and extraction automatically.

> Confirm exact multimodal message format with Subconscious team on arrival. See `.agents/skills/subconscious-dev/references/multimodal.md` in the starter.

---

## Safety Rules

| Risk | Guard | Enforced in |
|---|---|---|
| Malformed event | Zod `DelayEventSchema` | Worker, before pipeline |
| PO not found | DB lookup before agent call | Worker |
| Duplicate exception | Status check on same PO | Worker, returns 409 |
| Agent hallucination | Zod on all agent outputs | Worker, after agent returns |
| Human override on wrong status | Status must be decided/awaiting | Worker, returns 403 |
| Cancel on preferred supplier | Tier check in Decision Agent | Agent instructions |

**Principle:** Agent recommends. Worker validates. D1 is the audit trail.

---

## UI (public/index.html)

Single HTML file. Two panels. Vanilla JS + fetch.

### Left Panel — Submit Exception
- **Input type tabs:** Manual | Document
- Manual: PO number search field (autocomplete from seed data) → supplier dropdown auto-loads from `GET /po/:po_number/suppliers` → delay reason, days delayed, ASN missing toggle
- Document: drag-and-drop zone for PDF/manifest, Baseten extracts the rest
- **Simulate Supplier Response** button — appears once exception is in `awaiting_supplier`
- Spinner while pipeline runs

### Right Panel — Exception Dashboard
- Header: "Exception Queue" + **Download CSV** button
- Table columns: PO | Supplier | Days Delayed | ASN | Status | Decision | Reason | Updated

**Status badges:**

| Status | Color |
|---|---|
| open | grey |
| investigating | blue |
| awaiting_supplier | yellow |
| decided | teal |
| escalated | orange |
| closed | green |
| cancelled | red |

- Polls `GET /exceptions` every 3 seconds
- Newest exception highlighted on arrival

### Row Actions
- **Override** button on `decided` rows — opens decision picker (hold/reroute/escalate/cancel + reason)
- **Simulate Response** button on `awaiting_supplier` rows
- Buttons disappear once actioned

---

## CSV Download

**Filename:** `exceptions_2026-05-26T18-32-00.csv`

**Columns:**
```
Exception ID, PO Number, Supplier, Days Delayed, ASN Missing,
Status, Decision, Decision Reason, Overridden,
Created At, Updated At, Resolved At, Downloaded At
```

`Downloaded At` stamped at click time. `Overridden` shows `yes`/`no`.

---

## Setup (run on arrival)

```bash
# 0. GET YOUR KEYS FIRST
#    → Subconscious team: SUBCONSCIOUS_API_KEY (only key needed)

# 1. Use the existing starter — do NOT scaffold from scratch
cd hack-cloudflare-workers-starter
npm install zod

# 2. Local secrets
cp .dev.vars.example .dev.vars
# Fill in SUBCONSCIOUS_API_KEY in .dev.vars — that's the only key needed

# 3. KV namespace (already in starter — just paste your IDs into wrangler.toml)
npx wrangler kv namespace create AGENT_KV
npx wrangler kv namespace create AGENT_KV --preview
# → paste both IDs into wrangler.toml [[kv_namespaces]]

# 4. Database
npx wrangler d1 create supply-chain-db
# → paste database_id into wrangler.toml [[d1_databases]]

npx wrangler d1 execute supply-chain-db --local --file schema.sql
npx wrangler d1 execute supply-chain-db --local --file seed.sql

# 5. Dev server
npm run dev

# 6. Smoke tests (in order)

# Confirm seed data
curl http://localhost:8787/exceptions
# → []

# Submit a manual delay event
curl -X POST http://localhost:8787/exceptions \
  -H "Content-Type: application/json" \
  -d '{
    "type": "manual",
    "po_number": "PO-2026-4821",
    "supplier_id": "sup-001",
    "delay_reason": "Port congestion",
    "days_delayed": 5,
    "asn_missing": true
  }'
# → { "id": "...", "status": "investigating" }

# Check exception progresses through pipeline
curl http://localhost:8787/exceptions
# → status should move: investigating → awaiting_supplier

# Simulate supplier response
curl -X POST http://localhost:8787/exceptions/YOUR_ID/simulate-supplier-response \
  -H "Content-Type: application/json" \
  -d '{
    "asn_number": "ASN-88821",
    "new_eta": "2026-06-02",
    "items_confirmed": 220,
    "carrier": "XPO Logistics"
  }'
# → status should move: awaiting_supplier → decided

# Check final decision
curl http://localhost:8787/exceptions/YOUR_ID
# → decision: hold | reroute | escalate | cancel + reason
```

**Test order:** manual event first. Simulate supplier response second. Document/Baseten last.
**Rule:** check exception status in D1 after every pipeline step before moving on.

---

## Claude Code Prompt

```
We are working inside the hack-cloudflare-workers-starter repo.
Build a supplier delay exception management app from this spec on top of the existing starter.

Stack: Cloudflare Workers + Hono, Cloudflare D1, Subconscious (subconscious/tim-qwen3.6-27b),
Baseten (OpenAI-compatible), Zod, TypeScript throughout.

The starter already has:
- src/index.ts (replace routes with exception routes)
- src/types.ts (extend Env — do not replace it, add DB + Baseten + threshold fields)
- src/subconscious/client.ts (import SUBCONSCIOUS_MODEL + createSubconscious from here)
- public/index.html (replace with two-panel exception UI)
- wrangler.toml (add D1 binding + [vars] — keep existing KV + assets blocks)

New files to create:
src/db.ts, src/agents.ts, src/validators.ts
schema.sql, seed.sql

[paste full spec]

Build in this order:
1. Update src/types.ts — extend Env, do not delete existing fields
2. src/validators.ts — Zod schemas
3. schema.sql and seed.sql
4. Update wrangler.toml — add D1 binding + vars, keep existing blocks
5. src/db.ts — D1 query helpers for exceptions, POs, suppliers, agent_log
6. src/agents.ts — all four agents using createSubconscious from src/subconscious/client.ts
8. Update src/index.ts — Hono exception routes + cron handler
9. Update public/index.html — two-panel UI with status badges and row actions

Secrets in .dev.vars (local) and wrangler secrets (deploy):
SUBCONSCIOUS_API_KEY only — Baseten is handled by Subconscious internally.
Never hardcode. Update .dev.vars.example.
```

---

## Demo Script — Loop Video (90 seconds, no cuts)

### Setup before hitting record
- Browser open at `http://localhost:8787`, exception queue empty
- Terminal hidden, window fullscreen
- Do one dry run first to warm the Subconscious API and check timing

### Recording instructions
Use **QuickTime → File → New Screen Recording** (Mac) or `Cmd+Shift+5`. Trim to loop point at the end.

---

### [0:00–0:10] Submit a delay — preferred supplier
Type `PO-2026-4821` in the PO search field → supplier dropdown appears → pick **Nordic Furnishings AS** → Delay Reason: `Port congestion` → Days Delayed: `5` → check **ASN Missing** → hit **Submit Exception**

*Queue shows new exception with* `investigating` *badge*

---

### [0:10–0:20] Agent investigates and reaches out
Watch badge flip to `awaiting_supplier`. Click **Log** on the row — the outreach message the agent drafted expands below the row. Let judges read it.

> *"The agent assessed the PO, identified the missing ASN, and drafted a professional outreach message — tone adjusted for a preferred supplier."*

---

### [0:20–0:35] Supplier responds — decision made
Click **Sim Response** on the row. Watch badge flip to `closed`, decision `reroute`. Click **Log** — Decision Agent reasoning is visible.

> *"Supplier provided ASN details. Agent decided: reroute — 5-day delay, preferred tier. No human needed."*

---

### [0:35–0:50] Probation supplier — auto-cancel
Type `PO-2026-4823` → **MegaFlat Inc (probation)** auto-fills → Delay Reason: `No contact` → Days: `8` → Submit. Watch it go straight to `cancelled` with no supplier response step.

> *"Probation supplier, 8-day delay — agent cancelled automatically. Rule 1 triggered, no outreach wasted."*

---

### [0:50–1:05] Human override
Click **Override** on any decided row → pick `escalate` → type reason → **Confirm**. Badge updates. Click **Log** — shows `[Human] overrode_decision` timestamped.

> *"For edge cases, one click lets the ops team take over. Every action — agent or human — is in the audit log."*

---

### [1:05–1:15] Download CSV
Click **Download CSV**. File downloads instantly with all exceptions, decisions, and timestamps.

> *"Full audit trail. Compliance-ready on day one."*

---

### [1:15–1:30] Loop point
Queue shows 2 closed exceptions + 1 cancelled. Pause 2 seconds — then start over from step 1. The queue just grows, the loop is seamless.

---

**Closing line:**
*"From delay notification to routing decision in under 10 seconds. The agent investigates, reaches out, decides, and logs — the ops team only sees the hard ones."*

---

## Why This Wins

- **Multi-turn agent** — the outreach → response → decision loop is what Subconscious is built for
- **Wayfair-native problem** — judges live this problem; it will feel real to them
- **Baseten has a natural job** — document extraction from manifests and carrier notes
- **Audit trail is built-in** — `agent_log` table shows every agent action, which is the compliance story
- **Four distinct outcomes** — hold, reroute, escalate, cancel — richer than pass/fail

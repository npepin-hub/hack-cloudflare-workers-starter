# Supplier Delay Agent

> Built at the **Wayfair × Subconscious Hackathon — May 26, 2026** · Supply Chain Track

A multi-agent system that handles inbound supplier delay notifications end-to-end — investigating, reaching out, deciding, and logging — without human intervention for routine cases.

![Demo](./requirements/supplier-delay-agent-demo.gif)

---

## The Problem

Wayfair ships hundreds of thousands of pieces of furniture weekly through a global supplier network. Every order has a Purchase Order ("send us 240 sofas by May 20"). Before shipment, the supplier sends an Advance Ship Notice confirming what's in transit. When that notice is missing or a delivery is late, someone has to manually chase it down — email the supplier, wait for a reply, decide what to do, update internal systems. Multiply that by hundreds of shipments a week.

**This agent automates that entire chase.**

---

## Use Cases

| Scenario | What the agent does |
|---|---|
| Supplier submits late — ASN missing | Investigates PO, drafts info request, waits for response, routes exception |
| Preferred supplier, small delay (≤3 days) | Holds — shipment expected to arrive |
| Preferred supplier, medium delay (4–13 days) | Reroutes to alternative |
| Standard/probation supplier, medium delay | Escalates to ops team |
| Probation supplier, delay ≥ 7 days | Cancels automatically — no outreach wasted |
| No supplier response after 24h | Escalates via scheduled cron |
| Ops team disagrees with agent | One-click human override, logged in audit trail |
| Shipping manifest uploaded | Extracts PO details from PDF/image, runs same pipeline |

---

## Architecture

```
Input (manual form or document upload)
  │
  ▼
POST /exceptions
  │
  ├─ [document] Document Extraction Agent
  │     Reads PDF/image via Subconscious multimodal
  │     Extracts: PO number, supplier, delay, ASN status
  │
  └─ Investigation Agent
        Looks up PO + supplier in D1
        Assesses severity and missing fields
        │
        ├─ [probation ≥7d or delay ≥14d] → Decision Agent → Notification Agent → cancelled/closed
        │
        └─ [all others] Outreach Agent
              Drafts supplier message (tone adjusted by tier)
              Status: awaiting_supplier
              │
              └─ [supplier responds or 24h cron fires]
                    Decision Agent
                      hold | reroute | escalate | cancel
                    Notification Agent
                      Logs outcome, closes exception
```

### Decision Rules

| Condition | Decision |
|---|---|
| ASN confirmed, delay ≤ 3 days | `hold` |
| Supplier responded, 4–13 days, preferred tier | `reroute` |
| Supplier responded, 4–13 days, standard/probation | `escalate` |
| No response after 24h OR delay ≥ 14 days | `escalate` |
| Probation supplier + delay ≥ 7 days | `cancel` |

### Stack

| Layer | Technology |
|---|---|
| Agent LLM | Subconscious (`subconscious/tim-qwen3.6-27b`) |
| Document understanding | Subconscious multimodal (Baseten-backed) |
| API + cron | Cloudflare Workers + Hono |
| Database | Cloudflare D1 (SQLite) |
| Frontend | Cloudflare Worker Assets (single HTML file) |
| Validation | Zod |
| Language | TypeScript throughout |

### Project Structure

```
hack-cloudflare-workers-starter/
├── src/
│   ├── index.ts              Hono routes + cron handler
│   ├── types.ts              Env interface (DB, KV, thresholds)
│   ├── db.ts                 D1 query helpers (exceptions, POs, suppliers, agent_log)
│   ├── agents.ts             All five agents (extraction, investigation, outreach, decision, notification)
│   ├── validators.ts         Zod schemas for all inputs and agent outputs
│   └── subconscious/
│       └── client.ts         Subconscious API client
├── public/
│   ├── index.html            Two-panel dashboard (submit + exception queue)
│   └── sample-manifest-PO-2026-4821.pdf   Demo shipping manifest
├── schema.sql                D1 table definitions
├── seed.sql                  Demo suppliers, POs, po_supplier assignments
└── wrangler.toml             Worker config (D1, KV, assets, cron, vars)
```

---

## Running Locally

### Prerequisites

- Node.js 20+
- A [Subconscious API key](https://www.subconscious.dev/platform)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure your API key
cp .dev.vars.example .dev.vars
# Edit .dev.vars and set:
#   SUBCONSCIOUS_API_KEY=sky_your_key_here

# 3. Create and seed the database
npx wrangler d1 create supply-chain-db
# Paste the database_id into wrangler.toml [[d1_databases]]

npx wrangler d1 execute supply-chain-db --local --file schema.sql
npx wrangler d1 execute supply-chain-db --local --file seed.sql

# 4. Start the dev server
npm run dev
```

Open **http://localhost:8787**

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/po/:po_number/suppliers` | Approved suppliers for a PO |
| `POST` | `/exceptions` | Submit a delay event, triggers agent pipeline |
| `GET` | `/exceptions` | List all exceptions (newest first) |
| `GET` | `/exceptions/:id` | Single exception with full agent log |
| `POST` | `/exceptions/:id/resolve` | Human override of agent decision |
| `POST` | `/exceptions/:id/simulate-supplier-response` | Demo: simulate supplier reply |

---

## Smoke Tests

Run these in order after setup to verify the full pipeline. Each step must complete before running the next.

```bash
# 1. Check the server is up
curl http://localhost:8787/api/health
# → { "ok": true }

# 2. Confirm seed data is loaded
curl http://localhost:8787/exceptions
# → []

# 3. Check supplier lookup for a PO
curl http://localhost:8787/po/PO-2026-4821/suppliers
# → [{ "id": "sup-001", "name": "Nordic Furnishings AS", "tier": "preferred" }, ...]

# 4. Submit a manual delay event (preferred supplier)
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

# 5. Watch it progress (poll until awaiting_supplier)
curl http://localhost:8787/exceptions
# → status: investigating → awaiting_supplier

# 6. Simulate supplier response
curl -X POST http://localhost:8787/exceptions/YOUR_ID/simulate-supplier-response \
  -H "Content-Type: application/json" \
  -d '{
    "asn_number": "ASN-88821",
    "new_eta": "2026-06-02",
    "items_confirmed": 220,
    "carrier": "XPO Logistics"
  }'
# → { "ok": true, "status": "deciding" }

# 7. Confirm decision (preferred + 5 days → reroute)
curl http://localhost:8787/exceptions/YOUR_ID
# → { "status": "closed", "decision": "reroute", "agent_log": [...] }

# 8. Test auto-cancel (probation supplier, 8-day delay)
curl -X POST http://localhost:8787/exceptions \
  -H "Content-Type: application/json" \
  -d '{
    "type": "manual",
    "po_number": "PO-2026-4823",
    "supplier_id": "sup-003",
    "delay_reason": "No contact",
    "days_delayed": 8,
    "asn_missing": true
  }'
# → Should go straight to cancelled (no awaiting_supplier step)

# 9. Test duplicate guard
# → Re-submit same PO-2026-4821 while open → 409 Conflict

# 10. Test human override
curl -X POST http://localhost:8787/exceptions/YOUR_DECIDED_ID/resolve \
  -H "Content-Type: application/json" \
  -d '{ "decision": "escalate", "reason": "Supplier history flagged by ops" }'
# → { "ok": true, "decision": "escalate" }
# → agent_log should show [human] overrode_decision
```

---

## Production Deployment

```bash
# 1. Create production D1 database
npx wrangler d1 create supply-chain-db
# → paste database_id into wrangler.toml

# 2. Apply schema and seed to production
npx wrangler d1 execute supply-chain-db --file schema.sql
npx wrangler d1 execute supply-chain-db --file seed.sql

# 3. Set secrets (never committed to git)
npx wrangler secret put SUBCONSCIOUS_API_KEY

# 4. Deploy
npm run deploy
```

The cron job (`0 * * * *`) automatically escalates any exception that has been `awaiting_supplier` for more than 24 hours.

### Environment Variables

| Variable | Where | Description |
|---|---|---|
| `SUBCONSCIOUS_API_KEY` | `.dev.vars` / wrangler secret | Only key needed |
| `ESCALATION_THRESHOLD_DAYS` | `wrangler.toml [vars]` | Delays ≤ this are hold candidates (default: `3`) |
| `AUTO_CANCEL_THRESHOLD_DAYS` | `wrangler.toml [vars]` | Delays ≥ this auto-escalate (default: `14`) |

---

## Seed Data

Five suppliers across three tiers, five POs, and a many-to-many `po_suppliers` assignment table:

| Supplier | Tier | Good for demoing |
|---|---|---|
| Nordic Furnishings AS | preferred | Normal happy path — reroute or hold |
| Coastal Goods Ltd | standard | Standard escalation path |
| MegaFlat Inc | probation | Auto-cancel at 7+ days |
| Baltic Home Group | preferred | Multi-supplier PO (PO-4821 has 3 suppliers) |
| Suncoast Furniture | standard | Standard escalation path |

PO-2026-4821 is assigned to 3 suppliers — best for the supplier dropdown demo.

---

## Demo

The live demo follows the [Loom script](./requirements/demo-script-loom.md):

1. Submit PO-4821 (Nordic Furnishings, preferred, 5 days, ASN missing) → `investigating` → `awaiting_supplier`
2. Click **Sim Response** → `closed`, decision `reroute`
3. Upload `public/sample-manifest-PO-2026-4821.pdf` via Document tab → agent extracts and runs same pipeline
4. Submit PO-4823 (MegaFlat, probation, 8 days) → straight to `cancelled`
5. Click **Override** on any decided row → `[Human] overrode_decision` in audit log
6. Click **Download CSV** → full audit trail

**Closing line:** *"From delay notification to routing decision in under 10 seconds. The agent investigates, reaches out, decides, and logs — the ops team only sees the hard ones."*

---

## In a Real System

### What `reroute` would actually do

Today `reroute` is a decision label — the agent logs it and closes the exception. In production it would trigger a chain of actions using data already in the schema:

**1. Find the next available supplier**

The `po_suppliers` junction table already maps every PO to its approved alternates. For PO-2026-4821, the agent could query:

```sql
SELECT s.id, s.name, s.email, s.tier
FROM suppliers s
INNER JOIN po_suppliers ps ON s.id = ps.supplier_id
WHERE ps.po_number = 'PO-2026-4821'
  AND s.id != 'sup-001'   -- exclude the delayed supplier
ORDER BY s.tier ASC        -- prefer preferred > standard > probation
```

This returns Baltic Home Group and Coastal Goods Ltd as reroute candidates — no new data model needed.

**2. Create or reassign the order**

- Clone the open PO line and assign it to the next supplier in the list
- Update `purchase_orders.supplier_id` and reset `expected_by` based on their lead time
- Mark the original PO line as `cancelled` or `rerouted`

The `purchase_orders` table currently tracks: `po_number`, `supplier_id`, `item_count`, `expected_by`, `status`. A `rerouted_to` column and a `reroute_reason` column would be natural additions.

**3. Notify the warehouse**

Push an event to the warehouse management system so pick/pack expectations are updated before the new shipment arrives.

---

### Supplier communication — what's missing

The `suppliers` table has `email` on every row. The Outreach Agent drafts a message but doesn't send it. In production the message would go out over one or more channels depending on the supplier's preference:

| Channel | Integration | When to use |
|---|---|---|
| **Email** | [Resend](https://resend.com) or SendGrid — one `fetch()` call from the Worker | Default for all suppliers; preferred for formal paper trail |
| **Slack** | Slack Incoming Webhook or Bot API | Internal ops alerts, not supplier-facing |
| **SMS / WhatsApp** | Twilio — `fetch()` to Twilio REST API | Probation suppliers or urgent escalations where email response rate is low |
| **EDI / API** | Supplier's own webhook endpoint | Large preferred partners (Nordic Furnishings AS tier) with technical integrations |

The schema would need a `contact_channel` field on `suppliers` (or a `supplier_contacts` table with one row per channel) so the Outreach Agent can pick the right transport:

```sql
-- What this would look like
CREATE TABLE supplier_contacts (
  supplier_id  TEXT NOT NULL,
  channel      TEXT NOT NULL,  -- email | slack | sms | edi
  address      TEXT NOT NULL,  -- email address, phone number, webhook URL, etc.
  is_primary   INTEGER DEFAULT 0,
  PRIMARY KEY (supplier_id, channel)
);
```

The Outreach Agent already returns a `supplier_message` string — routing it to the right channel is a single tool call once the transport is wired.

---

### Receiving supplier replies — closing the loop

Today `POST /exceptions/:id/simulate-supplier-response` is the only inbound entry point and it's called manually. In production, supplier replies need to find their way back automatically. The pattern is the same across all channels: stamp an exception-specific token on the outbound message, then match it on the way back.

**Schema addition — one column on `exceptions`:**

```sql
ALTER TABLE exceptions ADD COLUMN reply_token TEXT; -- stamped when outreach is sent
```

**Inbound webhook route — one new endpoint:**

```
POST /webhooks/inbound/:channel   -- called by Resend / Twilio / Slack / supplier
```

This handler parses the reply, looks up the exception by `reply_token`, and calls the same Decision Agent pipeline that `simulate-supplier-response` calls today. The `agent_log` table captures everything — no other schema changes needed.

**Per-channel mechanics:**

| Channel | How the reply arrives | How the exception is matched |
|---|---|---|
| **Email** | Set `Reply-To: reply+{token}@mail.yourdomain.com` on outbound. Resend/SendGrid parse inbound emails and POST to your webhook. | Extract token from the `Reply-To` address in the inbound payload |
| **SMS / WhatsApp** | Twilio POSTs to your webhook URL on every inbound message | Store supplier phone → exception mapping; look up on inbound `From` number |
| **Slack** | Slack event subscription POSTs message events to your webhook | Store thread ID against the exception when outbound message is sent; match on `thread_ts` |
| **EDI / Supplier API** | Supplier POSTs directly to `POST /exceptions/:id/supplier-response` with a bearer token you issued | Token in `Authorization` header; no `reply_token` needed |

The existing `/simulate-supplier-response` endpoint is already the right shape — the only real work is the inbound webhook parser and the `reply_token` column.

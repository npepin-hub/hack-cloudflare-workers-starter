# Wayfair × Subconscious Hackathon Starter

Build an AI agent on **Cloudflare Workers** powered by the [Subconscious API](https://docs.subconscious.dev).

This repo gives you a working agent, a dashboard, and four ways to trigger it — so you can focus on the problem, not the plumbing.

---

## Pick a track

### Track 1 — Consumer Shopping Experience

Millions of customers visit Wayfair every day to buy furniture. How can AI agents improve discovery and the buyer experience?

**Challenge:** Build an agent that improves the consumer discovery and shopping experience for furniture.

**Starter ideas:**
- Style matcher — user describes a room → agent recommends furniture categories and search terms
- Compare assistant — agent helps narrow down similar products by dimensions, material, and reviews
- Discovery bot — cron or webhook ingests new catalog data → agent flags trending items or gaps

**Good triggers:** `POST /api/run` (user query), dashboard button (demo), webhook (product events)

---

### Track 2 — Supply Chain

Hundreds of thousands of furniture pieces ship worldwide through Wayfair and its supplier network. How can AI agents help manage this complexity?

**Challenge:** Build an agent that improves Wayfair's ability to manage its supply chain.

**Starter ideas:**
- Delay triage — webhook on shipment exception → agent summarizes impact and suggests next steps
- Supplier monitor — cron checks status feeds → agent logs anomalies and priorities
- Route advisor — agent uses tools to compare options and recommend reroutes or escalations

**Good triggers:** webhook (shipment/supplier events), cron (scheduled checks), `POST /api/run` (ops query)

---

### Track 3 — FinOps & Customer Service

Wayfair manages ~$12B in revenue and serves ~22M customers per year. How can agentic systems improve financial operations and customer service?

**Challenge:** Build an agent system that improves internal operations: financial operations or customer service.

**Starter ideas:**
- Ticket router — webhook on support ticket → agent classifies, summarizes, and routes
- Refund analyst — agent reviews case details via tools and drafts a recommendation
- Ops digest — cron runs daily → agent summarizes open issues, spend anomalies, or SLA risks

**Good triggers:** webhook (tickets, payments), cron (daily digest), `POST /api/run` (analyst query)

---

## Get started

**Prerequisites:** Node.js 20+, a [Subconscious API key](https://www.subconscious.dev/platform)

```bash
# 1. Install
npm install

# 2. Configure secrets
cp .dev.vars.example .dev.vars
# Add SUBCONSCIOUS_API_KEY to .dev.vars

# 3. Create KV storage (agent config + run history)
npx wrangler kv namespace create AGENT_KV
npx wrangler kv namespace create AGENT_KV --preview
# Paste both IDs into wrangler.toml

# 4. Run
npm run dev
```

Open **http://localhost:8787** — edit your agent's prompts, pick tools, and hit **Run now**.

**Deploy:**

```bash
npm run deploy
npx wrangler secret put SUBCONSCIOUS_API_KEY
```

---

## How it works

```
Trigger          →  Worker routes  →  Agent (Subconscious)  →  Your tools
─────────────────────────────────────────────────────────────────────────────
Button / API        src/index.ts       reasoning + tool calls     src/agent/tools.ts
Webhook
Cron (hourly)
```

| Piece | What it does |
|-------|----------------|
| **Agent logic** | System prompt, instructions, and enabled tools — edit in the dashboard or via API |
| **Subconscious** | Handles reasoning; calls your tools when needed |
| **Tools** | Functions your agent can invoke (fetch data, log notes, call APIs) — you implement these |
| **KV storage** | Persists config and run history between triggers |

---

## Build your agent

### 1. Set the behavior

Use the dashboard at `/` or update config via API:

```bash
curl -X PUT http://localhost:8787/api/agent/config \
  -H "Content-Type: application/json" \
  -d '{
    "systemPrompt": "You are a Wayfair shopping assistant.",
    "instructions": "Help the user find furniture that fits their room.",
    "enabledTools": ["get_time", "log_note"]
  }'
```

Defaults live in `src/types.ts` if you prefer code over the dashboard.

### 2. Add a tool

Tools are how your agent takes action. Edit `src/agent/tools.ts`:

```typescript
search_catalog: {
  name: "search_catalog",
  description: "Search furniture by style, room, or dimensions",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      maxPrice: { type: "number" },
    },
    required: ["query"],
  },
  execute: async (args) => {
    // Call your data source, mock API, or KV lookup
    return { results: [{ name: "Sofa", sku: "WF-123" }] };
  },
},
```

Enable it in the dashboard tool picker or add it to `enabledTools` in config.

### 3. Wire up a trigger

| Trigger | When to use | How |
|---------|-------------|-----|
| **Button** | Demos, manual testing | Dashboard → Run now |
| **API** | User-facing apps, internal tools | `POST /api/run` |
| **Webhook** | External events (tickets, shipments, orders) | `POST /api/webhook` |
| **Cron** | Scheduled digests, monitoring | Edit `[triggers].crons` in `wrangler.toml` |

**Run on demand:**

```bash
curl -X POST http://localhost:8787/api/run \
  -H "Content-Type: application/json" \
  -d '{"instructions": "A customer wants a mid-century desk under $500. What should I recommend?"}'
```

**React to an event:**

```bash
curl -X POST http://localhost:8787/api/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "shipment.delayed",
    "payload": { "orderId": "WF-9912", "delayDays": 3 }
  }'
```

Set `WEBHOOK_SECRET` in `.dev.vars` to require an `x-webhook-secret` header in production.

---

## API quick reference

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/agent/config` | Read agent config |
| `PUT` | `/api/agent/config` | Update agent config |
| `GET` | `/api/agent/tools` | List available tools |
| `POST` | `/api/run` | Run the agent now |
| `POST` | `/api/webhook` | Run on external event |
| `GET` | `/api/runs` | Recent run history |
| `GET` | `/api/runs/:id` | Single run details |

---

## Project layout

```
src/index.ts           Routes + cron handler
src/agent/tools.ts     ← add your tools here
src/agent/runner.ts    Tool loop (usually no edits needed)
src/types.ts           Default agent config
public/index.html      Dashboard
wrangler.toml          Cron schedule, KV binding
```

---

## AI coding assistant setup

Install the Subconscious skill so Cursor, Claude Code, or Codex understand the API:

```bash
npx skills add https://github.com/subconscious-systems/skills --skill subconscious-dev
```

Already bundled at `.agents/skills/subconscious-dev/`. See [AGENTS.md](./AGENTS.md) for file-level guidance.

---

## Subconscious API

| | |
|---|---|
| Base URL | `https://api.subconscious.dev/v1` |
| Model | `subconscious/tim-qwen3.6-27b` |
| Auth | `SUBCONSCIOUS_API_KEY` in `.dev.vars` |
| Tools | OpenAI-style function calling — **your Worker runs them** |

Docs: [docs.subconscious.dev](https://docs.subconscious.dev) · Playground: [subconscious.dev/playground](https://www.subconscious.dev/playground)

---

## Tips

- Start with one track, one trigger, and one tool — then expand.
- Use the dashboard to iterate on prompts before writing code.
- Set `enableThinking: false` (default) for fast responses; turn on for harder reasoning tasks.
- Mock external data in tools first; swap in real APIs when the agent logic works.

Good luck — build something useful for Wayfair customers, suppliers, or ops teams.

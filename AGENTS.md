# AI assistant guide

Hackathon starter: **Cloudflare Workers + Subconscious API** for Wayfair agent challenges.

## Tracks

1. **Consumer shopping** — discovery, recommendations, buyer experience
2. **Supply chain** — shipments, suppliers, logistics
3. **FinOps & customer service** — tickets, refunds, internal ops

Participants pick a track, define agent behavior, add tools, and connect a trigger.

## Subconscious skill

```bash
npx skills add https://github.com/subconscious-systems/skills --skill subconscious-dev
```

Bundled at `.agents/skills/subconscious-dev/`.

## Flow

```
Trigger → src/index.ts → src/agent/store.ts → src/agent/runner.ts → Subconscious API
                                                              ↓
                                                    src/agent/tools.ts
```

## Edit these files

| Goal | File |
|------|------|
| Default prompts / config | `src/types.ts` |
| Add tools (main hackathon work) | `src/agent/tools.ts` |
| New routes or triggers | `src/index.ts` |
| Cron schedule | `wrangler.toml` |

## Env vars

- `SUBCONSCIOUS_API_KEY` — required ([get key](https://www.subconscious.dev/platform))
- `WEBHOOK_SECRET` — optional, protects `POST /api/webhook`

## API

- `PUT /api/agent/config` — update agent logic
- `POST /api/run` — run now (`{ "instructions": "..." }`)
- `POST /api/webhook` — event trigger
- `GET /api/runs` — history

## Subconscious

- Base: `https://api.subconscious.dev/v1`
- Model: `subconscious/tim-qwen3.6-27b`
- Tools are client-side — Worker executes them, not Subconscious

Full API details: `.agents/skills/subconscious-dev/SKILL.md`

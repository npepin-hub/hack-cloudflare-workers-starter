# Demo Script — Loom Loop Video
### Supplier Delay Agent · Supply Chain Track · ~90 seconds · no cuts

---

## Before You Hit Record

- [ ] Open `http://localhost:8787` — exception queue must be empty
- [ ] Have `sample-manifest-PO-2026-4821.pdf` ready on your Desktop
- [ ] Terminal hidden, browser fullscreen or snapped full width
- [ ] Loom: set to record **This Tab** only (not full screen) — cleaner capture
- [ ] Do one dry run first to warm the Subconscious API and check LLM response time

---

## The Script

---

### [0:00–0:10] — Manual submission, preferred supplier

**Action:**
1. In the PO search field, type `PO-2026-4821`
2. Supplier dropdown appears — pick **Nordic Furnishings AS (preferred)**
3. Delay Reason: `Port congestion`
4. Days Delayed: `5`
5. Check **ASN Missing**
6. Hit **Submit Exception**

**Say:**
> "A shipment is flagged — PO 4821, Nordic Furnishings, 5 days late, no ASN. I submit it and the agent takes over."

**What appears:** exception row with `investigating` badge

---

### [0:10–0:20] — Agent investigates, drafts outreach

**Action:** Watch badge flip to `awaiting_supplier`. Click **Log** on the row.

**Say:**
> "The Investigation Agent assessed the PO. The Outreach Agent drafted a message to the supplier — tone adjusted for a preferred partner. It's stored and waiting for their reply."

**What appears:** Outreach message expanded below the row

---

### [0:20–0:35] — Supplier responds, decision made

**Action:** Click **Sim Response** on the row. Wait ~8 seconds. Watch badge flip to `closed`, decision `reroute`. Click **Log**.

**Say:**
> "Supplier confirmed ASN details. Decision Agent evaluated: 5-day delay, preferred tier — reroute. Closed in under 10 seconds."

**What appears:** Full agent log — investigation → outreach → supplier → decision → notification

---

### [0:35–0:50] — Document upload path

**Action:**
1. Click **Document** tab
2. Drag `sample-manifest-PO-2026-4821.pdf` into the dropzone
3. Hit **Submit Exception**

**Say:**
> "Same pipeline, different input. Upload a shipping manifest — Subconscious reads it, extracts the PO details, and runs the same agent chain."

**What appears:** New exception appears, pipeline runs on extracted document data

---

### [0:50–1:05] — Probation supplier, auto-cancel

**Action:**
1. Switch back to **Manual** tab
2. Type `PO-2026-4823` → **MegaFlat Inc (probation)** auto-fills
3. Delay Reason: `No contact`
4. Days: `8`
5. Submit

**Say:**
> "Probation supplier, 8-day delay. Agent doesn't wait for a response — it cancels automatically. Rule 1."

**What appears:** Goes straight to `cancelled` — no awaiting_supplier step

---

### [1:05–1:15] — Human override

**Action:** Click **Override** on any `closed` or `decided` row → pick `escalate` → type `Escalating — supplier history flagged` → Confirm.

**Say:**
> "For edge cases, one click lets the ops team override. Every action — agent or human — is timestamped in the audit log."

**What appears:** Badge updates, Log shows `[Human] overrode_decision`

---

### [1:15–1:25] — Download CSV

**Action:** Click **Download CSV**.

**Say:**
> "Full audit trail, one click. Every exception, every decision, ready for compliance or reporting."

**What appears:** File downloads — `exceptions_2026-05-26T...csv`

---

### [1:25–1:30] — Loop point

Let the queue sit for 2 seconds — 3 exceptions visible (2 closed, 1 cancelled). Then restart from step 1. The queue just grows. The loop is seamless.

---

## Closing Line

> *"From delay notification to routing decision in under 10 seconds. The agent investigates, reaches out, decides, and logs — the ops team only sees the hard ones."*

---

## Loom Settings

| Setting | Value |
|---|---|
| Record | This Tab |
| Camera | Off (or small bubble bottom-right) |
| Mic | On — use the script above |
| Trim | Cut first 1s and last 1s to clean the loop |
| Title | `Supplier Delay Agent — Wayfair Supply Chain Hackathon` |

---

## Sample Manifest

`sample-manifest-PO-2026-4821.pdf` is in `public/` and served at:
`http://localhost:8787/sample-manifest-PO-2026-4821.pdf`

Contents: Nordic Furnishings AS, PO-2026-4821, 240 items ordered / 220 shipped, 13-day delay, carrier notes, contact details. Realistic enough for a demo.

# PLAN_TRACKER.md — Status of all work

**Status:** The moving document. Status lives here and **nowhere else**.
**Last revised:** 28 August 2026
**Companions:** `PROJECT_CHARTER.md` · `ARCHITECTURE.md` · `DECISIONS.md` · `SCHEMA.md` · `AGENTS.md`

> This file exists because the previous plan document said "nothing is currently blocked or
> broken" and stopped being true within a day. Architecture describes the system;
> **this** describes the state of work. Do not record status anywhere else.
>
> **DONE** = verified in browser or database, with the evidence named.
> **BUILT-UNVERIFIED** = code exists, nobody has confirmed behaviour. Treat as not done.
> **BLOCKED** = cannot proceed, reason named.

---

## 0. WHERE WE STOPPED — read this first

**Last working session: 5 August 2026.** This document was written 28 August; anything
below reflects the state as of 5 August unless re-verified.

### The last completed thing
The **client brief spec-match rules** (migration 022) were built and tested. Test cases
(a)–(g) all behaved correctly once the test was run against an **active-listings** run.

### The false alarm that cost time — resolved
Spec rules appeared not to fire at all. Cause: the test run had `run_type = 'sold_comps'`,
and spec rules are deliberately active-listings-only (`DECISIONS.md` 4.8). The code was
correct. **The UI silently accepted a brief on a sold-comps run and then ignored it** — a
usability gap now queued as item 1.4 below.

### Immediately next, in order
1. **1.1** — finish the missing client-brief form fields (blocks further testing)
2. **1.2** — view / edit / soft-delete for briefs and clients
3. **1.3** — audit the runs list + creation form before any restructure
4. **2.1** — A2 derived flags, including cross-platform reappearance

### The most valuable open finding
A vehicle sold on **Copart and then IAAI** was observed in a client run flagged only as a
mild "unconfirmed sale" warning. Cross-platform reappearance is a **wreck-and-flip fraud
signal** that `PROJECT_CHARTER.md` §6 says must be blocked from client deliverables. The
rule was never built — it is Phase **A2**. This is a fraud pattern currently reaching client
deliverables unflagged, and it is the highest-value item outstanding.

---

## 1. Immediate queue

### 1.1 Finish client-brief form fields — **NOT STARTED**
Migration 022 created all columns, but the form only asks for some. Missing inputs:
`colour_preference`, `titles_accepted`, `fuel_type`, `trim`, `interior_preference`,
`max_budget_usd`, `max_bid_usd`, `quantity`.

Blocks testing of the colour/fuel/trim/title spec rules — those rules exist in code but
cannot be exercised because the data cannot be entered. Small; do first.

Note: `max_budget_usd` / `max_bid_usd` are **captured but not enforced**
(`DECISIONS.md` 3.6). Store them; do not build a budget rule.

### 1.2 Brief and client view / edit / soft-delete — **NOT STARTED**
Currently a brief cannot be opened, edited or deleted.

Reuse the existing research-run deletion pattern (`DECISIONS.md` 9.9): superadmin only,
type the full name to confirm, 30-day recovery. Do not invent a second model.

`deleted_at`/`deleted_by` columns exist on `client_briefs` (migration 023, applied
5 Aug 2026, committed to git 4 Sep 2026 — see `SCHEMA.md` §10). No UI work has started;
the schema is no longer the blocker here.

Two constraints:
- Deleting a brief must not break runs pointing at it — the run keeps working and keeps its
  spec history.
- Deleting a client should be blocked while they have live runs.

### 1.3 Audit runs list + creation form — **NOT STARTED**
Read-only inventory of every feature on the runs list and creation form **before** the
restructure, so nothing convenient is quietly dropped. This is the checkpoint that stops
item 3.1 going wrong.

### 1.4 Warn when a brief is attached to a sold-comps run — **NOT STARTED**
The app currently accepts the link and silently ignores it. Should display something like
"spec matching applies to active-listings runs only." Small, prevents a repeat of the
5 August false alarm.

---

## 2. Phase A — data quality

### A1. Source-aware sale verification — **DONE** (5 Aug)
Evidence: `isUnconfirmed` confirmed to mean `sale_confirmed === false` only, so `false`
hard-blocks attachment while `null` + auction platform still attaches, badges and is
excluded from the average. Verified by reading quoted code in
`researchService.ts` / `AddCapturesModal.tsx` / `ResearchRunDetail.tsx`.

Known cosmetic debt: `isUnconfirmed` is duplicated in two files rather than shared. Not a
bug; will drift if one copy is edited. One-line fix, unqueued.

### A1b. Source/population coherence guard — **NOT STARTED**
Distinct axis from A1. `logged_via` answers "is this a real sale?" but not "is this the same
kind of price, from the same population?" A `manual_entry` sighting can carry a **Nigerian
dealer asking price**, which is neither a concluded sale nor the same market as a US auction
comp. Asking ≠ sold; NG retail ≠ US auction.

Should WARN when a sold-comps average mixes materially different populations (by
`source_platform`). Deeper form of the existing mixed-models rule.

### A2. Derived asset flags — **NOT STARTED — HIGH PRIORITY**
From `auction_history`: `appearance_count`, `previously_unsold`,
`cross_platform_reappearance`, `highest_rejected_bid`, plus the checklist rules using them.

**Cross-platform reappearance must be a hard block from client deliverables**
(`PROJECT_CHARTER.md` §6). A real instance has already been observed (Copart → IAAI) passing
through with only a mild warning.

Commercial upside beyond fraud detection: rejected-bid history reveals the seller's reserve
and the market's repeated refusal — bidding intelligence no competitor has.

### A3. Extension run-picker — **NOT STARTED**
Dropdown of active runs, replacing the current typed UUID.

---

## 3. Structure and navigation

### 3.1 Client-hub restructure — **NOT STARTED**
Per `DECISIONS.md` §8. Client page becomes the hub (details, briefs, their runs, a
"New research run" button pre-filling client + brief). All-runs page stays as a cross-client
index. **`ResearchRunDetail` is not moved.** No router in this step.

Depends on 1.3 (audit) landing first.

**Open first:** `DECISIONS.md` 8.5 — may a run exist without a client?

---

## 4. Alerts and intake

### 4.1 Auction alerts (24h / 1h) — **NOT STARTED**
Designed, unblocked, not built. Reuses the `monthly-backup` pattern: pg_cron → Edge Function
→ Resend.

Confirmed feasible: `sale_date` carries full date **and** time **and** timezone
(`"Thu. Aug 06, 2026 03:00 PM GMT+1"`), so a 1-hour alert is possible. Must reuse the
existing `parseAuctionDate()` helper — a second parser would drift.

Requirements:
- Recipient list editable, not hardcoded (`DECISIONS.md` 7.2)
- Initial: `caplimoltd@gmail.com`, `umarfbash@gmail.com`, `ufbash@gmail.com`
- Client receives **24h only**
- No `client_email` field exists yet — needs adding
- No assignee field on `research_runs` — needs adding
- Fahad/Ahmed added only post-licence (`DECISIONS.md` 1.5)

Likely needs a stored timestamp column (parsed from `sale_date`) so cron can query
efficiently rather than parsing text in SQL.

### 4.2 Client intake form — **NOT STARTED**
Per `DECISIONS.md` §6. Web version of the existing Google Form, writing into the client
record from 022. Tokenized link, no login required, staff review before the brief goes live.

Source form fields (from the current Google Form): full name · mobile/WhatsApp · email ·
preferred contact · assigned agent · make · model · trim · year · quantity · transmission ·
fuel · max mileage · condition · title required · damage tolerance · colour · interior ·
max budget · max bid · shipping insurance opt-in · preferred auction/source · pickup
location · inspection required · inspection scope · payment method · additional notes ·
example images · consent to bid · consent to share details with auction houses · confirmation

Must build **after** 1.1/1.2 so it writes into a complete, editable brief.

---

## 5. Phase B — coverage

### B1. IAAI content script — **NOT STARTED**
Same schema; image permutation `[2,1,4,3]`. Present in the original Camry sheet; the one
source still missing.

### B2. Copart Sales History — **NOT STARTED**
Parity with bid.cars, if exposed. **Currently the reason every Copart sighting carries
"Unconfirmed sale" permanently** — there is no history to derive `sale_confirmed` from.
Raises the value of A1 considerably.

---

## 6. Phase C — landed cost

- **C1.** `cost_rates` table + admin screen — **NOT STARTED, not blocked.** Buildable now.
- **C2.** Duty calculator (51.47% formula + observed calibration) — **BLOCKED** on
  collecting 10+ assessment notices.
- **C3.** Client-facing grouped cost display (Vehicle · Shipping & logistics · Duties &
  clearing · Service fee · Total), expected and ceiling — **NOT STARTED**, depends on C1/C2.

---

## 7. Phase D — client operations

`clients` and `client_briefs` landed early (migration 022) as part of the brief work.
Remaining: `client_vehicles`, `vehicle_status_events` (state machine), `documents`,
`invoices` — all org-scoped and audited → staff dashboard build-out → client portal
(Google auth, status timeline, shareable tracking link, documents) → "Request this vehicle"
loop → email notifications → subdomain split → Chrome Web Store private publish.

**Status lifecycle:** RESEARCHED → RECOMMENDED → REQUESTED_BY_CLIENT → BID_PLACED →
WON / LOST → PAID → AT_US_PORT → ON_VESSEL → ARRIVED_DESTINATION_PORT →
CUSTOMS_CLEARANCE → READY_FOR_COLLECTION → DELIVERED (+ CANCELLED).
Enum + audited transitions; extensible by migration.

**Gate:** staff logins require the signed licence (`DECISIONS.md` 1.5).
**URL routing** belongs here (`DECISIONS.md` 8.4) — the portal needs its own address.

---

## 8. Phase E — estimator

E1 harvest → E2 standardisation → E3 stats engine → E4 public MVP → E5 analytics.
All **NOT STARTED**. E1 may begin early since comps compound weekly.
E4 must not precede E1–E3.

---

## 9. Phase F — intelligence

Deliberately last; needs accumulated data. Daily Sniper (vision ingestion, `NOT_VISIBLE`
anti-hallucination prompt) · Market Velocity Index · decay model · arbitrage detection ·
origin premium spread · repair-cost dataset exploitation.

---

## 10. Completed this cycle (3–5 August 2026)

| Item | Evidence |
|---|---|
| A1 source-aware sale filter | Quoted-code review of the attach gate vs the count-exclusion path |
| Critical share-blocks + typed override | DB row: reason, `ea3ecc92…` user id, timestamp `2026-08-05 01:12:32` |
| Migration 021 applied | 3 override columns confirmed present in `information_schema` |
| Full-row click → detail modal | Photo, left, centre and right of a row all open the modal |
| `parseAuctionDate()` helper | Shared util; "Future" correctly yields "Auction date TBC" |
| Auction countdown, staff + public | Live countdown; `sale_date` added to `public-run` allow-list and redeployed |
| Urgency colours (<48h red, ≥48h amber) | Verified on both views |
| Mixed-run `soldList` regression fix | `soldList` gated on `lot_state === 'finished'` only |
| Migration 022 — clients + client_briefs | Test brief `297467f4…` linked to client `9e26aefd…` |
| Spec-match rules (a)–(g) | All behaved correctly on an active-listings run |

**Bugs found and fixed this cycle:** three separate instances of `current_bid_usd` being
misused as a liveness test (see `AGENTS.md` §4.1); a migration-number collision;
`sale_date` missing from the public allow-list; a per-second re-render causing a modal to
flicker.

---

## 11. Debt register

| # | Item | Note |
|---|---|---|
| 1 | AutoData↔Caplimo licence unsigned | **Blocks Phase D and alert recipients** |
| 2 | No staging environment | Production Supabase doubles as the dev database |
| 3 | `isUnconfirmed` duplicated across two files | Will drift if one is edited |
| 4 | Data Detox (`handleCleanData`) disabled | Targeted the locked `sales` table |
| 5 | CSV `importSales` disabled | Pending ledger-shaped re-implementation or removal |
| 6 | `standardizeTrims` / `executeTrimCleanup` stubbed | Superseded by the E2 resolver |
| 7 | Copart model/trim duplication backfill | `model LIKE '% ' \|\| trim` |
| 8 | Three client-side Gemini calls use `VITE_GEMINI_API_KEY` | Absent from Vercel; local dev only. Server-side at Phase F |
| 9 | Gemini key should be reissued under the caplimoltd GCP project | |
| 10 | `sales` table physical drop | Currently RLS-locked, retained as backup |
| 11 | Google Workspace decision for `theautodata.com` | Needed before Chrome Web Store private publish |
| 12 | Google OAuth consent screen | Keep in "Testing" with explicit test-user list until the portal ships |
| 13 | Title standardisation | Title matching is approximate substring matching until this lands |
| 14 | Assessment notices must be photographed before handover | Ongoing habit, not a task |
| 15 | Legacy `sheet_url` / `drive_folder_url` columns on `research_runs` | Drive/Sheets dropped; columns remain |

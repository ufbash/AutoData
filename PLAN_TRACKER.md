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
4. ~~**2.1** — A2 derived flags~~ — DONE 4 Sep 2026, see §2 below

### The most valuable open finding
A vehicle sold on **Copart and then IAAI** was observed in a client run flagged only as a
mild "unconfirmed sale" warning. `PROJECT_CHARTER.md` §6 frames this as a cross-platform
wreck-and-flip fraud signal that must be blocked from client deliverables; Bashir's rule
(4 Sep 2026, see `MASTER_PLAN.md` A2) broadens it to any prior auction appearance. The rule
was never built — it is Phase **A2**.

Corrected urgency framing (4 Sep 2026): the one real instance found (a 2021 Tesla Model 3,
asset `1ea4d7f1-51e1-4889-888b-101578f8a7bf`) is a car auctioned twice three years apart with
consistent mileage accrual (51218 → 63017, i.e. increasing, not rolled back) and an insurance
seller (GEICO) on the second appearance — it blocks under Bashir's new rule, but it is **not**
evidence of a fraud pattern currently in flow. The accurate statement is that
prior-auction-history is currently **UNDETECTABLE** in the live checklist — the check does
not exist, not that a known-bad car is slipping through unflagged. Still worth fixing; not
an active incident.

---

## 1. Immediate queue

### 1.1 Finish client-brief form fields — **DONE** (4 Sep 2026)
Evidence: database row showing `titles_accepted` stored as a true 3-element array, distinct
`max_budget_usd`/`max_bid_usd` values (no swap), and `max_mileage` stored as `NULL` after a
real browser round-trip (create → save → hard refresh → reopen in edit mode → every value
returned exactly as entered). All sixteen inputs are rendered by `BriefForm` in
`src/components/ClientsList.tsx`.

Note: `max_budget_usd` / `max_bid_usd` are **captured but not enforced**
(`DECISIONS.md` 3.6). Store them; do not build a budget rule.

### 1.2 Brief and client view / edit / soft-delete — **PARTIALLY BUILT**
Service layer and edit mode are present. Delete confirmation UI is unverified — nobody has
checked it.

Reuse the existing research-run deletion pattern (`DECISIONS.md` 9.9): superadmin only,
type the full name to confirm, 30-day recovery. Do not invent a second model.

`deleted_at`/`deleted_by` columns exist on `client_briefs` (migration 023, applied
5 Aug 2026, committed to git 4 Sep 2026 — see `SCHEMA.md` §10). Service layer exists:
`researchService.ts` exports `softDeleteClientBrief`, `listDeletedClientBriefs`,
`restoreClientBrief`, and the equivalent trio for clients. Edit mode is verified working
(see 1.1 — `BriefForm` handles create and edit, edit-mode round-trip confirmed 4 Sep).
Unverified and possibly unbuilt: the delete confirmation UI — superadmin only, type the full
name to confirm, 30-day recovery — and the two constraints below.

Two constraints:
- Deleting a brief must not break runs pointing at it — the run keeps working and keeps its
  spec history.
- Deleting a client should be blocked while they have live runs.

### 1.3 Audit runs list + creation form — **DONE** (4 Sep 2026)
Evidence: `docs/REPO_MAP.md` §C, 26 features inventoried, scoped to `ResearchRuns.tsx`.

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

### A1b. Source/population coherence guard — **DONE** (6 Sep 2026)
Distinct axis from A1. `logged_via` answers "is this a real sale?" but not "is this the same
kind of price, from the same population?" A `manual_entry` sighting can carry a **Nigerian
dealer asking price**, which is neither a concluded sale nor the same market as a US auction
comp. Asking ≠ sold; NG retail ≠ US auction.

WARNs (never blocks, never touches the average) when a sold-comps run — or the sold portion
of a mixed run — groups by `source_platform` and spans both a US auction source
(`copart`/`bidcars`/`iaai`) and a non-auction source (dealer, manual entry, anything else). A
null/unrecognised `source_platform` counts as unknown and is called out rather than assigned
to either side. Implemented in `ResearchRunDetail.tsx` as the `population_mismatch` checklist
item, alongside the existing mixed-models warn.

**Evidence — three cases verified in the browser (run "ZZZ TEST - A2 Case2 SoldComps"
`61d919e9-3ce6-4498-b37c-1542810b51c9` for cases 1 & 2, "ZZZ TEST - A2 Case1 ActiveBlock"
`b5d32961-ec28-4648-964d-832fb3da223e` for case 3):**
1. Sold-comps run mixing 4 bidcars comps with 1 manual comp → warn: "Average mixes 4 US
   auction comps with 1 non-auction comp; these are different markets." Manual listing badged
   POPULATION MISMATCH.
2. Same run type, auction-only ("Hail Camry" run) → checklist shows the passing state "Comps
   are from a single population", no warn.
3. Active-listings run mixing bidcars/copart/manual → no population-mismatch warn or badge at
   all (rule correctly gated to sold-comps/mixed-sold-portion only).
Average unaffected in all cases — the rule reads `soldList` for grouping only and never
touches `getStats`/the average pipeline.

### A2. Derived asset flags — **DONE** (4 Sep 2026)
Shared derivation `src/utils/auctionHistoryFlags.ts` (`deriveAuctionHistoryFlags`, one place,
not duplicated), wired through `listRunListings` (added `asset_id`) and a new
`listAuctionHistoryForAssets` batch fetch in `researchService.ts`. Three checklist rules in
`ResearchRunDetail.tsx`: Rule 1 prior-auction-history hard block (active-listings + mixed
active portion only, never overridable), Rule 2 odometer-rollback critical (all run types,
overridable), Rule 3 not-checkable informational (never a clean pass).

**Evidence — Checkpoint 1, asset `1ea4d7f1-51e1-4889-888b-101578f8a7bf` (2021 Tesla Model 3):**
`appearance_count = 2` (not 3 — the two IAAI rows dedupe on lot `37445007`),
`previously_unsold = true`, `highest_rejected_bid = 10575` (not 7500 — the `Sold` row's
`bid_amount_usd` is `NULL`), `has_prior_auction_history = true`,
`odometer_rollback = false` (51,218 → 63,017, increasing). Zero-history asset confirmed to
return `checkable = false`, never a clean pass.

**Evidence — Checkpoint 3, four browser cases, all observed:**
1. Active-listings run + Tesla → hard blocked. Checklist: "1 listing(s) blocked: this vehicle
   has been to auction before (2 prior appearances: 2023-10-17, 2023-10-19, 2026-08-25).
   (BLOCK)". Sharing toggle disabled, no override offered.
2. Sold-comps run + a different previously-auctioned vehicle (2025 Toyota Camry SE,
   confirmed sale) → **not blocked**, counted in the average: $9,525 (2 comps) →
   $11,317 (3 comps) after adding it. No prior-auction-history item rendered at all on a
   sold_comps run (`DECISIONS.md` 4.8 held).
3. Mixed run with the Camry as sold portion + the Tesla as active portion (same run) →
   Camry unbadged, counted ($14,900 sold avg); Tesla red-badged "PRIOR AUCTION HISTORY",
   blocked. Both coexist correctly in one run.
4. Copart-only vehicle with zero `auction_history` rows → checklist shows "Prior auction
   history not checkable for this source (1 listing(s)) — bid.cars Sales History coverage
   only, Copart not yet available." (blue, informational) — not blocked, not rendered as a
   clean pass.

Note on real data: every asset currently carrying `auction_history` has `lot_state =
'finished'` in its sightings — none are `'active'`. Cases 1 and 3 needed the Tesla's own
sighting `lot_state` temporarily flipped to `'active'` (confirmed with Bashir first) to
construct a real active-listings/mixed test case, then reverted to `'finished'` immediately
after. No fabricated data — same real asset and history rows throughout.

All nine spec-rule `if` blocks (`ResearchRunDetail.tsx:414/417/420/423/428/450/455/460/465`)
confirmed byte-for-byte unchanged via `git diff`. No hard delete added (same three
pre-existing `.delete()` calls, none touching `clients`/`client_briefs`/`sightings` rows
this rule cares about). No migration, no new columns — flags derived at read time per
`PROJECT_CHARTER.md` §5.8.

**Coverage limitation — permanent, not pending B2 (updated 4 Sep 2026 after B2 was retired,
see B2 below — not a defect in the rule itself):**
1. `auction_history` is populated from the bid.cars Sales History panel only, **and stays
   that way permanently** — B2 (Copart Sales History) is retired as not buildable (Copart
   exposes no such panel). A vehicle captured solely from Copart has no history rows and
   never will via this mechanism. Rule 3 renders this honestly as "not checkable" — the block
   cannot fire on Copart-only captures, permanently, not as a temporary gap.
2. Every asset currently holding auction history has `lot_state = 'finished'` in its
   sightings — none are `'active'`. Rule 1 only applies to active listings and the active
   portion of mixed runs. So **on real data as it stands today, the hard block cannot fire.**
   Demonstrating Checkpoint 3 case 1 required temporarily flipping the Tesla's own
   `lot_state` to `'active'` and reverting it afterward (see evidence above).

**Consequence: A2's real-world catch rate is currently zero, and its coverage stays
bid.cars-only permanently** — not "until B2 lands," since B2 does not exist. With B2 retired,
**P1 (client-hub restructure) is next** — see `MASTER_PLAN.md` Part XII, corrected to match.

**Odometer-rollback rule (Rule 2), verified 4 Sep 2026 via a throwaway in-memory script
against the real `deriveAuctionHistoryFlags` function** (no fabricated database row): fires
correctly on a genuine decrease regardless of input row order (sorts internally by
`auction_date`, so fetch-order is not a risk); correctly does not fire on a null odometer
(absence is not violation) or on identical readings within one deduped event (no false
positive on the Tesla's own two same-lot rows). Noted, not fixed: identical readings across
two genuinely *different* events also do not fire — the rule catches decreases only, not
suspicious flatness. A real gap, deliberately left open pending a separate decision.

Commercial upside beyond fraud detection: rejected-bid history reveals the seller's reserve
and the market's repeated refusal — bidding intelligence no competitor has.

### A3. Extension run-picker — **DONE** (6 Sep 2026)
Replaced the typed run UUID with a new `list-active-runs` Edge Function (static-secret auth
and CORS copied verbatim from `research-capture`, org-scoped by `DEFAULT_ORG_ID`) feeding a
card-based picker in the extension popup: cards grouped by run type, client name as the
headline, run label as subtitle, a search box once the list exceeds 6 runs. Picking a run
performs the capture immediately and starts a **session** — every later capture (any tab)
reuses that run silently until "End run" is clicked or 10 minutes pass idle, rather than
re-prompting per capture. Manual run-ID entry remains as a fallback if the list fails to load.

Also fixed, same cycle: `research-capture` inserted into `research_run_listings` without
checking for an existing `(run_id, sighting_id)` row first, so re-capturing a lot already
attached to the selected run threw a unique-constraint error instead of succeeding — now
checks first and reuses the existing attachment.

**Evidence:** deployed `list-active-runs`; curl-verified missing/wrong secret → 401, POST →
rejected, valid GET → 200 with org-scoped list. Confirmed in the database that a capture
through the new picker attached to a non-first run in the list (`942a03dd-...`/"ZZZ TEST - P1
Client Required"), and that re-capturing the same lot into a different run created a second
legitimate `research_run_listings` row rather than erroring or duplicating.

---

## 3. Structure and navigation

### 3.1 Client-hub restructure (P1) — **DONE** (5 Sep 2026)
Per `DECISIONS.md` §8. Client page is now the hub: details, briefs, and — added this cycle —
**that client's research runs**, listed with status, run type, listing count, created date,
and sharing status, matching the all-runs card's informative fields. A **"New Research Run"**
button on the client page opens the same creation form pre-filled with that client (name +
`client_id`) and the brief selector already scoped to their briefs.

**`ResearchRunDetail.tsx` was not touched — `git diff` confirms zero lines changed.** Both the
client-page route and the all-runs-page route call the identical `onOpenRun` callback into
the identical component (`App.tsx`); verified by opening the same run from both places.
The all-runs page is unchanged as a cross-client index — worked through `docs/REPO_MAP.md`
§C's feature inventory line by line (the table there has **31 rows**, not the 26 the
document's own prose claims — counted directly rather than trusting either number). All 31
are still present; three were intentionally changed, not lost, all required by this same
build: the client link went from optional to required (Phase 1 below), the brief selector is
now always rendered but disabled until a client is chosen rather than hidden entirely, and
the Create button's disabled condition was extended to require a client. No router was added
— deferred to Phase D per `DECISIONS.md` 8.4, unchanged.

**Placeholder client and the client requirement (`DECISIONS.md` 8.5, LOCKED):**
- `Internal / Market Research` created **through the app UI** (not SQL) — id
  `571748aa-afe0-4eb1-806a-004aef9012f7`, `org_id` confirmed correct
  (`a93378ea-33ef-4c75-97c4-44c37f2e9002`). `created_by` came back `NULL` — a pre-existing gap
  in `createClient()` (`researchService.ts:186-195` never sets it), not caused by this task
  and not fixed here.
- All 14 client-less runs repointed to it (SQL `UPDATE`, confirmed with Bashir first):
  `Bm`, `Nafisah Bashir`, `Test Market`, `Blessing`, `Mrs Mabruka Bashir`, `Mr Ademola kadiri`
  (lowercase-k duplicate), `Mr Ademola Kadiri`, `Tesla`, `25-26 Camry`, `Hail Camry`, and four
  `ZZZ TEST` artifacts. Verified one repointed run (`Tesla`, `981b0f63…`) still renders with
  its listings intact.
- The client field is now **required** on run creation — enforced in the form (native
  `required` + disabled submit) and the service call (`handleCreateRun` refuses and alerts if
  no client is selected), **not** a database constraint — no migration, no `NOT NULL` added.
- **Brief-repointing bug fixed in the same change:** the client-brief selector previously did
  not clear a stale brief selection when the client dropdown changed mid-form — switching
  clients kept the old client's brief id in state even though it no longer appeared as a
  selectable option, which would have silently saved a run with a `client_brief_id` belonging
  to a different client than its `client_id`. Fixed in `ResearchRuns.tsx`'s brief-fetch effect
  (unconditional `setSelectedBriefId('')` on every client change). Verified: switching from
  Khalifah (brief: Honda Civic) to Mr Ademola Kadiri correctly reset the brief selector and
  repopulated with only his own brief; the resulting run saved with matching `client_id` and
  `client_brief_id`.

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

### 4.2 Client intake form — **NOT STARTED** (schema ready, 6 Sep 2026)
Per `DECISIONS.md` §6. Web version of the existing Google Form, writing into the client
record from 022. Tokenized link, no login required, staff review before the brief goes live.

Source form fields (from the current Google Form): full name · mobile/WhatsApp · email ·
preferred contact · assigned agent · make · model · trim · year · quantity · transmission ·
fuel · max mileage · condition · title required · damage tolerance · colour · interior ·
max budget · max bid · shipping insurance opt-in · preferred auction/source · pickup
location · inspection required · inspection scope · payment method · additional notes ·
example images · consent to bid · consent to share details with auction houses · confirmation

Must build **after** 1.1/1.2 so it writes into a complete, editable brief.

**Schema landed in migration `024_intake_schema_and_deposit_gate.sql`:** all fields above that
lacked a column now have one on `client_briefs` — `preferred_auction_sources` (`text[]`),
`pickup_delivery_location`, `inspection_required` (boolean), `inspection_scope` (`text`, free
description, not multi-select), `payment_method`, `damage_tolerance_accepted` (`text[]`,
captured/not enforced — see `SCHEMA.md` §10), `shipping_insurance_optin` (boolean),
`consent_to_bid` and `consent_share_with_auction_houses` (separate booleans, never bundled),
plus the review flow (`status` — `pending_review`/`approved`, defaults to the latter for the 8
pre-existing briefs) and the submission evidence trail (`submitted_at`,
`confirmation_sent_at`). All nullable, no defaults that imply an answer. The form itself — the
UI that writes into these columns — is still not started; this is the schema only.

**Known, deliberately unaddressed:** the form asks for a single Year while the schema (and this
migration) still maps it to `year_min`/`year_max` both set equal — a client wanting a 2018-2020
range has no way to say so yet, though the schema already supports it. Cheap to widen the form
to a range when it's built; awkward once real submissions exist under the single-year
assumption.

### 4.3 Deposit gate on run creation — **DONE** (6 Sep 2026)
Per `DECISIONS.md` 2.7, adopted this cycle: a research run cannot start until the client's
commitment fee has landed. `deposit_received_at`/`deposit_recorded_by` live on `clients`
(migration 024) — a relationship-level fact, not per-brief or per-run. `createRun()`
(`src/services/researchService.ts`) refuses with a named reason when the selected client has
no deposit marked; a staff-facing checkbox on the client record
(`src/components/ClientsList.tsx`) sets/clears it. The placeholder "Internal / Market
Research" client is exempt. Superadmin override follows the existing
`critical_override_reason`/`_by`/`_at` pattern, mirrored here as `deposit_override_*` on
`research_runs`, gated on a typed reason of at least 10 characters
(`src/components/ResearchRuns.tsx`). No payment integration — a manual staff toggle only
(`DECISIONS.md` 5.7).

**Evidence — three cases verified in the browser:** (1) "Mr Ademola Kadiri" with no deposit →
Create Run disabled, red warning naming the reason, clicking it created nothing (confirmed
against the database — no new row). (2) Same client, deposit marked via the new checkbox →
run created immediately, no warning (`92526662-...`). (3) "Internal / Market Research" →
succeeded with no deposit and no warning shown at all (the case that would catch the gate
wrongly blocking internal work). Override path verified separately: "Khalifah" (no deposit) +
a typed reason recorded `deposit_override_reason`/`_by`/`_at` on the new run
(`3babe481-...`).

---

## 5. Phase B — coverage

### B1. IAAI content script — **NOT STARTED**
Same schema; image permutation `[2,1,4,3]`. Present in the original Camry sheet; the one
source still missing.

### B2. Copart Sales History — **RETIRED — NOT BUILDABLE** (4 Sep 2026)
Would have given parity with bid.cars, if exposed. **Copart does not expose the data.**
DOM recon on a live Copart lot (4 Sep 2026, `https://www.copart.com/lot/49917586/...`) found:
three `<table>` elements, all vehicle specification (option codes; style/model/trim; engine
specs) — none carrying auction dates, bids, or sale outcomes; the only "history-ish" heading
matches were this lot's own live "Current bid$0USD" and a footer navigation link labelled
"Auctions"; the only date-related element was a label for this lot's own upcoming "Sale
date:", not a record of past appearances; no sold/not-sold/final-bid text anywhere on the
page. One page is thin evidence for a permanent claim on its own, but it directly confirms
the standing understanding that Copart has no such panel, and no counter-evidence has been
supplied.

**This is retired, not done and not merely unstarted** — those would mean opposite things to
a future reader. The reason every Copart sighting carries "Unconfirmed sale" permanently is
therefore Copart's own data model, not a gap awaiting this build. See `SCHEMA.md` §7 and A2
above, both updated to match. If a different Copart page type (e.g. a **sold**/archived lot)
is later shown to expose something this recon didn't reach, that would need re-opening this
item with new evidence — not assumed from this single page.

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

## 10a. bid.cars active-lot capture fix (4 September 2026)

**Fixed:** active bid.cars lots captured with zero images and no auction date; archived lots
were already correct. Diagnosed from real DOM recon (both page kinds) — a timing defect
(active-lot images load into the DOM after capture already ran) and a missing extraction
(no code read the live page's countdown element at all). See `docs/SOLVED.md` §1 and §4 for
the full mechanism.

| Fix | Evidence |
|---|---|
| Inline-`<script>` URL scan added, additive to the existing DOM/attribute walk | `content-bidcars.js`; archived-lot capture confirmed unchanged (still `pluto.bid.car`, `image_store_status='complete'`) |
| Image-domain dedup preference flipped `images.bid.cars` → `pluto.bid.car` | Found live: `images.bid.cars` fetches from bid.cars page context fail CORS (`No 'Access-Control-Allow-Origin' header`); `pluto.bid.car` succeeds. Two active lots captured after the flip: 12/12 images stored, `image_store_status='complete'` (sightings `49804e7e…`, `2a130af2…`) |
| `#time-left`'s `data-initial-total-seconds` read; absolute ISO instant computed and stored in `sale_date` for active lots only | DB: `sale_date = '2026-09-04T13:30:04.181Z'` on a fresh active capture; archived capture in the same session stayed `sale_date = NULL`, unchanged |
| Staff + public countdown verified against the live bid.cars page | Displayed date (`Fri 4 Sept, 14:30`) matched the live page directly, confirmed by side-by-side comparison |
| `parseAuctionDate()` untouched — ISO string was already a supported format | No second parser added |
| `public-run` allow-list untouched, no Edge Function redeploy | Countdown and images rendered on the public share page with no allow-list change |
| Bid-closing vs auction-start distinction recorded | `docs/SOLVED.md` §4 update, `SCHEMA.md` §6 |

**Also fixed the same session, not part of the original diagnosis:** `AuctionCountdown.tsx`
ticked every 30 seconds without a page refresh already, but only displayed hours/minutes.
Changed to a 1-second tick with seconds displayed (`"6h 27m 47s"`), verified live-ticking on
both the staff view and the public share page without any refresh.

Test artifacts: `ZZZ TEST - Prompt9 Countdown Check` run, left in place with sharing enabled
as evidence (public link renders the fix live).

---

## 11. Debt register

| # | Item | Note |
|---|---|---|
| 1 | AutoData↔Caplimo licence unsigned | **Blocks Phase D and alert recipients** |
| 2 | No staging environment | Production Supabase doubles as the dev database |
| 3 | `isUnconfirmed` duplicated across two files | Will drift if one is edited |
| 4 | Data Detox (`handleDataDetox`, `src/App.tsx:277`) disabled | Targeted the locked `sales` table |
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
| 16 | `docs/REPO_MAP.md` and `docs/BRIEF_WRITE_PATH.md` are untracked | Confirmed via `git status` 4 Sep 2026 — exist on disk, not yet committed |
| 17 | A2 rule base: 74 assets / 110 `auction_history` rows (dated 4 Sep 2026) | Useful to compare against later as B2 (Copart Sales History) grows the base |
| 18 | `pluto.bid.car` is the working image domain; `images.bid.cars` fails CORS from page context (dated 4 Sep 2026) | Do not flip the dedup preference in `content-bidcars.js` back to `images.bid.cars` — confirmed live, see `docs/SOLVED.md` §1 |
| 19 | Two `content-bidcars.js` defects fixed (dated 4 Sep 2026) | (a) `'No information'` Sales History status was missing from the recognised-status regex, causing a false console warning on every archived capture carrying it — added, stored raw and unmapped. (b) `isBidcarsLotPage()` was a single synchronous DOM check with no readiness wait, intermittently reporting a real lot page as unsupported — replaced with a short retry-until-found-or-timeout on the DOM-dependent part only, no fixed delay, non-lot pages still rejected instantly on URL shape alone |
| 20 | `createClient()` never sets `created_by` (`researchService.ts:186-195`, dated 5 Sep 2026) | Every client row has a null creator, including the placeholder "Internal / Market Research" client created 5 Sep 2026. A one-line fix, deliberately not made here — belongs with a scoped audit-fields pass (`created_by`/`updated_by` across all tables), not bolted onto a navigation prompt |

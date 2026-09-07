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

**Closed gap (Prompt 15, 6 Sep 2026):** the unknown-source count was previously reported only
when the mismatch warn also fired — an all-unknown-source sold-comps run showed nothing at
all, reading as a clean single-population average. Added a `population_unknown` INFO checklist
item that fires whenever `unknownCount > 0` and the mismatch warn does not, so unknowns are
always surfaced, never silently dropped, and never reported twice when both would otherwise
fire. Exercised via a throwaway script against all four cases (all-unknown, auction+unknown,
auction+non-auction+unknown, auction-only) — all matched expectations exactly. Real finding:
`source_platform` is a `NOT NULL` Postgres enum (`copart`/`iaai`/`bidcars`/`bidfax`/
`instagram`/`manual`) in the live schema, so this path is currently unreachable against real
data — correct defensive code for a case the schema itself forecloses today, not something
live-verified in the browser.

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

### 4.2 Client intake form — **DONE** (6 Sep 2026, direct-approach route only)
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
`confirmation_sent_at`). All nullable, no defaults that imply an answer.

**Built (Prompt 15):** `client_briefs.share_token`/`share_enabled` (migration 025, mirrors
`research_runs`' own share-token columns and generation exactly, same `UNIQUE` constraint —
reused, not a second scheme). A new `intake-brief` Edge Function
(`supabase/functions/intake-brief/index.ts`, `verify_jwt = false`) serves the tokenized form:
GET returns an explicit allow-list of the brief's own fields plus the client's name; POST
accepts only that same allow-list — `status`, `org_id`, `client_id`, and the token itself are
never read out of the request body regardless of what a client sends, then `status` is
force-set to `pending_review` and `submitted_at` to now, both server-side. Staff generate/
revoke the link from the brief detail view (`ClientsList.tsx`); the client-facing form lives at
`/intake/:token` (`IntakeFormView.tsx`), grouped contact/vehicle/condition/preferences/budget/
logistics/consents, year as a true "from"/"to" range, every boolean/consent field a tri-state
Yes/No/unanswered control so an unasked question is never coerced to `false`. A confirmation
email (Resend, same pattern as `monthly-backup`) is sent best-effort after the write completes
— a failed send is caught, logged, and never unwinds the submission; `confirmation_sent_at`
simply stays at its prior value, which is itself the record of failure.

**Staff review is enforced, not cosmetic:** `ResearchRunDetail.tsx`'s spec-match gate now reads
`run.client_brief.status !== 'pending_review' ? run.client_brief : null` — a pending brief
drives zero spec-match flags no matter what it contains, verified against a real listing that
massively violated its brief's year/mileage/condition (zero badges while pending, two SPEC
CRITICAL badges the instant it was approved, same listing, same brief, only the status
changed). Staff-created briefs (the internal "New Brief" form) are inserted as `approved`
directly — the review gate exists for client self-submissions, not staff's own data entry,
same reasoning as the migration 024 backfill.

**Known, deliberately unaddressed:** the form asks for a single Year while the schema (and this
migration) still maps it to `year_min`/`year_max` both set equal — a client wanting a 2018-2020
range has no way to say so yet, though the schema already supports it. Cheap to widen the form
to a range when it's built; awkward once real submissions exist under the single-year
assumption. **Update:** the form itself now collects a true range ("from"/"to"), so this gap is
closed for new submissions going through the built form; it only ever applied to a hypothetical
single-year UI that was never shipped.

**Flagged for later:** the confirmation email's HTML formatting is plain and unstyled (raw
field-name-to-value table) — functionally correct and verified delivered, but not something to
show a client as-is without a pass on the display format.

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

### 4.4 Spec-match false flags fixed; post-submission account offer — **DONE, partially verified** (6 Sep 2026)
Two parts, Prompt 16.

**Spec-match vocabulary fix — fully verified.** `src/utils/specVocabulary.ts` (new; see
`docs/SOLVED.md` topic 12) fixes two real bugs on the BMW 535i brief: a negative preference
(`"Any, except White"`) that flagged every listing forever, and a vocabulary mismatch
(`Gas`/`petrol`) that flagged genuine matches. Applied to 3 of the 9 spec-match blocks
(colour, transmission, fuel) — the other 6 untouched, 9 rules in, 9 rules out. Verified on the
real brief: Gray car passes, White car flags, Gas-vs-petrol no longer flags, Diesel-vs-petrol
still flags.

**Post-submission account offer — built Google-only, not fully live-verified end to end.**
`DECISIONS.md` §6 stays locked: no login to submit. Migration 026 adds `clients.user_id`
(nullable, unique) and an `AFTER INSERT ON auth.users` trigger (`link_new_auth_user_to_client`)
that matches a new account to an existing client by email (case/whitespace-insensitive) or
phone (Nigerian-format-normalised via `normalize_ng_phone()`), links only on exactly one match,
and never creates a client row from a signup. The success screen (`IntakeFormView.tsx`) offers
"Continue with Google" only after submission, skippable, never earlier.

**Verified:** offer appears only on the success screen (live). Skip leaves the submission
intact (code has zero side effects on skip). Trigger matching logic proven directly via SQL
against real data: a case-different email (`Khalifah.Tune@GMAIL.com`) matches; `0816...` and
`+234816...` normalise to the same value; an unmatched email/phone returns zero rows; a
deliberately-created duplicate-email test row proved the `array_length(...) = 1` guard refuses
to link when two clients share an email.

**Not verified — two real blockers found, not code defects:** (1) no spare Google identity was
available to drive a genuinely new signup through the browser, so the trigger's live `INSERT`
path was never exercised end to end. (2) the OAuth redirect landed on the production site root
(`theautodata.com`) rather than back at `/intake/:token`, because Supabase only honours
allow-listed redirect URLs (Dashboard → Authentication → URL Configuration) and `/intake/*`
isn't in that list yet — debt #27. WhatsApp OTP is correctly not built this cycle (debt #24);
Apple Sign In and Apple Messages for Business are correctly not built (debt #25, #26).

### Client intake — phase close-out audit (6 Sep 2026)

**What it does, end to end:** Staff create a client record and a brief, then generate a
tokenized, unguessable link from the brief detail view (`share_token`/`share_enabled` on
`client_briefs`, migration 025, mirroring `research_runs`' own share mechanism). The client
opens `/intake/:token` on any device, no login, and completes a mobile-first form covering
every intake field except images — vehicle spec, condition and title, preferences, budget,
logistics, and two separately-answerable consents, with a review step before final submit. The
`intake-brief` Edge Function enforces a strict field allow-list in both directions: `status`,
`org_id`, `client_id`, and the token itself can never be set by the client no matter what the
request body contains; `status` is force-set to `pending_review` and `submitted_at` to now,
both server-side. A reformatted confirmation email (Resend) sends best-effort after the write
completes; a failed send never unwinds the submission. The brief sits pending until a staff
member reviews and approves it — a pending brief drives zero spec-match flags on any linked
run, verified live. On the success screen, the client can optionally create a Google account,
which links to their existing client record by email via a database trigger if exactly one
match exists.

**What it deliberately does not do:** no cold-web enquiry path or review queue (the estimator
hasn't started; DECISIONS.md §6 route 1, direct-approach, is the only route built). No image
uploads on the brief. No client portal, dashboard, or logged-in view — the account offer links
an account to a client record and stops there; there is nothing yet for that account to log in
and see. No payment integration — the Prompt 14 deposit gate is a manual staff toggle, untouched
by this work. No budget or max-bid enforcement — captured, never enforced. No structured
include/exclude preference fields — free-text exclusion parsing is a workaround. No WhatsApp
OTP, no Apple Sign In, no Apple Messages for Business.

**Every gap carried forward:** debt #21 (free-text exclusion parser can't handle a compound
`"except X or Y"` phrase), #22 (A1b's unknown-source path unreachable against live data), #23
(email-failure log line unverifiable from this CLI, DB-evidence only), #24 (WhatsApp OTP is
blocked on the AutoData entity forming — `PROJECT_CHARTER.md` §2 — not on Meta itself; must
never be registered under Caplimo's CAC documents), #25 (Apple Sign In needs an Apple Developer account, Services ID, private key), #26
(Apple Messages for Business needs an approved Messaging Service Provider, Business Register
account, Experience Review, own OAuth endpoints), #27 (the Supabase redirect-URL allowlist
doesn't include `/intake/*`, so the post-signup "you're linked" screen doesn't complete
correctly yet), and the account-linking trigger's live `INSERT` path was verified by direct SQL
simulation against real data, not by a genuine end-to-end browser signup — no spare Google
identity was available in this environment to drive one.

### 4.5 Confirmation-email visibility; direct link generation; run-from-brief; form parity (widened allow-list) — **DONE, Phase 4.3/4.5 deferred** (6 Sep 2026)
Prompt 17.

**Email visibility fix — `docs/SOLVED.md` topic 13.** A real submission sent no confirmation
email because the client had no email on file — correct behaviour, invisible to staff. A
status banner on the brief detail view now shows green "sent" (with timestamp) or amber "not
sent" (naming the reason when inferable), derived entirely from existing data, no migration.

**"Generate intake link" on the client page.** `createBriefWithIntakeLink()`
(`researchService.ts`) creates an empty `pending_review` brief and a ready token in one action,
shown inline without navigating away — reuses the exact token generation already used
everywhere else. The manual "New Brief" path (staff-typed, inserted as `approved`) is
unchanged and still available.

**"New research run" from a brief.** Extends the existing client→run pre-fill mechanism
(`prefillClientId`/`onConsumedInitialClient`) by one field, `prefillBriefId`. Found and fixed a
real race condition in the process: clearing the consumed pre-fill inside the same effect whose
own dependency array included the value being cleared caused that effect to re-fire and hit its
own unconditional reset, silently discarding the brief selection. Fixed by reading the pending
brief id through a ref, decoupled from the effect's dependency array, so clearing it afterward
cannot retrigger the effect that just consumed it. Verified: client + brief both correctly
pre-filled and saved with matching `client_id`/`client_brief_id` (no Prompt 11-style mismatch);
the deposit gate still refuses correctly from this path; a pending brief can start a run and
correctly shows the pending banner with zero spec-match flags, the same decision and mechanism
Prompt 16 verified — deliberately not blocked at creation time.

**Form parity, Phase 4.1/4.2/4.4 — done; 4.3/4.5 deferred to Prompt 18 Phase 6.** The intake
form now collects full name, mobile/WhatsApp, phone, email, and preferred contact method,
pre-filled from the client record and editable by the client (`assigned_agent` deliberately
excluded — staff-only, a client does not pick their own sales rep). `intake-brief`'s
write allow-list is deliberately widened onto a second table: exactly `full_name`, `phone`,
`email`, `preferred_contact` on `clients`, via a wholly separate `CLIENT_FIELDS` list kept
independent from `BRIEF_FIELDS` so the two can never merge. Verified live: a real client's
`full_name` updated from the form, while an injected `assigned_agent`, `org_id`, and —
critically — `deposit_received_at` in the same request were all silently ignored, before/after
shown identical for all three. Autocomplete/input-type attributes (`name`/`tel`/`email`) added
for the three new fields. Dropdowns for year/transmission/fuel/condition/interior/payment/
titles/damage/auction-source (4.3) and the field-by-field parity table (4.5) could not proceed
without the Google Form's exact option sets — deferred, now supplied, see Prompt 18 Phase 6.

### 4.6 Intake link lifecycle, orphan cleanup, runs relocated to the brief, exact form parity — **DONE** (6 Sep 2026)
Prompt 18 Stage 2.

**Cancelling a link generation no longer leaves a brief.** The "Generate intake link" action
on the client page now opens a confirmation first ("Generate a blank intake link for X?");
the brief is created only by that confirmation's own click, never by opening it — cancelling
leaves no trace, verified live (brief count unchanged before/after cancel). Two pre-existing
orphans from earlier testing (never submitted, no runs) were found, shown, confirmed, and
soft-deleted.

**Link lifecycle re-architected.** `share_enabled` now means "open for editing", not "does
this token resolve at all" — a brief stays live and editable while `pending_review`
(re-submitting updates it, `submitted_at` advances, status stays `pending_review`); approval
auto-sets `share_enabled = false` but the token keeps resolving, read-only, showing a summary
of exactly what the client submitted (same field allow-list, nothing staff-only); a *manual*
revoke on a still-`pending_review` brief is the one case that is a true dead link (404, same
generic message as an unknown token). The POST handler explicitly rejects a write against an
approved brief (409, "already been approved") **server-side** — verified directly via curl,
not just hidden behind the client-side read-only view, since a client's stale form tab can
still fire the request after approval and a silent success (or worse, a status revert) would
undo a staff decision without anyone noticing.

**Runs moved off the client page onto the brief.** The client page now shows each brief with a
run count only; the brief detail page (unchanged since Prompt 12/17) is where runs actually
live and where "New research run" already was. The all-runs page is untouched. Verified:
opening a run from the brief page lands on the same `ResearchRunDetail` used everywhere else.

**Form parity — exact option sets, verbatim from the live Google Form PDF.** Transmission,
fuel type, condition required, interior preference, and payment method are now closed
dropdowns; titles accepted and damage tolerance are closed multi-selects; year (both ends of
the range) is a 2000–2025 dropdown plus "Prior to 2000" (stored as `1999` internally so
ordinary numeric spec-match comparisons need no special-casing). Title and interior carry an
"if other, please specify" companion exactly as the source form does — the free text replaces
the literal word "Other" in storage, so a future reader sees the actual answer, not a
placeholder; reloading a submitted brief correctly reconstructs which option was "Other" from
whatever doesn't match the known set. Make and model stay free text — recorded as debt below.
Verified live end-to-end on a narrow viewport: every dropdown value landed exactly as selected,
and all four untouched Yes/No fields (`inspection_required`, `shipping_insurance_optin`,
`consent_to_bid`, `consent_share_with_auction_houses`) stored `NULL`, not `false`, alongside
the new dropdown answers in the same submission.

**Parity table (Google Form → intake form):**

| Form field | Status |
|---|---|
| Full name | Present |
| Mobile/WhatsApp | Present |
| Email | Present |
| Preferred contact | Present |
| Assigned agent | Deliberately excluded — staff-only, a client does not choose their own rep |
| Make | Present (free text) |
| Model | Present (free text) |
| Trim | Present (free text) |
| Year | Present, as a true range (both ends use the same 2000–2025 + "Prior to 2000" list) |
| Quantity | Present |
| Transmission | Present (exact dropdown) |
| Fuel type | Present (exact dropdown) |
| Max mileage | Present |
| Condition required | Present (exact dropdown) |
| Title required (+ if other) | Present (exact multi-select + specify field) |
| Damage tolerance | Present (exact multi-select) |
| Colour preference | Present (free text — not in the Phase 6 dropdown list) |
| Interior preference (+ if other) | Present (exact dropdown + specify field) |
| Max budget | Present |
| Max bid | Present |
| Shipping insurance opt-in | Present (tri-state Yes/No/unanswered) |
| Preferred auction/source | Present (exact multi-select) |
| Pickup/delivery location | Present |
| Inspection required | Present (tri-state) |
| Inspection scope | Present (conditional free text) |
| Payment method | Present (exact dropdown) |
| Additional notes | Present |
| Example images | Deliberately excluded — out of scope for the whole intake build |
| Consent to bid | Present (tri-state, separable) |
| Consent to share with auction houses | Present (tri-state, separable) |
| Final confirmation ("I confirm these details are correct") | **Gap** — the review-then-submit flow serves the same practical purpose, but the literal confirmation copy/checkbox from the source form was not reproduced |

---

### 4.7 Client approval trail — **DONE** (7 Sep 2026)
Prompt 19 Stage 1.

**Approval lives on `research_run_listings` (migration 028), not `research_runs`.** The
client is choosing between vehicles within a shared run, and `public-run`'s field mapping
already treats listings individually — never the run as a single priced/dated object.
`approved_at` / `approved_via` / `approved_by` / `approved_snapshot` are all nullable, no
defaults implying an answer, and a CHECK constraint makes the client-made shape
(`approved_via='client'`, `approved_by NULL`) and the staff-relayed shape
(`approved_via='staff_relayed'`, `approved_by NOT NULL`) the only two valid non-null states —
the distinction cannot collapse into one field even by accident.

**Enforced server-side in `public-run`, not only the UI.** The client approves from the
existing tokenized share page — an "Approve this vehicle" action per live listing (never on
sold comps), gated behind an explicit confirmation step. A second POST — same listing or a
different one on the same run — is rejected `409` by the endpoint itself, verified via curl,
with the row confirmed byte-identical after. The update's own `WHERE approved_at IS NULL`
clause is the actual race guard (not just a pre-check), so two concurrent requests cannot both
win.

**What the client was shown is captured at approval time, server-side, from a fresh query —
never from the POST body.** `approved_snapshot` holds identifying details (year/make/model/
trim/VIN), the price actually shown (`display_price` + `is_bid`), and the auction date shown —
because live lots get overwritten on re-capture (`SCHEMA.md` §1), so a bare foreign key to the
listing/sighting would not reliably reproduce what was seen weeks later in a dispute.

**A blocked run cannot be approved — but only in the sense that's actually enforceable.** The
critical-block checklist has no server-side or stored representation (see debt #31) — the
approval endpoint reuses the same `share_enabled`/`deleted_at` gate `public-run`'s read path
already enforces, and nothing else exists to check. Verified: a `share_enabled = false` test
run 404s on both GET and the approval POST.

**Staff cannot approve on the client's behalf — they can only record a relayed one.** A
"record client approval" action on the run detail page requires the same confirmation
discipline, sets `approved_via = 'staff_relayed'` and `approved_by` to the recording staff
member's real user id, and is visually distinct in the UI (blue "Approved (relayed)" vs. green
"Client approved") from a client-made approval — verified live, both paths, including the
run-list at-a-glance marker and the run-detail summary card showing what was shown.

Verified end-to-end against two throwaway runs (soft-deleted after), never against a real
client's live research.

---

### 4.8 C1: `cost_rates` table and admin screen — **DONE** (7 Sep 2026)
Prompt 19 Stage 2.

**Four dimensions, read from `DECISIONS.md` §3 / `MASTER_PLAN.md` Part VII, not guessed.**
`cost_category` (`inland_trucking` | `ocean_freight` | `duty_component` | `service_fee`) plus a
free-text `label` for the specific thing within that category — a state-tier name, a shipping
method, a duty-component name, or the fee itself. `basis` (`cif` | `cif_plus_prior` |
`import_duty`) is the fourth dimension, needed only for `duty_component` rows, since the six
locked components split three ways on what their percentage is computed against. No
`vehicle_class` column: nothing in the locked rate data varies by vehicle class today — the
value-dependent declared-CIF ratio (§3.2) is C2's own future calibration problem once real
assessment-notice data exists, not something to guess a schema shape for now.

**Range-capable, per the project's own honesty doctrine.** `rate_value` / `rate_value_max`
(max nullable) hold either a single point value or an observed range (e.g. "$200–500") rather
than forcing a fake average — matching C3's own stated principle ("widen the band rather than
faking precision").

**Never edited in place — verified live, not just by reading the code.** Added a real test
rate, superseded it with a new value and a later `effective_from`, and confirmed two distinct
database rows: the original unchanged except for `effective_to`, the replacement a fresh row.
Same-day supersede was tried and correctly rejected (`effective_to` would have landed before
`effective_from` on the original row) — the CHECK constraint working as intended, not a bug.
Both test rows removed by hard `DELETE` (confirmed first) — `cost_rates` has no soft-delete
column, since a superseded row already **is** the history mechanism.

**RLS matches `SCHEMA.md` §12 exactly** — pasted and confirmed identical in shape to
`client_briefs`'s policies. The admin screen itself additionally gates on `role === 'superadmin'`
at the application layer (`PROJECT_CHARTER.md` §3), same pattern as the ledger dashboard's
existing superadmin-only tabs.

**No rates seeded, and no deploy required to change one** — both explicit requirements,
confirmed by the empty-table state at hand-off and by the admin screen being a pure
database-backed UI with no code path involved in adding or superseding a rate.

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

- **C1.** `cost_rates` table + admin screen — **DONE** (7 Sep 2026, Prompt 19 Stage 2). See §4.8
  below. No rates seeded — the table is empty until Bashir enters real figures.
- **C2.** Duty calculator (51.47% formula + observed calibration) — **BLOCKED** on
  collecting 10+ assessment notices. **The 51.47% figure and the six-component stack's
  individual percentages are documented in `DECISIONS.md` §3 but deliberately not encoded
  anywhere in code or seeded into `cost_rates`** — they are uncalibrated for declared-CIF
  purposes until real assessment notices exist; entering them as rate rows (via the C1 admin
  screen, once real) is the correct way to make them live, not a code change. Standing action
  continues: photograph every assessment notice before handover.
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
| 9 | Gemini key should be reissued under the caplimoltd GCP project | **Conflict, flagged not fixed (Prompt 16):** this contradicts `PROJECT_CHARTER.md` §2 (LOCKED), which states AutoData has its own Google Cloud project and Caplimo is licensee, never owner — reissuing under `caplimoltd` would run counter to that. The charter governs. Not re-keyed here; left as a decision for whoever resolves the conflict, not silently picked one way |
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
| 21 | Free-text colour/fuel/transmission exclusions (`"Any, except White"`) are a workaround (Prompt 16) | Structured include/exclude fields on the brief are the real fix. Also: the exclusion parser's containment-based match cannot correctly handle a compound exclusion like `"except white or black"` — only the single-value shape actually observed live works today |
| 22 | A1b's `population_unknown` INFO path is unreachable against live data (Prompt 15/16) | `source_platform` is a `NOT NULL` Postgres enum with no null/empty value possible — correct defensive code, verified only via a throwaway script, not live-observable until the schema itself changes |
| 23 | Prompt 15 Checkpoint 17 (email-failure log line) unverifiable from this CLI | This Supabase CLI version has no `functions logs` subcommand; the email-send-failure path is proven via DB-level evidence (`confirmation_sent_at` not advancing) only, not by reading the actual `console.error` line |
| 24 | WhatsApp OTP signup — blocked on AutoData entity formation, not on Meta (Prompt 16) | `PROJECT_CHARTER.md` §2 (LOCKED): AutoData runs on its own resources — own Supabase, own domain, own Google Cloud project — and Caplimo is licensee, never owner. A Meta Business account verified today would necessarily use Caplimo's own CAC documents (AutoData's entity isn't formed yet), which would register Caplimo as owner of AutoData's client-signup channel — exactly the ownership erosion §2 exists to prevent. **Must not be registered under Caplimo.** Once the AutoData entity exists: a Meta Business account under AutoData, business verification with AutoData's own registration documents, an approved WhatsApp authentication message template, then delivery via Supabase's **Send SMS Hook** → a new Edge Function → the **WhatsApp Business Cloud API** directly. **Not Twilio** — evaluated and rejected: no viable free tier, and it resells the same underlying Meta pipe at a markup, needing the same approval regardless. Supabase Auth itself still owns OTP generation, expiry, rate limiting and replay protection via the hook; delivery is the only thing this project would ever supply |
| 25 | Apple Sign In — not built (Prompt 16) | Needs an Apple Developer Program account, a Services ID, and a private key generated in Apple's developer portal, entered in the Supabase Dashboard's Auth → Providers → Apple settings. None of this exists. Available if wanted, once that setup is done |
| 26 | Apple Messages for Business — not built (Prompt 16) | Genuinely supports in-thread authentication, but requires an Apple-approved Messaging Service Provider, an Apple Business Register account, an Experience Review, and our own OAuth 2.0 endpoints supplied to Apple — a channel wrapped around an identity provider, not one itself. Best revisited at Phase D alongside the portal, when its support-conversation and Apple Pay sides also become useful |
| 27 | Supabase Auth redirect-URL allowlist doesn't include `/intake/*` (found Prompt 16) | The post-OAuth-signup redirect from the intake page's account offer currently lands on the site root (`theautodata.com`) instead of back at `/intake/:token`, because only allow-listed redirect URLs are honoured. **Exact fix:** Supabase Dashboard → Authentication → URL Configuration → Redirect URLs → add `https://theautodata.com/intake/*`. (For local testing against the same project, also add `http://localhost:3000/intake/*` — optional, dev convenience only.) Not fixable from the codebase or CLI; must be added there before the "you're now linked" confirmation screen can work end-to-end |
| 28 | `clients.deposit_received_at`/`deposit_recorded_by` retained as fallback, not dropped (Prompt 18) | Migration 027 moved the deposit gate to `client_briefs`; the old client-level columns are kept only as a rollback path, since there is no staging environment to test a drop against. Dropping them is a separate, later step once the move is proven in production |
| 29 | Make/model stay free text on the intake form (Prompt 18 Phase 6) | The Google Form's nine-make dropdown is a Forms limitation that forces "Other, please specify" onto everything else — not worth reproducing. Real dropdowns wait for the vehicle database (E-series estimator work) |
| 30 | Intake form has no literal "I confirm these details are correct" confirmation (Prompt 18 Phase 6) | The review-then-submit flow serves the same practical purpose, but the source form's exact confirmation copy/checkbox was not reproduced — a parity gap, not a functional one |
| 31 | The critical-block checklist has no server-side or stored representation (Prompt 19 Phase 1/3) | It is computed client-side in `ResearchRunDetail.tsx` on every render and is only ever consumed to gate the share toggle before `share_enabled` is written. `public-run` and the new client-approval path can therefore only enforce `share_enabled`/`deleted_at` — neither recomputes the checklist. **The gate is enforced at the moment of sharing, not continuously:** a run that was legitimately shared and later develops a block — a re-captured lot changing `lot_state`, new `auction_history` arriving, a brief edited after sharing — stays shareable and approvable until a staff member reopens the run and the client-side checklist re-evaluates. Fixing this means persisting the checklist result or recomputing it in the Edge Function — its own piece of work, and it spans the rule layer this prompt is deliberately fenced off from |

# PLAN_TRACKER.md — Status of all work

**Status:** The moving document. Status lives here and **nowhere else**.
**Last revised:** 9 September 2026
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

**Last working session: 8 September 2026** (Prompt 21, auction fee research and bid
headroom). This document is current as of **9 September 2026** (Prompt 23, pre-handover
document reconciliation — docs only, no code/schema changes).

### The last completed thing
**C1c: auction buyer-fee research, `auction_fee_brackets`, the shared bid-headroom module**
(migration 031, `bidHeadroomService.ts`). Cross-checked researched fee tables against three
real Copart invoices, found a genuine mismatch, traced it to Copart's High-Volume Licensed
schedule on a different member account (White Nexus Ltd), and — after an initial default
choice was corrected by Bashir — set the default headroom schedule to Caplimo's **own**
Copart account (`Jamilu Danmusa Danmusa`, Non-Licensed), never the middleman's cheaper one.
See §4.10 below and `docs/SOLVED.md` topics 18-19. Pushed to `origin/main` 8 Sep 2026.

### Immediately next, in order
Everything in the old list here (1.1–1.3, A2) is now **DONE** — see §1/§2 below for evidence.
The genuinely open items, in rough priority order:
1. **1.2 (remaining piece)** — the delete-confirmation UI for briefs/clients is built but its
   confirmation step itself is unverified; nobody has clicked through it.
2. **1.4** — warn when a brief is attached to a sold-comps run — **NOT STARTED**.
3. **4.1** — auction alerts (24h/1h) — **NOT STARTED**, unblocked, designed in full.
4. **B1** — IAAI content script — **DONE** (10 Sep 2026, Prompt 22 Stage 2). See §4.12 below.
5. **C2** — duty calculator — **BLOCKED** on collecting 10+ assessment notices (standing
   habit, not a task).
6. **C3** — client-facing cost display — blocked behind C2.
7. **Phase D** (client operations / portal) — blocked on the signed AutoData↔Caplimo licence
   (debt #1).

### A2 — resolved, no longer an open finding
The prior-auction-history hard block (Phase A2) shipped 4 Sep 2026. See §2.A2 below for the
full build, evidence, and its permanent bid.cars-only coverage limit (B2/Copart Sales History
is retired, not buildable — Copart exposes no such panel).

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

### 4.9 C1b: `trucking_rates` ledger, deterministic importer, two views, yard matcher — **DONE** (8 Sep 2026)
Prompt 20, both stages.

**The real vendor file's column layout matched the prompt's description for one sheet out of
four.** The prompt described COPART's layout exactly (container pairs at columns 3/4, 6/7,
9/10, 12/13; RoRo at 16/17, 19/20, 22/23) as if it were the whole file's shape. The real
November 2025 file's other three sheets have fewer port options and different column
positions — IAAI, MANHEIM, and ADESSA each lay out their (port, price) pairs at different
column indices entirely. The importer derives each sheet's pairs from that sheet's own header
row (any cell containing "CONTAINER" or "RORO" starts a pair) rather than trusting one
hardcoded layout — caught by inspecting the real file before running the import, not by
assuming the prompt's description held. See `docs/SOLVED.md` topic 17 for the full mechanism.

**Imported 1,740 rate rows from the real file; 143 failures reported, none silently dropped.**
137 are the vendor's own unquoted port options (a port name listed with no price attached —
e.g. a whole cluster of Atlanta-area yards lists "BALTIMORE" as a fourth container option, but
only 2 of 11 actually have a price), 4 are orphan prices with no attributable port, 2 are
stray non-data rows. Yard counts cross-checked by an independent method match exactly for
three of four sheets (208/208, 77/77, 59/59); IAAI's is 188 found vs. 187 represented in
`trucking_rates`, explained and not a bug — **Honolulu, HI is a real yard where the vendor
wrote the literal text "NO" instead of any price**, correctly producing zero rate rows. See
`docs/SOLVED.md` topic 17.

**The vendor's own file has a state-name typo.** The COPART sheet spells New Hampshire "New
Hamphire"; the IAAI sheet spells it correctly. Both exist, unfixed, in
`trucking_rates.yard_state` (raw at capture) — bridged at the matcher layer
(`STATE_NAME_ALIASES` in `src/services/yardMatchingService.ts`), not corrected in storage.

**Two read views over the one table** (`src/services/truckingRatesService.ts` +
`src/components/TruckingRatesLookup.tsx`, superadmin-only, not wired into research runs or the
public share page): an internal view (every vendor's price, current and superseded, visible as
history) and an estimator view (a band and sample size across currently-effective rates only —
verified live that a superseded rate drops out of the aggregate but stays visible as history).

**Yard matcher measured a 35% miss rate against all 171 live sightings — a baseline to
measure against, not a defect.** 112 matched (65.5%), 0 ambiguous, 59 unmatched (34.5%),
broken down by real cause:
- 18 — bid.cars listing with no resolved underlying auction platform yet
  (`sightings.source_auction_platform` is null)
- 11 — `manual` source, no auction platform at all
- 27 — resolved platform and location fine, but this vendor's rate sheet doesn't cover that
  yard (a coverage gap, not a matcher weakness — closes by adding vendors, not by changing
  code)
- 3 — malformed or unrecognised location strings

Cross-platform leakage (a Copart listing resolving to an IAAI yard) proven absent: 0 of 112
matches. The "Mobile" vs "Mobile South" ambiguity case the prompt anticipated does not occur
in real data — confirmed directly against Copart's own live facility pages, which always
display the full disambiguating name ("AL - Mobile South", matching address on file); the
prompt's warning is a defence against substring/prefix matching, which this matcher's
exact-normalised-string design never does. **A real bug was found while proving this**: the
ambiguity check as first written compared city+state between already city+state-filtered
candidates — structurally unable to ever fire, for any input, which every "0 ambiguous"
report up to that point could not have distinguished from a working check. Fixed to compare
street addresses among same-city candidates instead, verified against a synthetic true
duplicate. See `docs/SOLVED.md` topic 16 — the method generalises past this one matcher.

---

### 4.10 C1c: auction fee research, `auction_fee_brackets`, shared bid-headroom module — **DONE** (8 Sep 2026)
Prompt 21, both stages.

**Researched from primary sources, then cross-checked against three real Copart invoices
rather than trusted on authority alone — and the cross-check found something the pages never
would have.** Both Copart and IAAI's buyer fee is a bracket table on final sale price up to
$15,000, then a flat percentage above it (Copart: 7.25–12.5% depending on title/payment tier;
IAAI: 6.0–7.5%). Checking the researched Non-Licensed table against three real Camry invoices
found two of three matched exactly to the penny — the third did not, on the same title status
and every ancillary fee. Chasing that mismatch (not accepting "close enough") led to Copart's
own **High-Volume Licensed** fee schedule, a structurally different bracket table for a
different member account (White Nexus Ltd) buying on Caplimo's behalf — confirmed by locating
its own $7,500–7,999.99 bracket and finding an exact match. See `docs/SOLVED.md` topic 18 for
the further finding this produced: Copart's "Secured" vs "Unsecured" tier tracks the member
**account's** standing classification (almost certainly a security deposit on file), not a
choice made per transaction — all three invoices priced as Unsecured regardless of payment
method, including one paid mostly by wire. Descriptively (not a recommendation): Secured
pricing on the same three purchases would have totalled $1,125 less ($2,775 vs $3,900 paid).

**`auction_fee_brackets` (migration 031) holds the two genuinely bracket-shaped fees** (buyer
fee, remote-bid fee) at their real grain — a bracket table doesn't fit `cost_rates`' one-row-
one-figure shape, so this is a second, purpose-built table, not a forced fit. Flat per-unit
fees (environmental, gate, title pickup) got a new `auction_fee` `cost_rates` category, kept
separate from `service_fee` (Caplimo's own brokerage fee to the client - a different thing).
328 rows stored, dated and sourced; only 9 genuinely confirmed against an invoice
(`actual_paid`), the rest the unconfirmed-but-published table (`official_tariff`). **A first
pass wrongly marked every bracket in four whole tables `actual_paid`** because one bracket in
each matched an invoice — caught and fixed (both the data and the generator script) before
calling the phase done, since that overstated confidence in ~39 untested neighbours per table.

**Deliberately not stored:** IAAI's entire fee structure (zero IAAI invoices exist to
cross-check against — after the Copart lesson, not willing to store IAAI's published tables on
faith); High-Volume Licensed **Clean**-title brackets (not fully captured this session, real
purchases are salvage); Storage fees (genuinely variable per day, no fixed figure to store
honestly). See debt below.

**`bidHeadroomService.ts` is the single shared calculation module** (`isUnconfirmed` is
already duplicated as debt because that happened once - #3 below) computing auction fees,
inland trucking (via the Prompt 20 matcher), ocean freight, and duty as independently
available/unavailable components, plus the derived headroom. **Duty is permanently "not yet
calculable" until C2 exists, which means headroom cannot be produced for any listing right
now** — verified across four cases (full data, unquotable trucking, no client budget, an exact
fee-bracket boundary) that this is never smoothed into a partial or zero-filled number; Case 3
(no budget) and Cases 1/4 (missing component) correctly report two different reasons, not one
generic "unavailable." The bracket circularity (fee depends on final price, headroom solves
for that same price) is resolved as a deterministic ordered scan over the brackets, not
iteration — implemented and ready for when duty unblocks, not reachable in practice until then.
See `docs/SOLVED.md` topic 19.

**Displayed on `ResearchRunDetail`, collapsed by default, active listings only** (`lot_state
!== 'finished'`) — verified live against a real run with no client budget stated (Mohammed
Jamilu Danmusa's Yaris/Matrix brief) that the panel correctly renders every component and
withholds headroom for the right, specific reason. **Sold-comps average confirmed
byte-identical before and after** by literally stashing the Phase 4 diff, reloading, capturing
`$17,550` (11 sales), restoring, reloading, capturing `$17,550` again on a real run (Hail
Camry) — not just a code-inspection argument. **`public-run`'s allow-list confirmed unchanged**
(zero diff this entire two-prompt body of work) — bid headroom stays internal-only, never
reaches the client share page.

---

### 4.11 C1d: AI document extraction, staged behind human review — **DONE, Stage 1 only** (9 Sep 2026)
Prompt 22 Stage 1. `cost_document_extractions` (migration 032) is a queue, not a rate table —
no `effective_from`/`source`, deliberately, since those are human decisions set only at
confirmation (`PROJECT_CHARTER.md` §5.10/§5.4). A CHECK constraint (`..._review_shape`)
structurally enforces the confirm/reject shape: a `pending_review` row has no reviewer yet, a
`confirmed` row must name both a reviewer and a destination table, a `rejected` row must name
a reviewer but never a destination.

**Two real failure modes found and fixed against real documents, not assumed safe from
design alone.** (1) The model filled in a duty component's `basis` from its own training
knowledge of Nigerian customs when the source document itself stated no formula at all —
fixed with an explicit "never use outside knowledge to fill a field the document doesn't
state" guard. (2) A real Nigerian assessment notice's Naira amounts would have been recorded
as USD, since no non-USD unit exists in `cost_rates`/`auction_fee_brackets` — fixed with an
explicit currency guard that abstains rather than assumes USD. See debt #44/#45 and
`docs/SOLVED.md` topic 20 for the fuller finding this produced.

**The one NOT fully fixed, by design, and documented rather than papered over:** a single
extraction pass confidently misread a real degraded invoice's `"$1,385.00"` as `1285`, marked
`status: 'read'` — the exact "confidently wrong figure with no abstention marker" failure this
phase's own checkpoint exists to catch. Mitigated with two independent passes per document,
trusting a field only when both agree (`reconcileRows()` in `extract-cost-document/index.ts`)
— caught 2 of 3 real digit misreads on re-test. **Not solved**: both passes independently
misread the same digit identically once, so cross-pass agreement is a filter, not proof of
correctness. `docs/SOLVED.md` topic 20 has the full account, including why this makes the
review screen's side-by-side source document the actual safety net, not a formality.

**Verified end-to-end through the real deployed function and the real review UI** — not just
scripted: extracted a real Nigerian customs assessment notice (correctly abstained on every
monetary field, currency guard fired) and a real Copart invoice (13 rows, all matching figures
already verified in Prompt 21); rejected the former, confirmed one genuinely new row (a real
Storage fee, `actual_paid`) from the latter into `cost_rates`; confirmed the resulting row
carries human-set `source`/`effective_from` (never anything the model produced — structurally
impossible, since the staging schema has no such columns) and renders correctly in the
pre-existing Cost Rates admin screen with zero changes needed there. Deliberately did not
confirm the invoice's Buyer Fee/Bid Fee/Environmental/Gate/Title Pickup/Late Payment rows —
those already exist in `cost_rates`/`auction_fee_brackets` from Prompt 21; confirming them
again would have created duplicate production data purely to demonstrate the mechanism.

**Known scope boundary, not a defect:** confirmation is per-extraction (one document confirms
into one target table), matching the checkpoint's own phrasing. A real document containing
genuinely mixed-shape line items (the Copart invoice's Buyer/Bid Fee lines arguably belong in
`auction_fee_brackets` while its flat fees belong in `cost_rates`) is handled by the reviewer
excluding the mismatched rows from one confirm and, if needed, re-entering them separately via
the existing admin screens — not by a more complex multi-table split mechanism, which was
judged out of scope for this build.

**Not demonstrated with real data, and not faked to look demonstrated:** the checkpoint asked
to confirm one extraction into `trucking_rates` specifically. None of the three real documents
available (a Nigerian assessment notice, two Copart-adjacent invoices) contain genuine
yard-to-port trucking-rate data — the closest only states a port-to-port shipping leg with no
originating auction yard. Confirming into `trucking_rates` would have required inventing a
yard location. Confirmed into `cost_rates` instead, which exercises the identical mechanism
(human-set source/date, never AI-supplied); the destination table doesn't change what the
checkpoint is actually proving.

---

## 5. Phase B — coverage

### B1. IAAI content script — **DONE** (10 Sep 2026, Prompt 22 Stage 2)
`chrome-extension/content-iaai.js` — the last missing capture source, built against real
authenticated-session HTML (two pastes required before writing any bid-state logic, after an
unverified-assumption shortcut was flagged and rejected — see `docs/SOLVED.md` topic 21).
Reads IAAI's embedded `ProductDetailsVM` JSON directly rather than scraping the DOM; login
state (`auctionInformation.userLoginStatus`) gates `current_bid_usd`/`seller`/`seller_type`,
since each field's own masked shape differs and pattern-matching them individually was
already wrong on the first real test. `lot_state` is always `'active'` — confirmed on the
real platform that sold lots redirect to search rather than rendering this page. Yard
matching wired in via `parseIaaiLocation()` (`src/services/yardMatchingService.ts`) —
`resolveEffectivePlatform()` already handled `'iaai'` from Prompt 20, but no location parser
ever existed for it, so every IAAI sighting fell through to unmatched regardless of location
quality until this build.

**Verified against real data, not compile-only:**
- Two real IAAI captures (one via Bashir's authenticated session) landed with correct
  platform-appropriate fields — `location` in `"City (ST)"` form, `lot_state: 'active'`,
  login-gated `current_bid_usd`/`seller`/`seller_type` populated only when logged in.
- Yard matcher: both real IAAI sightings now resolve (100%, 0 unmatched, 0 ambiguous, 0
  cross-platform leaks) — previously 0% by construction (missing parser branch).
- Regression check against all existing Copart/bid.cars data (167 real sightings, 1740 real
  yard rows): 70.7% matched, 0 cross-platform leaks — consistent with the Prompt 20 baseline
  of 65.5%, confirming the IAAI parser addition caused no shared-code regression.
- Live end-to-end capture confirmed unaffected by this session's shared-code changes: one
  real Copart lot and one real bid.cars lot captured through the actual extension after the
  yard-matcher change, both landing with correct platform-specific fields (`location`,
  `source_auction_platform`, `current_bid_usd`) — see debt #46 for an unrelated finding
  surfaced by this same pair of captures.

**Known permanent gap, not a defect of this build:** IAAI exposes no sales-history panel
analogous to bid.cars' — every IAAI sighting's `sale_confirmed` stays `false` indefinitely,
the same "Unconfirmed sale" state Copart carries permanently per B2 above, for the same
reason (the platform's own data model, not a missing feature).

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
- **C1b.** `trucking_rates` ledger, importer, two views, yard matcher — **DONE** (8 Sep 2026,
  Prompt 20). See §4.9 below. A second table, not a reshaping of `cost_rates` — real vendor
  data prices each yard-to-port lane individually, which a state tier would discard.
- **C1c.** Auction buyer fee research, `auction_fee_brackets`, shared bid-headroom module —
  **DONE** (8 Sep 2026, Prompt 21 Stage 1/2). See §4.10 below. Researched from primary sources
  and cross-checked against three real Copart invoices, which revealed two Copart member
  accounts on structurally different fee schedules.
- **C1d.** AI document extraction staged behind human review, `cost_document_extractions` —
  **DONE, Stage 1 only** (9 Sep 2026, Prompt 22 Stage 1). See §4.11 below. Establishes the
  first real `NOT_VISIBLE`-style abstention convention in this codebase (debt #45) and a
  dual-pass reconciliation mechanism with a documented, unsolved residual limit
  (`docs/SOLVED.md` topic 20) — cross-pass agreement is evidence, not proof. **Currently blind
  to every Nigerian-currency document** (assessment notices, most customs quotes) — `cost_rates`
  has no non-USD unit, so the extraction correctly abstains on every monetary field in an NGN
  document rather than guess a conversion. See the currency-column design note recorded
  9 Sep 2026 below C2 for what closing this would actually require.
- **C2.** Duty calculator (51.47% formula + observed calibration) — **BLOCKED** on
  collecting 10+ assessment notices. **The 51.47% figure and the six-component stack's
  individual percentages are documented in `DECISIONS.md` §3 but deliberately not encoded
  anywhere in code or seeded into `cost_rates`** — they are uncalibrated for declared-CIF
  purposes until real assessment notices exist; entering them as rate rows (via the C1 admin
  screen, once real) is the correct way to make them live, not a code change. Standing action
  continues: photograph every assessment notice before handover. **Bid headroom
  (`bidHeadroomService.ts`) is permanently unavailable for every listing until C2 exists** —
  duty is always reported "not yet calculable," and the module's own rule (any missing
  component makes headroom unavailable, never partial) means headroom cannot be produced at
  all right now. This is by design, not a bug to chase.
- **C3.** Client-facing grouped cost display (Vehicle · Shipping & logistics · Duties &
  clearing · Service fee · Total), expected and ceiling — **NOT STARTED**, depends on C1/C2.

**AI extraction for unstructured vendor documents — planned in Prompt 20 Phase 6, built in
Prompt 22 Stage 1 (see C1d above).** Upload → AI extracts to a review table → human confirms
→ rates, exactly as originally planned. AI never writes directly into live rates
(`PROJECT_CHARTER.md` §5.4) — enforced by a database CHECK constraint, not just application
logic. The deterministic spreadsheet importer built for Prompt 20 remains the only path that
doesn't route through human review at all (it was never AI-touched to begin with).

**Design note, recorded 9 Sep 2026 — `cost_rates` has no currency column, and this now
visibly blocks something.** Every amount in `cost_rates`/`trucking_rates`/
`auction_fee_brackets` is implicitly USD; there is no `currency` field and no conversion
mechanism anywhere in the landed-cost schema. This was invisible as a gap until Prompt 22
Stage 1 tried to extract real Nigerian documents — a genuine Tincan assessment notice and
most customs-agent quotes are denominated in Naira, and the extraction correctly abstains on
every monetary field in an NGN document rather than record a Naira figure as if it were USD
(the currency guard in `extract-cost-document`'s prompt, `docs/SOLVED.md` topic 20). That is
the *honest* behaviour given today's schema, but it means **every Nigerian-currency document —
precisely the documents C2's duty calibration depends on — is currently unconfirmable into any
rate table.** The correct fix is real work, not a prompt tweak, and is deliberately not built
here (design question only, per Bashir 9 Sep 2026):

- **A column, not a workaround.** `cost_rates`/`trucking_rates`/`auction_fee_brackets` would
  each need a `currency` column (`usd` | `ngn`, extensible) alongside the existing
  `rate_value`/`price`/`fee_value`. A separate `fx_rate`/`fx_rate_date` pair (mirroring
  `sightings.exchange_rate`/`exchange_rate_date`, see below) would be needed anywhere a
  non-USD row must ever be compared against a USD one — which, for a duty calculation whose
  entire output must land in USD-comparable landed cost, is everywhere.
- **Existing rows need no migration, only a default.** Every row in all three tables today is
  already USD (confirmed — no non-USD data has ever been entered, by design, until this
  finding). A new `currency` column with `DEFAULT 'usd' NOT NULL` backfills every existing row
  correctly with zero data loss and zero ambiguity — this is the easy part.
- **The real decision is storage-time vs read-time conversion, and `sightings` already
  answers it for an analogous problem.** `SCHEMA.md` §1 / `exchange_rate`/`exchange_rate_date`
  on `sightings`: the rate is **frozen at capture** — `price_usd` is computed once, at ingest,
  from whatever the live rate was that day, and never recomputed. The reasoning there
  (`PROJECT_CHARTER.md` §5.8, "raw at capture, classify at read") is about *rates changing
  over time* — a sold comp from six months ago should report the dollar value it actually had
  then, not get silently repriced every time someone looks at it.
- **That reasoning fits `cost_rates` less cleanly than it looks at first.** A `sightings` row
  is a historical fact (a car sold for ₦X on date Y) — freezing the conversion is correct
  because the fact itself is dated and immutable. A `cost_rates` row is closer to a *standing
  rate* that stays "current" until superseded (`effective_from`/`effective_to`, never edited in
  place — `PROJECT_CHARTER.md` §5.10) — the same discipline `sightings` uses for *prices*,
  applied here to *rates*. The honest parallel is: **freeze the rate at confirmation time,
  the same way `sightings` freezes it at capture** — store both `rate_value` in its original
  currency *and* the USD-equivalent computed from that day's rate, never a bare currency code
  with no stored conversion. A duty component confirmed from a Naira assessment notice would
  carry its original NGN figure (for audit — reconciling against the original document later
  requires the original number, not a derived one) plus a frozen USD figure (for every actual
  calculation, which is what a landed-cost figure ultimately has to produce). Recomputing at
  *read* time against a live rate would mean the same stored duty component silently reports a
  different USD cost every time the Naira moves — which is exactly the kind of drift
  `PROJECT_CHARTER.md` §5.10's dated-rate discipline exists to prevent for USD rates already,
  and there is no principled reason currency risk should be exempt from that discipline while
  everything else in this table is dated specifically to avoid silent drift.
- **What this would NOT require:** a general multi-currency calculation engine, or converting
  the *existing* USD rows to anything. This is additive — a currency column, a frozen
  USD-equivalent alongside the original figure, and a currency-aware confirm step in the
  extraction review screen (Phase 4) that fetches or asks for the day's rate before writing a
  non-USD row, mirroring how `currencyService.ts` already does this for `sightings`.
- **Not built.** This is recorded as a design reading only, per instruction — Stage 2 (B1)
  proceeds independently of it.

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
| 32 | Yard matching is name-based and will miss (Prompt 20 Phase 5) | `src/services/yardMatchingService.ts` matches on exact normalised platform + city + state text — no geocoding, no distance tolerance, no fuzzy matching (deliberately, per `PROJECT_CHARTER.md` §5.1 — an approximate match is worse than an honest non-match). A sighting whose location text doesn't exactly match a `trucking_rates` yard name is unmatched, not nearest-matched. Measured baseline: 65.5% matched, 34.5% unmatched, 0% ambiguous, across all 171 live sightings |
| 33 | 27 sightings resolve platform + location cleanly but sit at yards this vendor's file doesn't cover (Prompt 20 Phase 5) | This is a rate-sheet coverage gap, not a matcher weakness — e.g. `ME - WINDHAM` is a real Copart yard per the sighting, simply absent from the "Inland Towing" vendor's price list. Closes by importing more vendors' rate sheets through the same importer, never by loosening the matcher's exactness |
| 34 | Port-name normalisation (`PORT_ALIASES`) and state-name normalisation (`STATE_NAME_ALIASES`) are small explicit alias tables, not general fuzzy correction (Prompt 20 Phase 3/5) | Only two port variants (`JACKSONVILLE YARD`, `LOS ANGELOS` sic) and one state variant (`New Hamphire` sic, present unfixed in `trucking_rates.yard_state` since the raw+normalised treatment was only built for ports) are handled today. A future vendor file will have its own spelling quirks — extend the tables in `scripts/lib/truckingRatesParser.mjs` and `src/services/yardMatchingService.ts` as they're found; never guess at a correction that isn't explicitly listed |
| 35 | `DECISIONS.md` §3's RoRo figure ($1,500–1,800) may be stale against the current market (Prompt 20 Phase 6, research only) | External marketing-page quotes gathered 8 Sep 2026 (AuctionExport, ShipIt, All Transport Depot — none a real quote request) suggest the floor may now run closer to $1,295, with container costs trending toward $2,800 rather than "$2,000+". These are not quotes and were deliberately not used to correct the documented figure or seed any rate row — flagged only as needing a real `agent_quote` before `DECISIONS.md` §3 is updated |
| 36 | No IAAI fee data stored at all (Prompt 21 Phase 1/2) | Every rate in `auction_fee_brackets`/`cost_rates` `auction_fee` is Copart-only. IAAI's own published tables were captured (Standard/High Volume buyer fee, Internet Bid Fee, Service/Environmental/Title-Handling/Premium Imagery fees) but deliberately not stored — zero IAAI invoices exist to cross-check them against, and the Copart cross-check proved a published table can diverge from what a real account actually pays. Store once a real IAAI invoice exists to check against, not before |
| 37 | High-Volume Licensed **Clean**-title Copart brackets not captured (Prompt 21 Phase 2) | Only Non-Clean was fully captured for the White Nexus Ltd (High-Volume Licensed) schedule — Caplimo's real purchases are salvage/Non-Clean, so this wasn't chased further this session. A real Clean-title purchase on that account would need this table pulled the same way (Copart's own site, volume → title-status selector) before it could be priced |
| 38 | Copart Secured-tier brackets stored but unconfirmed against any invoice (Prompt 21 Phase 2) | Both real Copart accounts price as Unsecured on every invoice seen; the Secured tables (both accounts, all title statuses) are stored as `official_tariff` from the published page only. If Caplimo ever posts a security deposit with Copart (see debt #18 in `docs/SOLVED.md` — the $1,125 saved across 3 vehicles is the descriptive number, not a recommendation), the Secured rows are already there to switch to, but unverified against reality until then |
| 39 | Storage fees not stored anywhere (Prompt 21 Phase 2) | Copart's own page defers to "check with your local branch" / genuinely escalates per day ($5/$10/$15/$20/$25/$30 observed across the three real invoices, not a flat figure) — no honest single rate exists to store. `bidHeadroomService.ts` has no storage component at all; a listing sitting unpaid past the free period will under-report true landed cost until this is addressed, deliberately, as a known gap rather than a guessed figure |
| 40 | Late Payment Fee ($50) stored as an always-on flat fee, not a conditional one (Prompt 21 Phase 2) | `bidHeadroomService.ts`'s auction-fee component always adds the environmental/gate/title-pickup flat fees but does not currently add Late Payment even though it's stored in `cost_rates` — it is a penalty for late payment, not a baseline cost, and was stored for completeness (confirmed on 2 of 3 real invoices) without yet deciding how a headroom calculation should treat contingent fees. Worth a deliberate decision before this table grows more conditional fees |
| 41 | Copart's Licensed low-volume fee table is byte-identical to Non-Licensed — incorporation alone does not lower fees (Prompt 21, confirmed 8 Sep 2026) | Pulled both tables directly from Copart's own site (Licensed path → "fewer than 25 vehicles" → Non-Clean) and compared byte-for-byte against the Non-Licensed schedule already stored: identical at every bracket. **Only the High-Volume tier differs** — gated on 25+ units purchased AND $75k+ in trailing-twelve-month sales AND fewer than 5 bidder accounts (the White Nexus Ltd schedule, stored separately, historical not default per the correction below). Recorded so nobody later assumes registering a corporate/licensed Copart account is itself a lever on fees — it isn't; volume is |
| 42 | `bidHeadroomService.ts` defaulted headroom to White Nexus's High-Volume schedule — corrected 8 Sep 2026 | White Nexus Ltd is a one-off middleman that bought one vehicle on Caplimo's behalf; it is not Caplimo's own account. Defaulting to its cheaper schedule would have understated auction fees — and therefore overstated bid headroom — on every research-run listing, systematically, in the direction that loses money on a real bid decision. `DEFAULT_MEMBER_ACCOUNT` now points at Jamilu Danmusa Danmusa (Copart Non-Licensed), the account confirmed against Caplimo's own invoices 1 & 3. White Nexus's High-Volume rows remain stored (that invoice must stay explicable per §5.10) but are historical, not the default. The cost breakdown panel now states "Priced under: [account] — [title], [payment tier]" prominently, not buried in a source line, so the basis is never ambiguous |
| 43 | Copart Secured vs. Unsecured requirement is an open question, not yet resolved — real money at stake | A $400 security deposit is on file with Copart, yet all three real invoices priced at Unsecured. **The deposit does not appear to confer Secured status**, and what actually does is unknown — not something to guess or research further, it needs a direct answer from Copart. Measured stake across the three invoices checked: $1,125 total, averaging $375/vehicle, 3.4–4.4% of sale price. Secured-tier rows stay in `auction_fee_brackets` as `official_tariff`, unconfirmed, and must not be entered or defaulted-to as if Secured status were already obtained |
| 44 | `extract-vehicle-vision`'s prompt instructs the model to guess rather than abstain (found Prompt 22 Phase 1, not fixed — out of scope) | Its prompt reads: `"For 'originalCurrency', strictly use one of: 'NGN', 'USD', 'EUR', 'GBP'. Default to 'NGN' if ambiguous."` That is an explicit instruction to pick a value when the model cannot tell, not to abstain — directly contradicting `PROJECT_CHARTER.md` §5.4 ("AI never generates a price... A plausible-sounding invented price destroys a pricing product permanently"), since a wrong currency silently produces a wrong USD-converted price with no signal anything was uncertain. Correctly left unfixed here: Bulk Import / `extract-vehicle-vision` was not named in PROMPT_22's scope, and editing it risked exactly the kind of adjacent, unscoped change `AGENTS.md` §5 warns against. `extract-cost-document`'s prompt (this same build) deliberately does the opposite — see debt #45 |
| 45 | `NOT_VISIBLE` existed only in documents, in no code, until Prompt 22 (found Prompt 22 Phase 1) | `DECISIONS.md` 9.5, `PLAN_TRACKER.md` §9, `MASTER_PLAN.md` Part X, and the deprecated `AutoData_Architecture_Plan_v4.md` all describe a `NOT_VISIBLE` anti-hallucination escape hatch as if it were an established convention already in use by vision prompting on this project. It was not — confirmed by grepping the entire repo before Phase 3 was written. `supabase/functions/extract-cost-document/index.ts`'s `EXTRACTION_PROMPT` is **the first real implementation** of this convention anywhere in the codebase (the literal string `"NOT_VISIBLE"`, normalized server-side into a `status: 'unreadable'` field marker — see `docs/SOLVED.md` topic 20). **When Daily Sniper (Phase F) is eventually built, it should reuse this exact convention and its normalization pattern, not invent a second one** — the same reasoning `isUnconfirmed`'s two-file duplication (debt #3) already exists to warn against |
| 46 | Asset fingerprinting diverges when the same physical car is captured with and without a VIN, permanently splitting it into two assets (first found Prompt 22 Stage 2, caught again 10 Sep 2026 during B1 close-out verification) | A sighting with no VIN falls back to a make/model/year/trim/colour fingerprint to resolve or create an asset; a later capture of the *same physical car* that does carry a VIN computes a different, VIN-based fingerprint and creates a second, permanently separate asset — the two never merge on their own. Reproduced a second time, unprompted, during this build's own end-to-end verification: a real Copart lot (62572576, no VIN in that capture) and its bid.cars listing of the identical lot (VIN `3MYDLBYV3JY316392`) landed on two different `assets` rows (`71afaf80...` vs `94e1aaff...`), same make/model/year, same location. The first instance was manually merged (repoint the sighting's `asset_id`, delete the orphan) after explicit confirmation and a references check; this second instance was left as-is and only recorded here — a manual merge does not fix the underlying gap, and doing it repeatedly is itself a sign the fix belongs in the fingerprinting logic, not in one-off cleanup. Needs its own dedicated prompt: likely a re-fingerprint/merge pass triggered whenever a VIN arrives for an asset that was originally created without one, not a change to the fingerprint function itself |

# PLAN_TRACKER.md — Status of all work

**Status:** The moving document. Status lives here and **nowhere else**.
**Last revised:** 20 September 2026 (Prompt 35 — bought-car view, extension picker, make tiering; §4.22 and debts #60-#65 added. Earlier: 15 September 2026, Prompt 33 Stage 5 — status refresh; also fixed a stale
debt #58 table row that a narrative log elsewhere in this file had already marked resolved, an
instance of exactly the doc-drift pattern this file exists to prevent).
**Companions:** `PROJECT_CHARTER.md` · `ARCHITECTURE.md` · `DECISIONS.md` · `SCHEMA.md` · `AGENTS.md` · `HANDOFF.md` (the current narrative account — read it alongside this file, not instead of it)

> This file exists because the previous plan document said "nothing is currently blocked or
> broken" and stopped being true within a day. Architecture describes the system;
> **this** describes the state of work. Do not record status anywhere else.
>
> **DONE** = verified in browser or database, with the evidence named.
> **BUILT-UNVERIFIED** = code exists, nobody has confirmed behaviour. Treat as not done.
> **BLOCKED** = cannot proceed, reason named.

---

## 0. WHERE WE STOPPED — read this first

**Last working session: 15 September 2026** (Prompt 33, Stages 1-3 and 5; Stage 4 deliberately
skipped, superseded by Prompt 34). This document is current as of that session. **Full narrative
of everything since the 9 September state (Prompts 24-33: the integrity-debt audit, `daily-
sniper`'s retirement, the asset-merge system, and the NHTSA vehicle reference vocabulary) lives
in `HANDOFF.md` — read it for the "why" behind what changed; this section only restates current
status.** Debts #46-#50, #53, #55-#59 are all closed (see `HANDOFF.md`'s debt table for what
closed each). Migrations now run through 042; live Edge Functions now include
`asset-merge-candidates`, `asset-merge-confirm`, `vehicle-reference-seed`, and `vin-decode`
alongside everything listed below; `daily-sniper` no longer exists at all.

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

**Displayed on `ResearchRunDetail`, collapsed by default** (originally active listings only via
`lot_state !== 'finished'`; that gate was widened in Prompt 26 — see §4.14) — verified live
against a real run with no client budget stated (Mohammed Jamilu Danmusa's Yaris/Matrix brief)
that the panel correctly renders every component and withholds headroom for the right, specific
reason. **Sold-comps average confirmed
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

### 4.13 `public-run`'s sold-comps average ignored `sale_confirmed` — **DONE** (10 Sep 2026, Prompt 25)

Found during Prompt 24's own pre-flight, and it outranked the bug that pre-flight was written
to investigate: the staff dashboard's sold-comps average (`ResearchRunDetail.tsx`'s `getStats`)
excludes `sale_confirmed === false` and, with a `manual_entry`/`ai_vision` carve-out, `null` —
but `public-run` (the client-facing share page, the deliverable that replaced the Excel sheets)
applied **no exclusion at all**. A bid.cars "final bid" that isn't a confirmed sale was being
averaged into the market figure clients actually see. `sale_confirmed` exists specifically to
prevent this; the staff view honoured it, the client view didn't — a live `PROJECT_CHARTER.md`
§5.1 honesty problem in production, not a hypothetical.

**Real blast radius, measured before fixing anything:** of 12 live share-token runs, 9 carry a
stats block; 6 of those 9 changed. Two — Nafisah Bashir's and Tesla's — went from a fully
populated average (9 rows/$10,456.33; 6 rows/$9,375.00) to **zero confirmable comps**, because
every row in each was an unconfirmed bid.cars final bid. The other four shifted by $24–$228 on
one dropped row each. Three comps-bearing live runs were genuinely clean and unaffected.

**The fix, `supabase/functions/public-run/index.ts`:** added `sale_confirmed`/`logged_via` to
the internal query (previously not even fetched), and a derived `sale_unconfirmed` boolean
computed server-side with the identical `getStats` predicate — never the raw fields themselves,
per `PROJECT_CHARTER.md` §5.9's "deliberate, minimal widening." Applied to the price/count
aggregation only; mileage stays unfiltered, matching `getStats` exactly rather than "improving"
it into a silent divergence from the rule being mirrored. `priced_count` (the number actually
displayed as "Based on N sales") now reflects the post-exclusion count; `total_count` is left
representing the full sold population regardless of confirmation (a completeness figure,
currently unused in the UI) — a deliberate choice, not an oversight, recorded here rather than
left implicit.

**New on the public page:** an "Unconfirmed sale" badge on the sold-listing card
(`PublicRunView.tsx`), the client-facing counterpart of the staff dashboard's existing badge —
§5.2 requires an excluded row stay visible and labelled, never silently disappear.

**Verified against real, live data post-deploy** — not compile-only:
- Nafisah Bashir's and Tesla's live share links: `stats.priced_count` now `0`,
  `avg_price_usd`/`min`/`max` all `null`; confirmed both via direct Edge Function fetch and a
  real-browser screenshot of the deployed page — "MARKET AVERAGES (BASED ON 0 SALES)",
  "Avg Sale Price —", every card badged "Unconfirmed sale."
- Khalifah's run: `priced_count` 8→7, `avg_price_usd` $8,234.38→$8,096.43 exactly as predicted
  pre-fix; browser screenshot confirms one badged card, seven unbadged, average/range/mileage
  matching the Edge Function response exactly.
- A second, distinct Mohammed Jamilu Danmusa run with zero unconfirmed rows: `priced_count`
  unchanged at 6/6, average unchanged at $1,512.50 — confirms no drift on a clean run.
- `manual_entry`/`ai_vision` carve-out: no row matching this combination currently sits on any
  *live* share-token run (checked directly) — verified instead against 5 real `manual_entry`
  sold sightings elsewhere in production, confirming the deployed carve-out logic does not
  exclude them, consistent with `getStats`'s own behaviour on the same field values. Recorded
  honestly as verified-by-logic-against-real-values rather than verified-by-live-share-link,
  since no live example of this specific combination exists yet to point to.

**Correction to an earlier entry in this document, found while doing this work:** §4.12 (B1,
Prompt 22) originally stated IAAI's `sale_confirmed` "stays `false` indefinitely" — verified
against real production data here and corrected to `null`. `sale_confirmed` is written in
exactly one place in the whole codebase (bid.cars' own content script); Copart and IAAI never
write it at all, so it can only ever be `null` for either platform, never `false`. See the
corrected text at §4.12 above.

---

### 4.14 Auction fees as a function of bid, not a bracket lookup on a guessed reference price — **DONE** (10 Sep 2026, Prompt 26, supersedes Prompt 24 Phase 2)

Prompt 24 set out to give an active listing a *better* reference price (a sold-comps average
instead of `current_bid_usd`) to bracket the auction fee against. Its own Phase 1 pre-flight
found that an `active_listings`-only run structurally has no sold-comps average at all —
plausibly the majority case. **That was the design telling us the question was wrong, not an
obstacle to route around:** there is no correct single price for a car that hasn't sold, so no
substitute for one — comps average, budget, anything else — is honest. But Copart/IAAI buyer
fees are tiered by actual sale price, and a bid is not a fixed unknown — it's exactly the thing
staff are choosing. **The fee is a function of the bid.** Modelled as one instead of guessed at.

**What changed, `bidHeadroomService.ts`:**
- `getAuctionFeeComponent`'s `referencePriceUsd` is no longer `current_bid_usd ?? listed_price
  ?? price_usd`. It is now either the actual confirmed sale price (`price_usd` on a finished,
  `sale_confirmed=true` listing — a real fact) or a staff-entered candidate bid on an active
  listing — never a number the system picked for itself.
- Extracted `fetchAuctionFeeRows` so the forward calculation (a known price → its fee) and the
  new inverse one (a target → the bid that produces it) share one query instead of two copies
  that could drift apart — exactly the failure mode Prompt 25 just found and fixed elsewhere.
- Replaced a dead scaffold (`solveMaxBidAgainstBracket`, built in Prompt 21, never called —
  handled only the buyer-fee bracket alone) with a real combined-region solver
  (`solveMaxBidForFees`) covering buyer fee + bid-fee midpoint + flat fees together. **Mode A**
  (solve for max bid against `max_budget_usd` as the ceiling): built correctly, gated on
  shipping/trucking/duty *all* being available — duty being permanently blocked (C2) means this
  is expected to be unreachable today, and is: `maxBidSolve.status` is `'unavailable'` in every
  real case tested.
- **Mode B** (what actually renders): a candidate-bid input (`current_bid_usd` may prefill it
  as a convenience and is shown separately as read-only context — it must never itself select a
  bracket or produce a fee) plus `getFeeBracketBoundaries`, showing the current and next bracket
  for both buyer fee and bid-fee midpoint, so staff can see where the step changes are near a
  bid they're actually considering.
- `computeBidHeadroom` gained `isFinishedLot`: forces headroom to abstain on a sold car (no
  future bid to size headroom for) while the cost components — the number that validates the
  fee model against reality — still render.

**`max_budget_usd` — the precise distinction, not a blanket exclusion.** It enters the *solve*
(the ceiling `solveMaxBidForFees` solves against) but never enters bracket selection as an
assumed price — that would overstate the fee on every car that bids below budget, the exact
conflation Prompt 24's Checkpoint 1 wording risked forbidding correctly by being too blunt.
Grepped: confirmed it only ever reaches `computeHeadroom`'s subtraction and
`solveMaxBidForFees`'s `targetAfterOtherCosts` — zero references inside the bracket-selection
path.

**`ResearchRunDetail.tsx:1370`'s `lot_state !== 'finished'` gate removed.** A finished listing
now reaches the cost-breakdown panel — "what did this car actually cost" is the number that
checks the fee model against reality, and leaving that branch unreachable would have been the
same category of mistake as this session's earlier vacuously-true-zero bug (a branch nothing
can execute reads as tested when it never ran).

**Verified against real data:**
- Monotonicity of `total(bid) = bid + fees(bid)` tested directly (not reasoned about) against
  all 108 real currently-effective bracket rows for the default account/tier, every integer
  dollar $0–$20,000, both title statuses — **zero violations**. A max-bid solve is well-defined
  whenever duty unblocks.
- A real active bid.cars/Copart listing (`current_bid_usd=$25`, non-clean title): fee computed
  at $25→$157.50, $99→$180.00, $100→$265.00 (a real bracket boundary), $2000→$897.50 — the fee
  visibly tracks the candidate, including a real step at a real boundary, not the $25 current
  bid alone.
- Five real finished/`sale_confirmed=true` bid.cars rows checked for a case where `price_usd`
  and the old formula would have differed: none exists (`current_bid_usd` is always null on a
  finished bid.cars lot by construction, and every real one is USD) — stated honestly rather
  than presenting a coincidental match as proof.
- `npx tsc --noEmit` clean. `getAuctionFeeComponent` grepped to exactly one caller, unchanged.

**Design note, so this isn't "simplified" back into a reference price later:** an active
listing's fee is *conditional on a staff-entered candidate*, by design, not a system prediction
with a fallback. There is no honest single number to show absent that input — a comps average
would only trade one guess for another (and, per Prompt 24 Phase 1, usually isn't even
available). Any future change reintroducing an automatic price substitute for an active listing
reopens exactly the bug this prompt fixed.

**Correction, 11 Sep 2026 — the live-browser click-through above was written before it
happened, and has since been done.** Bashir logged into the staff dashboard himself (this
session never handled his credentials) and walked through it together: a real finished,
`sale_confirmed=true` bid.cars listing (2007-2011 Toyota Yaris run, $1,600 sale) reached the
cost-breakdown panel, showed the green "Confirmed sale price: $1,600 (fee computed against the
actual price, not a guess)" banner, computed auction fees at **$775** — matching, to the cent,
a manual calculation against the real bracket rows (`$555` buyer fee + `$90` bid-fee midpoint +
`$130` flat fees) — and Bid Headroom correctly rendered **"Unavailable — bid headroom does not
apply to a finished/sold listing"** while inland trucking (`$450`) still computed independently.
This directly confirms Checkpoint 2 items 1 and 2 live, not just at the code/type level as
originally recorded here.

The same walkthrough surfaced a second, real, pre-existing bug in a completely different
function (`listRunListings`'s `current_bid_usd` mapping) — unrelated to this prompt's own
changes, fixed separately and documented at §4.15, not folded into this entry so the two stay
independently revertable.

---

### 4.15 `current_bid_usd` has been permanently null on every `RunListing` since `listRunListings` existed — **FIXED** (11 Sep 2026)

Found live, by hand, during the Prompt 26 walkthrough with Bashir — not by code review. The
new candidate-bid input on an active listing rendered empty instead of prefilling with the
listing's real current bid ($125, a live Copart lot via bid.cars). Traced to the actual cause,
per the handover's own five-things #2: **"A rule against a field the query doesn't return
fails silently — never fires, never errors. Check the select list."**

`researchService.ts`'s `listRunListings` (the sole source of every `RunListing` — everything
`ResearchRunDetail`, `ListingCostBreakdown`, and the staff-side `VehicleDetailModal` render)
mapped `current_bid_usd: raw.current_bid_usd ?? null`, where `raw = sighting.raw_payload`. Two
compounding mistakes: **`sightings.current_bid_usd` — the real, correctly-populated database
column — was never in this query's select list at all**, and `raw_payload.current_bid_usd`
doesn't exist at that path either — confirmed against a real sighting that the actual value
sits one level deeper, at `raw_payload.captured_fields.current_bid_usd`. The result: `null`,
unconditionally, for every `RunListing` this function has ever produced, for as long as it has
existed. Two other functions in the same file had the identical mistake — `listAvailableSightings`
(feeding `AddCapturesModal`'s `AvailableSighting`) and `attachSightingToRun`'s ad-hoc sighting
object — same root cause, same fix, all three in this commit.

**Why nothing ever errored or was noticed:** the old reference-price logic everywhere that
consumed this field used a fallback chain, `current_bid_usd ?? listed_price ?? price_usd`, and
`price_usd` correctly mirrors the live current bid for an active listing (`research-capture`
writes it that way at capture time) — so the fallback silently absorbed the always-null field
and produced the right number anyway, by coincidence, for years. Prompt 26's candidate-bid
prefill was the first piece of code to read `current_bid_usd` **without** that fallback chain
(deliberately — falling back to `price_usd` there would have reintroduced exactly the
"current_bid_usd on its own" bug Prompt 26 exists to prevent), which is why it's the first
thing to surface this as visible, broken behaviour instead of a silent no-op.

**Every real read of `RunListing.current_bid_usd`, checked individually, per Bashir's explicit
request — what it evaluated to before, and what changes now that the field is populated:**

- **`ResearchRunDetail.tsx:1315`** — `current_bid_usd !== null ? 'Current bid' : 'Sale /
  Listed Price'`. Always showed "Sale / Listed Price" for every active listing on the entire
  staff dashboard, confirmed directly against the real screenshot evidence from this same
  walkthrough. Now correctly shows "Current bid" — verified live, same listing, same session.
- **`ResearchRunDetail.tsx:339-340`**, the `mixed`-run-type stats split. The sold-side clause
  (`current_bid_usd === null`) was always true, degenerating the filter to `lot_state !==
  'active'` alone — likely low-impact, since a genuinely active listing also carries
  `lot_state === 'active'` in the common case. The active-side clause (`current_bid_usd !==
  null`) was always **false**, making the filter always false — **the "Client Options (Live)"
  stats card in every `mixed`-type run has shown an empty list, unconditionally, regardless of
  how many active listings the run actually contains.** Real, not theoretical: 2 of 33 live
  runs are `mixed`-type today, and both have been affected for as long as they've existed. Now
  populates correctly.
- **`researchService.ts:806`** (the staff-relayed approval function) — `is_bid: currentBid !==
  null` was always `false`, meaning **`approved_snapshot.is_bid` has always recorded `false`**
  even for a staff-relayed approval of a genuinely live auction bid, on every approval ever
  recorded this way. `display_price` itself stayed correct by accident via the `price_usd`
  branch ahead of the broken fallback. This is the one behaviour change with a real downstream
  consequence worth flagging distinctly: **historical `approved_snapshot` rows recorded before
  this fix may have `is_bid: false` on records that were genuinely bids** — those rows are not
  retroactively corrected (per `PROJECT_CHARTER.md` §5.8/§5.10, a stored record isn't rewritten
  after the fact) and should be read with this in mind if ever consulted as dispute evidence.
  New approvals from this point forward record `is_bid` correctly.
- **`AddCapturesModal.tsx:48`'s `eligibleSold`** (via `listAvailableSightings`) and
  **`attachSightingToRun`'s** identical gate — the `!hasValue(current_bid_usd)` clause was
  always true (a no-op), so a sighting's sold-comps eligibility never actually checked whether
  it had a live current bid. Now it does — a sighting that's genuinely still active will
  correctly be **excluded** from sold-comps eligibility for the first time. Stricter, correct
  direction; not expected to reject anything that was legitimately being accepted before, since
  `lot_state`/`sale_confirmed` were already doing most of that work.

**Checked and confirmed unaffected**, per the same request:
- **A1b's population-coherence guard** keys off `source_platform` only — never reads
  `current_bid_usd`. Clean.
- **The "Unconfirmed Sale," "Limited sample," and "Different model" WARN checklist items**
  compute their own `soldList` from `lot_state === 'finished'` alone (`ResearchRunDetail.tsx:
  659-660`) — **a third, independent implementation of "the sold group,"** distinct from both
  the buggy `displayGroups` split above and `public-run`'s own version (Prompt 25). Correct on
  its own terms, unaffected by this bug, but recorded as debt #50 below since three divergent
  implementations of the same concept in one codebase is exactly the risk Prompt 25 already
  materialised once.
- **`PublicRunView.tsx`/`public-run`** — confirmed already reading `current_bid_usd` directly
  from the `sightings` column, never from `raw_payload`. The client-facing page never had this
  bug.

**Fix:** added `current_bid_usd` to the select list in all three functions
(`listRunListings`, `listAvailableSightings`, `attachSightingToRun`) and mapped it from the
real column instead of `raw_payload`. `npx tsc --noEmit` clean. Verified live: the same real
Oklahoma City listing ($125 current bid) that exposed the bug now shows "Current bid" as its
label and correctly prefills `125` into the candidate-bid input (`document.querySelector
('input[type=number]').value === "125"`, checked directly against the live DOM).

Committed separately from Prompt 26 (a pre-existing, unrelated bug this prompt's own testing
happened to surface, not a change to anything Prompt 26 built) so either can be reverted
without dragging the other along.

---

### 4.16 Spec-rule audit: all nine rules, plumbing verified clean; two real fixes; one design question surfaced — **DONE** (11 Sep 2026, Prompt 27)

Three real findings from use: (A) a 2012 car in Ahmed Ibrahim's 2013–2016 Honda Accord brief
went unflagged; (B) false "trim differs" WARNs on Mohammed Jamilu Danmusa's E-Class brief
(`350`/`350 4MATIC` vs `E350` — the same trim, written differently); (C) an A2 badge reading
"has been to auction before" on a listing that had run and **not sold**, implying a sale that
never happened. Ran under this prompt's own standing authority — audit, then fix directly,
without a per-item approval gate.

**Full audit table — all nine spec-rule `if` blocks in `ResearchRunDetail.tsx`, quoted,
fields traced both sides, proven with synthetic fire/no-fire input:**

| # | Rule | Listing field | Brief field | Select-list status | Real behaviour | Synthetic proof |
|---|---|---|---|---|---|---|
| 1 | `:460` max mileage | `mileage_miles` | `max_mileage` | Both real columns | Fires correctly (3/21 real) | 150k>100k fires; 90k≤100k clean |
| 2 | `:463` year min | `year` (via `assets`) | `year_min` | Both real columns | Correct logic; genuine zero on real data — see root cause below | 2012<2013 fires; 2013≥2013 clean |
| 3 | `:466` year max | `year` | `year_max` | Both real columns | Fires correctly (4/21 real) | 2017>2016 fires; 2016≤2016 clean |
| 4 | `:469` condition | `runs_and_drives` | `condition_required` | Both real columns | Fires correctly (3/21 real) | `false` fires; `true` clean |
| 5 | `:474` titles accepted | `title_type` | `titles_accepted` | Both real columns | Fires correctly (1/21 real, also observed live) | Salvage∉[clean] fires; Clean∈[clean] clean |
| 6 | `:502` colour | `exterior_color` (via `assets`) | `colour_preference` | Both real columns | Fires correctly, incl. exclusion path (1/21 real, also observed live) | White≠Black fires; Black=Black clean |
| 7 | `:514` transmission | `transmission` (via `assets`) | `transmission` | Both real columns | Correct logic; genuine zero on real data | Manual≠Automatic fires; Auto≈Automatic clean |
| 8 | `:526` fuel | `fuel` (via `assets`) | `fuel_type` | Both real columns | Correct logic; genuine zero on real data | Diesel≠Gas fires; Petrol≈Gas clean |
| 9 | `:538` trim | `trim` (via `assets`) | `trim` | Both real columns | **Fired wrongly on Mercedes class-letter trims — fixed, §"2B" below** (5/21 real, incl. the 4 real false positives) | LX∌EX-L fires; EX-L Premium⊇EX-L clean |

**No `current_bid_usd`-style select-list bug anywhere in these nine.** `listRunListings`
(single source for all nine — one listing-object shape, unlike the three-shape §4.15 bug) and
`client_briefs:*` (wildcard select — no brief field can ever be silently omitted) are both
clean, confirmed by hand against the real `.select()`/mapping code, not assumed. Real
production data also checked directly: of 21 live `active_listings`/`mixed` listings, rules 1,
3, 4, 5, 6, 9 have genuinely fired; rules 2, 7, 8 show a genuine zero (proven vacuous-or-real by
the synthetic pairs above, not left untrusted) — the handover's own #3, applied to all nine, not
just the one Bashir happened to notice.

**Root cause of Finding A — not a plumbing bug, a design boundary, correctly identified and
left alone (stop conditions #2 and #5):** `ResearchRunDetail.tsx:401`'s `if (isActiveListings
|| isMixed) { ... }` wraps **all nine spec rules AND A2's prior-auction-history hard block**
(confirmed by brace-matching — one unbroken block, lines 401–618). **A `sold_comps`-type run
never evaluates any of this, for any listing, ever.** Ahmed Ibrahim's real brief has exactly
one run, and it is `sold_comps` — confirmed directly: two of its three included listings are
real 2012 Accords, the year rule's logic is provably correct (synthetic proof above), and it
simply never runs against this run's type. **This is `PROJECT_CHARTER.md` §5.6, applied
consistently, not a bug** — "risk and spec rules apply [to active listings] and only here." A
2012 Accord in 2013–2016 sold-comps research is legitimate market data; flagging it would
apply client-protection rules to market history, exactly what §5.6 warns against. The app
already says so, in the run's own UI, unprompted by this audit: *"Spec matching applies to
active-listings runs only. This brief is stored with the run but no spec rules will run against
it."* **Genuinely ambiguous, not decided here:** does Bashir want some signal — even
informational, non-blocking — when a sold-comps run includes cars outside the brief's stated
range, or is silent inclusion the intended behaviour for market research? A2's hard block sits
in the identical gate, unweakened, untouched, flagged for awareness only since the prompt asked
specifically about hard-block scope relative to these nine.

**2B — trim vocabulary (Finding B), fixed.** See the dedicated commit — extends
`specVocabulary.ts` with `trimMatches()`, deriving a class-letter prefix from the brief's own
`model` (`"E-Class"` → `"E"`, or a named line like GLE/GLC/GLS/GLA/GLB/CLA/CLS/SLC/SLK whose
model name already is the class letters) rather than hardcoding "Mercedes." Verified live: all
4 real flagged listings on Danmusa's brief stop flagging; a genuinely different trim (`E550`)
still flags, both by direct computation against the regex and structurally (the strip only
fires on `<Letter><digit>`, so an unrelated trim word starting with the same letter, e.g.
"Executive", is never touched).

**2C — A2 badge wording (Finding C), fixed.** See the dedicated commit — `auctionHistoryFlags.ts`
gains `previouslySold` alongside the existing `previouslyUnsold`; the badge text now reads
differently for sold vs. not-sold vs. status-absent, with sold taking priority when a listing's
history is mixed (a car that has EVER sold and reappeared is the closer-to-fraud signal per
`PROJECT_CHARTER.md` §6, the stronger fact to surface). A2's trigger and hard-block behaviour
are unchanged — wording only. Verified live against two real cases: Danmusa's Oklahoma City
listing (`status: "Not sold"`) and a pre-existing test fixture, "ZZZ TEST - A2 Case1
ActiveBlock" (a 2021 Tesla Model 3 with a real mixed Sold/Not sold/No information history) —
both render the correct, distinct wording.

**Debt: no universal vehicle database.** The class-letter fix is deliberately narrow (a prefix
pattern, not a trim taxonomy) — a real vehicle-spec database (make/model/trim/generation,
resolving "350" ≡ "E350" ≡ "E-Class 350" for any manufacturer's naming quirks generally) is the
eventual general solution, and a large build in its own right. Not started here — recorded per
this prompt's own explicit instruction not to build it.

---

### 4.17 Debt #52 closed: sold-comps range disclosed, not flagged — **DONE** (11 Sep 2026, Prompt 28 Stage 1)

Prompt 27 correctly declined to decide whether a sold comp outside a brief's stated year range
should get any signal at all, and recorded it as debt #52 rather than guess. Decided now:
**disclose, never exclude, never badge as a defect.** `PROJECT_CHARTER.md` §5.6 is why the nine
spec rules and A2's hard block must not fire on a sold comp — a 2012 Accord in a 2013–2016
brief's market research is legitimate history, and treating it as a spec violation corrupts the
average. That stands, untouched. But §5.1 requires widening bands honestly, not silently — a
client reading an average is entitled to know the sample reached outside what they asked for.

**Built:** a blue INFO badge per out-of-range comp on `ResearchRunDetail.tsx` (mechanically
distinct from WARN/BLOCK — Prompt 27 fixed four false WARNs specifically because false alarms
train users to ignore badges, and this must not recreate that), plus a "N inside, M outside"
composition line next to the average — staff and client side (`PublicRunView.tsx`,
`public-run`). Both derived from the exact same `includePrice` membership `getStats`/the
public stats block already use for the average itself, not a fourth definition of "the sold
group" (three already diverge — debt #47, #50). `public-run` gained a `client_brief` join used
only to compute two derived fields (`range_status` per listing, `range_in/out/unknown_count` in
`stats`) — `year_min`/`year_max` themselves never enter the response's own allow-list object,
the same minimal-widening pattern Prompt 25 used for `sale_unconfirmed`.

**Verified live, deployed:** Ahmed Ibrahim's real run labels its one price-counted 2012 Accord
("0 inside, 1 outside" — the other 2012 Accord is already excluded from the average by Prompt
25's unconfirmed-sale rule, correctly not double-counted here). Danmusa's real Yaris run: "3
inside, 3 outside," average **$1,513** on 6 sales, min/max **$1,000/$2,000** — byte-identical to
the figures verified in Prompt 25, both via the deployed `public-run` API response and the
rendered public page. Nafisah Bashir's run (no brief linked): zero labels, zero composition
line — confirms absence is not violation. No real case of "range stated but comp's year
unknown" exists in production; the `l.year == null` guard was verified by code inspection
instead.

---

### 4.18 C1d: currency on the rate tables — **DONE** (11 Sep 2026, Prompt 28 Stage 2)

The binding constraint on C2 (which is itself the binding constraint on bid headroom Mode A and
C3), parked deliberately in Prompt 22: `extract-cost-document`'s currency guard correctly
abstains on every monetary field in a Naira-denominated document, since `rate_unit` only ever
offered `usd | percent` — the pipeline built to process real Nigerian assessment notices could
not confirm a single row from one. The guard is right and untouched (confirmed: zero diff on
`extract-cost-document/index.ts` across this entire build). The fix widens what the tables can
hold, never loosens what the model is allowed to guess — see `docs/SOLVED.md` topic 25.

**Migration 033** — `currency` (`NOT NULL DEFAULT 'usd'`), `amount_usd`, `fx_rate`,
`fx_rate_date` on all three rate tables, plus a CHECK constraint per table enforcing the only
two valid shapes (all three conversion fields null for a USD or percent-unit row; all three
populated together for anything else) — an auditor reconstructs the conversion from the row
alone. Applied; all existing rows (5 `cost_rates`, 1,740 `trucking_rates`, 324
`auction_fee_brackets`) backfilled to `currency='usd'`, zero existing amounts altered
(spot-checked against known real values from Prompt 26 — $15/$95/$20 Copart flat fees,
unchanged).

**Frozen at confirmation, never recomputed at read** — deliberately not `sightings.
exchange_rate`'s mechanism copied verbatim: a sighting freezes a rate because the fact is
historical and immutable, a rate row is a standing figure current until superseded by
`effective_from`/`effective_to`, and freezing the conversion at confirmation is the honest
extension of that same discipline, not a second one for a different reason. Built into
`costDocumentExtractionsService.ts`'s `confirmExtraction`: the FX rate is fetched once per
confirm (`currencyService.ts`, the same module `sightings` already uses), never typed; the
reviewer's only input is which currency the source document actually used. A currency the fetch
can't resolve a rate for aborts the whole confirm before anything is written —
`currencyService`'s own silent "return the unconverted amount" fallback for a missing rate
(exactly the ~1,395x mispricing class of bug this whole feature exists to prevent) is never
reached from here, since the rate's presence is checked explicitly first.

**No existing read site touched.** `bidHeadroomService.ts`/`truckingRatesService.ts` select an
explicit column list that never included the new fields — every USD row (100% of them, always,
in practice, since Copart/IAAI/US-trucking data is always USD) reads exactly as before.
`CostRatesAdmin.tsx` needed one necessary display fix: a bare `$` prefix on a non-USD
`rate_value` would relocate the exact mislabeling this feature exists to prevent to the admin
screen itself, so it now shows the original currency and amount with the frozen USD-equivalent
alongside — not a conversion, a formatting choice between two already-computed numbers.

**Verified end-to-end against a real document** — the exact real assessment notice
("AssessmentNotice (23).pdf") that Prompt 22 could only ever reject, its real extracted
structure re-staged as a fresh `pending_review` row (confirmed by SQL, not fabricated): "FCS,"
₦205,581.08 read directly off the real rendered document, confirmed with currency=NGN through
the actual review screen. Result, queried directly: `rate_value=205581.08`, `currency=ngn`,
`fx_rate=1326.029544` (a real fetched rate, not the hardcoded 1,500 fallback),
`fx_rate_date=2026-09-11`, `amount_usd=155.04`, `source`/`effective_from` human-set exactly as
Prompt 22 Checkpoint 4 established. Re-read after confirming: identical figures — proof this is
a stored value, not a live conversion. Verified live in `CostRatesAdmin.tsx`: existing USD rows
unchanged (`$95`, `$20`, `$50`), the new row correctly reads `NGN 205,581.08 (≈ $155.04)`.

This unblocks C2; it does not build it. Duty remains `unavailable` everywhere until the
51.47%/six-component formula is actually calibrated against 10+ real assessment notices
(`PLAN_TRACKER.md` §6/C2).

### 4.19 Prompt 29 (Integrity and configuration): six independent stages — **DONE** (12 Sep 2026)

Six independently-scoped stages, each committed separately, each with its own confirm-before-
migrate/deploy/non-`SELECT`-SQL gate honoured throughout (one self-caught violation early in
Stage 2 — a deploy run before asking — flagged to Bashir unprompted the moment it happened, not
after). Full detail lives on each stage's own debt-table entry, linked below; this section is
the cross-stage summary the master prompt's own "Documents" requirement asked for.

- **Stage 1 (debt #46, PARTIALLY addressed — stays open, per Bashir 12 Sep 2026):**
  `research-capture/index.ts` now upgrades a VIN-less asset in place the moment a *same-platform*
  re-capture of the same physical car arrives already carrying the VIN it previously lacked
  (proven case: an IAAI lot captured logged-out, then re-captured logged-in). This closes a real
  gap but not the one that actually motivated the debt: the Copart/bid.cars Yaris split survives,
  because Copart folds trim into its model string (`Yaris IA BASE`/`null`) while bid.cars
  separates them (`Yaris`/`BASE`) — the two platforms' VIN-less fingerprints never match to begin
  with, so there's no candidate row for the fix's upgrade path to find. That's moat item #4
  (same VIN across Copart/bid.cars/dealer listings), and it's a model/trim **parsing** problem —
  the normalisation layer, the same one the Mercedes class-letter fix (§4.16) already extended —
  not a fingerprinting problem. The abstention branch that *is* reachable (a vinless lookup
  finding a candidate already carrying a *different* VIN) was built and proven with synthetic
  data, since it has no live positives; the master prompt's own detection-query premise was found
  wrong for the reason above and reported rather than forced to fit. **Verification: CLOSED
  12 Sep 2026** via a real browser capture session (Bashir) — an IAAI lot captured logged-out
  then logged-in produced one asset with `fingerprint_outcome: upgraded_vinless_asset` through
  the real deployed endpoint (not just direct SQL against `generate_fingerprint()`), and a fresh
  Copart + bid.cars pair (Mercedes E250 Bluetec, lot 66964556) reproduced the still-open
  cross-platform split live, independent of the earlier-recorded Yaris instance — see debt #46's
  own entry for both results in full.
- **Stage 2 (debts #47/#48/#49/#50, all resolved):** `supabase/functions/_shared/soldGroup.ts` —
  one plain-`.ts` module, zero runtime-specific imports, imported literally by both
  `ResearchRunDetail.tsx` (React) and `public-run/index.ts` (Deno). Folds in `sale_confirmed`'s
  three null meanings as an explicit discriminated union and the `api_import` carve-out gap. A
  **fourth** divergent copy (`public-run`'s own `stats` block, missing the `lot_state !==
  'active'` check) was found live during the unification and fixed in the same pass. Verified
  byte-identical arithmetic on every real run checked, both via direct query and live rendering.
- **Stage 3 (fix, not a debt):** exhaustive `raw_payload` mapping audit across every service, in
  the same style as the `current_bid_usd` fix at §4.15 — 3 more broken fields found and fixed in
  `researchService.ts` (`estimated_retail_value_usd`, `estimated_cost_low_usd`,
  `estimated_cost_high_usd`), 6 already-correct fields documented with why (a genuinely different
  write pattern in `app-ingest/index.ts` makes its `raw.<field>` reads correct, unlike
  `research-capture`'s). Verified live against a real BMW 750i listing.
- **Stage 4 (debt #43 addendum, business question still open):** `bidHeadroomService.ts`'s
  hardcoded `PAYMENT_TIER = 'unsecured'` is now `org_settings.copart_payment_tier` (migration
  034), superadmin-editable, same default. Verified both that the default is unchanged ($775 fee)
  and that flipping the setting produces a real, correctly-computed different figure ($595, with
  an honest "bid fee not available" rather than a fabricated number where no Secured bid_fee rows
  exist).
- **Stage 5 (debt #44, resolved; debts #53/#54, new):** `extract-vehicle-vision`'s "Default to
  'NGN' if ambiguous" replaced with the same null/`"NOT_VISIBLE"` abstention convention debt #45
  established for `extract-cost-document`. `BulkImport.tsx`'s own client-side `Currency.NGN`
  default and several literal-`"NOT_VISIBLE"`-pass-through bugs fixed so an abstention actually
  reaches the human reviewer. Verified against a synthetic degraded test image: currency
  correctly abstained instead of guessing NGN; a second guesser (`standardizeVehicleString`) and
  an imperfect null-vs-`"NOT_VISIBLE"` distinction in practice were found and recorded as new
  debt, not silently fixed or hidden.
- **Stage 6 (new capability, no debt closed):** `cost_document_extractions` gained an optional,
  always-human-set `asset_id` pairing (migration 035) to the vehicle a staged document describes,
  and a `declared_value`/`declared_value_currency` pair scoped to assessment notices only, for
  later official-vs-actual comparison. No duty calculator, no automated comparison — only the
  place for the data to land. Verified end-to-end via a temporary synthetic row: search-and-pick
  pairing persisted with a real paired-by user/timestamp, declared value round-tripped correctly;
  the test row was deleted after verification.

See `DECISIONS.md` for the allow-list precedent this prompt's own scope depended on, `SCHEMA.md`
for `org_settings` (Stage 4) and the Stage 6 pairing fields, and `docs/SOLVED.md` for the
fingerprint-revision-and-abstention rule (Stage 1) and the `raw_payload` audit method (Stage 3).

---

### 4.20 Prompt 30 (Root causes): five stages — **DONE** (12 Sep 2026)

Root-causes what Prompt 29 patched at the symptom layer, plus a codebase-wide audit for the same
shape of bug (one concept, silently duplicated) recurring anywhere else.

- **Stage 1 (debt #55, resolved):** `research-capture/index.ts:308`'s `{ ...payload }`
  envelope-spread — the actual cause behind four `raw_payload` reader bugs across two prompts —
  replaced with a flat spread of `captured_fields`, matching `app-ingest`'s already-correct
  convention. One canonical shape system-wide now. `supabase/functions/_shared/rawPayload.ts`
  added: `readRawPayloadField`/`requireRawPayloadField` handle both the new flat and 176
  historical-nested rows transparently, and throw/report absence explicitly rather than ever
  returning a bare null for a field that isn't there — proven with synthetic input, and
  separately against a real historical row pulled from production just before the deploy.
- **Stage 2 (debt #46, the real motivating case resolved):** built `canonicalizeForFingerprint()`
  in `_shared/specVocabulary.ts` (extending, not duplicating, the Prompt 27 class-letter
  normaliser), used only at fingerprint-computation time — stored make/model/trim never touched
  (§5.8). Proven via the real `generate_fingerprint()` RPC that both known real pairs (Mercedes
  lot 66964556, Yaris lot 62572576) now hash identically from each side's own raw data, and that
  synthetic near-misses (E250/E350, a bare "Yaris iA" vs a bare "Yaris") do not collide. Backfilled
  all 33 real VIN-less assets' `fingerprint_hash` (23 changed, 0 collisions, make/model/trim
  columns confirmed byte-identical before/after). Bashir's own follow-up browser session then
  reproduced the fix live: an IAAI logged-out→logged-in re-capture correctly upgraded in place
  through the real deployed endpoint, and a fresh Copart+bid.cars capture of the Mercedes pair
  reproduced the still-open cross-platform split exactly as predicted, confirming both halves of
  the fix (same-platform closed, cross-platform now provably fixed going forward) against real
  data, not assertion.
- **Stage 3 (debt #53, resolved; debts #56/#57, new):** `geminiService.ts`'s
  `standardizeVehicleString` — a second, independent NGN-guesser — fixed the same way debt #44
  was: "NOT_VISIBLE" added to the Gemini schema's currency enum, default-on-ambiguity instruction
  removed, `CarForm.tsx`'s silent-default-discarding bug fixed alongside it (currency state
  widened to allow "needs review", submit blocked when a price has no currency). Verified live
  against the real Gemini API: an ambiguous bare price abstains, an explicit one still extracts
  correctly. The required "audit for a third" found a genuine third guesser
  (`daily-sniper/index.ts`) plus a bigger problem riding along with it (writes to the deprecated
  `sales` table, hardcoded secret, no human review at all) — registered as debt #56 rather than
  patched in isolation, since fixing only the currency line would leave an abstention with
  nowhere safe to land. A non-monetary default (`normalizeHistoricalData`'s trim-defaults-to-Base)
  was also found and registered as debt #57, lower priority than the currency guessers.
- **Stage 4 (debt #58, new; everything else checked clean):** audited every normalization layer
  (fuel/colour/transmission/trim vocabulary, currency parsing, port/state aliases, per-platform
  location parsing), every identity derivation (fingerprinting, VIN-usability check, yard
  matching, capture dedup), and every population definition (sold-group, the
  `isActiveListings || isMixed` spec-rule gate, A2's auction-history flags) against the
  "same concept, silently duplicated" shape this session's own bugs shared. Found one real,
  live-confirmed divergence not previously known: `bidHeadroomService.ts`'s conservative
  `classifyTitleStatus` and `ResearchRunDetail.tsx`'s permissive inline title-match logic
  disagree on a real documented value (`"Certificate of title (WV)"` — matches as clean-equivalent
  in one, abstains as unknown in the other). Registered as debt #58, not fixed — deliberately
  different risk tolerances for different purposes, needing a real design decision to unify, not
  a quick patch. Everything else checked (soldGroup's consumers, A2's flag derivation, the
  per-platform location parsers, the two alias tables) confirmed single-definition or
  deliberately-separate-by-design, no further duplication found.
- **Stage 5 (Documents):** this section, plus `SCHEMA.md` §16 (Stage 1's canonical shape),
  `DECISIONS.md` §4.14 (identity normalization derived at fingerprint time, never written back),
  and `docs/SOLVED.md` §§28-29 (the writer-side root cause; the cross-platform parser divergence).
  Prompt 22 item #15 (a real Copart + bid.cars capture pair) marked verified — Bashir's own
  captures during this prompt's Stage 2 verification closed it.

---

### 4.21 Prompt 31 (Close #46, security, and the title decision): five stages — **DONE** (12 Sep 2026)

- **Stage 1 (debt #46, STAYS OPEN — real cause found):** Bashir's fresh re-capture of lot 66964556
  proved the merge does not happen through the real endpoint: the upgrade-probe only runs when no
  VIN-bearing asset exists yet, and one already did (created before the vinless sibling existed).
  Once a VIN-bearing asset exists for a VIN, no future capture of either platform can trigger a
  merge — the main hash lookup finds it directly and never reaches the probe. Diagnosed, not
  patched, per this stage's own instruction; the remaining work is a genuine human-confirmed
  two-asset merge, deliberately not automated.
- **Stage 2 (debt #56, resolved; debt #59, new — owned by Bashir):** treated as security work
  ahead of feature work. The hardcoded secret (in git history since `ccac489`) moved to
  `Deno.env.get("SNIPER_SECRET")`; the deprecated `sales` write and its service-role client
  removed entirely (nothing ever read those writes); the third currency guesser fixed the same
  way as debts #44/#53, at all three internal sites that used to coerce an abstention to NGN;
  the function now extracts-and-returns only, since no review UI exists for it. Deployed with
  Bashir's explicit choice to accept a short outage and rotate to a new secret value himself
  (debt #59) rather than reuse the git-history-exposed one.
- **Stage 3 (debt #58, resolved):** one title-status classifier in `_shared/specVocabulary.ts`,
  taking the severe reading (a bare "Certificate of Title" — the legal document name for any
  title, branded or not — no longer counts as clean-equivalent). Pre-flight blast radius queried
  first: 19 real sightings, 4 of 5 clean-accepting briefs, but zero live intersection inside an
  evaluated run today. `bidHeadroomService.ts`'s binary contract preserved via a wrapper, verified
  byte-identical against all 88 real title_type values. `ResearchRunDetail.tsx`'s spec rule 5 now
  surfaces an unclassifiable title as a distinct "needs manual review" message. Neither call site
  touches sold-comps population or arithmetic — confirmed structurally, not just asserted.
- **Stage 4 (debt #57, resolved; Prompt 30's audit closed out):** `normalizeHistoricalData`'s
  trim-defaults-to-`'Base'` replaced with `null`-on-unstated, same abstention standard as the
  currency guessers — low-risk since its only caller (`handleDataDetox`) is itself disabled
  (debt #4), genuinely dead code today. Re-reading Prompt 30's Stage 4 audit table: every other
  item it listed was already confirmed single-definition or deliberately-separate-by-design: the
  one real duplication it found (title-status classifiers) is now fixed (Stage 3 above); nothing
  else from that audit remains unaddressed.
- **Stage 5 (Documents):** this section, `DECISIONS.md` §4.15 (the title-severity rule, with the
  asymmetry reasoning), and `docs/SOLVED.md` §30 (the cross-platform merge path's real gap).

### 4.22 Prompt 35: the bought car, the extension picker, the make tiering — **DONE except as listed** (20 Sep 2026)

Run before Prompt 34 Stages 4-6 (documents, invoice/notification, docs) were built — those are still
**not done** (and Prompt 34 Stage 6's `SCHEMA.md`/`DECISIONS.md` entries for `won_vehicles`,
migrations 043/044, are still owed). Stage 1 built everything except the documents section and left an
explicit placeholder in its place.

- **Stage 0 — E2E test data cleanup: DONE.** Soft-deleted (`deleted_at`/`deleted_by`, migration 023
  pattern) the walkthrough's client, brief, run and promoted won vehicle. The real Yaris won vehicle
  (`da661471…`, VIN `JTDBT923781219099`) untouched — note it is at `auction_paid`, not `won`: `ufbash`
  advanced it on 16 Sep, a genuine step, so the prompt's "still `won`" premise was stale. **Not
  cleaned:** the two dummy assets (`E2ETESTVIN0000001/2`), their sightings and listings — `assets`,
  `sightings` and `research_run_listings` have no soft-delete column and adding one to `assets` means
  filtering every asset read. Left in place, still `ACTIVE`, counted in Toyota's traded count. Decision
  pending with Bashir.
- **Stage 1 — bought-car thumbnail and detail: DONE, verified in browser.** Thumbnail in the brief from
  *stored* images only (signed URLs; remote `image_urls` never rendered — `images.bid.cars` fails CORS);
  placeholder when none. Detail sections: Identity, Purchase, Costs, Status, Documents (placeholder),
  Provenance. Purchase reads `won_snapshot` only — proven by wrapping `fetch` to rewrite the
  `sightings` response as a re-capture (price 999999, platform, title, location, lot, images all
  changed): Purchase unchanged, gallery fell back to the placeholder. Auction fee matched an
  independent SQL computation on all four cases (non-clean $802.50 / $1,272.50, clean $640 / $1,130);
  trucking $400 matched SQL; schedule label ("Unsecured") matches `org_settings`. Duty abstains
  visibly; **no landed total is shown while any component is unavailable or partial**. Provenance
  link opens the source run, whose banner shows the matching staff-relayed approval.
  **Stated limits:** (1) *the final winning bid is not recorded anywhere* — the snapshot holds only
  the approved price, so fees are computed and labelled "at the approved price" (debt #60);
  (2) the snapshot lacks title type, yard, auction platform and lot number, so cost inputs are read
  from the source sighting, which `research-capture` updates in place on re-capture — labelled "as it
  stands now" in the view, not frozen; (3) destination port/method is not stored on the won vehicle,
  so trucking and shipping need it chosen in the view and the choice is not saved.
- **Stage 2 — extension run picker, vehicle first: BUILT, deploy verified, extension NOT exercised.**
  `vehicleHeadingFromBrief` moved from `ResearchRuns.tsx` to `supabase/functions/_shared/vehicleHeading.ts`
  (one definition; the website imports it, `list-active-runs` calls it). New response fields
  `vehicle_heading` and `brief_reference` (finished strings; the extension builds nothing). Auth is the
  static `x-research-secret`, not a staff JWT — the master prompt's "staff-authenticated" was loose.
  Over 38 real runs: 19 lead with the vehicle, 19 fall back to the run label, 0 blank. Deployed and
  boots (401 without the secret). **Outstanding, needs Bashir's browser:** reload the extension at
  `chrome://extensions` **and** hard-refresh, check the picker, the A3 session model (pick once,
  persists across tabs, 10-minute idle expiry), and one Copart + one bid.cars capture.
- **Stage 3 — make tiering by evidence: DONE, verified, with a finding that changes the outcome.**
  Migration 045; `_shared/nhtsa.ts` (one NHTSA fetch, now shared by the seed, the on-demand and the
  probe functions, with an id-keyed variant because names containing a period 302 to a 404);
  `vehicle-reference-make-probe` (superadmin, resumable, never deletes); `tierMakes`, the one place the
  rule lives; `MakeCombobox` typeahead with reversible Hide/Restore. All 406 makes probed.
  Result: **14 traded / 317 current / 75 other** (47 zero-models, 28 older-only). **The zero-models rule
  does not catch AC Propulsion** — NHTSA returns its two models for every year 2010-2030, and Toyota,
  Honda and Ford also return models for 2029, so vPIC's year filter cannot show a make is defunct
  unless NHTSA recorded an end date. The rule catches real ended makes (Oldsmobile, Plymouth, Saturn,
  Pontiac, Saab, DeLorean, Yugo, Geo, AMC) and non-car makers (IC Bus, Orion Bus, Crane Carrier,
  Jerr-Dan, Mitsubishi Fuso, Wausau) but leaves 317 makes in tier 2, so the default list is only
  partly de-cluttered. AC Propulsion is one Hide click away; not hidden without Bashir's call.
- **Stage 4 — documents:** this section, `SCHEMA.md` §18, `DECISIONS.md` §13, `docs/SOLVED.md` topic 33.

**What remains of Phase D after this:** Prompt 34 Stage 4 (won-vehicle documents, private bucket,
staff-only), Stage 5 (invoice + notification email through `_shared/email.ts`, test sends to Bashir
only), Stage 6 (its docs); recording the real winning bid; persisting the destination port.

---

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

**Item #15 (a real Copart lot + a real bid.cars lot, captured through the actual extension)
marked VERIFIED, 12 Sep 2026** — the bullet immediately above satisfied it once, then Bashir's
own follow-up capture session during Prompt 30 Stage 2's verification (a fresh Copart + bid.cars
pair, lot 66964556, Mercedes E250 Bluetec) exercised it again independently, this time also
proving the cross-platform fingerprint fix (debt #46) against real data from both platforms.
No longer open.

**Known permanent gap, not a defect of this build:** IAAI exposes no sales-history panel
analogous to bid.cars' — every IAAI sighting's `sale_confirmed` stays `null` indefinitely
(**correction, 10 Sep 2026, Prompt 25** — originally written here as `false`; verified
against real production data while building Prompt 25's fix and confirmed to be `null`, not
`false` — `sale_confirmed` is only ever written by bid.cars' own content script, and neither
Copart's nor IAAI's ever sets it to anything). This is the same "unconfirmable by platform"
state Copart carries permanently per B2 below, for the same reason (the platform's own data
model has no confirmation mechanism, not a missing feature) — but it renders identically to a
bid.cars lot whose sales-history table simply didn't parse, which is a different kind of
`null` (see debt entry recorded under Prompt 25, §4.13). Worth distinguishing in the UI
eventually — not done now.

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

Deliberately last; needs accumulated data. Market Velocity Index · decay model · arbitrage
detection · origin premium spread · repair-cost dataset exploitation.

**Daily Sniper — retired 12 Sep 2026, Prompt 32 Stage 1.** Was: vision ingestion via phone
Shortcuts automation, with the `NOT_VISIBLE` anti-hallucination prompt (debt #56). Superseded,
not delivered: the live site now accepts uploads from Bashir's phone directly, through the
normal reviewed pipeline, covering the same workflow through code that already exists and is
already reviewed. See debt #56/#59 resolution notes below and `docs/SOLVED.md` topic 31.

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
| 43 | Copart Secured vs. Unsecured requirement is an open question, not yet resolved — real money at stake | A $400 security deposit is on file with Copart, yet all three real invoices priced at Unsecured. **The deposit does not appear to confer Secured status**, and what actually does is unknown — not something to guess or research further, it needs a direct answer from Copart. Measured stake across the three invoices checked: $1,125 total, averaging $375/vehicle, 3.4–4.4% of sale price. Secured-tier rows stay in `auction_fee_brackets` as `official_tariff`, unconfirmed, and must not be entered or defaulted-to as if Secured status were already obtained. **Still open as of 12 Sep 2026, Prompt 29 Stage 4:** the underlying business question is unchanged — this is not a resolution. What changed is that `bidHeadroomService.ts`'s `PAYMENT_TIER = 'unsecured'` constant is now `org_settings.copart_payment_tier` (migration 034), a superadmin-editable setting defaulting to the same `'unsecured'` value. Once Copart actually answers, flipping the tier is a settings change, not a code change and redeploy |
| 44 | `extract-vehicle-vision`'s prompt instructs the model to guess rather than abstain (found Prompt 22 Phase 1, not fixed — out of scope) | Its prompt reads: `"For 'originalCurrency', strictly use one of: 'NGN', 'USD', 'EUR', 'GBP'. Default to 'NGN' if ambiguous."` That is an explicit instruction to pick a value when the model cannot tell, not to abstain — directly contradicting `PROJECT_CHARTER.md` §5.4 ("AI never generates a price... A plausible-sounding invented price destroys a pricing product permanently"), since a wrong currency silently produces a wrong USD-converted price with no signal anything was uncertain. Correctly left unfixed here: Bulk Import / `extract-vehicle-vision` was not named in PROMPT_22's scope, and editing it risked exactly the kind of adjacent, unscoped change `AGENTS.md` §5 warns against. `extract-cost-document`'s prompt (this same build) deliberately does the opposite — see debt #45. **Resolved 12 Sep 2026, Prompt 29 Stage 5:** the "Default to 'NGN' if ambiguous" instruction was removed and replaced with the same null/`"NOT_VISIBLE"` per-field abstention convention `extract-cost-document` already uses (debt #45), plus `BulkImport.tsx`'s own client-side `let finalCurrency = Currency.NGN` default and several literal-`"NOT_VISIBLE"`-pass-through bugs were fixed so an abstention actually reaches the human reviewer instead of being silently overwritten. A second, independent NGN-guessing instruction was found elsewhere in the same investigation and left unfixed — see debt #53 |
| 45 | `NOT_VISIBLE` existed only in documents, in no code, until Prompt 22 (found Prompt 22 Phase 1) | `DECISIONS.md` 9.5, `PLAN_TRACKER.md` §9, `MASTER_PLAN.md` Part X, and the deprecated `AutoData_Architecture_Plan_v4.md` all describe a `NOT_VISIBLE` anti-hallucination escape hatch as if it were an established convention already in use by vision prompting on this project. It was not — confirmed by grepping the entire repo before Phase 3 was written. `supabase/functions/extract-cost-document/index.ts`'s `EXTRACTION_PROMPT` is **the first real implementation** of this convention anywhere in the codebase (the literal string `"NOT_VISIBLE"`, normalized server-side into a `status: 'unreadable'` field marker — see `docs/SOLVED.md` topic 20). **When Daily Sniper (Phase F) is eventually built, it should reuse this exact convention and its normalization pattern, not invent a second one** — the same reasoning `isUnconfirmed`'s two-file duplication (debt #3) already exists to warn against |
| 46 | Asset fingerprinting diverges when the same physical car is captured with and without a VIN, permanently splitting it into two assets (first found Prompt 22 Stage 2, caught again 10 Sep 2026 during B1 close-out verification) | A sighting with no VIN falls back to a make/model/year/trim/colour fingerprint to resolve or create an asset; a later capture of the *same physical car* that does carry a VIN computes a different, VIN-based fingerprint and creates a second, permanently separate asset — the two never merge on their own. Reproduced a second time, unprompted, during this build's own end-to-end verification: a real Copart lot (62572576, no VIN in that capture) and its bid.cars listing of the identical lot (VIN `3MYDLBYV3JY316392`) landed on two different `assets` rows (`71afaf80...` vs `94e1aaff...`), same make/model/year, same location. The first instance was manually merged (repoint the sighting's `asset_id`, delete the orphan) after explicit confirmation and a references check; this second instance was left as-is and only recorded here — a manual merge does not fix the underlying gap, and doing it repeatedly is itself a sign the fix belongs in the fingerprinting logic, not in one-off cleanup. Needs its own dedicated prompt: likely a re-fingerprint/merge pass triggered whenever a VIN arrives for an asset that was originally created without one, not a change to the fingerprint function itself. **Partially addressed 12 Sep 2026, Prompt 29 Stage 1 — STAYS OPEN, narrower scope stated by Bashir 12 Sep 2026:** `research-capture/index.ts` now upgrades a VIN-less asset in place the moment a *same-platform* re-capture of the same physical car arrives already carrying the VIN it previously lacked (e.g. an IAAI lot captured logged-out, then re-captured logged-in) — a real, useful fix, but it only closes the case where both captures would have produced the *same* VIN-less fingerprint to begin with. **It does not close the case that actually motivated this debt.** The real Copart/bid.cars split above (Toyota Yaris) survives unchanged: Copart folds trim into its model string (`Yaris IA BASE` / `trim: null`) while bid.cars separates the two (`Yaris` / `BASE`), so the two platforms' VIN-less fingerprints never match in the first place — there is no vinless candidate row for the VIN-bearing capture to find and upgrade. This is moat item #4 (the same VIN across Copart, bid.cars, and dealer listings) and it is a **model/trim parsing problem, not a fingerprinting problem** — the same class of fix the Mercedes class-letter resolver (`trimMatches`, §4.16) already does for spec matching, needed instead in the normalisation layer that feeds the fingerprint function. The master prompt's own detection query did not actually catch the real split described above, for this exact reason (differing model/trim parsing across platforms), and `assets.fingerprint_hash unique not null` makes "multiple ambiguous candidates" structurally unreachable — the real, reachable abstention case that direction of testing *could* prove (a vinless-fingerprint lookup finding a candidate that already carries a *different* VIN) was built and proven with synthetic data since it has no live positives. Existing production splits (like the Yaris one recorded above) are not auto-merged by this fix; they must still be found and merged by hand as before. **Verification status: CLOSED, 12 Sep 2026 — verified against the real deployed HTTP endpoint via a live browser session Bashir ran.** IAAI lot 45846349 (Toyota Camry) captured logged-out then re-captured logged-in: one asset (`28a1bb03-acc5-416c-948c-4e3025d28b81`), `raw_payload.asset_fingerprint_outcome = {"action": "upgraded_vinless_asset", "acquired_vin": "4T1DAACK8TU694575", ...}` — the upgrade path fired for real, not just against `generate_fingerprint()` directly in SQL. In the same session, a fresh Copart + bid.cars pair (lot 66964556, Mercedes E250 Bluetec) reproduced the still-open cross-platform split live: Copart's capture (`model: "E 250 Bluetec"`, `trim: null`, asset `92aacfdf-2efe-4d74-870d-2a8d23a8850b`, no VIN) and bid.cars' capture of the identical lot (`model: "E-class"`, `trim: "250 BLUETEC"`, VIN `WDDHF9HB9GB237134`, asset `2c9e6244-8f72-498b-ad00-86ccd6fe2acb`) landed on two different assets, `fingerprint_outcome: null` on the bid.cars capture (no vinless candidate found, because the fingerprints never matched) — a fresh, independent confirmation of the scope correction above, not a re-read of the old Yaris instance. **STAYS OPEN, 12 Sep 2026, Prompt 31 Stage 1 — real cause found on the actual re-merge attempt:** Bashir re-captured lot 66964556 from the bid.cars side after Prompt 30's backfill, specifically to test whether the now-canonicalized pair would merge on the next real capture. It did not: the new capture (`captured_at` updated to a fresh timestamp) reused the existing sighting and asset `2c9e6244` unchanged, `raw_payload.asset_fingerprint_outcome: null` - the upgrade-probe block never ran at all. **Root cause: the upgrade path is gated on `!existingAsset`, and `2c9e6244` already existed** (created during the very first verification capture, itself a VIN-bearing capture that happened *before* Copart's vinless sibling `92aacfdf` existed - so the probe correctly found nothing at that moment and created a normal new asset). Once a VIN-bearing asset exists for a given VIN, its own fingerprint hash matches on every subsequent capture via the *main* lookup, which short-circuits before the probe block is ever reached - so no future capture, of either platform, can trigger a merge for a pair that has already split. This is not a new gap; it is precisely what debt #46's own "existing production splits are not auto-merged by this fix" caveat already predicted, now demonstrated concretely rather than asserted. Closing this for real needs a genuine two-asset merge operation (repoint every `sightings`/`auction_history` row from the loser to the survivor, retire the orphan) - deliberately never built by Prompt 29 Stage 1, to avoid the higher risk of an automated merge fusing two unrelated cars. Debt #46 stays open; the remaining work is that merge operation (human-confirmed per pair, never automatic), not another fingerprinting change. **CLOSED 13 Sep 2026, Prompt 32 Stages 2-3.** Stage 2 built the human-confirmed merge operation this debt was waiting on (`merge_assets()` SQL function, migration 036; review UI at `AssetMergeReview.tsx`, gated superadmin): both real production split pairs — the Mercedes E-Class (lot 66964556, `2c9e6244`/`92aacfdf`) and the Toyota Yaris (lot 62572576, `71afaf80`/`94e1aaff`) — were merged through the real UI with Bashir confirming each one. Verified in the database afterward: every `sightings`/`auction_history`/`cost_document_extractions` row repointed to the survivor (confirmed by direct query, zero rows left pointing at either orphan), both orphans soft-retired (`merged_into_asset_id`/`merged_at`/`merged_by` set, nothing deleted), raw `make`/`model`/`trim`/etc byte-identical on both sides (§5.8 held), A2 reads correctly against the merged history (confirmed by code trace: `ResearchRunDetail.tsx` re-derives `auction_history` flags from a live `asset_id`-scoped query, not a cache — the FK repoint alone makes it correct), no sold-comps figure moved (the merge never touches `sightings.price_usd`/`sale_confirmed`, only `asset_id`). Stage 3 made the split-prevention probe symmetric: a VIN-less capture arriving after a VIN-bearing asset already exists now attaches to it instead of creating a second asset (new `assets.vinless_identity_hash` column, migration 037, backfilled across all 165 existing assets via the real production canonicalizer). Both capture orders and the ambiguous-match abstention (two different real cars sharing one VIN-less identity) proven with synthetic, self-cleaning test rows against the real `generate_fingerprint` RPC — see `docs/SOLVED.md` topic 32. **Two review corrections from Bashir, both applied before deploy:** the `fingerprint_hash` sentinel Stage 2 used to stop a merged orphan being silently rediscovered needed a second instance for the new `vinless_identity_hash` column too (migration 038) — without it a soft-retired orphan would still attract fresh VIN-less captures back onto the dead row through the new column, the exact revival bug the first sentinel was built to prevent. **Outstanding, not blocking:** a real capture through the live Chrome extension (Stage 3 Verify #3) needs Bashir's browser and was not run this session — the synthetic proof above covers the same logic paths directly against production `generate_fingerprint`, but a real end-to-end extension capture has not yet confirmed it |
| 47 | Three separate, un-shared implementations of the sold-comps average — `ResearchRunDetail.tsx`'s `getStats`, `public-run/index.ts`'s stats block, and `researchService.ts`'s single-listing display-price helper (found Prompt 25) | These have already diverged once in production — see the fix at §4.13 above, where `public-run` silently omitted the `sale_confirmed` exclusion `getStats` applies. Deliberately not refactored into one shared module by this same prompt: `public-run` is Deno server-side, `getStats` is client-side React, and forcing a shared module across that boundary was judged a bigger change than the fix warranted. Recorded as the same category of risk as `isUnconfirmed`'s two-file duplication (debt #3) — any future change to one rule (e.g. adding the `api_import` carve-out gap noted below) must be applied to both by hand, or this diverges a second time. **Resolved 12 Sep 2026, Prompt 29 Stage 2:** `supabase/functions/_shared/soldGroup.ts` is now a single plain-`.ts` module with zero runtime-specific imports, imported literally by both `ResearchRunDetail.tsx` (React/Vite) and `public-run/index.ts` (Deno) — no more un-shared logic to diverge. A **fourth** divergent copy was found live in `public-run`'s own `stats` block (`soldListings` filtered on `current_bid_usd === null` alone, missing the `lot_state !== 'active'` check) and fixed in the same pass. Verified byte-identical arithmetic on every real run checked before and after |
| 48 | `sale_confirmed = null` means two different things depending on `logged_via`, and nothing in the UI currently distinguishes them (found Prompt 25, deferred per Bashir 10 Sep 2026) | On a `manual_entry`/`ai_vision` row, `null` is structural — no code path could ever set it, since neither entry method parses a sales-history table. On an `extension_dom_capture` row from Copart or IAAI, `null` means "unconfirmable by platform" — neither has any sales-history mechanism at all (`sale_confirmed` is written in exactly one place codebase-wide, bid.cars' own content script). On a bid.cars `extension_dom_capture` row, `null` can also mean "the sales-history table didn't parse to a confirmable status" — genuine inconclusive data. All three render identically today (excluded the same way, badged "Unconfirmed sale" the same way). Worth labelling differently eventually — e.g. "not tracked on this platform" vs. "sale status unclear" — not built now, per Bashir's explicit call when this was raised. **Resolved 12 Sep 2026, Prompt 29 Stage 2:** the three meanings are now an explicit discriminated union (`SaleConfirmation` in `soldGroup.ts`) — `no_mechanism_for_entry_method`, `platform_has_no_mechanism`, `inconclusive` — via `classifySaleConfirmation()`. The UI still renders them identically (badged "Unconfirmed sale" the same way) — that display-layer distinction Bashir deferred is still not built, only the underlying ambiguity is now named rather than inferred ad hoc |
| 49 | `getStats`'s `manual_entry`/`ai_vision` carve-out doesn't cover `api_import` (found Prompt 25, theoretical — not a live discrepancy) | `logged_via_enum` has a fourth value, `api_import`, that would structurally have the same "no sales-history mechanism, `null` is not ambiguity" property as `manual_entry`/`ai_vision` — but it's excluded from the carve-out in both `getStats` and this prompt's `public-run` mirror of it. Nothing in the codebase currently produces `api_import` rows (confirmed by grep), so this doesn't affect any real data today. Extend the carve-out to include it if `api_import` is ever wired up as a real ingestion path. **Resolved 12 Sep 2026, Prompt 29 Stage 2:** `soldGroup.ts`'s `ENTRY_METHODS_WITHOUT_MECHANISM` now includes `api_import` alongside `manual_entry`/`ai_vision`, applied identically wherever the shared module is used. Still 0 live `api_import` rows (reconfirmed) — this closes the gap structurally rather than waiting for it to become live |
| 50 | A third independent implementation of "the sold group" exists in `ResearchRunDetail.tsx` (found 11 Sep 2026, fixing the `current_bid_usd` mapping bug at §4.15) | `ResearchRunDetail.tsx:659-660`'s checklist WARNs (`limited_sample`, `different_model`, `population_mismatch`, `unconfirmed_sale`) compute their own `soldList` from `lot_state === 'finished'` alone — separate from `displayGroups`' sold/active split (also in this file, the one §4.15 fixed) and separate again from `public-run`'s own version (Prompt 25/debt #47). None of the three currently disagree in a way that's been observed live, and this one is correct on its own terms, but three divergent implementations of the same concept in one codebase is exactly the risk that materialised once already (debt #47) - worth consolidating if a fourth divergence is ever found, not before. **Resolved 12 Sep 2026, Prompt 29 Stage 2:** this checklist's `soldList` now calls the same shared `isInSoldPopulation()` as everything else — see debt #47's resolution note; the fourth divergence that triggered consolidation was found in `public-run`, not here, but the fix covers this file too |
| 51 | No universal vehicle database — trim/spec matching stays pattern-based (found/deferred 11 Sep 2026, Prompt 27) | The Mercedes class-letter fix (`trimMatches`, §4.16/2B) is deliberately narrow: a prefix-stripping pattern derived from the brief's own model, not a real vehicle taxonomy. A general solution — resolving "350" ≡ "E350" ≡ "E-Class 350" (or equivalent naming quirks for any manufacturer, not just German class-letter conventions) — needs an actual make/model/trim/generation reference database, which is a large, separate build (`SCHEMA.md` §4's E2 standardisation resolver anticipates something like this). Explicitly out of scope for Prompt 27; the class-letter pattern closes the real, reported gap without it |
| 52 | Spec-match rules (all nine) and A2's hard block never evaluate against `sold_comps`-type runs (found 11 Sep 2026, Prompt 27 — genuinely ambiguous, not a bug) | `ResearchRunDetail.tsx:401`'s `if (isActiveListings \|\| isMixed)` gate wraps every spec rule and A2's prior-auction-history BLOCK in one unbroken block (lines 401-618) — a `sold_comps` run's listings are never checked against the brief's spec, or against prior-auction history, at all. Consistent with `PROJECT_CHARTER.md` §5.6 ("risk and spec rules apply to active listings and only here") and already disclosed in the run's own UI ("Spec matching applies to active-listings runs only"). This is why Ahmed Ibrahim's 2012 Accords in a 2013-2016 sold-comps run were never flagged — correct per the current design, not a plumbing bug. **Resolved 11 Sep 2026, Prompt 28 Stage 1 (§4.17): disclose, never exclude, never badge as a defect** — an INFO label and a composition line, staff and client side, never a spec flag. The `isActiveListings \|\| isMixed` gate and A2's hard block are unchanged |
| 53 | A second, independent NGN-guessing instruction exists in `geminiService.ts`'s `standardizeVehicleString`, called live from `CarForm.tsx` (found 12 Sep 2026, Prompt 29 Stage 5, not fixed — out of scope) | Its own prompt instructs: `"Detect currency code (default to NGN if ambiguous but looks like Naira)."` — the same class of guess-dressed-as-a-default that debt #44 named for `extract-vehicle-vision`, in a separate function this prompt's own scope did not name. Falsifies the assumption that `extract-vehicle-vision` was "the last guesser" in the system. Left unfixed deliberately, per this same discipline of not making unscoped adjacent changes (`AGENTS.md` §5) — fix the same way debt #44 was fixed (null/`"NOT_VISIBLE"` abstention, no default) when a prompt actually scopes this function. **Bashir, 12 Sep 2026: fold this into the next prompt rather than let it sit** — it's the exact same fix already made twice (debts #44, #45), small in scope, and "documented" is not the same as "fixed" for a guesser that's live in production via `CarForm.tsx` today. **Resolved 12 Sep 2026, Prompt 30 Stage 3:** the "default to NGN if ambiguous" instruction removed, `"NOT_VISIBLE"` added to the Gemini structured-output schema's currency enum (the enum itself blocks the model from emitting any value outside it, so the sentinel had to be added there, not just described in prose), and `CarForm.tsx`'s `if (result.currency) setCurrency(...)` fixed so an abstention explicitly clears the field (state widened to `Currency | ''`) instead of silently leaving the prior NGN-defaulted value standing, with a submit-time validation block when a price is set but currency isn't. Verified live against the real Gemini API: an ambiguous bare price returns `"NOT_VISIBLE"`, an explicit one still returns the right code. The follow-up grep-for-a-third this same stage required found a genuine third guesser — see debt #56 |
| 55 | `research-capture:308`'s `rawPayloadToSave = { ...payload }` envelope-spread is the root cause of the `raw_payload` reader bugs Stage 3 fixed one at a time (found 12 Sep 2026, Prompt 29 Stage 3, flagged by Bashir 12 Sep 2026 — not fixed) | Four fields now (`current_bid_usd` plus the three fixed in Stage 3) have hit the same bug: a reader reaches for `raw_payload.<field>`, but the real value lives nested under `raw_payload.captured_fields.<field>` because the write path spreads the whole request envelope rather than just `captured_fields`. Stage 3 fixed the four known readers (see `docs/SOLVED.md` §27's audit method) but did not touch the writer — the actual defect. Fixing readers one at a time works only until the next field is added and someone reaches for the top level again, reproducing the exact same bug a fifth time. **The structural fix is on the write side**: either normalise what `research-capture` writes to `raw_payload` (spread `captured_fields` only, matching `app-ingest`'s already-correct flat-spread shape), or stop treating `raw_payload` as a read source at all for any field that has a real column — read exclusively from real columns and treat `raw_payload` as archive-only, per §5.8's "raw at capture, classify at read" doctrine taken to its logical conclusion. Not built here — Stage 3's own scope was "audit and fix every mismatch," not "redesign the write path". **Resolved 12 Sep 2026, Prompt 30 Stage 1:** `research-capture/index.ts:308` now writes the flat shape (spreads `captured_fields` directly onto `raw_payload`'s top level, matching `app-ingest`'s convention exactly) — one canonical shape system-wide. The 176 historical rows under the old nested shape are untouched; `supabase/functions/_shared/rawPayload.ts`'s `readRawPayloadField`/`requireRawPayloadField` handle both shapes transparently and throw loudly (proven with synthetic input) rather than silently returning null for a genuinely absent field — the actual guardrail against a fifth reader bug. See `SCHEMA.md` §16 |
| 54 | The null vs. `"NOT_VISIBLE"` abstention distinction is not reliably followed by the model in practice (found 12 Sep 2026, Prompt 29 Stage 5, verification finding) | Tested `extract-vehicle-vision`'s fixed prompt against a synthetic image with a trim string present but heavily blurred (i.e. "present but unreadable" — the textbook `"NOT_VISIBLE"` case). The model returned `null` (its "genuinely absent" outcome) instead. The primary fix this debt's testing was built to prove — no guessed currency default (verified: correctly returned `"NOT_VISIBLE"` for an ambiguous bare-number price) — held. The finer null-vs-unreadable distinction did not, for this field, in this one test. Not chased further: `BulkImport.tsx`'s full human-review step is the actual backstop for both cases, and `extract-cost-document`'s two-pass reconciliation (built for exactly this class of model unreliability — see debt #45 and that function's own code comments) was considered and deliberately not added to `extract-vehicle-vision` for cost/latency reasons given that backstop already exists |
| 56 | `daily-sniper/index.ts` is a third NGN-guesser, and worse: it writes directly to the deprecated `sales` table with a hardcoded secret and no human review (found 12 Sep 2026, Prompt 30 Stage 3 grep audit, not fixed) | Carries the exact same `"For 'originalCurrency', strictly use one of: 'NGN', 'USD', 'EUR', 'GBP'. Default to 'NGN' if ambiguous."` line `extract-vehicle-vision` had before debt #44's fix — a near-verbatim copy of that function's original prompt. Falsifies "the last guesser" a second time (first falsified by debt #53) — the claim is only safe after a complete grep, which is what actually found this one. Deliberately NOT fixed here, unlike debts #44/#53, because patching only the currency line would be incomplete to the point of misleading: (1) `SCHEMA.md` §11 documents `sales` as **DEPRECATED, RLS-locked, do not read or write it** — this function inserts into it anyway, successfully, because it uses the service-role key to bypass RLS; nothing else in the codebase writes to `sales` any more, confirmed by grep. (2) Auth was a literal hardcoded secret string in source (redacted here per Prompt 31 Stage 2's "no secret values in any output, commit, or document" — see debt #56's own resolution note below), not an env-var secret like every other capture/extraction function in this codebase uses. (3) It inserts straight into the database with **no human review step at all** — unlike `BulkImport.tsx`/`CarForm.tsx`, an abstained `"NOT_VISIBLE"` currency landing here would sit permanently in a dead table as an unhandled sentinel string with nobody ever looking at it, which is arguably worse than the wrong-guess status quo, not better. No caller of this function exists anywhere in this repo — it's invoked externally (the secret's name suggests a phone-based Shortcuts automation), consistent with `PLAN_TRACKER.md` debt #45's framing of "Daily Sniper (Phase F)" as still not properly built. Needs its own dedicated look — likely: retire it, or rebuild it against `sightings`/`assets` with a real auth pattern and an actual review step — not a one-line prompt patch. **Resolved 12 Sep 2026, Prompt 31 Stage 2** (treated as security work, ahead of feature work, per the master prompt's own framing): auth moved to `Deno.env.get("SNIPER_SECRET")`, matching every other secret-header function's pattern; the `sales` insert and the service-role Supabase client removed entirely (confirmed by grep: nothing ever read those writes); the currency default-on-ambiguity replaced with `NOT_VISIBLE` abstention, fixed at all three sites that previously coerced it to NGN; the function now extracts-and-returns only, no auto-persistence, since no review UI exists for it. Confirmed genuinely live (deployed, `ACTIVE`, 9 prior versions) with no caller anywhere in this repo — not dead code, not deleted. **Outstanding, owned by Bashir, not closeable by a coding session:** the old secret has been in git history since commit `ccac489` (21 Jun 2026) and was never rotated before this fix — Bashir chose to rotate to a new value rather than reuse the old one now that it's off a hardcoded literal, and must set `SNIPER_SECRET` in the Supabase project's Edge Function secrets himself (a value only he should ever type) and update the Shortcuts automation's `x-sniper-secret` header to match. Until he does, every real call to this function 401s — an accepted, deliberate outage window, not a bug. **Closed by removal, 12 Sep 2026, Prompt 32 Stage 1:** `daily-sniper` itself is retired — source deleted, undeployed, `config.toml` entry removed (see `docs/SOLVED.md` topic 31). This is a stronger outcome than the remediation above: the risk this debt described no longer exists anywhere for anyone to trigger, rather than existing-but-mitigated |
| 57 | `geminiService.ts`'s `normalizeHistoricalData` defaults an unknown trim to `'Base'` (found 12 Sep 2026, Prompt 30 Stage 3 grep audit, registered not fixed) | `"If a trim is unknown, use 'Base', but never put a trim level into the Model field."` — a default-on-ambiguity instruction, but for a non-monetary field (trim), not a price-corrupting one like the three currency guessers above (debts #44/#53/#56). Consistent with an existing, already-accepted convention elsewhere in the codebase (`BulkImport.tsx`'s own `trimRaw || 'Base'`) — a genuinely lower-stakes default than a guessed currency, since a wrong trim doesn't silently mis-price a vehicle the way a wrong currency does. Registered per Stage 3's "produce the list" requirement, not fixed - a different class of risk than the currency defaults this stage's own scope targeted. **Resolved 12 Sep 2026, Prompt 31 Stage 4:** the default removed - the prompt now instructs `null` when a trim is genuinely unstated, never a guessed `'Base'`, on the reasoning that "trim not stated" and "confirmed base trim" are different facts. Low-risk fix: `normalizeHistoricalData` is called only from `handleDataDetox` (`App.tsx:285`), which is itself disabled (debt #4 - "alert('Data Detox is disabled...')", never actually invokes the function) - genuinely dead code today, so this closes cleanly with nothing live to verify against, and is ready correct if Data Detox is ever re-enabled |
| 58 | Two independently-maintained title-status classifiers exist and disagree on a real, documented value (found 12 Sep 2026, Prompt 30 Stage 4 normalizer audit, not fixed) | `bidHeadroomService.ts`'s `classifyTitleStatus` (binary `clean`\|`non_clean`\|`unknown`, deliberately conservative — `CLEAN_INDICATORS = /\bclean title\b\|\bclear\b/i`, abstains to `unknown` rather than guess, used only to pick the right `auction_fee_brackets` row) and `ResearchRunDetail.tsx`'s inline spec-match title logic (lines ~498-517, a 4-way clean/salvage/rebuilt/junk classifier with its own broader synonym list, including `'certificate of title'` as clean-equivalent, used to flag a brief's `titles_accepted` preference) are two separate, hand-written classifications of the same underlying fact from the same messy `title_type` text (`SCHEMA.md` §5's real observed values). **Confirmed disagreement**: `"Certificate of title (WV)"` — a real, documented live value — matches ResearchRunDetail's `'certificate of title'` token as clean-equivalent, but matches neither of `classifyTitleStatus`'s regexes, so `bidHeadroomService` would abstain (`unknown`) on the exact same listing. Not necessarily a bug in either direction — the two serve different purposes with deliberately different risk tolerances (a fee lookup that must never guess vs. a spec-match preference where a permissive match avoids a false alarm) — but a real divergence risk of the same shape Prompt 29 Stage 2 already found and fixed once for the sold-group definition. Not fixed here: unifying these needs a deliberate design decision about which tolerance wins where, not a quick patch, and this stage's own scope is the map, not the fix. **Resolved 12 Sep 2026, Prompt 31 Stage 3** (this row itself was missed at the time — found stale during Prompt 33 Stage 5's document refresh, itself an instance of the doc-drift this file warns about): unified into one classifier in `_shared/specVocabulary.ts` taking the severe reading (a bare "Certificate of Title" no longer counts as clean-equivalent). `bidHeadroomService.ts`'s binary contract preserved via a wrapper, verified byte-identical against all 88 real `title_type` values; `ResearchRunDetail.tsx`'s spec rule 5 now surfaces an unclassifiable title as its own "needs manual review" message rather than silently picking a side |
| 59 | `daily-sniper`'s auth secret rotation is outstanding — owned by Bashir, not closeable by a coding session (found 12 Sep 2026, Prompt 31 Stage 2) | The hardcoded secret (in git history since `ccac489`, 21 Jun 2026) was moved to `Deno.env.get("SNIPER_SECRET")` (see debt #56), but the env var itself does not exist in the Supabase project yet — Bashir chose to deploy the code first and set the value himself right after, rotating to a new value rather than reusing the exposed one. **This debt closes only when Bashir confirms `SNIPER_SECRET` is set in the Supabase project's Edge Function secrets and the Shortcuts automation's `x-sniper-secret` header has been updated to match.** Until then, every real call to `daily-sniper` returns 401 — an accepted, deliberate gap, not a bug to fix in code. **Resolved 12 Sep 2026 — Bashir confirmed both done:** `SNIPER_SECRET` set in the Supabase project (confirmed present via `supabase secrets list`, digest only, value never seen by this session) and the Shortcuts automation's header updated to match. The old hardcoded value remains in git history permanently (rewriting history was never proposed or requested) but is now inert — a new secret superseded it, and the code path that once compared against the literal no longer exists. **Closed by removal, 12 Sep 2026, Prompt 32 Stage 1:** `daily-sniper` itself is retired — the rotated `SNIPER_SECRET` this debt tracked is now dead (Bashir may unset it whenever he likes; this session did not touch it), and the header-matching concern this debt existed to track no longer applies to anything |
| 60 | The final winning bid is not recorded anywhere (found 20 Sep 2026, Prompt 35 Stage 1) | `won_vehicles.won_snapshot` freezes the *approved* price (`display_price`, `is_bid`), which is what the client approved, not what the lot hammered at. The bought-car view therefore prices auction fees "at the approved price" and says so; it cannot claim exactness. Fix: a staff-entered `winning_bid_usd` on `won_vehicles` (with who/when), consumed by the same `getAuctionFeeComponent`. Not built — out of Prompt 35's scope |
| 61 | A bid.cars capture can carry `source_auction_platform = 'copart'` for an IAA lot (found 20 Sep 2026) | One real sighting — the Yaris — has `source_auction_platform: copart` with `location: "IAA Dallas/Ft Worth (TX)"`. All other 148 labelled bid.cars sightings have neither format. Pricing it under Copart's schedule would be a confident wrong number, so `getAuctionFeeComponent` now abstains when the location names an IAA yard. Root cause (the capture defaulting the platform label) not investigated — extension-side |
| 62 | Clean-title / unsecured Copart bid-fee rows do not exist in `auction_fee_brackets` (found 20 Sep 2026) | Only `non_clean`/unsecured and `clean`/secured bid-fee rows exist. `getAuctionFeeComponent` returned `available` with the bid fee silently left out (e.g. $640 for a clean-title $1,700 lot). Now flagged: `CostComponent.partialReason` is set, the view shows PARTIAL, and a partial component blocks any landed total. Whether Copart charges no bid fee in that tier or the rows were never entered is unresolved — an invoice would settle it |
| 63 | Eight inline copies of the brief-reference string (`year-year Make Model` with `Any` fallbacks) (found 20 Sep 2026) | `ClientsList.tsx` ×3, `ResearchRuns.tsx` ×2, `ResearchRunDetail.tsx`, `researchService.ts:250`, plus the new shared `briefReference()`. Only `ResearchRuns.tsx`'s run card was switched to the shared one. Same divergent-definition shape as debts #3/#58 |
| 64 | `mercedes` is a real make name in traded data that is not an alias for `MERCEDES-BENZ` (found 20 Sep 2026) | Tier 1 keys on exact/alias match, so those rows do not count toward Mercedes-Benz (it still reaches tier 1 through other rows). Also unmatched: `avatr` (not in the vocabulary, by design free text), `i` (junk brief text), `range rover` (a Land Rover model). Alias additions are Bashir's call — added by a human who looked, never inferred |
| 65 | The make tier-2 list is 317 of 406 makes; the year probe cannot narrow it (found 20 Sep 2026) | See §4.22 Stage 3. Options for Bashir: rank tier 2 by model breadth (a column for the model count), hide specific makes with the existing flag, or leave it — every make stays searchable either way |

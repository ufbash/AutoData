# BUILD_LOG.md — chronological build record

**Status:** Append-only history. Never edit a past entry's substance — if something recorded
here turns out to be wrong, add a correction note under it, the same way `DECISIONS.md`
handles supersession. Status of *current* work lives in `PLAN_TRACKER.md`, not here; this
file answers "what shipped, when, and in what commit," not "what state is it in today."
**Generated:** 9 September 2026, from `git log` (full history, `--reverse`, real commit
dates) cross-referenced against the detailed evidence already recorded in `PLAN_TRACKER.md`,
`DECISIONS.md`, and `docs/SOLVED.md`. Every date and commit hash below is quoted directly
from `git log`; every claim about *what* a commit did is drawn from that commit's message
plus, where one exists, the corresponding `PLAN_TRACKER.md` entry — not from memory or
inference.
**Companions:** `PLAN_TRACKER.md` (current status) · `DECISIONS.md` (why) · `docs/SOLVED.md`
(how specific mechanisms work) · `MASTER_PLAN.md` (the roadmap this log fulfils)

> **A caution on the earliest entries:** commits before 4 September 2026 predate the
> `PLAN_TRACKER.md`/`AGENTS.md`/`SCHEMA.md` document set entirely — there is no contemporary
> written record of what verification, if any, happened at the time, only the commit message
> itself. Where this log says only "per commit message," that is the honest limit of what can
> be reconstructed — it is not a claim that nothing else happened, only that nothing else is
> recorded anywhere this document can check. From 4 September onward, most builds have a
> corresponding `PLAN_TRACKER.md` entry with real browser/database evidence, and this log
> cites it rather than repeating it in full.

---

## Pre-history — before the current document set existed

Reconstructed from `git log` alone; no `PLAN_TRACKER.md`/`DECISIONS.md` entries exist for
this era to cross-check against.

| Date | Commit | What shipped (per commit message) |
|---|---|---|
| 2026-01-04 | `ddf7a0f` | Initial commit |
| 2026-01-04 | `a84a9cd` | Project initialised as "AutoTrend Tracker" |
| 2026-01-04 | `db2cbed` | Sales import and merge functionality |
| 2026-01-04 | `28c17ca` | Renamed to AutoData; branding update |
| 2026-01-05 | `d8834f2` | Vehicle price stored and displayed in USD |
| 2026-01-06 | `c69fae4` | README updated with application details |
| 2026-01-20 | `1975c24` | Refactor to `src/` layout; local file-system saving added |
| 2026-01-20 | `390e787` | "Data Integrity Refactor & UX Improvements" |
| 2026-06-21 | `ccac489` | AI bulk import completed; UI updates |
| 2026-06-22 | `1e0b045` | Repoint to the unified ledger; verification pass |
| 2026-07-30 | `eee3e87` | S2b: the public share page |
| 2026-07-31 | `e0e4a44` | "Master build b" — run typing (`run_type`) and market-research run shape |
| 2026-07-31 | `17093da` | Hotfix: removed a dead auto-migration; fixed a conditional hook |
| 2026-08-01 | `5cc077d` | A1: currency conversion, `CarForm` USD fix, superadmin gate |
| 2026-08-03 | `8831d2e` | A3: automated monthly backup, verified end-to-end (this is the pattern later reused for alerts and confirmation emails) |
| 2026-08-03 | `a5d6499` | C1 image pipeline: server-side Copart fetch, extension-side bid.cars upload; Copart readiness guard; `lot_state`; eligibility rules |
| 2026-08-03 | `4904725` | Superadmin dashboard restrictions; Open Graph link previews |

**5 August 2026 (Antigravity era, not separately committed at the time):** per
`PLAN_TRACKER.md`'s own account, the client-brief spec-match rules (migration 022) were built
and tested against an active-listings run, test cases (a)-(g) verified. Migration 023
(soft-delete columns) was applied to production the same day. **Neither was committed to git
until 4 September** — this is one of the two named incidents (`HANDOFF.md`, `AGENTS.md`) that
motivated building the current document set: "Migration 023 was applied and never recorded,
and Q1 was built by untracked codemods and marked NOT STARTED for a month."

---

## 4 September 2026 — the tooling switch, retroactive commits, and A2

The day Claude Code replaced Antigravity as the implementation tool (`AGENTS.md` §0), and the
day the backlog of uncommitted/undocumented work from 5 August was found and reconciled.
Commits, in order:

- **`2961e78`** — **A2: prior-auction-history hard block and odometer-rollback critical.**
  The highest-priority item in Phase A. Any row in `auction_history` predating the current
  sighting hard-blocks a vehicle from client-facing active-listings/mixed runs; a genuine
  odometer decrease between appearances is a separate critical signal. Verified against a
  real asset (2021 Tesla Model 3, `1ea4d7f1-51e1-4889-888b-101578f8a7bf`) with a real
  two-appearance history. Full evidence: `PLAN_TRACKER.md` §2.A2.
- **`a5f67cd`** — Client edit UI added; sold-comps brief note; `DECISIONS.md` 8.5 (every run
  requires a client) locked.
- **`03bf878`** — `docs/REPO_MAP.md` (read-only code inventory) and
  `docs/BRIEF_WRITE_PATH.md` (client-brief write-path diagnostic) added.
- **`4b77c8c`** — Corrected the migration-023 gap, Q1/Q2/A2 status, the spec-rule count, and
  browser-capability claims — the first real reconciliation pass, predating this log by five
  days and using the same method this file's own header describes.
- **`8469826`** — Deleted duplicate doc snapshots and applied scratch scripts;
  `supabase/.temp` gitignored.
- **`612e1e8`** — Committed the pending app changes, migrations 019-022, and the project docs
  that had been sitting uncommitted since 5 August.
- **`59c327e`** — `AGENTS.md`, `SCHEMA.md`, `PLAN_TRACKER.md` created — the document set this
  log is now part of. Migration-023 gap corrected.
- **`b27f9ae`** — Migration 023 (soft-delete columns for `clients`/`client_briefs`) itself
  committed — applied to production a month earlier, only now recorded.

**Outcome:** Q1 (client-brief form fields) confirmed **DONE** via a real browser round-trip
(create → save → hard-refresh → reopen in edit mode, every value returned exactly as
entered); Q3 (runs-list audit) done via `docs/REPO_MAP.md`. See `PLAN_TRACKER.md` §1.1/§1.3.

---

## 5 September 2026 — bid.cars capture fix, B2 retirement, P1 restructure

- **`2fbcd7f`** — `docs/SOLVED.md` created as the project's mechanism runbook; documents the
  bid.cars capture fix and its coverage limits (below).
- **`eec08c6`** — **Fixed bid.cars active-lot capture**: active lots were capturing zero
  images and no auction date (archived lots were already correct). Root cause was timing (the
  gallery lazy-loads after the popup's capture button fires) plus a missing extraction (no
  code read the live countdown element). Fixed via an inline-`<script>` URL scan
  (timing-independent) and a `#time-left`/`data-initial-total-seconds` read for `sale_date`.
  Also flipped the image-domain dedup preference from `images.bid.cars` (fails CORS from page
  context) to `pluto.bid.car` (works). Full mechanism: `docs/SOLVED.md` topics 1 and 4.
- **`63372f2`** — **B2 (Copart Sales History) retired as not buildable.** Live DOM recon on a
  real Copart lot found no sales-history panel of any kind. Every Copart sighting therefore
  carries `sale_confirmed = null` **permanently**, by the source's own data model — restated
  in `SCHEMA.md` §7 and `PLAN_TRACKER.md` B2. `docs/REPO_MAP.md`'s feature count corrected in
  the same commit.
- **`dff16db`** — **P1: client-hub restructure.** The client page becomes the hub (details,
  briefs, their runs); the all-runs page stays as a cross-client index; `ResearchRunDetail`
  itself is untouched (`git diff` confirmed zero lines changed). Every client-less run
  repointed to a new placeholder "Internal / Market Research" client. Client now required on
  run creation. Full evidence: `PLAN_TRACKER.md` §3.1.
- **`da6c101`** — Bidirectional navigation added: brief↔runs, run↔client/brief.

---

## 6 September 2026 — intake pipeline, A1b, A3, spec-match fixes, deposit-gate correction

The single busiest day in the log — the client intake form (Prompts 15-18) plus several
independent fixes landed the same day.

- **`995d3a9`** — Fixed a duplicate-key error on re-capturing a lot already in a run
  (`research_run_listings_run_id_sighting_id_key`) — check-first instead of blind insert.
  `docs/SOLVED.md` topic 10; `AGENTS.md` §4.13.
- **`af7e7d8`** — **A3: extension run-picker.** Replaced the typed run UUID with a new
  `list-active-runs` Edge Function feeding a card-based picker, plus a session model
  (`chrome.storage.local`, 10-minute idle expiry) so a multi-lot capture session doesn't
  re-prompt per lot. `docs/SOLVED.md` topic 11; `AGENTS.md` §4.14.
- **`e3f64cf`** — **A1b: sold-comps population-coherence warn.** WARNs (never blocks) when a
  sold-comps average mixes a US-auction source with a non-auction source (dealer, manual
  entry). Distinct axis from A1. `PLAN_TRACKER.md` §2.A1b.
- **`cd494e6`** — Documented the `research_run_listings` duplicate-key bug and the extension
  session model in `docs/SOLVED.md` (topics 10-11).
- **`0f7bc3c`** — Unknown `source_platform` now reported even when the population-mismatch
  warn itself doesn't fire — closes a silent-drop gap for an all-unknown-source run.
- **`569c2df`** — Intake-form schema (migration 024: all the Google-Form-parity fields on
  `client_briefs`, plus `status`/`submitted_at`/`confirmation_sent_at`) and the deposit gate
  on run creation (`clients.deposit_received_at`, migration 024 — **later corrected**, see
  `677475a` below).
- **`41bdf6d`** — **Client intake form v1**: `share_token`/`share_enabled` on `client_briefs`
  (migration 025), the `intake-brief` Edge Function (strict allow-list both directions), the
  tokenized `/intake/:token` form, and staff review gating spec-match (`pending_review` briefs
  drive zero flags). `PLAN_TRACKER.md` §4.2.
- **`b5abfc3`** — **Fixed two real spec-match false-flag bugs**: a negative preference
  (`"Any, except White"`) flagging every listing forever, and a `Gas`/`petrol` vocabulary
  mismatch flagging genuine matches. New `src/utils/specVocabulary.ts`. `docs/SOLVED.md`
  topic 12.
- **`9b80860`** — Post-submission account offer (Google-only, migration 026's
  `link_new_auth_user_to_client` trigger, email/phone match, single-match guard) added to the
  intake success screen; confirmation email reformatted.
- **`47717fa`** — Confirmation-email delivery status (sent/not-sent, with reason) surfaced to
  staff on the brief detail view — closes the "silent send failure" gap. `docs/SOLVED.md`
  topic 13.
- **`a7a8d74`** — Direct intake-link generation from the client page; "new research run" from
  a brief; widened intake-form parity.
- **`677475a`** — **Moved the deposit gate from `clients` to `client_briefs`** (migration
  027). The original client-level gate (migration 024) was a modelling error: one commitment
  fee buys the right to research one vehicle, not every future vehicle for that client — a
  second, unrelated car's run was starting free once the first was marked paid.
  `docs/SOLVED.md` topic 14; `DECISIONS.md` §2.7.
- **`2b70be2`** — **Prompt 18 Stage 2**: intake-link lifecycle re-architected
  (`share_enabled` now means "open for editing," not "resolves at all"; approval auto-revokes
  editing but keeps the token read-only-resolving; a stale client tab's POST against an
  approved brief is rejected server-side, `409`), plus exact form parity (closed dropdowns/
  multi-selects replacing several free-text fields, matching the live Google Form verbatim).
  `PLAN_TRACKER.md` §4.6.
- **`167f43f`** / **`cd2415e`** — Confirmation-email deliverability fixed (was landing in
  spam/Promotions) by isolating and then restoring styling — the isolation step identified
  which part of the HTML was triggering spam classification before the styled version was
  restored on top of the now-deliverable structure.

**Correction to `PLAN_TRACKER.md`'s own account:** the client approval trail (`32e7617`) and
`cost_rates` (`a35c4fe`) are dated **7 September** in git, not 6th — see below. Some
`PLAN_TRACKER.md` prose groups "Prompt 19" narratively with the 6 Sep intake work; this log
follows the actual commit dates.

---

## 7 September 2026 — client approval trail, `cost_rates`

- **`32e7617`** — **Prompt 19 Stage 1: the client approval trail.** Lives on
  `research_run_listings` (migration 028), not `research_runs` — the client approves
  individual vehicles within a shared run. `approved_via` (`client`|`staff_relayed`) is
  CHECK-constrained against `approved_by` so the two shapes can never collapse into one field.
  `approved_snapshot` captures what was actually shown (server-side, from a fresh query,
  never from the POST body) because live lots overwrite on re-capture — a bare foreign key
  would not reliably reproduce what a client saw weeks later. Enforced server-side in
  `public-run` (a second approval POST is rejected `409`, verified via curl). Full evidence:
  `PLAN_TRACKER.md` §4.7; mechanism: `docs/SOLVED.md` topic 15.
- **`a35c4fe`** — **Prompt 19 Stage 2: C1, the `cost_rates` table and admin screen.** Four
  dimensions (`cost_category`, `label`, `basis`, plus range-capable `rate_value`/
  `rate_value_max`), never edited in place (a superseded rate gets `effective_to`, the new
  value is a fresh row — verified live with a real test rate). No rates seeded at hand-off.
  `PLAN_TRACKER.md` §4.8.

---

## 8 September 2026 — trucking rates, yard matcher, auction fees, bid headroom

The landed-cost build's heaviest day — Prompts 20 and 21, both two-stage, all four stages
shipped.

- **`0f1f5fa`** — **Prompt 20 Stage 1: `trucking_rates` ledger and deterministic importer.**
  Imported 1,740 real vendor rate rows (November 2025 file, four sheets, each with a
  genuinely different column layout the importer derives from each sheet's own header row
  rather than trusting one hardcoded shape) with 143 reported (never silently dropped)
  parse failures. Two read-only views (`truckingRatesService.ts`): an internal view (every
  price, current and superseded) and an estimator view (a band across currently-effective
  rates only). Full mechanism: `docs/SOLVED.md` topic 17.
- **`d2a4814`** — **Prompt 20 Stage 2: the platform-first yard matcher**
  (`yardMatchingService.ts`). Measured baseline: 65.5% matched, 34.5% unmatched, 0%
  ambiguous across all 171 live sightings, broken down by real cause (unresolved bid.cars
  platform, manual-source listings, rate-sheet coverage gaps, malformed location strings). A
  real bug was found and fixed while proving the 0%-ambiguous figure trustworthy: the
  ambiguity check as first written could structurally never fire for any input — caught by
  testing against a synthetic true-positive case, not by inspecting real data (which cannot
  distinguish "correctly found nothing" from "incapable of finding anything"). This is the
  generalizable lesson recorded as `docs/SOLVED.md` topic 16.
- **`1641c96`** — **Prompt 21 Stage 1: auction fee research and `auction_fee_brackets`
  (migration 031).** Researched Copart/IAAI buyer-fee bracket tables from primary sources,
  cross-checked against three real Copart invoices, found a genuine mismatch on one, traced
  it to a second Copart member account (White Nexus Ltd, a one-off middleman) on a
  structurally different High-Volume Licensed schedule. Stored both schedules, keyed by
  member account. Along the way: proved Copart's Licensed-low-volume schedule is
  byte-identical to Non-Licensed (only the High-Volume tier genuinely differs), and that
  Secured/Unsecured pricing is an account-level standing classification, not a per-transaction
  choice (all three invoices priced Unsecured regardless of payment method).
  `docs/SOLVED.md` topics 18-19; `PLAN_TRACKER.md` §4.10.
- **`b9fcabd`** — **Prompt 21 Stage 2: the cost-breakdown display.**
  `bidHeadroomService.ts` (the single shared module computing auction fees, inland trucking,
  ocean freight, and duty as independently available/unavailable components, plus the
  derived headroom) and `ListingCostBreakdown.tsx`, shown collapsed-by-default on active
  listings in `ResearchRunDetail.tsx`. Verified via a `git stash` before/after comparison
  that the sold-comps average is byte-identical, and that `public-run`'s allow-list has zero
  diff across the entire two-prompt body of work — bid headroom stays internal-only.
- **`e78dda5`** — **Corrected the bid-headroom default.** Had defaulted to White Nexus's
  cheaper High-Volume schedule based on an earlier (later-retracted) instruction; corrected
  to Caplimo's own Copart account (member `Jamilu Danmusa Danmusa`, Non-Licensed) after
  Bashir identified that pricing against a discount Caplimo doesn't actually receive would
  systematically understate cost on every listing. The cost-breakdown panel now states which
  account/tier a figure was computed under, always. `PLAN_TRACKER.md` debt #42.

**Duty remains permanently unavailable** until C2 (10+ real assessment notices collected) —
so headroom itself cannot be produced for any real listing yet, by design, never smoothed
into a partial figure. `PLAN_TRACKER.md` Phase C.

---

## 9 September 2026 — pre-handover document reconciliation

- **`fb748ef`** — **Prompt 23: docs-only reconciliation.** Ground-truthed every migration,
  table, RLS policy, and Edge Function against the live database via
  `supabase db query --linked`, then corrected `SCHEMA.md` (roughly 35 real columns across
  `client_briefs`/`clients`/`research_runs`/`research_run_listings` had never been
  documented), `PROJECT_CHARTER.md` §6 (cross-platform wording marked superseded by the
  broader any-prior-auction rule), `DECISIONS.md` (the deposit-gate location, which still
  described the pre-`677475a` model; three undocumented session decisions added), and
  `PLAN_TRACKER.md`/`MASTER_PLAN.md`/`docs/REPO_MAP.md`'s stale "where we stopped"/sequence
  sections. `HANDOFF.md` rewritten in full (it was missing three of the nine companion
  documents from its own index). No application code, schema, or migration touched.
- *(uncommitted at time of writing this log)* — `AGENTS.md` (header date fixed; §4.13/§4.14
  added for the re-capture duplicate-key and stale-session traps, both previously documented
  only in `docs/SOLVED.md`), `docs/BRIEF_WRITE_PATH.md` (status note added pointing to its
  resolved question and the form's subsequent rewrite), and this file's creation.

---

## Index — where to look for more detail on any of the above

- **Full evidence tables, current status:** `PLAN_TRACKER.md`, sections referenced above.
- **The reasoning behind a decision, and its LOCKED/PROVISIONAL/OPEN status:**
  `DECISIONS.md`.
- **How a specific non-obvious mechanism actually works, traced through real code:**
  `docs/SOLVED.md`, topics referenced above.
- **What the roadmap says comes next, and why it's sequenced that way:** `MASTER_PLAN.md`.
- **Every known repeatable trap an agent should check before writing code:** `AGENTS.md` §4.

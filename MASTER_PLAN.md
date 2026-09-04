# MASTER_PLAN.md — The full build plan

**Status:** The detailed roadmap. Every phase, what it entails, why it sits where it does.
**Last revised:** 28 August 2026
**Companions:** `PLAN_TRACKER.md` (one-line status) · `ARCHITECTURE.md` (as built) ·
`DECISIONS.md` (why) · `SCHEMA.md` (data truth) · `AGENTS.md` (agent rules)

> **How this differs from `PLAN_TRACKER.md`:** the tracker answers *what state is this in?*
> in one line. This document answers *what does this actually involve, what does it depend
> on, and what does done look like?* — in enough detail to write a build prompt from.
>
> When an item completes, update its status in `PLAN_TRACKER.md`, not here. When the *plan*
> changes — scope, sequence, approach — update here.

---

## PART I — WHAT HAS BEEN BUILT

Everything in this part is live in production and verified. Retained in detail because a
new architect needs to know what already exists before proposing anything.

### 1. Capture layer — complete

A Chrome extension (Manifest V3, unpacked) reading Copart and bid.cars DOM inside the
user's authenticated browser session. Deliberately not a scraper: it defeats Cloudflare by
being a genuine user.

**Delivered:**
- ~30 structured fields per vehicle (full list in `ARCHITECTURE.md` §2)
- VIN fingerprint dedup (SHA256) with cross-source COALESCE enrichment — the same VIN on
  two platforms becomes one enriched asset with two sightings
- Non-VIN fallback fingerprint (make/model/year/trim/colour formula)
- `lot_state` detection on both platforms
- Copart page-readiness guard, preventing capture of a half-rendered Angular page
- bid.cars finished-lot capture (final sale price)
- Sales History capture → `auction_history` (bid.cars only)
- Dedup rule: live lots overwrite on re-capture; finished lots accumulate immutably
- Superadmin-only deletion with cascading orphan-asset cleanup

**Image pipeline:** Copart images fetched server-side into a private Supabase Storage
bucket. bid.cars images uploaded **extension-side**, because Cloudflare Bot Management
blocks all server-side fetching of `pluto.bid.car` (verified 403 with full browser headers).
The extension fetches bytes in page context and POSTs them. **This pattern generalises to
any future source that blocks servers** — assume it will be needed again.

### 2. Data spine — complete

Supabase as single source of truth. `assets` (physical vehicles) / `sightings`
(observations) / `auction_history` (past appearances) / `research_runs` +
`research_run_listings` (deliverables) / `clients` + `client_briefs` /
`organizations` + `memberships`. Migrations 001→023 (023_soft_delete_clients_briefs was
applied to production 5 Aug 2026 under Antigravity but not committed to git until this
session, retroactively, as commit b27f9ae). Full detail in `SCHEMA.md`.

Multi-tenancy, RLS, org scoping and role structure built from day one — so a second
licensee is a new organization row, not a refactor.

### 3. Client deliverables — complete and live

The original problem: two hand-built Excel sheets per client. Both solved as tokenized
mobile-friendly web pages.

- Research runs: create, list, detail, curate (include/exclude), drag-and-drop ordering,
  share-token generation and rotation
- `run_type` (`sold_comps` / `active_listings` / `mixed`) drives display and averaging
- Attach-time eligibility enforced in two layers (modal filter + service validation),
  keyed on lot state
- Public delivery via the `public-run` Edge Function with a strict field allow-list —
  never a public RLS policy on a ledger table
- Mobile-first `PublicRunView`, snapshot-dated, shared `VehicleDetailModal` with internal
  fields hidden, static Open Graph meta for link previews

### 4. Guardrails — complete

Three-tier pre-share checklist (hard block / critical-red / warn-yellow). Full rule list in
`ARCHITECTURE.md` §5, reasoning in `DECISIONS.md` 4.9.

- **A1 source-aware sale verification** — the fix for the Yaris problem (a 2010 Yaris ran
  16 times in two months and never sold, yet the page displayed "Final bid $1,100"). Sold
  comps built naively on that field are polluted with rejected bids.
- **Critical damage blocks** — 20 keywords covering flood, burn, frame, rollover, VIN
  tampering, biohazard and more, matched case-insensitively as substrings because damage is
  stored as inconsistent free text, not codes
- **Typed override with audit trail** — a critical warning can be overridden only with a
  typed reason, recorded with user id and timestamp
- **Spec matching against a client brief** — stratified critical vs warn. Verified count
  (4 Sep 2026, `docs/REPO_MAP.md` §B.6): 9 individual `if` blocks in
  `ResearchRunDetail.tsx` — 5 CRITICAL (max mileage, `year_min`, `year_max`,
  `condition_required`, `titles_accepted`) and 4 WARN (colour, transmission, fuel type,
  trim). Not 7, not 8 — those were earlier miscounts.

### 5. Auction timing — complete

`sale_date` is display text, not a timestamp. A shared `parseAuctionDate()` helper returns a
real `Date` or `null` — never a fallback, because a wrong date would fire an alert at the
wrong time. `AuctionCountdown` renders on staff and public views with its own 30-second
clock, urgency colours (<48h red, ≥48h amber, <1h most urgent), and "Auction date TBC" for
unparseable values.

### 6. Operations — complete

Automated monthly backup (pg_cron → Edge Function → six CSVs → Resend, verified end-to-end
including a real scheduled run — **this is the pattern the auction alerts must reuse**).
Currency normalisation with the rate frozen at capture. Access control. Migration hygiene.

---

## PART II — IMMEDIATE QUEUE

Four items, in order. Everything here is small and unblocked.

### Q1. Finish the client-brief form fields — DONE (verified 4 Sep 2026)
All sixteen inputs are rendered by `BriefForm` in `src/components/ClientsList.tsx`. The
write path carries every field unfiltered in both directions. Verified by a real browser
round-trip (created a brief with all 16 fields populated, saved, hard-refreshed, reopened in
edit mode — every value returned exactly as entered) plus a direct database read confirming
`titles_accepted` stored as a true 3-element array, `max_budget_usd` and `max_bid_usd` stored
distinct (no swap), and an untouched `max_mileage` stored as `NULL` rather than `0`.

**Constraint (still true, still matters):** `max_budget_usd` and `max_bid_usd` are
**captured but never enforced** (`DECISIONS.md` 3.6). Auction price is not landed cost, and
the duty model is uncalibrated — an "over budget" flag would be confidently wrong, which is
worse than absent.

**Why this was believed unbuilt:** the work was applied on 5 Aug 2026 by untracked codemod
scripts and never committed or recorded, so `ClientsList.tsx` entered git history only on
4 Sep 2026 (commit 612e1e8). Same failure class as migration 023, same session.

### Q2. View / edit / soft-delete for briefs and clients — PARTIALLY BUILT, UI unverified
The columns exist: migration 023 added `client_briefs.deleted_at`, `client_briefs.deleted_by`,
and `clients.deleted_by`; `clients.deleted_at` predates it.

**Approach:** reuse the existing research-run deletion pattern — superadmin only, type the
full name to confirm, 30-day recovery (`DECISIONS.md` 9.9). Do not invent a second model.

**What exists:**
- Service layer: `researchService.ts` exports `softDeleteClientBrief`,
  `listDeletedClientBriefs`, `restoreClientBrief`, and the equivalent trio for clients.
- Edit mode: `BriefForm` handles create and edit; the edit-mode round-trip is verified
  working (confirmed 4 Sep 2026, see Q1).

**Unverified, possibly unbuilt:** the delete confirmation UI — superadmin only, type the
full name to confirm, 30-day recovery — and the two constraints below. Nobody has checked
this UI; it is not asserted missing, only unverified.

**Two constraints that must hold:**
- Deleting a brief must not break runs pointing at it. The run keeps working and keeps its
  spec history — a deleted brief is not a deleted decision record.
- Deleting a client must be blocked while they have live runs, or records orphan.

**Done looks like:** a brief can be opened and read in full, edited, and soft-deleted with
confirmation; a deleted brief's runs still function; deleting a client with live runs is
refused with a clear message.

### Q3. Audit the runs list and creation form
**Why:** this is the checkpoint that stops Q4/P1 going wrong. Read-only inventory of every
feature on the runs list and creation form **before** the restructure touches them, so
nothing convenient is quietly dropped.

**Done looks like:** a written inventory, feature by feature, including the small
conveniences that are easy to lose.

### Q4. Warn when a brief is attached to a sold-comps run
**Why:** the app currently accepts the link and silently ignores it, because spec rules are
active-listings-only by design. That silence cost an hour of false-alarm debugging on
5 August.

**Done looks like:** a visible note on the run detail page — spec matching applies to
active-listings runs only.

---

## PART III — PHASE A: DATA QUALITY

The principle: **every downstream product inherits the quality of this layer.** The
estimator, the landed-cost model and the client portal all sit on this data. Fixing quality
later means re-deriving everything built on top of it.

### A1. Source-aware sale verification — DONE
Recorded in Part I. The refinement that matters: `sale_confirmed = null` is not one
situation but three, and the original blunt "filter to `true`" rule would have wrongly
excluded every manually-entered and AI-vision comp — most of the Nigerian market data.
Full rule in `SCHEMA.md` §7.

### A1b. Source/population coherence guard
**The gap:** `logged_via` answers *"is this a real sale?"* It does not answer *"is this the
same kind of price, from the same population?"* A `manual_entry` sighting can carry a
**Nigerian dealer asking price** — neither a concluded sale nor the same market as a US
auction comp. Asking ≠ sold. NG retail ≠ US auction.

**Build:** WARN when a sold-comps average mixes materially different populations, keyed on
`source_platform`. A deeper form of the existing mixed-models rule, on a distinct axis from
A1 — which is precisely why it is a separate item and not folded into it.

**Done looks like:** a run mixing US auction sales with NG dealer listings warns before
sharing, naming the mix.

### A2. Derived asset flags — **highest priority in Phase A**
**Rule redefined (Bashir, 4 Sep 2026):** the trigger is **any prior auction appearance**,
not cross-platform reappearance specifically.

Any prior auction appearance in `auction_history` → hard block from client-facing
active-listings and mixed runs. Not gated on elapsed time, odometer movement, or which
platforms are involved.

**Reasoning:** a repaired wreck carries latent faults from the first crash; a car being
auctioned twice is itself the disqualifying signal for a client vehicle — it does not matter
whether the two appearances share a platform.

Per `DECISIONS.md` 4.8, this applies to active listings and mixed runs **only**. On a
`sold_comps` run a previously-auctioned vehicle is valid market history: it stays in the run
and still counts in the average.

**Conflict with `PROJECT_CHARTER.md` §6:** the charter's wording is framed around
cross-platform reappearance specifically. That framing is superseded by the broader rule
above, but the charter is LOCKED and amending it is Bashir's decision, not an agent's — this
is noted here, the charter itself is left unchanged.

**Build, derived from `auction_history`:**
- `appearance_count` — how many times this vehicle has been to auction
- `previously_unsold` — ran before without meeting reserve
- `highest_rejected_bid` — the highest bid that failed to meet reserve
- Prior-auction-history — any `auction_history` row for the asset predating the current
  sighting

**Removed: the "damage severity decreases between appearances" escalation clause.** It is
unbuildable — `auction_history` carries no damage field (real columns: `id`, `org_id`,
`asset_id`, `sighting_id`, `auction_platform`, `auction_date`, `lot_number`,
`bid_amount_usd`, `odometer_miles`, `status`, `seller_type`, `created_at` — see `SCHEMA.md`
§8). Odometer movement is the available proxy instead. A **decreasing** odometer between
appearances is odometer rollback — a separate critical signal in its own right, applicable
to sold comps as well, since it means the recorded sale price describes a vehicle that was
not what it claimed.

**Flag definitions** (the naive version of each is wrong — the real Tesla asset below breaks
it):

| Flag | Definition | Naive version is wrong because |
|---|---|---|
| `appearance_count` | Distinct auction events, deduped on `(auction_platform, lot_number)` | Two rows can share one lot/platform pair — one auction event that produced two rows (e.g. a bid row then a status-update row). Row count over-counts; the dedup gives the correct figure |
| `previously_unsold` | True only where `status = 'Not sold'` | `status = 'No information'` means unknown, not unsold (AGENTS.md §6, absence is not violation) |
| `highest_rejected_bid` | Max `bid_amount_usd` among rows where `status = 'Not sold'` only | A sold row can carry `bid_amount_usd = NULL`, so a `max()` across all rows can silently return a rejected bid and label it a sale price |
| Prior-auction-history | Any `auction_history` row for the asset predating the current sighting | — |

**Real example — asset `1ea4d7f1-51e1-4889-888b-101578f8a7bf`, 2021 Tesla Model 3, VIN
`5YJ3E1EA1MF874581`.** Its three `auction_history` rows:

```
IAAI    | 2023-10-17 | lot 37445007 | bid_amount_usd=10575 | odometer=51218 | status='Not sold'      | seller_type='No information'
IAAI    | 2023-10-19 | lot 37445007 | bid_amount_usd=NULL   | odometer=51218 | status='Sold'          | seller_type='No information'
Copart  | 2026-08-25 | lot 64610326 | bid_amount_usd=7500   | odometer=63017 | status='No information' | seller_type='GEICO'
```

Expected values on this asset: `appearance_count = 2` (the two IAAI rows share lot
`37445007` — one auction that ran twice), `previously_unsold = true`, `highest_rejected_bid
= 10575`, prior-auction-history = true → hard block.

**Detection coverage gap:** `auction_history` is populated from the bid.cars Sales History
panel only. A vehicle captured solely from Copart has no history rows, so this check
silently passes rather than finding nothing to block. Per the honesty doctrine
(`PROJECT_CHARTER.md` §5.1) the checklist must render this as **NOT CHECKABLE**, never as a
clean pass.

**Consequence for sequencing:** B2 (Copart Sales History) moves to immediately behind A2 in
the build sequence, promoted out of Phase B (see Part IV and Part XII). Under a warn-based
rule the coverage gap was tolerable; under a hard block it is what decides whether the rule
works at all.

**The commercial upside, which is the part most people miss:** rejected-bid history reveals
the seller's reserve and the market's repeated refusal. A car that ran three times at
$6,200 / $6,800 / $7,100 without selling tells you the floor and that the market declined
three times. That is bidding intelligence no competitor has, derived from data already
captured.

**Done looks like:** the flags computed and stored; any prior auction appearance hard-blocks
a client-facing active-listings or mixed run; the Tesla asset above is caught by the rule.

### A3. Extension run-picker
Replace the current typed UUID with a dropdown of active runs. Small quality-of-life item;
low risk, meaningful daily friction reduction.

---

## PART IV — PHASE B: SOURCE COVERAGE

### B1. IAAI content script
Same schema as existing sources; image permutation `[2,1,4,3]`. IAAI appeared in the
original Camry sheet and is the one source still missing entirely.

### B2. Copart Sales History — **promoted, now sequenced immediately behind A2**
**Why it matters more than it looks:** Copart has no Sales History capture, so **every
Copart sighting carries `sale_confirmed = null` permanently** and shows the "Unconfirmed
sale" badge forever. That is honest — we genuinely cannot confirm — but it means the A1
verification layer, which is the strongest data-quality guarantee in the system, currently
only covers bid.cars.

Building this roughly doubles the value of A1. Contingent on Copart exposing the data.

**Sequencing change:** A2's prior-auction-history rule is a hard block, and `auction_history`
is populated from bid.cars only (see A2 above). A Copart-only capture has no history rows,
so the A2 check is not checkable for it, not a clean pass. That coverage gap decides whether
A2 works at all, so B2 no longer waits its turn in Phase B — it moves to immediately behind
A2 in the sequence (Part XII).

---

## PART V — STRUCTURE AND NAVIGATION

### P1. Client-hub restructure
**The reasoning, which is the important part.** The original proposal was "move all
research-run features under the client page." That is the risky version.
`ResearchRunDetail` holds nearly everything hard-won — the checklist, critical blocks,
override reason, curation, drag ordering, share tokens, countdown, A1 filtering. Moving it
is where things break, and there is no staging environment to catch a mistake.

**It does not need moving.** What actually feels convoluted is that runs are *created and
listed* in a place disconnected from the client.

**So change only navigation and creation:**
- The **client page becomes the hub** — details, briefs, and their runs listed underneath,
  with a "New research run" button that pre-fills client and brief
- The **all-runs page stays** as a cross-client index (still needed for "show me every open
  run" without clicking through fifteen clients), read-only for creation
- Clicking a run from either place opens **the same detail page as today, unchanged**

**No router in this step** (`DECISIONS.md` 8.4). Routing arrives in Phase D, when the client
portal needs its own address anyway.

**Depends on:** Q3 (the audit) landing first.
**8.5 — decided (Bashir, 4 Sep 2026):** may a run exist without a client? **Every run
requires a client**, with a placeholder "Internal / Market Research" client for internal
work. Reasoning: an unconditional rule means no screen handles a null client, the client hub
becomes the only creation path, and the alternative leaves two shapes of run permanently.
Existing client-less runs (e.g. "Test Market") get repointed to the placeholder when P1
lands. `DECISIONS.md` itself still needs 8.5 marked LOCKED to reflect this — out of scope
for this edit, noted here only.

**Done looks like:** a run can be created from within a client page with the brief pre-
filled; the all-runs index still works; `ResearchRunDetail` is byte-for-byte unchanged in
behaviour.

---

## PART VI — ALERTS AND INTAKE

### N1. Auction alerts (24h / 1h)
**Feasibility confirmed:** `sale_date` carries full date, time *and* timezone
(`"Thu. Aug 06, 2026 03:00 PM GMT+1"`), so a 1-hour alert is genuinely possible. This was
the open question that gated the whole feature.

**Architecture:** reuse the `monthly-backup` pattern exactly — pg_cron → Edge Function →
Resend. That pipeline is already verified end-to-end in production.

**Must reuse `parseAuctionDate()`.** A second parser would drift from the first, and the two
would disagree about when an auction starts.

**Likely needs** a stored timestamp column, parsed from `sale_date` at capture or on write,
so cron can query efficiently rather than parsing inconsistent text in SQL.

**Recipients:**
- Internal (24h **and** 1h): `caplimoltd@gmail.com`, `umarfbash@gmail.com`,
  `ufbash@gmail.com`
- Client: **24h only.** The 1-hour alert is an internal "get ready to bid" ping; it means
  nothing to a client except noise, and two emails per auction is how a sender gets muted.
- The list must be an **editable setting, never hardcoded**, so Fahad and Ahmed are added
  the day the licence is signed with no rebuild (`DECISIONS.md` 1.5 / 7.4).

**Missing fields to add:** `client_email` (nowhere in the schema today) and an assignee /
bidder field on `research_runs`.

**Email contents:** which client, which vehicle, lot number, platform, auction time, and a
link to the run.

**Done looks like:** a scheduled auction fires a 24h and a 1h internal email and a single
24h client email, with correct times, verified against a real upcoming lot.

### N2. Client intake form
**What it is:** a web version of the existing Google Form, writing directly into the client
record. Not a form that emails a PDF — a form that **creates or populates a client brief**.
Building it as a standalone would mean building it twice.

**The three arrival routes, one form** (`DECISIONS.md` §6):
| Route | Flow |
|---|---|
| Direct approach | Staff create the client record → send a tokenized brief link → client completes it → lands in their record |
| Website / estimator | Stranger completes the form cold → arrives as an **enquiry** → staff review → convert to client |
| Existing account | Same form, already signed in |

**No login required to complete a brief** — same tokenized-link pattern as the share pages.

**Staff review before a brief goes live** (`DECISIONS.md` 5.4). Clients mistype budgets and
pick wrong years; a wrong spec silently driving the flags is worse than no spec.

**Fields** (from the current Google Form): full name · mobile/WhatsApp · email · preferred
contact · assigned agent · make · model · trim · year · quantity · transmission · fuel ·
max mileage · condition · title required · damage tolerance · colour · interior · max budget
· max bid · shipping insurance opt-in · preferred auction/source · pickup location ·
inspection required · inspection scope · payment method · additional notes · example images
· consent to bid · consent to share details with auction houses · confirmation

**On signatures:** a drawn signature looks official but is weak evidence alone. If the
purpose is dispute evidence, the strong version is the surrounding record — the exact form
content stored unaltered, a timestamp, the client's own email confirming, and a copy emailed
to them at submission so they hold a matching record. Add a signature for ceremony if
desired; do not rely on it.

**NDPR posture:** state plainly what the data is used for; keep it behind auth once
submitted; no pre-ticked boxes, no bundled consent.

**Depends on:** Q1 and Q2, so it writes into a complete, editable brief.

**Done looks like:** a client receives a link, completes it on their phone, and the result
appears in staff review; on approval it becomes a live brief that drives spec matching.

### N3. The approval trail
The full client journey, each step logged: intake form → research run (market comps) →
client approval → active options run → bidding. The aggregation point for everything that
follows — invoices, customs papers, receipts — under a single client master record.

---

## PART VII — PHASE C: LANDED COST

**The state of knowledge:** the duty formula is **exact and verified** — 51.47% of declared
CIF, reverse-engineered from a real Tincan assessment notice where all six components
reconcile to the kobo. What varies is the **declared CIF**, which depends on the clearing
agent. All uncertainty collapses into that one variable.

Three calibration points exist: a Camry declared at **17.4%** of official value (verified
notice with FX), an ML350 at roughly 30% and a G63 at roughly 60–65% (both agent quotes,
FX unknown). The ratio rises steeply with value — declaring a G63 at 17% would be
conspicuous in a way a Camry is not. **Three points cannot fit a curve.**

### C1. `cost_rates` table + admin screen — buildable now, not blocked
Dated rate tables with `effective_from` / `effective_to` and a `source`
(`official_tariff` | `agent_quote` | `actual_paid`), edited through an admin screen without
a deploy, so historical quotes stay explicable. Covers US inland trucking tiers, ocean
freight, and duty components. **Rates never live in code.**

### C2. Duty calculator — BLOCKED on data
The formula is ready. Blocked on collecting **10+ assessment notices** across the value
range. Standing action: photograph every assessment notice before handing it to the client.
This is calibration data currently walking out the door.

### C3. Client-facing cost display
Grouped as Vehicle · Shipping & logistics · Duties & clearing · Service fee · Total.
Shows **both** the expected case (based on observed actual declarations) and the official
ceiling. Per the honesty doctrine: show the sample size, widen the band rather than faking
precision, date the snapshot.

**Only after C1 and C2.** A confident wrong number here damages more than an absent one.

---

## PART VIII — PHASE D: CLIENT OPERATIONS

`clients` and `client_briefs` landed early as part of the brief work. Remaining:

**Data:** `client_vehicles`, `vehicle_status_events` (audited state machine), `documents`,
`invoices` — all org-scoped and audited.

**Status lifecycle:** RESEARCHED → RECOMMENDED → REQUESTED_BY_CLIENT → BID_PLACED →
WON / LOST → PAID → AT_US_PORT → ON_VESSEL → ARRIVED_DESTINATION_PORT → CUSTOMS_CLEARANCE →
READY_FOR_COLLECTION → DELIVERED (+ CANCELLED). Enum with audited transitions, extensible by
migration.

**Then:** staff dashboard build-out → client portal (Google auth, status timeline,
shareable tracking link, documents) → "Request this vehicle" loop → email notifications →
subdomain split → Chrome Web Store private publish.

**URL routing belongs here** — the portal needs its own address, which is what finally makes
the routing work worth doing.

**Gate:** staff logins require the signed AutoData↔Caplimo licence. This is a paperwork
blocker on a code phase, and it has already constrained one live feature (the alert
recipient list).

---

## PART IX — PHASE E: PUBLIC ESTIMATOR

The largest remaining build, and **lead generation for the brokerage — not a standalone
product**. A visitor searches a vehicle, sees a comps-based average and an estimated Nigeria
landed cost, and can request a quote. Every search is a demand signal.

**Sequence is binding: E1 → E2 → E3 → E4 → E5.** E4 must not precede E1–E3, because an
estimator over thin data produces visibly wrong numbers and burns the early users who matter
most.

- **E1. Harvest** — own ledger first, then bid.cars/Bidfax sold-history harvesting (the
  pragmatic core). Commercial APIs only if harvesting hours cap out. **Copart member data is
  off-limits** — ToS risk to the bidding account. *May begin early; comps compound weekly.*
- **E2. Standardisation** — NHTSA vPIC (free, keyless) for makes/models/years and VIN
  decoding; curated `trim_canonical` ladders for ~30 corridor models (~1,500 rows,
  AI-drafted, human-reviewed). This is also where damage and title standardisation finally
  happen, retiring the approximate substring matching used today.
- **E3. Stats engine** — the resolver in three deterministic-first tiers: exact/alias lookup
  → `pg_trgm` fuzzy → constrained Gemini classification among candidates → **abstain below
  confidence**. Not RAG. **AI never generates a price.**
- **E4. Public MVP** — search → average → landed cost → request quote. Freemium: first
  search free, second requires a free account. Marketing consent separate, unticked, framed
  as price alerts.
- **E5. Analytics** — search demand signals, including *what people search for and cannot
  find*, which is a market-gap detector for acquisition decisions.

---

## PART X — PHASE F: INTELLIGENCE

Deliberately last; every item needs accumulated data to be meaningful.

Daily Sniper (vision ingestion with the `NOT_VISIBLE` anti-hallucination escape hatch) ·
Market Velocity Index · decay model · arbitrage detection · origin premium spread ·
exploitation of the repair-cost dataset.

**The moat, ranked by defensibility:** repair quote history (cannot be scraped or bought) →
clearance history (official vs declared vs actual, per class, per agent) → search demand
signals → the cross-source vehicle ledger. The first three cannot be bought at any price.
Comparable auction data eventually can.

---

## PART XI — NON-CODE WORK

These are not optional, and two of them already block code.

| # | Item | Blocks |
|---|---|---|
| 1 | **Sign the AutoData↔Caplimo licence** | Phase D staff logins **and** the alert recipient list |
| 2 | **Collect 10+ assessment notices** | C2, and therefore all client-facing duty figures |
| 3 | Confirm the tiered brokerage fee (7/5/3, $500 floor) | Pricing consistency |
| 4 | Confirm the retail discount band (8–12% below best NG comp) | Retail pricing |
| 5 | Decide on a commitment fee before research runs | Protects the most expensive labour in the business |
| 6 | Decide whether a run may exist without a client | The shape of P1 |

**On #5** — raised by a competitor's process received 5 August: deposit ₦500k → preferences
→ contract → options → approval → 65% → buy → 35% on arrival. Caplimo currently performs the
full research run — capture, curation, comps, a polished client link — for free, before any
commitment. **Recommendation: a refundable commitment fee gates the research run, not
account creation.** Anyone may submit a brief; work starts when the fee lands.

---

## PART XII — SEQUENCE SUMMARY

```
NOW ──▶ Q1 brief form fields
        Q2 view/edit/soft-delete
        Q3 audit runs list          ──┐
        Q4 sold-comps brief warning   │
                                      │
NEXT ─▶ A2 derived flags ★ fraud gap  │
        B2 Copart Sales History ◀──────── (promoted; A2's hard block needs its coverage)
        A1b population coherence      │
        A3 extension run-picker       │
                                      │
THEN ─▶ P1 client-hub restructure ◀───┘ (depends on Q3)
        N1 auction alerts
        N2 client intake form ◀──────── (depends on Q1, Q2)
        N3 approval trail

        C1 cost_rates (unblocked now)
        B1 IAAI
        C2 duty calculator ◀─────────── (blocked: 10+ notices)
        C3 cost display

        Phase D client operations ◀──── (blocked: licence)
        Phase E estimator E1→E5
        Phase F intelligence
```

★ **A2 is the item to do first among the non-blocking work.** A fraud pattern reaching a
client deliverable outranks every feature in the queue.

---

## PART XII-B — TOOLING SWITCH: ANTIGRAVITY → CLAUDE CODE (28 AUGUST 2026)

Everything in Part I (built) was built through Antigravity: an architect chat wrote a
prompt, Bashir pasted it in, Antigravity edited files but could not touch a terminal, so
every deploy/migration/query was manual. From 28 August, implementation runs through
**Claude Code**, which has direct terminal access — it can very likely run `git`, `npm`,
and the authenticated Supabase CLI itself.

This does not change what is true about the codebase (Part I–XI stand as written). It
changes how work gets executed and what needs confirming versus what can just run. Full
detail in `AGENTS.md` §0 and §3. The Q1–Q4 items and A2 remain the correct next steps
regardless of which tool builds them.

---

## PART XIII — HOW THIS PLAN IS MAINTAINED

1. **Status changes go in `PLAN_TRACKER.md`, not here.**
2. **Plan changes go here** — scope, sequence, approach, dependencies.
3. **Reasoning goes in `DECISIONS.md`** with a LOCKED / PROVISIONAL / OPEN status.
4. **The document is updated before the build, not after.** When reality and this document
   disagree, update the document first, then build. This is the discipline that the v3/v4
   drift existed because of.
5. **Nothing moves to the next phase until the current checkpoint is verified in a browser
   or a database.** An agent's completion summary is not evidence (`AGENTS.md` §1).

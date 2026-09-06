# DECISIONS.md — Decision log

**Status:** Append-only. Supersedes `AutoData_Business_Decisions.md`.
**Last revised:** 28 August 2026

> Records *why* things are the way they are. `ARCHITECTURE.md` records *how* the system is
> built; `PLAN_TRACKER.md` records *what state work is in*. Status is never recorded here.
>
> **LOCKED** — settled · **PROVISIONAL** — working assumption, revisit with data ·
> **OPEN** — not yet decided

---

## 1. Ownership and structure

| # | Decision | Status |
|---|---|---|
| 1.1 | AutoData owned solely by Bashir; Caplimo is licensee / tenant #1 | LOCKED |
| 1.2 | Multi-tenant from day one, so a second licensee is just a new org | LOCKED |
| 1.3 | Role structure: superadmin / staff / client / consumer | LOCKED |
| 1.4 | Vehicle logging restricted to superadmin while data quality is established | LOCKED |
| 1.5 | AutoData↔Caplimo licence signed **before** Fahad or Ahmed get any access | **OPEN — URGENT** |

**On 1.5:** this now blocks a live feature. The auction alert recipient list was designed
to include Fahad and Ahmed as bidding staff; they are excluded from the initial list
specifically because the licence is unsigned. The list is built editable so they can be
added the day it is signed, with no rebuild. See `PLAN_TRACKER.md` → Phase D-alerts.

---

## 2. Product lines and pricing

| # | Decision | Status |
|---|---|---|
| 2.1 | Two product lines: transparent brokerage vs bundled retail | LOCKED |
| 2.2 | An agent discloses a fee; a seller quotes a price — not a contradiction | LOCKED |
| 2.3 | Manheim is a retail *sourcing channel*, not a third product line | LOCKED |
| 2.4 | Retail priced 8–12% below best Nigerian market comp, not cost-plus | PROVISIONAL |
| 2.5 | Brokerage fee tiered 7% / 5% / 3% with $500 floor, +7.5% VAT on the fee | PROVISIONAL |
| 2.6 | Repair estimation stays human indefinitely | LOCKED |

**On 2.5 — the reasoning:** a flat percentage breaks at both ends. A $3,000 Camry at 7%
yields $210 (below the cost of the work); a $220,000 G63 at 7% yields $15,400 (large enough
to invite a direct approach). Tiered: first $20k at 7%, $20,001–$60,000 at 5%, above $60,000
at 3%. Worked: $10k → $700 · $50k → $2,900 · $220k → $7,700. Benchmark: bid.cars charges a
flat $450 + VAT — too cheap at the top; straight percentage is too expensive.

**On 2.4 — why value-based:** on a G63 where the Abuja market asks ₦380m, a 10% discount
still leaves a very large margin. On a Camry where the local market is thin, the same rule
produces a modest margin — correctly. Cost-plus would misprice both. The Nigerian dealer
listings already captured (manually and via Gemini Vision) **are** the comparison set:
Copart/bid.cars comps price the brokerage product, Nigerian dealer comps price retail.

**Commitment fee (2.7): ADOPTED (6 Sep 2026).** A competitor's process (received via WhatsApp,
5 Aug 2026) takes ₦500k *before* any work: deposit → preferences → contract → options →
approval → 65% → buy → 35% on arrival. Caplimo previously performed the full research run —
capture, curation, comps, a polished client link — for free, before any commitment. That was
the most expensive labour in the business, given away to people who may never buy.
**Adopted as recommended: a refundable commitment fee gates the research run, not account
creation and not the brief.** Anyone may submit a brief; work starts when the fee lands.

**The gate's location:** a staff-controlled `deposit_received_at` / `deposit_recorded_by` pair
on `clients` (migration 024) — the deposit is a relationship-level fact, not a brief or run
fact, since a client pays once and may have several briefs and runs over time. `createRun()`
(`src/services/researchService.ts`) refuses with a named reason when the selected client has
no deposit marked; the placeholder "Internal / Market Research" client is exempt. A
superadmin may override with a typed reason (min 10 characters), recorded on the new run via
`deposit_override_reason`/`_by`/`_at` on `research_runs`, mirroring the existing
`critical_override_*` pattern — real deposits sometimes arrive by WhatsApp before they land in
the system, and a hard block with no override gets worked around by editing the database
directly. No payment integration; a manual staff toggle only (`DECISIONS.md` 5.7).

---

## 3. Landed cost

| # | Decision | Status |
|---|---|---|
| 3.1 | Duty stack = **51.47% of declared CIF**, invariant | LOCKED (verified) |
| 3.2 | Declared-value ratio rises steeply with vehicle value | OBSERVED, needs data |
| 3.3 | Show both expected case and official ceiling | LOCKED |
| 3.4 | All rates in dated tables with admin screen, never hardcoded | LOCKED |
| 3.5 | Origin (e.g. German sourcing) is a rate-table variable, not a new model | LOCKED |
| 3.6 | No budget/max-bid enforcement until landed cost is calibrated | LOCKED |

**The stack — reverse-engineered from a real Tincan assessment notice, all six components
reconcile to the kobo:**

| Component | Basis | Rate |
|---|---|---|
| Import Duty | CIF | 20% |
| NAC Levy | CIF | 15% |
| FCS | CIF | 4% |
| ETLS | CIF | 0.5% |
| Surcharge | Import Duty | 7% |
| VAT | CIF + all above | 7.5% |

**The declared-value problem:** the formula is fixed and exact. What varies is the declared
CIF, which depends on the clearing agent. All uncertainty collapses into one variable.

| Vehicle | Official table | Declared CIF | Ratio | Quality |
|---|---|---|---|---|
| 2021 Camry SE | $21,161 | $3,684 (₦5,139,527 @ 1,395) | **17.4%** | Verified notice + FX |
| ML350 2012–15 | not in table | ~$4,200–4,900 | ~30% | Agent quote, FX unknown |
| G63 2025 | ~$170–180k (extrapolated) | ~$111,400 | ~60–65% | Agent quote, FX unknown |

Declaring a G63 at 17% would be conspicuous in a way a Camry is not. **Three points cannot
fit a curve.**

**Standing action:** photograph every assessment notice before handing it to the client.
Target 10+ across the value range before any duty figure ships. This is calibration data
currently walking out the door.

**On 3.6:** the auction price is not the landed cost. An "over budget" flag built on
hammer price alone would be confidently wrong, which is worse than absent. Deferred to
Phase C.

**Rate tables (dated, not code):**
- US inland trucking — Tier 1 $200–500 (FL, MA, RI, NJ, MD, CT, DE) · Tier 2 $400–600
  (NY Albany/Newburgh, GA, NC, SC, PA, ME, VA, TX Houston/Dallas/San Antonio/Austin/Lufkin) ·
  Tier 3 $600–800 (OH, MI, IL, KY, OK, TN, AL, LA, AR, KS, IN, WV)
- Ocean freight — RoRo $1,500–1,800 · Container $2,000+ · Special $5,000 ·
  Air $10,000–20,000

---

## 4. Data integrity and guardrails

| # | Decision | Status |
|---|---|---|
| 4.1 | Sold comps must be `sale_confirmed`; "Final bid" alone is not a sale | LOCKED |
| 4.2 | `sale_confirmed` treatment is **source-aware**, not a blanket filter | LOCKED (5 Aug) |
| 4.3 | Capture dedup: live lots overwrite; finished lots accumulate immutably | LOCKED |
| 4.4 | Eligibility keyed on lot state, never platform | LOCKED |
| 4.5 | Normalise to `price_usd` at capture; freeze the rate; never average raw | LOCKED |
| 4.6 | Averages: minimum n=3 or explicit caveat; always show sample size | LOCKED |
| 4.7 | Public data access via Edge Function allow-list, never public RLS | LOCKED |
| 4.8 | Risk rules apply to **active listings only**, never sold comps | LOCKED (5 Aug) |
| 4.9 | Critical warnings are overridable with a **typed, recorded reason** | LOCKED (5 Aug) |
| 4.10 | Duplicate vehicle in a run is a hard block, never overridable | LOCKED |

**On 4.2 — the refinement that replaced the original blunt rule.** Phase A1 originally read
"filter sold_comps to `sale_confirmed = true`." That was too blunt: it would have wrongly
excluded every manually-entered and AI-vision comp — which is most of the Nigerian market
data. `null` is not one situation but three:

1. **manual_entry / ai_vision** — no `auction_history` mechanism exists for these. Null
   means "the verification concept does not apply," not "unverified." These **count**.
2. **Auction platform, no history captured** — structurally identical to the Yaris case:
   a "Final bid" with no way to know if it was real. These are **shown, badged, and
   excluded from the average**.
3. **Any future source with no verification mechanism** — treated as (2) until that source
   gets its own history capture.

And `false` was upgraded from "excluded from the average" to **hard block on attachment**:
a confirmed non-sale in a "what things sold for" deliverable is not imprecise, it is
actively wrong.

**On 4.8 — why risk rules never touch sold comps.** A salvage, flood-damaged or non-running
car that *genuinely sold* is valid market history. Blocking it from a sold-comps run would
corrupt the very average that 4.1/4.2 exist to protect. Client-protection rules protect
clients; market history records the market.

**On 4.9 — three severity tiers:**

| Tier | Examples | Override |
|---|---|---|
| **Hard block** | duplicate vehicle in run · zero included listings | None, ever |
| **Critical (red)** | critical damage keywords · not run-and-drive · spec breaches | Review tick **+ typed reason**, recorded with user id and timestamp |
| **Warn (yellow)** | missing price · <3 comps · non-insurance seller · unconfirmed sale · soft spec mismatches | Review tick alone |

The typed reason persists to `research_runs.critical_override_reason` / `_by` / `_at`. That
audit trail is the point: if a client ever queries why a flagged car was sent to them, there
is a dated record of who decided and why.

**Critical damage keyword list** — see `SCHEMA.md` §4. Includes VIN tampering, biohazard,
frame damage, rollover, stripped and all-over on top of the originally-specified list,
because for a car heading to a Nigerian client these are as bad or worse. VIN tampering in
particular is a customs-seizure and fraud risk.

---

## 5. Client brief and spec matching (new — 5 Aug 2026)

| # | Decision | Status |
|---|---|---|
| 5.1 | Client record and client account are separate; record comes first | LOCKED |
| 5.2 | Nobody self-registers as a client; a stranger's form creates an *enquiry* | LOCKED |
| 5.3 | One client may hold many briefs over time | LOCKED |
| 5.4 | A client-submitted brief requires staff review before going live | LOCKED |
| 5.5 | Spec rules are **stratified**, not flat | LOCKED |
| 5.6 | Null / empty / `'either'` never fires a rule | LOCKED |
| 5.7 | Payment layer deferred; deposits tracked outside the system for now | LOCKED |

**On 5.5 — the stratification, and why.** Mismatches are not equal in what they cost.

**Critical (typed-reason override):** mileage over maximum · year outside range · not
run-and-drive · title type not accepted.
These are breaches of what was agreed. Title especially — "clean title only" answered with
a salvage is not a preference miss, it is a different product.

**Warn (review tick only):** colour · transmission · fuel type · trim.
Real mismatches worth noticing, not worth blocking a good car over. Clients flex on colour
and trim constantly. Transmission and fuel sit at the boundary and were placed here
deliberately: a client ticking "Automatic" over "Either" is often expressing a default
rather than a hard requirement.

**On 5.6 — why this is load-bearing.** No stated preference means nothing to violate. A
brief field that is null, empty or `'either'` must never fire, and a *missing value on the
listing* must never fire either. Getting this wrong floods the UI with false alarms, which
trains the user to ignore every badge — destroying the feature.

**On 5.4 — why review.** Clients mistype budgets and pick wrong years. A wrong spec silently
driving the flags is worse than no spec.

---

## 6. The client intake flow (designed 5 Aug 2026, not built)

**The chicken-and-egg dissolves** once the record and the account are separated (5.1).
Three arrival routes, one form:

| Route | Flow |
|---|---|
| Direct approach | Staff create the client record → send a tokenized brief link → client completes it themselves → lands in their record |
| Website / estimator | Stranger completes the same form cold → arrives as an **enquiry** → staff review → convert to client record |
| Existing account | Same form, already signed in |

No login is required to complete a brief — same tokenized-link pattern as the share pages.
The client completes it in their own words, which is the evidence trail.

**On signatures — a caution, LOCKED as guidance.** A drawn signature looks official but is
weak evidence alone; anyone can draw a squiggle. If the purpose is dispute evidence, the
strong version is the surrounding record: the exact form content stored unaltered, a
timestamp, the client's own email confirming, and a copy emailed to them at submission so
they hold a matching record. Add a signature for ceremony if desired — it does help clients
take it seriously — but do not rely on it.

**NDPR posture:** the form collects names, phone numbers, emails and consents from Nigerian
clients. State plainly on the form what the data is used for; keep it behind auth once
submitted; no pre-ticked boxes, no bundled consent. Dark patterns are both NDPR-risky and
brand-poisonous for a company selling transparency.

---

## 7. Alerts (designed 5 Aug 2026, not built)

| # | Decision | Status |
|---|---|---|
| 7.1 | 24h and 1h alerts internally; **24h only** to the client | LOCKED |
| 7.2 | Recipient list is an editable setting, never hardcoded emails | LOCKED |
| 7.3 | Initial recipients: `caplimoltd@gmail.com`, `umarfbash@gmail.com`, `ufbash@gmail.com` | LOCKED |
| 7.4 | Fahad and Ahmed added **only after** the licence is signed (1.5) | LOCKED |

**On 7.1:** the 1-hour alert is an internal "get ready to bid" ping. It means nothing to a
client except noise, and two emails per auction is how a sender gets muted.

---

## 8. Navigation and structure (decided 5 Aug 2026, not built)

| # | Decision | Status |
|---|---|---|
| 8.1 | The client page becomes the hub: details, briefs, and their runs | LOCKED |
| 8.2 | The all-runs page **stays** as a cross-client index | LOCKED |
| 8.3 | `ResearchRunDetail` is **not moved** — only lists and creation change | LOCKED |
| 8.4 | URL routing deferred to Phase D, when the client portal needs it | LOCKED |
| 8.5 | Every research run requires a client (placeholder "Internal / Market Research" client for internal work) | LOCKED (4 Sep 2026) |

**On 8.3 — the important one.** The original proposal was "move all research-run features
under the client page." That is the risky version: `ResearchRunDetail` holds nearly
everything hard-won — the checklist, critical blocks, override reason, curation, drag
ordering, share tokens, countdown, A1 filtering. Moving it is where things break.

It does not need moving. What feels convoluted is that runs are *created and listed* in a
place disconnected from the client. Changing only navigation and creation delivers the same
mental model — a run lives inside a client — while touching nothing that took real effort
to build. Clicking a run from either place opens the same detail page, unchanged.

**On 8.4:** the app currently has no router. Screens are swapped with `setView(...)` state;
only `/share/:token` is a real URL. Converting now would mean touching every screen and
every navigation control at once, with no staging environment, for zero visible benefit
today. The payoff arrives with the client portal, which needs its own address anyway.

**On 8.5 — decided (4 Sep 2026).** Every research run requires a client, with a placeholder
"Internal / Market Research" client for internal work. Reasoning: an unconditional rule means
no screen has to handle a null client; the client hub becomes the single creation path; the
alternative leaves two shapes of run permanently. Existing client-less runs (e.g. "Test
Market") get repointed to the placeholder when P1 lands — not done as part of this decision,
since repointing existing rows is a data write that belongs to the P1 build itself.

---

## 9. Technical decisions

| # | Decision | Status |
|---|---|---|
| 9.1 | Capture via real-browser extension, never headless scraping | LOCKED |
| 9.2 | bid.cars images uploaded extension-side (Cloudflare blocks servers entirely) | LOCKED |
| 9.3 | Supabase Storage only; Google Drive and Sheets permanently dropped | LOCKED |
| 9.4 | Vision: Gemini `gemini-3.1-flash-lite`, server-side, superadmin-gated | LOCKED |
| 9.5 | Vision prompting uses a `NOT_VISIBLE` escape hatch (anti-hallucination) | LOCKED |
| 9.6 | Taxonomy resolver is deterministic-first three tiers, **not RAG** | LOCKED |
| 9.7 | Two deliverables share one table with `run_type`; display and averaging branch | LOCKED |
| 9.8 | Verification standard: browser/DB-verified, never compile-verified | LOCKED |
| 9.9 | Soft-delete pattern (superadmin + typed name + 30-day recovery) is the standard | LOCKED (5 Aug) |

**On 9.2:** Cloudflare Bot Management blocks all server-side fetching of `pluto.bid.car`
(verified 403 with full browser headers). The extension fetches bytes in page context where
the origin is `bid.cars` and POSTs them. **This pattern generalises to any future source
that blocks servers.**

**On 9.9:** research runs already use this pattern. Client briefs and clients should reuse
it rather than inventing a second deletion model. Deleting a brief must not break runs that
already point at it — the run keeps working and keeps its spec history. Deleting a client
should be blocked while live runs exist.

---

## 10. Estimator (design locked, not started)

| # | Decision | Status |
|---|---|---|
| 10.1 | The estimator is **lead generation** for the brokerage, not a standalone product | LOCKED |
| 10.2 | AI never generates a price | LOCKED |
| 10.3 | Freemium: first search free, second requires a free account | PROVISIONAL |
| 10.4 | Marketing consent separate, unticked, framed as price alerts | LOCKED |
| 10.5 | Sequence E1→E5 binding; E4 must not precede E1–E3 | LOCKED |

**Data sources, ranked:** own ledger → bid.cars/Bidfax sold-history harvesting (the
pragmatic core) → commercial APIs only if harvesting hours cap out → **Copart member data
off-limits** (ToS risk to the bidding account).

**Taxonomy:** NHTSA vPIC (free, keyless) for makes/models/years and VIN decoding; curated
`trim_canonical` ladders for ~30 corridor models (~1,500 rows, AI-drafted, human-reviewed).

**Resolver, three tiers:** exact/alias lookup → `pg_trgm` fuzzy → constrained Gemini
classification among candidates → abstain below confidence.

**On 10.5:** an estimator over thin data produces visibly wrong numbers and burns the early
users who matter most.

---

## 11. Open decisions

| # | Decision | Notes |
|---|---|---|
| 1 | Sign AutoData↔Caplimo licence | **Before any staff access, including alert emails** |
| 2 | Collect 10+ assessment notices | Required before any duty model goes live |
| 3 | Confirm tiered brokerage fee (2.5) | Recommended, not yet adopted |
| 4 | Confirm retail discount band 8–12% (2.4) | May differ by segment |
| 5 | ~~Adopt a commitment fee before research runs (2.7)~~ | **ADOPTED 6 Sep 2026** — see §2.7 |
| 6 | May a run exist without a client? (8.5) | Decides the restructure shape |
| 7 | Post-2023 vehicles in the valuation table | Table ends 2023; extrapolation method undecided |
| 8 | Publish the fee schedule publicly? | Transparency argues yes; negotiating room argues no |
| 9 | Is licensing AutoData to a second licensee a goal? | Affects roadmap priority |

# DECISIONS.md — Decision log

**Status:** Append-only. Supersedes `AutoData_Business_Decisions.md`.
**Last revised:** 9 September 2026

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

**The gate's location — corrected (migration 027, 6 Sep 2026).** Originally placed on
`clients` (migration 024) as a relationship-level fact. That was a modelling error: a
commitment fee buys the right to research **one vehicle**, not every future vehicle for that
client, so a client-level flag let a second, unrelated car's research run start free once the
first was marked paid. **The gate now lives on `client_briefs`** —
`deposit_received_at`/`deposit_recorded_by` there is what `createRun()`
(`src/services/researchService.ts`) actually checks (`brief?.deposit_received_at`); a run with
no brief linked always requires the superadmin override rather than defaulting to "no deposit
needed." The placeholder "Internal / Market Research" client remains exempt regardless. The
old `clients.deposit_received_at`/`deposit_recorded_by` columns are retained only as a
rollback fallback (no staging environment to test a drop against) and are no longer read by
any live gate. See `docs/SOLVED.md` topic 14 for the full mechanism and the data-migration
rule (an existing deposit was allocated only to briefs with a non-deleted run already
attached — concrete evidence it was actually drawn on — never blanket-copied to every brief).
A superadmin may override with a typed reason (min 10 characters), recorded on the new run via
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
| 4.11 | A2 hard block triggers on **any** prior auction appearance, not cross-platform reappearance specifically | LOCKED (4 Sep 2026) |
| 4.12 | A2's damage-severity-decrease escalation is dropped; decreasing odometer between appearances is the proxy critical signal | LOCKED (4 Sep 2026) |
| 4.13 | A raw client-brief field never enters a public payload; only a value derived from it (a boolean, a count, a status label) may | LOCKED (11 Sep 2026) |
| 4.14 | Vehicle-identity normalization is derived at fingerprint-computation time only, never written back to a captured make/model/trim field | LOCKED (12 Sep 2026) |
| 4.15 | Title status has one classifier, taking the severe reading for active-listing eligibility/blocking; disagreement is surfaced, never silently resolved; never applied to sold comps | LOCKED (12 Sep 2026) |

**On 4.11/4.12 — supersedes `PROJECT_CHARTER.md` §6's original wording.** A car auctioned
twice is itself the disqualifying signal for a client vehicle regardless of whether the two
appearances share a platform — not contingent on cross-platform movement. The original
clause also called for blocking harder when damage severity *decreases* between appearances,
which turned out to be unbuildable: `auction_history` (migration 019) carries no damage
field at all. Odometer movement is the available proxy — a genuine **decrease** between
appearances is treated as odometer rollback, a critical signal in its own right, applicable
to sold comps as well since it means the recorded sale price describes a vehicle that was not
what it claimed. `PROJECT_CHARTER.md` §6 is LOCKED doctrine and was updated to note this
supersession rather than rewritten; the charter's prose now points back here. See
`PLAN_TRACKER.md` §2.A2 for the build and its verified evidence.

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

**On 4.13 — the allow-list precedent, formalised.** First applied by Prompt 25's
`sale_unconfirmed` (a derived boolean, never the raw `sale_confirmed` enum value itself, in
`public-run`'s response) and again by Prompt 28 Stage 1's sold-comps range disclosure:
`public-run` joins `client_brief` to compute `range_status` per listing and
`range_in/out/unknown_count` in `stats`, but the brief's own `year_min`/`year_max` never enter
the response's allow-list object — a client sees "3 inside, 3 outside," never the raw band
that produced it. The reasoning generalises beyond years: a raw brief field can carry client
context (budget ceiling, a name, an internal note) that was never meant for the public share
link, while a value derived from it (a count, a boolean, a status label) is exactly the
minimal signal `PROJECT_CHARTER.md` §4.7's allow-list discipline exists to permit. Any future
Edge Function widening what a brief-linked run discloses publicly must derive, never pass
through — the same test `public-run`'s own allow-list has satisfied at every widening so far
(§4.5, §4.17 in `PLAN_TRACKER.md`).

**On 4.14 — why this must not become a capture-time rewrite later.** Debt #46's real fix
(`PLAN_TRACKER.md` §4.20, Prompt 30 Stage 2) computes a canonical model/trim
(`canonicalizeForFingerprint()`) purely to feed `generate_fingerprint`'s identity hash — a
Copart capture's stored `model` stays exactly `"E 250 Bluetec"`, never rewritten to `"E-Class"`.
This is `PROJECT_CHARTER.md` §5.8 ("raw at capture, classify at read") applied to identity the
same way §5.1 already applies it to spec matching (`specVocabulary.ts`'s vocabulary groups) and
§5.10 applies it to rates. The temptation this decision exists to head off: normalizing at
*write* time instead would look simpler (no need to re-derive the canonical form on every
lookup) but would destroy the one thing that let this bug be diagnosed and fixed at all — the
raw, unaltered record of what each platform actually sent, which is what proved Copart folds
trim into its model string and bid.cars doesn't. A future prompt optimizing for "why compute
this twice" must not fold normalization into the write path. Compute it at read/fingerprint
time, every time, from the shared `_shared/specVocabulary.ts` module — never a second one
(the same lesson `soldGroup.ts` already exists to teach).

**On 4.15 — the asymmetry, stated so it survives being "simplified" later.** Two independent
title-status classifiers (`bidHeadroomService.ts`'s fee-lookup one, `ResearchRunDetail.tsx`'s
spec-match one) disagreed on real data — a bare `"Certificate of Title"` value, which is the
*legal document name* for any title, branded or not, not a clean-title signal at all
(`PLAN_TRACKER.md` §4.21/debt #58). The two were not measuring different things; they were
applying different tolerances to the same fact, and the costs of being wrong are not symmetric:

- A clean car wrongly classed salvage produces a false BLOCK on an active listing — visible to
  staff, annoying, and overridable with a typed reason (§4.9's tier 2).
- A salvage car wrongly classed clean passes spec rule 5's `titles_accepted` gate and reaches a
  client as a live purchase option. A title problem discovered after purchase is a customs-
  seizure risk at the Nigerian border (`PROJECT_CHARTER.md` §6) — not visible until it's too
  late, and not a risk the client chose or can undo.

Given that asymmetry, "average the two tolerances" or "pick whichever recognises more text" are
both wrong answers — only the more severe reading is defensible for anything that gates whether
a listing reaches a client. **This must never be softened into a symmetric or permissive
classifier later** just because it produces more `unknown`/blocked results than the old
permissive logic did; that reduction in false "accepted" answers is the fix, not a side effect
to tune away. Three things keep this from becoming its own new failure mode: (1) an `unknown`
classification is shown to staff as a distinct "needs manual review" message, never silently
folded into the same badge a confidently-wrong title gets — the disagreement is surfaced, not
resolved by fiat; (2) flood is tracked as an independent flag, never absorbed into "salvage" or
into the separate critical-damage-keyword system (§4.9's own list, `SCHEMA.md` §4) that already
treats it specially; (3) **this severity rule applies to active-listing eligibility only.** §5.6
already establishes that risk and spec rules must never touch sold comps — a salvage or
flood-damaged car that genuinely sold is valid market history, and applying a severity rule to a
sold population would corrupt the very average §4.1/§4.2 exist to protect. Neither classifier
call site (the fee lookup, spec rule 5) reaches sold-comps code at all; that separation is
structural, not just policy, and must stay that way if this classifier is ever extended.

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

**Intake link lifecycle — decided and built (Prompt 18, 6 Sep 2026).** `share_enabled` on
`client_briefs` means "open for editing," not "does this token resolve at all." A brief stays
live and editable while `pending_review` (re-submitting updates it in place, `submitted_at`
advances, status stays `pending_review`); staff approval auto-sets `share_enabled = false`
but the token keeps resolving, read-only, showing exactly what the client submitted; a
*manual* revoke on a still-`pending_review` brief is the one case that produces a true dead
link (404, same generic message as an unknown token). The `intake-brief` Edge Function
rejects a write against an approved brief server-side (`409`) — not just hidden behind the
client-side read-only view, since a stale client tab can still fire a POST after approval.
"Generate intake link" on the client page opens a confirmation first; the brief row is only
created on that confirmation's own click, never on opening the dialog, so cancelling leaves
no orphan brief.

**Account linking — decided and built (Prompt 16, 6 Sep 2026), Google-only.** Per §7's "the
record always comes first": a new Google signup is matched to an existing client by email
(case/whitespace-insensitive) or phone (Nigerian-format-normalised), and linked only when
exactly one match exists — never on an ambiguous or zero match, and a signup never creates a
new client row on its own. Offered only on the intake success screen, after submission,
always skippable — never presented as a requirement to submit. See `SCHEMA.md` §11 and
`docs/SOLVED.md`/`PLAN_TRACKER.md` §4.4 for the trigger mechanism and its verification
status (SQL-simulated, not yet a live end-to-end signup — debt #27).

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
| 6 | ~~May a run exist without a client? (8.5)~~ | **RESOLVED 4 Sep 2026 — LOCKED, no**, see §8.5 |
| 7 | Post-2023 vehicles in the valuation table | Table ends 2023; extrapolation method undecided |
| 8 | Publish the fee schedule publicly? | Transparency argues yes; negotiating room argues no |
| 9 | Is licensing AutoData to a second licensee a goal? | Affects roadmap priority |

---

## 12. Asset merges (Prompt 32 Stage 2, debt #46)

| # | Decision | Status |
|---|---|---|
| 12.1 | An asset merge is **always human-confirmed, never automatic** - regardless of how good detection gets | LOCKED |
| 12.2 | A wrong merge (fusing two different real cars) is **worse than a split** and harder to detect afterward | LOCKED |
| 12.3 | A merge repoints foreign keys and soft-retires the orphan; it never deletes it | LOCKED |
| 12.4 | Provenance fields (who did what, when, against the state of the world as it existed then) are never rewritten or moved on merge - only the pointer moves | LOCKED |

**Why 12.1/12.2, stated plainly so this doesn't get "optimized" later by someone reading only
the candidate detector:** a split leaves an orphan you can find by querying - `sightings`/
`auction_history` still exist, just attached to the wrong asset id, and a `SELECT` finds it. A
fusion looks exactly like one well-documented car. `auction_history` is keyed on `asset_id`, so
a wrong fusion also silently corrupts A2 - the flag built specifically to catch a car being
auctioned twice would then be reading two different cars' appearances as one car's history. The
failure mode a merge introduces is strictly worse than the failure mode it fixes, which is why
detection is fully automatic (Prompt 32 built real, indexed matching against production data)
while the act of merging is not, and never should be, however confident detection becomes. If a
future prompt proposes auto-merging "high-confidence" candidates, that proposal needs to argue
against this decision explicitly, not just cite an improved detector.

**Why 12.4:** a document's `asset_paired_by`/`asset_paired_at` (the first table this came up for,
`cost_document_extractions`) record a human's decision to pair a document to a vehicle, at the
time they made it, against the asset as it existed then. If that asset is later merged into
another, the human's decision does not retroactively become a decision about a different asset
made at the time of the merge - only the pointer (`asset_id`) moves. This is the same reasoning
that already keeps `source`/`effective_from` human-set in the cost-rate extraction pipeline, and
the same reason an FX rate is frozen at confirmation rather than recomputed later - a general
house pattern, not a one-off rule for this one table. Applies to any future table with a
similar "who confirmed this, when" pair of columns.

---

## 13. The make vocabulary is ranked by evidence, never curated by hand (Prompt 35 Stage 3)

| # | Decision | Status |
|---|---|---|
| 13.1 | The make vocabulary is **ranked by evidence and never curated by hand**: no whitelist of "real" brands, no deleted rows, no hidden-and-unreachable makes | LOCKED |
| 13.2 | Every make stays selectable: ranking decides what is *listed by default*; typeahead reaches all 406, and free text is always available | LOCKED |
| 13.3 | A staff demotion is a reversible flag on the row, never a delete | LOCKED |
| 13.4 | **No landed-cost total is shown until every component is real.** A component that abstains — or is available but partial — blocks the total and is named | LOCKED |

**Why 13.1, so nobody later "cleans up" the list by deleting rows:** a hand-maintained brand list is
unmaintainable (new makers appear, old ones matter again) and arbitrary (who decides "obscure"?), and
`Avatr` already proved the vocabulary cannot be authoritative — a make missing from it is a brief that
cannot be written. Ranking hides; it must never block. The failure to keep absent is a legitimate make a
client could ask for becoming unreachable. A Nigerian importer may well ask for a Peugeot, a Renault or an
Oldsmobile, which the evidence puts in tier 3 — one keystroke away, by design.

**What the evidence can and cannot do** (measured, not assumed, 20 Sep 2026): the zero-models rule
catches makes NHTSA has *ended* (Oldsmobile, Plymouth, Saturn, Pontiac, Saab) and makes with nothing at
all (heavy-truck and bus makers), by the same computed evidence. It does **not** catch a make NHTSA never
recorded an end date for — AC Propulsion returns its two models for every year 2010-2030, and Toyota also
returns models for 2029. Do not "fix" that by hard-coding names; the escape hatch is the demote flag, which
is a human decision on the row.

**Why 13.4:** a landed total that silently omits duty looks complete, which is worse than no total
(`PROJECT_CHARTER.md` §5.1). Duty is permanently unavailable until C2 unblocks, so today the bought-car view
never shows a total. Real cases that would otherwise have looked complete: a clean-title fee returned
`available` with its bid fee left out ($640), now flagged `partialReason`.

---

## 14. Won-vehicle documents (Prompt 34 Stage 4)

| # | Decision | Status |
|---|---|---|
| 14.1 | A won-vehicle document anchors to the **won vehicle**, never the asset: `won_vehicle_documents` has no `asset_id` | LOCKED |
| 14.2 | Documents are **staff-only, behind auth, always**. They never appear on the tracking page or behind any share token | LOCKED |
| 14.3 | The **only writer** is the `won-vehicle-documents` Edge Function; no client role has an INSERT/UPDATE/DELETE policy on the table or the bucket | LOCKED |
| 14.4 | Documents are **soft-deleted only; the stored file is always retained** | LOCKED |
| 14.5 | `won_vehicle_documents` and `cost_document_extractions` are **not merged**; the seam is the existing asset pairing, read not copied | LOCKED |
| 14.6 | Any table with an `asset_id` FK must be added to `merge_assets()` in the same change | LOCKED (standing obligation, restated) |

**Why 14.1:** a won vehicle is client-specific. The same physical car can be won for two clients, and an
invoice carries one client's name and amounts. Anchoring to the asset would show it against the other client's
record. This was proven with two won vehicles on one shared asset.

**Why 14.3:** with no write policy, a hard delete is impossible from the app, and a staff member's browser
session cannot rewrite a document's type or path. The function reads the org off the vehicle row (never the
request) and answers "not found" identically for a missing vehicle and one in another org.

**Why 14.5:** different lifecycles (a review gate vs. a record), different consumers (rate tables vs. a
client's file). One invoice can legitimately be both; that is why the seam exists, not a merge.

**Why 14.6:** Prompt 34 Stage 2 created `won_vehicles.asset_id` and it was never added, found only in this
stage's pre-flight. It is the same miss that produced Prompt 32.

---

## 15. The won vehicle (Prompt 34)

| # | Decision | Status |
|---|---|---|
| 15.1 | Documents, invoices, status and notifications anchor to the **won vehicle, never the asset** | LOCKED |
| 15.2 | **Promotion adds; it never moves.** The source listing stays in its run, marked won and linked | LOCKED |
| 15.3 | The won vehicle's `won_snapshot` is **frozen at promotion** and never recomputed | LOCKED |
| 15.4 | The **tracking token carries status only** — never an invoice, cost, fee, document or estimate | LOCKED |
| 15.5 | Status moves **forward exactly one step**; a correction is superadmin-only, needs a reason, and is a new row — history is never edited | LOCKED |
| 15.6 | An invoice issuance is **append-only**: voided with a reason, never edited or deleted; amounts are staff-entered, never derived | LOCKED |
| 15.7 | A client notification is **manual, never automatic**, carries the tracking link only, and every attempt (sent or failed) is logged | LOCKED |
| 15.8 | A test email can only reach the caller or an allowlisted address; a client's address is unreachable through `test` | LOCKED |
| 15.9 | The **real winning bid is a separate, staff-entered, append-only record**, never written into `won_snapshot` and never derived from the sighting | LOCKED |
| 15.10 | A winning-bid **replacement needs a note and keeps the earlier entry**; any entry is voided with a reason; nothing is edited or deleted | LOCKED |
| 15.11 | Auction fees are priced at the **recorded winning bid** when one exists, and are **exact only when the bid method is recorded**; otherwise a range, as before | LOCKED |
| 15.12 | A won vehicle's **destination is a saved, append-only history**, not an overwritten column and not a per-visit picker | LOCKED |
| 15.13 | A destination must be one the **current rates can quote**; trucking and shipping **abstain** when none is saved rather than assuming a port | LOCKED |

**Why 15.1, so it does not get "simplified" into an asset-level store later:** an asset is the physical car; a won vehicle is one client's
purchase of it. The same asset legitimately appears in two clients' runs (and after Prompt 32's merges, more readily), and could be won for two
clients. An invoice carries one client's name and amounts. An asset-level store would show client A's paperwork against client B's record — a
confidentiality failure, not a bug. Proven with two won vehicles on **one shared asset**: neither listed the other's document (docs/SOLVED.md 34).

**Why 15.2:** the run is the complete account of what was offered and what the client approved (`approved_snapshot`, the approval trail). Moving or
rewriting the listing to reflect the win would destroy that account. Promotion is an addition with a link back.

**Why 15.4:** `PROJECT_CHARTER.md` §7 makes the tracking page the one thing shareable without login, so it must carry the least. Also §5.1: no
confident date the system cannot support, so no arrival estimate.

**Why 15.6:** "an invoice nobody can prove was sent is not evidence." Editing an issuance would let the record say something that was not true when it
was sent; a void plus a new row preserves both. The trigger enforces it against the service role too, since the Edge Function is the only writer
and a future bug there must not be able to rewrite evidence.

**Why 15.7/15.8:** a real email is an irreversible external side effect. Manual send means a person confirms the recipient; the allowlist means even a
mistaken test cannot reach a real client.

**Approach chosen for invoices (Bashir, 20 Sep 2026):** record issuance against an uploaded PDF now; generation from cost data is planned as part of a
later CRM, once its inputs exist. Not a rejection of generation — a sequencing decision.

**Why 15.9:** the snapshot is what the client approved; the hammer price is a different fact that arrives later. Folding it into the snapshot would either break the
freeze (15.3) or make the snapshot say something that was not true at approval. The sighting is not a source either: `research-capture` updates it in place on re-capture.

**Why 15.10:** a corrected figure must not erase the wrong one; "was it ever entered as X, by whom" has to stay answerable. Voiding a replacement restoring the
earlier entry is intended: the earlier one was superseded, not disproved.

**Why 15.11:** bid fees differ by method (a proxy bid and a live bid are priced differently). Showing a midpoint or a range for a bid that is already won and whose method
staff know would be a guess dressed as a figure (`PROJECT_CHARTER.md` §5.1); with the method recorded the fee is a lookup.

**Why 15.12:** a destination legitimately changes (a client reroutes) and drives a cost, so "which port was chosen, by whom, and what it was before" has to stay answerable. The previous
picker saved nothing, so trucking and shipping went back to "not calculable" every time the view was reopened.

**Why 15.13:** a free-typed port could never match a rate and would look like a real destination that simply had no quote. Requiring an exact match to a quotable value keeps a destination
meaningful; abstaining without one is `PROJECT_CHARTER.md` §5.1. (The rate data's own typos are a known gap, debt #66, mitigated by ranking options by rate count, not by curation.)

---

## 16. Which auction house a bid.cars lot belongs to (debt #61)

| # | Decision | Status |
|---|---|---|
| 16.1 | The auction house of a bid.cars lot is **derived server-side, in one shared module**, from the raw lot prefix; the extension does not classify | LOCKED |
| 16.2 | The mapping contains **only prefixes the data proves** (`1` copart, `0` iaai); an unobserved prefix resolves to null and downstream **abstains** | LOCKED |
| 16.3 | The value the extension sent is **never overwritten**; corrections and derivations are stamped beside it | LOCKED |
| 16.4 | A corrective backfill uses the **same module** as ingest, is **dry-run by default**, and is idempotent | LOCKED |

**Why 16.1:** the extension had this wrong for months and a fix in the extension only helps browsers that have reloaded it. Deriving at ingest from the raw page text makes the server the authority, so a stale extension cannot
reintroduce the bug; and it leaves one definition instead of two that can drift (the class of problem this project keeps unwinding).

**Why 16.2:** the old code mapped `2` to IAAI with no observation behind it. A guessed label is worse than none: a null abstains visibly, a wrong label prices an IAAI car under Copart's schedule and quotes a Copart yard's trucking.

**Why 16.4:** correcting history with a second copy of the mapping in SQL would recreate the divergence. Dry run first means the change was seen and matched to independent measurements before any row was written.

---

## 17. The rates architecture (Prompt 37 Phase 1)

| # | Decision | Status |
|---|---|---|
| 17.1 | **The auction house is a key, not a hardcoded label.** A flat fee is "the `environmental` fee for house X under tier Y", never the string `Copart Environmental Fee`; the code asks for a fee *role* against a house and gets whatever the data says | LOCKED |
| 17.2 | **The three rate tables are unified by convention, not merged.** They have different grains (yard x port x method, price bands, flat amounts); one table would be mostly nulls with special cases in every query. Currency, effective dating, source, org scoping, provenance and the append-only rule are identical across all three | LOCKED |
| 17.3 | **A fee tier is named as the house publishes it, never after a person or company.** The holder and member number are facts on the *account*, not part of the schedule's name | LOCKED |
| 17.4 | **Payment tier (Secured/Unsecured) is per account per house**, not one org-wide setting | LOCKED |
| 17.5 | **A house with no account, or a tier with no schedule, abstains and states why.** "No schedule" is never a zero; a *partial* fee (a sub-part missing) never feeds a total or a headroom figure as complete | LOCKED |
| 17.6 | **Rate rows are never edited or deleted by the app.** The database, not application code, refuses it: API roles may only close a live row. Direct SQL by the admin role stays possible - it is the human-confirmed path - and is logged | LOCKED |
| 17.7 | **Loading a schedule is a data operation.** Through Document Extraction (the reviewer chooses the official tier) or `scripts/loadFeeSchedule.mjs` (prints SQL, never runs it). Adding IAAI must never need a TypeScript edit - proven with a synthetic schedule and an empty source diff | LOCKED |
| 17.8 | **A schedule that does not vary by title or payment method is stored once** (`any`), not four times | LOCKED |
| 17.9 | **Existing Copart figures do not move.** A frozen copy of the old arithmetic is kept as a regression oracle (`scripts/feeRegression/`); the refactor is accepted only at zero differences over every bracket boundary | LOCKED |
| 17.10 | **Asset Merges records the negative decision** ("not the same car"): append-only, voidable, remembered - so it matches Document Extraction's confirm/reject pattern | LOCKED |

**Why 17.6:** the Prompt 36 Miami update matched 0 rows because something unattributed had already applied it. The investigation could not identify who, and found that any org member could rewrite any rate row through the API while the charter rule lived only in application code. A rule that lives only in the app is a habit, not a guarantee.

**Why 17.5:** the project's recurring failure is a missing value indistinguishable from a real zero. An empty schedule that priced as $0 would be the same failure at the point where a client sees a number.

**Open (Bashir):** whether the Gate Fee, labelled "Non-Clean Title", is really charged on clean titles (it is added today; debt #70); which of two live duplicate trucking quotes is current (debt #69).

---

## 18. Numbering, invoices, payments, receipts and the client view (Prompt 37 Phase 2)

Bashir delegated these; they are hard to change later, so they are settled and recorded.

| # | Decision | Status |
|---|---|---|
| 18.1 | **Numbering is per org, separate for invoices and receipts** (`INV-000001`, `REC-000001`). A **voided document keeps its number** and a number is **never reused**; every gap is explained by a status (`voided`, `abandoned`, `allocated`). Uniqueness is enforced by the database, and allocation serialises on the org's counter row | LOCKED |
| 18.2 | **An invoice is line-item and staff-authored.** Lines are pre-filled only from a component that **computes for real**; a component that abstains, is partial, or is an approximation is never pre-filled and never a zero | LOCKED |
| 18.3 | **A total is never presented as complete while a component is missing.** Each of the six cost components is a line with a real figure or is *excluded with a stated reason*; any exclusion makes the invoice **partial**, printed on its face with the list of exclusions. Shipping and duty therefore appear only when a real figure exists. The database refuses an invoice that is silent about one | LOCKED |
| 18.4 | **Two hats are recorded on every invoice and never blurred.** Brokerage itemises every line (a disclosed fee on transparent costs). Retail shows one all-inclusive price; the underlying costs are stored internally and never rendered | LOCKED |
| 18.5 | **Currency is frozen at issuance.** An NGN invoice takes a live rate once, with **no fallback rate**, records rate, date and source, and each line's naira figure is computed once by the database. Never recomputed on read. If a live rate cannot be fetched the invoice is refused, not issued on a guess | LOCKED |
| 18.6 | **Payments are append-only, in the invoice's own currency, and the balance is derived, never stored.** A payment is voided with a reason, never edited or deleted; overpayment is refused by the database | LOCKED |
| 18.7 | **A receipt is issued against a recorded payment**, in its own numbered sequence; one live receipt per payment | LOCKED |
| 18.8 | **An invoice extends the existing issuance record** (which already ties an invoice to a stored document and is append-only); it does not create a parallel invoice table. **This amends 15.6**: amounts on a *generated* invoice are still staff-authored, but the header amount is now required to equal the sum of its confirmed lines | LOCKED |
| 18.9 | **The brokerage fee is staff-entered with its basis, never pre-filled.** Its schedule (7% / 5% / 3% tiers, $500 floor, VAT 7.5% on the fee) is still PROVISIONAL (2.5); it enters code only when adopted, and then as data (`service_fee` rate rows), never as a constant | LOCKED |
| 18.10 | **The client relationship view is staff-only and doubly scoped**: every read carries both the org and the client (or that client's vehicle ids) and the result is asserted afterwards. RLS alone is not relied on (`research_runs` has a permissive policy - debt #76) | LOCKED |

**Why 18.3:** the won-vehicle landed-cost view already refuses to total while a component is missing, but its component list omits the winning bid and the service fee - an invoice that copied that list would look complete without them. An invoice is what a client sees and may pay, so the refusal is stricter here: not just "do not total" but "say what is not in it".

**Why 18.5:** `currencyService.fetchExchangeRates` silently falls back to a hard-coded NGN rate on any failure. Stamping a "frozen" rate that was never fetched would be a false precision; an unfetchable rate stops the invoice instead.

**Open (Bashir):** how a paid deposit or commitment fee is credited against an invoice - nothing in the documents says (credit, offset or refund), so no invoice does it (debt #74); adoption of the brokerage fee schedule (debt #75).

### 18.11 What the database can and cannot enforce about a "computed" figure (added after the Phase 2 verifier)

**Decision.** The database refuses a zero line (except a stated, waived brokerage fee) and a computed line with no stated source; the Edge Function additionally checks a computed vehicle price against the vehicle's recorded winning bid. It does **not** re-derive computed auction-fee, trucking or freight figures, because those cost cores live in frontend code. **Why.** The verifier showed that leaving a component out was refused but zeroing it was not - the exact failure this design exists to prevent - and that "computed" was a self-declared label. **Consequence.** A session holder can still label a wrong figure "computed" if they name a source; closing that means moving the cost cores into `_shared` and recomputing in the function (debt #79). The design's honest claim is therefore: an invoice cannot silently omit or zero a component, and every computed figure names what it came from; it is not "every computed figure is proven".

## 19. The document engine v2 (Prompt 38 Phase A, 22 Sep 2026)

**19.1 An invoice belongs to a client; the vehicle is optional, and may be external.** Phase 2's `won_vehicle_id NOT NULL` was wrong the moment a real invoice (INV-0025, a repair) turned out to have no auction purchase behind it. `billing_documents.client_id` is required; a vehicle is either a won vehicle or a plate/VIN/description, never both. LOCKED.

**19.2 The real org's numbering continues Caplimo's paper trail, not a fresh `INV-000001`.** Bashir confirmed 21 Sep 2026: the last paper invoice was INV-0027, 4-digit padding, next is INV-0028. `configure_document_series()` can only move a counter forward past every number already in its ledger, so this is safe to do once, now, before the real org issues anything through the new engine - and unsafe to redo later. LOCKED.

**19.3 Discounts are typed, never a negative line; the informational "Discount Applied" is derived, never stored.** INV-0025's own printed total is the proof: subtracting its "Discount Applied -₦148,250.00" a second time gives ₦2,173,700.00, ₦148,250.00 short. The engine cannot reproduce that bug structurally - `billing_compute()` derives the printed figure at render time from the line discounts that already exist inside each net amount; there is no column anywhere holding a summed discount that a second subtraction could touch. LOCKED.

**19.4 The six-component "PARTIAL INVOICE" rule is replaced by a required scope statement.** Caplimo invoices in stages (purchase and service fee now, shipping and clearance later); the old rule would have stamped every one of Caplimo's real invoices with an alarm that doesn't apply to how they actually bill. The database still requires the field to be non-blank on a purchase or retail invoice - it just can no longer verify the field is *true*. That is a real weakening of the original guarantee, made deliberately, and is stated as a limitation in `PLAN_TRACKER.md` §4.35, not hidden. LOCKED.

**19.5 Deposits are payments applied to a document, never a line.** `billing_payments` + `billing_applications`; a document line's `rate` must be `> 0`, so representing a deposit as `-$800.00` is not merely discouraged, it fails a CHECK constraint. This also closes debt #74 (deposit crediting): a retainer, once paid, credits its `billing_applications` amount against a final invoice the same way a payment does. LOCKED.

**19.6 A credit note is the only way to reduce an issued invoice.** Documents are sealed after issue (`billing_documents_guard` refuses any UPDATE except the void columns together). A credit note is a separate, positively-stored document that reduces the invoice's *derived* balance (`billing_document_balances`); the invoice row itself never changes, and a credit note cannot exceed what remains outstanding, even cumulatively across several credit notes. LOCKED.

**19.7 FX is staff-set (agreed) or fetched live, and the invoice records which.** Caplimo's real invoices use an agreed rate (₦1,390) that differs from the live rate at the time (~₦1,326). `fx_basis` is `agreed`|`live`; an agreed rate requires a stated source (who agreed it, and how). Still frozen once at issue - never recomputed, never re-fetched. Extends Phase 2's `18.5` (which required live-only); that requirement is superseded here. LOCKED.

**19.8 A "computed" invoice line is a verified claim, not a label (closes debt #79).** The auction-fee, inland-trucking, ocean-freight and duty cores moved to `_shared` (database client injected), and the `billing` Edge Function recomputes every `computed` line at issue time from those same functions, refusing the document if the submitted figure disagrees by even a cent - proved live against the deployed function with a deliberately tampered figure. Duty and ocean freight still have no calculator/rate, so a `computed` line naming either is refused outright regardless of figure; those stay `staff_entered` (with a basis) or `document_backed` (linked to an uploaded document, as INV-0027's own IAAI-invoice line is). This closes the gap `18.11` named ("what the database can and cannot enforce about a 'computed' figure"): everything that *can* be recomputed now *is*, on every issue.

**19.9 Per-org branding lives in data, not code.** `org_billing_profile` (name, address lines, logo, payment instructions, footer notes) is per-org and superadmin-write; a second licensee invoices under its own name with no code change. LOCKED.

**19.10 Origin footnotes are kept, printed small, per line.** Bashir, 21 Sep 2026: "keep them as a footnote" rather than dropping them from the PDF. Live evidence (INV-0025, 18 lines, all `staff_entered` with one shared basis) shows this can be noisy when many lines share one reason - recorded as a usability note in `PLAN_TRACKER.md` §4.35, not changed, since the instruction was explicit.

**19.11 Phase 2's tables are legacy, not migrated.** The old `won_vehicle_invoice_issuances`/`lines`/`payments`/`receipts` are left exactly as they are - still readable, no longer the writer for anything new. Migrating their two real Copart-org test rows into the new shape would mean rewriting frozen, provenance-bearing figures (`[[feedback-provenance-fields-frozen]]`) to invent a discount/tax shape they never had; abandoning them in place is cheaper and safer, and was recommended by the Phase 2 reuse pre-flight before any migration was written.

## 20. The client view (Prompt 39, 22 Sep 2026)

**20.1 Supersedes 14.2/14.3: "behind auth" means visible to the authenticated client, with a deliberate flag - not invisible to everyone but staff.** `DECISIONS.md` §14.2/14.3 said won_vehicle_documents are "staff-only, behind auth, always" and were written before any client login existed - at the time, "behind auth" and "staff-only" were the same thing, since only staff could authenticate at all. `PROJECT_CHARTER.md` §7 draws the real line: the tracking page is the one thing visible *without* login; documents stay *behind* auth, which is what the client account now exists for. But not every document is the client's to see (an auction's own cost invoice reveals what Caplimo paid). Resolution: a per-document `client_visible` flag, default false, set deliberately by staff - and a cost document can never be flagged visible on a vehicle invoiced retail, enforced by the database. 14.3's write lock is untouched: the Edge Function is still the only writer of the table itself; only the flag has a second, narrow path. LOCKED.

**20.2 Client policies are separate from staff policies, never a clause added to them.** Postgres OR's permissive policies of the same command together, so an unchanged org-wide staff policy would still grant a client the same access regardless of how narrow a new client policy was. The staff policies themselves had to stop matching a client role (`AND user_is_staff(org_id)`) before any client-specific policy could mean anything. "Staff access does not change" is a RESULT guarantee (proved live, byte-identical row counts before and after), not a promise the policy text stays untouched - the text had to change for the result to hold once a client role could exist at all. LOCKED.

**20.3 A client sees their own rows, never their org's rows.** Every client policy resolves through `current_client_id(org_id)`, never `org_id IN user_org_ids()` alone - the second would give a client the same org-wide shape staff has, just narrower table access. Column-level hiding (internal notes, internal linkage) is not something a row policy can do; where it matters, a client reads a `security_invoker` view instead of the table. LOCKED.

**20.4 Revocation is RLS-level, not merely a UI lock.** `memberships.revoked_at` feeds directly into `user_org_ids()`/`is_superadmin()`/`current_client_id()` - the moment staff revoke a client, every policy that depends on those functions returns nothing for that session, proved live. The client record and every billing/status row are untouched; only future reads through that membership stop. LOCKED.

**20.5 Server-side Edge Functions exclude a client role explicitly; RLS is not the boundary for service-role code.** Every Edge Function runs on the service-role key and bypasses RLS entirely, so a client token's only barrier there is whatever the function itself checks. `won-vehicle-status`'s `advance` mode had no such check at all until a live hostile-client test found it (debt #82) - the lesson generalises: a NEW client role must be checked against EVERY existing service-role code path, not assumed safe because RLS was fixed. LOCKED, and treated as a standing audit item for any future Edge Function.

**20.6 A subagent's finding is evidence to verify, not fact to build on (carried from Prompt 38, restated because it mattered again here).** The Phase B pre-flight (Prompt 38) and this phase's own hostile-client verifier were both told explicitly to attack, not confirm - and the most serious finding of Stage 3 (the missing role check) was found by the MAIN agent's own live test before the independent verifier even ran, precisely because "try to break it" was taken literally rather than treated as a formality.

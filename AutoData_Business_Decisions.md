# AutoData & Caplimo — Business Decisions Record

**Status:** Master reference for commercial strategy and business rules
**Owner:** Bashir
**Companion document:** AutoData Architecture Plan v3 (technical)
**Last revised:** 3 August 2026

> This document records *why* the business works the way it does — pricing, positioning, ownership, and the reasoning behind each choice. The Architecture Plan records *how* the system is built. When a business decision changes, update this document first, then check whether the technical plan needs to follow.
>
> Decisions are marked **LOCKED** (settled), **PROVISIONAL** (working assumption, revisit with data), or **OPEN** (not yet decided).

---

## 1. Ownership & Structure

### 1.1 AutoData ownership — LOCKED
AutoData is owned **solely by Bashir**. It began as an internal tool for Caplimo but is now an independent product. Caplimo is AutoData's **first licensee — tenant #1 — not its owner.**

Consequences:
- AutoData runs on its own resources (own Supabase, own domain `theautodata.com`, own Google Cloud project, own API keys).
- Caplimo staff receive scoped *access*, not ownership.
- A second licensee is simply a new organization inside the platform, isolated by row-level security.
- Multi-tenancy was built from day one specifically so this remains true without a painful refactor.

### 1.2 Licence documentation — OPEN, URGENT
**A one-page licence agreement between Bashir (AutoData) and Caplimo must be signed before Fahad or Ahmed receive staff logins.** IP ambiguity is cheapest to prevent before usage starts. Caplimo's history with the CAC share register (recorded as 40/30/30 rather than the agreed equal thirds) is direct evidence of what undocumented arrangements cost later.

Minimum contents: what is licensed, to whom, for how long, at what cost (nominal or free), what happens on termination, and explicit confirmation that AutoData's code, data model, and accumulated market data remain Bashir's property.

### 1.3 Role structure — LOCKED
| Role | Scope |
|---|---|
| `superadmin` | Platform owner (Bashir). Cross-org visibility. Only role permitted to log vehicles. |
| `staff` | Single licensee org. Research, client management, status updates. |
| `client` | Own records only — brokerage customers. |
| `consumer` | Own records only — public estimator signups. |

Vehicle logging (manual, AI-vision, extension) is currently restricted to `superadmin`. This is deliberate while data quality is being established; it can be widened later.

---

## 2. The Two Product Lines

This is the central commercial insight of the business. **Caplimo operates two different businesses that happen to share infrastructure.** Conflating them produces bad pricing.

| | **Brokerage** (auction) | **Retail** (clean cars) |
|---|---|---|
| Whose car | The client's | Ours |
| Our role | Agent | Seller |
| Client mindset | Value-seeking, will compare | Outcome-seeking, wants a finished car |
| Can they see our cost? | Yes — Copart/IAAI are public | No — and no reason to show them |
| Pricing model | Disclosed fee on top of transparent costs | All-inclusive price, margin undisclosed |
| Our advantage | Transparency and trust | Beating the local market price |

### 2.1 Why the apparent inconsistency is not one — LOCKED
Publishing a fee in one line and not the other could look contradictory against a brand built on transparency. It isn't, and the framing should be stated openly: **an agent discloses their fee; a seller quotes a price.** Nobody expects a supermarket to publish what it paid the dairy. Being explicit about which hat we are wearing on any given transaction resolves it entirely.

### 2.2 Manheim and other dealer auctions — LOCKED
Manheim is a **sourcing channel for the retail product**, not a third product line. Buyers of clean Manheim cars have the same mindset as buyers of clean dealer cars — they want a finished vehicle. Manheim access is also dealer-gated, so publishing those prices would invite disintermediation while helping nobody.

**Rule:** buy at Manheim, price against the Nigerian market, sell all-inclusive.

---

## 3. Pricing

### 3.1 Brokerage fee — PROVISIONAL (recommended, awaiting confirmation)

A flat percentage breaks at both ends of the range: a $3,000 Camry at 7% yields $210 (below the cost of the work), while a $220,000 G63 at 7% yields $15,400 (large enough to invite pushback or a direct approach).

**Recommended tiered structure:**

| Vehicle value band | Fee |
|---|---|
| First $20,000 | 7% |
| $20,001 – $60,000 | 5% |
| Above $60,000 | 3% |
| **Minimum fee** | **$500** |

Worked examples: $10k car → $700 (unchanged from flat 7%). $50k car → $2,900. $220k car → $7,700.

VAT at 7.5% is charged **on the fee**, not on vehicle value. All-in client cost on a $10k car is therefore ~$752.

Benchmark: bid.cars charges a flat $450 + VAT. Flat is too cheap at the top of the range; straight percentage is too expensive. Tiered sits between and keeps high-value deals winnable.

### 3.2 Retail pricing — value-based, not cost-plus — LOCKED

**Do not price clean cars at cost + fixed margin.** The correct anchor is what the vehicle sells for in Nigeria today, not what it cost to land.

**Rule:** price at a deliberate discount to the best comparable Nigerian listing — target **8–12% below market** — and accept whatever margin falls out.

Why this is right:
- On a G63 where the Abuja market asks ₦380m, the discount still leaves a very large margin.
- On a Camry where the local market is thin, the same rule produces a modest margin — correctly.
- Cost-plus would misprice both, leaving money on the table at the top and overpricing at the bottom.

**The data already exists.** The Abujacar-style listings logged manually and via Gemini Vision *are* the Nigerian market comparison set. Copart/bid.cars comps price the brokerage product; Nigerian dealer comps price the retail product. Two data sources, two products, one ledger.

### 3.3 Repair estimation stays human — LOCKED
Damage assessment is Caplimo's core expertise and the foundation of client trust. An automated repair figure that is wrong destroys exactly the credibility the service sells. Repair quotes remain human-produced indefinitely.

The quote funnel is framed as **"Get exact quote — including cost to repair"**, because that answers the only question the buyer actually has: what does it cost to have this car on the road in Lagos?

Every quote issued is logged. Over time, damage class × model × actual repair cost becomes a proprietary dataset no competitor or scraper can replicate — and eventually the basis for semi-automated triage, if ever desired.

---

## 4. Landed Cost Model

### 4.1 The Nigerian duty stack — LOCKED (reverse-engineered from a real assessment notice, all six components verified to the kobo)

| Component | Basis | Rate |
|---|---|---|
| Import Duty | CIF | 20% |
| NAC Levy | CIF | 15% |
| FCS | CIF | 4% |
| ETLS | CIF | 0.5% |
| Surcharge | Import Duty | 7% |
| VAT | CIF + all above | 7.5% |

**Total duty = 51.47% of declared CIF.** This ratio is invariant.

### 4.2 The declared-value problem — the key commercial insight

Duty is not unpredictable. The *formula* is fixed and exact. What varies is the **declared CIF**, which depends on the clearing agent's handling. All uncertainty collapses into a single variable.

The official Vehicle Valuation table (2014–2023, ~1,800 model rows) gives the assessed value. Actual declarations come in well below it.

**Observed calibration points:**

| Vehicle | Official value | Declared CIF | Ratio | Source quality |
|---|---|---|---|---|
| 2021 Camry SE | $21,161 | $3,684 | **17.4%** | Verified assessment notice + FX rate |
| ML350 2012–2015 | (not in table) | ~$4,200–4,900 | ~30% (est.) | Agent quote, FX date unknown |
| G63 2025 | ~$170–180k (extrapolated) | ~$111,400 | ~60–65% | Agent quote, FX date unknown |

**The ratio is not constant — it rises steeply with vehicle value.** Declaring a G63 at 17% would be conspicuous in a way a Camry is not. Three points is insufficient to fit a curve.

**Action:** photograph every assessment notice before handing it to the client. This is calibration data currently walking out the door. Target: 10+ notices across the value range before committing a model to code.

### 4.3 Client-facing duty presentation — LOCKED
Estimates must show **both**:
- the **expected case**, based on observed actual declarations, and
- the **official ceiling**, computed from the valuation table.

Framed as *"estimated — final assessment is determined by Customs at clearance."*

Rationale: basing a firm quote on the observed ratio carries genuine business risk. It depends on agent handling, which is outside our control. If an agent changes or enforcement tightens, every published estimate breaks — and a client who has already committed absorbs the difference. A disclosed range protects both parties and is more credible than a confident number that is sometimes wrong.

### 4.4 Freight and inland transport — LOCKED as rate tables, not code

**US inland trucking (to port):**

| Tier | Range | Locations |
|---|---|---|
| 1 | $200–500 | FL, MA, RI, NJ, MD, CT, DE |
| 2 | $400–600 | NY (Albany, Newburgh), GA, NC, SC, PA, ME, VA, TX (Houston, Dallas, San Antonio, Austin, Lufkin) |
| 3 | $600–800 | OH, MI, IL, KY, OK, TN, AL, LA, AR, KS, IN, WV |

**Ocean freight by method:**

| Method | Cost |
|---|---|
| RoRo | $1,500–1,800 |
| Container | $2,000+ |
| Special/oversized | $5,000 |
| Air freight | $10,000–20,000 |

**Nothing above is hardcoded.** All rates live in a dated rate table, updated through an admin screen without a deploy. Each row records its effective date range and source, so historical quotes remain explicable and rate history is preserved.

**Multi-origin (e.g. German G-Wagon sourcing):** origin changes the freight leg and the CIF basis only. The Nigerian duty stack applies identically at the port of entry regardless of source country. Origin is a rate-table variable, not a separate model.

---

## 5. The Public Estimator (planned)

### 5.1 Purpose — LOCKED
The estimator is **lead generation for the brokerage**, not a standalone product. Its job is to build enough trust that a visitor requests a real quote. Every design decision should serve that.

### 5.2 Never let AI generate a price — LOCKED
Figures come from actual transaction records. AI's only roles are parsing free-text search into filters and writing plain-English explanations. A plausible-sounding invented price destroys a pricing product permanently.

### 5.3 Freemium funnel — PROVISIONAL
- **First search free**, no login. Tracked loosely; trivially evadable by design — it is a nudge, not a fortress.
- **Second search requires a free account** via Google one-tap. Hook framed as value: *"your first estimate is saved to your account."*
- **Marketing consent is a separate, unticked, optional checkbox**, framed as price alerts for cars the user searched — genuinely useful, which is why it converts. No pre-ticked boxes, no bundled consent. Dark patterns are both NDPR-risky and brand-poisonous for a company selling transparency.

### 5.4 Honesty doctrine — LOCKED (applies to every client-facing number)
- Always display sample size alongside an average.
- Widen bands and say so rather than faking precision on thin data.
- Show the underlying comparables so the client can verify.
- Abstain and flag rather than guess.
- Date every snapshot: *"data captured 31 July 2026."*

This is both an ethical position and a commercial one — a tool that admits uncertainty is trusted; one that never does eventually gets caught out.

---

## 6. Vehicle Selection & Risk Rules

### 6.1 Non-insurance sellers — LOCKED
Vehicles from non-insurance sellers are **avoided**. They correlate with undisclosed problems. `seller_type` is captured automatically and flagged in the pre-share checklist.

### 6.2 Multiple auction appearances — fraud signal — LOCKED as a principle
A vehicle appearing across multiple auctions — particularly where damage severity *decreases* between appearances — indicates a wreck repaired cosmetically and re-sold. Classic importer trap; invisible on the listing itself.

Bid.cars' Sales History panel exposes: every past auction appearance, all past bids (including failed ones that missed reserve), and seller type.

**Commercial value beyond fraud detection:** failed bids reveal the market ceiling. A car that ran three times at $6,200 / $6,800 / $7,100 without meeting reserve tells you the seller's floor and that the market repeatedly declined. That is bidding-strategy intelligence no competitor has.

Vehicles with cross-platform reappearance must be blocked from client-facing deliverables.

### 6.3 Flood damage — LOCKED
Flagged as a distinct damage class, not folded into general damage. Specific and severe risk in the Nigerian market.

---

## 7. Data as Competitive Moat

Ranked by defensibility:

1. **Repair quote history** — damage class × model × actual quoted repair cost. Cannot be scraped, bought, or replicated. Accumulates automatically through the quote funnel.
2. **Clearance history** — official value vs declared CIF vs actual paid, per vehicle class, per agent. Proprietary and directly monetisable as estimate accuracy.
3. **Search demand signals** — what Nigerians search for, and what they search for but cannot find. A market-gap detector for acquisition decisions.
4. **Cross-source vehicle ledger** — the same VIN captured across Copart, bid.cars and dealer listings, enriched over time.

Comparable auction data can eventually be bought from commercial providers. Items 1–3 cannot.

---

## 8. Client Relationship Model

### 8.1 Accounts, not links — LOCKED
Clients get real accounts (Google sign-in primary). Rationale: invoices, receipts and full vehicle history need a persistent home, and link-management does not scale. Accounts are **provisioned by staff and pre-populated before the client ever logs in** — the client's first experience is a finished dashboard, not an empty signup form.

### 8.2 The one shareable link — LOCKED
Only the **shipping/tracking page** is shareable without login (unguessable, revocable token), so a client can forward it to someone monitoring delivery. Invoices, documents and account data remain behind authentication.

### 8.3 Status transparency reduces support burden — LOCKED
A live status timeline (researched → won → paid → in transit → customs → delivered) removes the largest recurring support cost: individual "where is my car" messages. It is simultaneously the strongest expression of the transparency positioning.

---

## 9. Open Decisions

| # | Decision | Notes |
|---|---|---|
| 1 | Confirm tiered brokerage fee structure (§3.1) | Recommended, not yet adopted |
| 2 | Sign AutoData↔Caplimo licence | **Before** any staff login is issued |
| 3 | Collect 10+ assessment notices | Required before duty model goes live |
| 4 | Retail discount target — confirm 8–12% band | May differ by segment |
| 5 | Handling of post-2023 vehicles in the valuation table | Table ends at 2023; extrapolation method undecided |
| 6 | Whether to publish the fee schedule publicly | Transparency argues yes; negotiating room argues no |
| 7 | Second licensee — is licensing AutoData externally a goal? | Affects roadmap priority |

---

## 10. Decisions Log Summary

| Decision | Status |
|---|---|
| AutoData solely owned by Bashir; Caplimo is licensee | LOCKED |
| Two product lines: transparent brokerage vs bundled retail | LOCKED |
| Manheim is a retail sourcing channel, not a product line | LOCKED |
| Retail priced against Nigerian market, not cost-plus | LOCKED |
| Repair estimation stays human | LOCKED |
| Duty stack = 51.47% of declared CIF | LOCKED (verified) |
| Declared-value ratio rises with vehicle value | OBSERVED, needs more data |
| Show both expected and ceiling duty estimates | LOCKED |
| All rates in dated tables, never hardcoded | LOCKED |
| Estimator is lead-gen, not a standalone product | LOCKED |
| AI never generates a price | LOCKED |
| Honesty doctrine on every client-facing number | LOCKED |
| Avoid non-insurance sellers | LOCKED |
| Block cross-platform reappearance vehicles | LOCKED |
| Client accounts, staff-provisioned | LOCKED |
| Tiered brokerage fee (7/5/3, $500 floor) | PROVISIONAL |
| Freemium: 1 free search then account | PROVISIONAL |
| Retail discount 8–12% below market | PROVISIONAL |

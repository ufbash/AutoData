# AutoData Platform — Architecture Plan v4

**Status:** Master reference blueprint (supersedes v3)
**Owner:** Bashir (platform owner / superadmin)
**Domain:** theautodata.com (live)
**Revision:** v4 — post-delivery. Both client products shipped.
**Companion:** `AutoData_Business_Decisions.md` (commercial strategy), `AutoData_Handover_Brief.md` (new-chat context)

> Single source of truth. Every build prompt is checked against this document. When reality and this document disagree, update the document first, then build.
>
> **v4 changes:** (1) Records the completed delivery of both client products. (2) Full built/not-built inventory. (3) Duty stack verified exactly. (4) Sold-comp validation problem discovered and solved. (5) Re-sequenced remaining work.

---

## 1. What AutoData Is

A multi-tenant vehicle-market-intelligence and client-operations platform, owned solely by Bashir. Caplimo is licensee / tenant #1.

**Three product faces, one data spine:**
1. **Brokerage toolset** — staff dashboard, capture, research runs, curation. *Built.*
2. **Client deliverables** — tokenized mobile share pages replacing the old Excel sheets. *Built and live.*
3. **Public estimator** — search any vehicle → comps-based average → Nigeria landed cost → request quote. *Not started; the largest remaining build.*

---

## 2. Architecture (stable)

**One spine.** Supabase is the single source of truth. The extension, staff dashboard, public share pages, and future portal/estimator are all clients of it.

```
                    ┌──────────────────────────────┐
                    │  SUPABASE  (xrotvpuainpfdulh…) │
                    │  Postgres + Auth + Storage    │
                    │  + Edge Functions + RLS       │
                    └──────────────────────────────┘
         ▲             ▲              ▲             ▲
   ┌─────┴────┐ ┌──────┴─────┐ ┌──────┴────┐ ┌──────┴──────┐
   │ Chrome   │ │  Staff      │ │ Public    │ │ Estimator / │
   │ Extension│ │  Dashboard  │ │ Share     │ │ Portal      │
   │ (capture)│ │  (built)    │ │ (live)    │ │ (future)    │
   └──────────┘ └─────────────┘ └───────────┘ └─────────────┘
```

**Secrets doctrine:** anything `VITE_`-prefixed is public. Only Supabase URL + anon key belong client-side. All real secrets live in Supabase Edge Function secrets.

**Storage:** Supabase Storage for all images and documents, private bucket `vehicle-images`, org-scoped paths `{org_id}/{sighting_id}/{NN}.jpg`, served via signed URLs. Google Drive and Sheets permanently dropped.

---

## 3. CURRENT STATE — full inventory

### 3.1 Built and verified in production

**Capture layer**
- Chrome extension reads Copart and bid.cars DOM inside the authenticated browser session (deliberately not a scraper — this defeats Cloudflare by being a real user).
- ~30 structured fields per vehicle: VIN, year/make/model/trim, mileage + odometer brand, title type, primary/secondary damage, body style, cylinders, engine type, horsepower, transmission, fuel, drivetrain, colour, current bid, estimated retail value, has-key, run-and-drive, engine-starts, transmission-engages, seller type, location, sale date, bid.cars import-cost estimates.
- VIN fingerprint dedup; cross-source COALESCE enrichment (same VIN from two platforms → one enriched asset, two sightings).
- `lot_state` detection on both platforms; Copart page-readiness guard (prevents capturing a half-rendered Angular page).
- bid.cars finished-lot capture (final sale price → `listed_price`).
- **Sales History capture** → `auction_history` table: every past auction appearance with date, lot, bid, odometer, status, seller.
- Capture dedup: live lots overwrite on re-capture; finished lots accumulate immutably.
- Capture deletion with confirmation, superadmin-only, cascading cleanup of orphan assets.

**Platform foundation**
- Multi-tenancy: `organizations`, `memberships`, roles (superadmin / staff / client), RLS on all ledger tables, `org_id NOT NULL`.
- Supabase Auth + Google OAuth, whole-app gate, session persistence.
- `app-ingest` (JWT-verified, superadmin-gated, `created_by` audit stamp).
- Server-side vision via `extract-vehicle-vision` (Gemini key never client-side, superadmin role gate).
- Currency normalisation: `price_usd`, `exchange_rate`, `exchange_rate_date` frozen at capture, live FX fetch, NGN and USD both verified.
- Dashboard and vehicle log restricted to superadmin; legacy `sales` table locked at the database level (RLS on, zero policies).
- Automated monthly backup — pg_cron → Edge Function → six CSVs → Resend to two addresses. **Verified end-to-end including a real scheduled run.**

**Image pipeline**
- Copart: server-side fetch → private Supabase Storage bucket.
- bid.cars: **extension-side upload** — Cloudflare Bot Management blocks all server-side fetching of `pluto.bid.car` (verified 403 with full browser headers), so the extension fetches bytes in page context where the origin is `bid.cars` and POSTs them. This pattern generalises to any future source that blocks servers.
- Public pages serve 7-day signed URLs; falls back to source URLs when not stored.

**Client deliverables — LIVE**
- Research runs: create, list, detail, curate (include/exclude), drag-and-drop ordering, share-token generation and rotation.
- `run_type` — `sold_comps` | `active_listings` | `mixed` — with differentiated display.
  - *sold_comps:* four-image grid, sale price per vehicle, **average sale price panel with sample size**.
  - *active_listings:* single thumbnail → gallery, current bid, **no average** (averaging live bids is misleading).
  - *mixed:* both sections.
- Capture eligibility enforced at attach time, keyed on **lot state, not platform** (self-maintaining as sources change).
- Pre-share checklist: BLOCK on duplicate vehicle or zero listings; WARN on thin sample, missing prices, mixed models, non-insurance seller. Offending rows highlighted; BLOCK disables sharing.
- `public-run` Edge Function with strict field allow-list (never a public RLS policy on ledger tables), generic 404 for both bad token and sharing-disabled.
- `PublicRunView` — mobile-first, snapshot-dated, reuses the shared `VehicleDetailModal` with internal fields hidden.
- Static Open Graph meta tags for link previews.

**Migrations applied:** 001 → 019.

### 3.2 Discovered problem, solved

**"Final bid" on bid.cars is not a sale price.** Verified case: a 2010 Toyota Yaris ran **16 times over two months and never sold** — bids $875–$1,650, every row "Not sold" — yet the page displays "Final bid $1,100 USD".

Sold comps built naively on that field are polluted with rejected bids, which would understate market averages. The `auction_history` Status column is the only place this is visible, which is why B4 became the validation layer for the entire market-research product, not an optional extra.

`sale_confirmed` is now derived from the last history row's status. **Still to do:** filter `sold_comps` runs to `sale_confirmed = true`.

The commercial upside: rejected-bid history reveals the seller's reserve and the market's repeated refusal — bidding intelligence no competitor has.

### 3.3 Not built

| Area | Item |
|---|---|
| Coverage | IAAI content script; extension run-picker (currently requires typing a UUID) |
| Data quality | `sold_comps` filter on `sale_confirmed`; derived asset flags (cross-platform reappearance, previously-unsold, highest rejected bid); checklist rules using them |
| Landed cost | Rate tables + admin screen; duty calculator; client-facing cost display |
| Client ops | `clients`, `client_vehicles`, `vehicle_status_events`, `documents`, `invoices`; status state machine; client portal; "Request this vehicle" loop; email notifications |
| Estimator | Harvest mode; taxonomy (vPIC); standardisation resolver; stats engine; public MVP; analytics |
| Intelligence | Daily Sniper (Instagram vision ingestion); Market Velocity Index; decay model; arbitrage detection |
| Ops | Subdomain split (`app.` / `portal.`); Chrome Web Store private publish; staging environment |

---

## 4. Landed Cost Model

### 4.1 The duty stack — VERIFIED EXACTLY
Reverse-engineered from a real Tincan assessment notice; all six components reconcile to the kobo.

| Component | Basis | Rate |
|---|---|---|
| Import Duty | CIF | 20% |
| NAC Levy | CIF | 15% |
| FCS | CIF | 4% |
| ETLS | CIF | 0.5% |
| Surcharge | Import Duty | 7% |
| VAT | CIF + all above | 7.5% |

**Total duty = 51.47% of declared CIF.** Invariant.

### 4.2 The declared-value problem
The formula is fixed; the **declared CIF** is the only unknown, and it depends on agent handling. All uncertainty collapses into one variable.

| Vehicle | Official table | Declared CIF | Ratio | Quality |
|---|---|---|---|---|
| 2021 Camry SE | $21,161 | $3,684 (₦5,139,527 @ 1,395) | **17.4%** | Verified notice + FX |
| ML350 2012–15 | not in table | ~$4,200–4,900 | ~30% | Agent quote, FX unknown |
| G63 2025 | ~$170–180k (extrapolated) | ~$111,400 | ~60–65% | Agent quote, FX unknown |

**The ratio rises steeply with vehicle value.** Three points cannot fit a curve.

**Action:** photograph every assessment notice before handing it to the client. Target 10+ across the value range before any duty figure ships. This is calibration data currently walking out the door.

### 4.3 Rate tables (not code)
All rates live in a dated `cost_rates` table with `effective_from` / `effective_to` and a `source` field (`official_tariff` | `agent_quote` | `actual_paid`), updated through an admin screen without a deploy.

**US inland trucking:** Tier 1 $200–500 (FL, MA, RI, NJ, MD, CT, DE) · Tier 2 $400–600 (NY Albany/Newburgh, GA, NC, SC, PA, ME, VA, TX Houston/Dallas/San Antonio/Austin/Lufkin) · Tier 3 $600–800 (OH, MI, IL, KY, OK, TN, AL, LA, AR, KS, IN, WV).

**Ocean freight:** RoRo $1,500–1,800 · Container $2,000+ · Special $5,000 · Air $10,000–20,000.

**Multi-origin (German G-Wagon sourcing):** origin changes the freight leg and CIF basis only. The Nigerian stack applies identically at port of entry. Origin is a rate-table variable, not a new model.

### 4.4 Client-facing presentation
Show **both** the expected case (observed actuals) and the official ceiling, framed as *"estimated — final assessment determined by Customs at clearance."* Protects the client from surprise and the business from an agent change or tightened enforcement.

---

## 5. Estimator Track (design locked, not started)

- **AI never generates a price.** Deterministic statistics over real transaction records. AI parses search intent and writes explanations only.
- **Data sources, ranked:** own ledger → bid.cars/Bidfax sold-history harvesting (the pragmatic core) → commercial APIs only if harvesting hours cap out → Copart member data off-limits (ToS risk to the bidding account).
- **Taxonomy:** NHTSA vPIC (free, keyless) for makes/models/years and VIN decoding; curated `trim_canonical` ladders for ~30 corridor models (~1,500 rows, AI-drafted and human-reviewed).
- **Standardisation resolver, three tiers:** exact/alias lookup → `pg_trgm` fuzzy → constrained Gemini classification among candidates → abstain below confidence. **Not RAG** — this is a small structured reference table, not unstructured knowledge.
- **Doctrine:** raw at capture, classify at read. Mileage bands (0–30k/30–60k/60–90k/90–120k/120k+), ~6 damage classes (flood specially flagged), 4 title classes — all derived at query time.
- **Granularity:** capture at year level; aggregate to generation when the sample is thin, and disclose it.
- **Funnel:** first search free → second requires a free Google account → unbundled optional marketing consent framed as price alerts → "Request exact quote incl. repair estimate" → staff queue. Repair estimation stays human.
- **Sequence:** E1 harvest → E2 standardisation → E3 stats engine → E4 public MVP → E5 analytics. **E4 must not precede E1–E3** — an estimator over thin data produces visibly wrong numbers and burns the early users who matter most.

---

## 6. Guardrails & Data Integrity

**Capture eligibility (attach time, two layers — modal filter + service validation):**
- `sold_comps` → `price_usd` present AND `current_bid_usd` null AND `lot_state ≠ 'active'`
- `active_listings` → any auction source AND `lot_state ≠ 'finished'` (bids **not** required — an unbid live lot is a valid option)
- `mixed` → either

**Pre-share checklist:** duplicate `asset_id` (BLOCK) · zero included listings (BLOCK) · fewer than 3 priced comps (WARN) · missing prices (WARN) · mixed models in a sold_comps run (WARN) · non-insurance seller (WARN). Offenders highlighted in the listings table.

**Risk rules:** avoid non-insurance sellers · flood flagged as a distinct damage class · vehicles appearing across multiple auctions (especially with *decreasing* damage severity between appearances) indicate wreck-and-flip and must be blocked from client deliverables.

**Honesty doctrine:** show sample size · widen and disclose rather than fake precision · show the comps · abstain and flag · date every snapshot.

---

## 7. BUILD SEQUENCE v4 (from here)

### Phase A — Close out data quality (small, high value)
- **A1.** Filter `sold_comps` runs to `sale_confirmed = true`. *Directly protects the market-research average from rejected-bid pollution — the single highest-value remaining fix.*
- **A2.** Derived asset flags from `auction_history`: `appearance_count`, `previously_unsold`, `cross_platform_reappearance`, `highest_rejected_bid`. Add corresponding pre-share checklist rules.
- **A3.** Extension run-picker — dropdown of active runs replacing the typed UUID.

### Phase B — Coverage
- **B1.** IAAI content script (same schema; image permutation `[2,1,4,3]`). Present in the original Camry sheet; the one source still missing.
- **B2.** Copart Sales History (if exposed) — parity with bid.cars.

### Phase C — Landed cost
- **C1.** `cost_rates` table + admin screen (trucking tiers, freight methods, agent fees). **Not blocked** — buildable now.
- **C2.** Duty calculator using the verified 51.47% formula, with observed-actual calibration. **Blocked** on collecting 10+ assessment notices.
- **C3.** Client-facing grouped cost display (Vehicle · Shipping & logistics · Duties & clearing · Service fee · Total), showing expected and ceiling.

### Phase D — Client operations
`clients`, `client_vehicles`, `vehicle_status_events` (state machine), `documents`, `invoices` — all org-scoped and audited → staff dashboard build-out → client portal (Google auth, status timeline, shareable tracking link, documents) → "Request this vehicle" loop → email notifications → subdomain split → Chrome Web Store private publish.

**Status lifecycle:** RESEARCHED → RECOMMENDED → REQUESTED_BY_CLIENT → BID_PLACED → WON / LOST → PAID → AT_US_PORT → ON_VESSEL → ARRIVED_DESTINATION_PORT → CUSTOMS_CLEARANCE → READY_FOR_COLLECTION → DELIVERED (+ CANCELLED). Enum + audited transitions; extensible by migration.

### Phase E — Estimator
E1 → E5 per §5. Harvest mode (E1) may start early since comps compound weekly.

### Phase F — Intelligence (needs accumulated data; deliberately last)
Daily Sniper (vision ingestion, `NOT_VISIBLE` anti-hallucination prompt) · Market Velocity Index · decay model · arbitrage detection · origin premium spread · repair-cost dataset exploitation.

### Sequencing rules (binding)
- One step ≈ one prompt ≈ ≤3 files where the change is not genuinely one thing.
- No step starts before the previous checkpoint is verified **in the browser or database** — compile success is not verification.
- Commit after every verified checkpoint.

---

## 8. Debt Register

1. Data Detox (`handleCleanData`) disabled — targeted the locked `sales` table.
2. CSV `importSales` disabled pending ledger-shaped re-implementation or removal.
3. `standardizeTrims` / `executeTrimCleanup` stubbed → superseded by the E2 resolver.
4. Copart model/trim duplication backfill (`model LIKE '% ' || trim`).
5. Three client-side Gemini utility calls still use `VITE_GEMINI_API_KEY` (absent from Vercel; local dev only). Server-side at Phase F.
6. Gemini key should be reissued under the caplimoltd Google Cloud project.
7. `sales` table physical drop (currently RLS-locked, retained as backup).
8. Google Workspace decision for `theautodata.com` — needed before Chrome Web Store private publish.
9. **AutoData ↔ Caplimo licence on paper — before Fahad or Ahmed receive staff logins.**
10. No staging environment; production Supabase doubles as the dev database.
11. Google OAuth consent screen should remain in "Testing" with an explicit test-user list until the client portal ships.
12. Assessment notices must be photographed before handover — ongoing habit, not a task.

---

## 9. Decisions Log

| Decision | Resolution |
|---|---|
| Ownership | Bashir sole owner; Caplimo licensee / tenant #1; multi-tenant from day one |
| Capture method | Real-browser extension, never headless scraping |
| bid.cars images | Extension-side upload (Cloudflare blocks servers entirely) |
| Two deliverables | Distinct products; one table + `run_type`; display and averaging branch |
| Sold comps | Must be `sale_confirmed`; "Final bid" alone is not a sale |
| Capture dedup | Live lots overwrite; finished lots accumulate immutably |
| Eligibility | Keyed on lot state, not platform |
| Currency | Normalise to `price_usd` at capture; freeze the rate; never average raw prices |
| Averages | Minimum n=3 or explicit caveat; always show sample size |
| Public data access | Edge Function allow-list, never a public RLS policy |
| Storage | Supabase Storage only; Drive/Sheets dropped |
| Vision model | Gemini `gemini-3.1-flash-lite`, server-side, superadmin-gated |
| Vision prompting | `NOT_VISIBLE` escape hatch; base manufacturer in Make, coachbuilder in Trim |
| Taxonomy resolver | Deterministic-first three tiers, not RAG |
| Brokerage pricing | Tiered 7/5/3 with $500 floor (provisional) |
| Retail pricing | 8–12% below Nigerian market comp, value-based not cost-plus |
| Manheim | Sourcing channel for retail, not a third product |
| Repair estimation | Stays human indefinitely |
| Duty | 51.47% of declared CIF; show expected and ceiling |
| Rates | Dated tables with admin screen, never hardcoded |
| Verification standard | Browser/DB-verified, not compile-verified |

---

## 10. What This Solves

The problem this project began with — two hand-built Excel sheets per client — is **solved in production**. A client now receives a mobile link showing curated vehicles with photos, specs, prices, and (for market research) a real average with its sample size disclosed.

Everything remaining turns a working deliverable into a platform: better data quality, wider source coverage, landed-cost transparency, client self-service, and eventually a public estimator that turns the accumulated ledger into a lead-generation engine for the brokerage.

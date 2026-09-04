# ARCHITECTURE.md — AutoData as built

**Status:** v5. Supersedes `AutoData_Architecture_Plan_v4.md`.
**Owner:** Bashir (platform owner / superadmin)
**Domain:** `theautodata.com` (live)
**Last revised:** 28 August 2026
**Companions:** `PROJECT_CHARTER.md` · `DECISIONS.md` · `PLAN_TRACKER.md` · `SCHEMA.md` · `AGENTS.md`

> Describes **how the system is built**. It does **not** record work status — that lives in
> `PLAN_TRACKER.md`, deliberately, because v4 carried a "nothing is blocked or broken" line
> that stopped being true within a day.
>
> **v5 changes from v4:** status moved out to `PLAN_TRACKER.md` · schema detail moved to
> `SCHEMA.md` · agent rules moved to `AGENTS.md` · records migrations 020–022 · corrects the
> A1 rule from a blunt filter to the source-aware version · adds the clients/briefs layer ·
> adds the countdown and critical-block layers · notes the `current_bid_usd` class of bug.

---

## 1. The spine

**Supabase is the single source of truth.** The extension, staff dashboard, public share
pages and future portal/estimator are all clients of it.

```
                    ┌────────────────────────────────┐
                    │  SUPABASE (xrotvpuainpfdulh…)  │
                    │  Postgres + Auth + Storage     │
                    │  + Edge Functions + RLS        │
                    └────────────────────────────────┘
         ▲              ▲               ▲              ▲
   ┌─────┴────┐  ┌──────┴──────┐  ┌─────┴─────┐  ┌─────┴───────┐
   │ Chrome   │  │  Staff      │  │  Public   │  │ Estimator / │
   │ Extension│  │  Dashboard  │  │  Share    │  │ Portal      │
   │ (capture)│  │             │  │           │  │ (future)    │
   └──────────┘  └─────────────┘  └───────────┘  └─────────────┘
```

**Stack**
- **Frontend:** React 19 + Vite + TypeScript on Vercel. Local dev `localhost:3000`.
  No router — see §7.
- **Backend:** Supabase (Postgres, Auth, Storage, Deno Edge Functions).
  Project ref `xrotvpuainpfdulhfhtt`.
- **Capture:** Chrome extension, Manifest V3, unpacked. Reads Copart and bid.cars DOM inside
  the user's authenticated browser session.
- **Auth:** Supabase Auth, Google OAuth only. Whole app gated.
- **Vision:** Gemini `gemini-3.1-flash-lite`, server-side only.

**Secrets doctrine:** anything `VITE_`-prefixed is public. Only the Supabase URL and anon key
belong client-side. All real secrets live in Edge Function secrets.

**Storage:** Supabase Storage for all images and documents. Private bucket `vehicle-images`,
org-scoped paths `{org_id}/{sighting_id}/{NN}.jpg`, served via signed URLs (7-day on public
pages, falling back to source URLs when not stored). Google Drive and Sheets permanently
dropped.

**Key identifiers:** Caplimo `org_id` `a93378ea-33ef-4c75-97c4-44c37f2e9002`.
Superadmins in `PROJECT_CHARTER.md` §3.

---

## 2. Capture layer

The extension is **deliberately not a scraper**. It reads the DOM inside a real,
authenticated browser session, which defeats Cloudflare by being a genuine user.

- ~30 structured fields per vehicle: VIN, year/make/model/trim, mileage + odometer brand,
  title type, primary/secondary damage, body style, cylinders, engine type, horsepower,
  transmission, fuel, drivetrain, colour, current bid, estimated retail value, has-key,
  run-and-drive, engine-starts, transmission-engages, seller type, location, sale date,
  bid.cars import-cost estimates.
- **VIN fingerprint dedup** (SHA256) with cross-source COALESCE enrichment: the same VIN on
  two platforms becomes one enriched asset with two sightings.
- **`lot_state` detection** on both platforms. Copart page-readiness guard prevents capturing
  a half-rendered Angular page.
- **bid.cars finished-lot capture** — final sale price → `listed_price`.
- **Sales History capture** → `auction_history`: every past auction appearance with date,
  lot, bid, odometer, status, seller. bid.cars only; Copart has no equivalent yet.
- **Dedup:** live lots overwrite on re-capture; finished lots accumulate immutably.
- **Deletion** with confirmation, superadmin-only, cascading cleanup of orphan assets.

### Image pipeline
- **Copart:** server-side fetch → private Supabase Storage bucket.
- **bid.cars:** **extension-side upload.** Cloudflare Bot Management blocks all server-side
  fetching of `pluto.bid.car` (verified 403 with full browser headers), so the extension
  fetches bytes in page context — where the origin is `bid.cars` — and POSTs them.
  **This pattern generalises to any future source that blocks servers.**

---

## 3. Data model

Full column-level detail in `SCHEMA.md`. The shape:

- **`assets`** — one row per physical vehicle. Market intelligence.
- **`sightings`** — one row per observation. Carries org, mechanism, price, lot state,
  sale confirmation, raw payload.
- **`auction_history`** — past auction appearances.
- **`research_runs`** / **`research_run_listings`** — client deliverables, curation,
  ordering, share tokens, override audit, client/brief links.
- **`clients`** / **`client_briefs`** — client records and their buying briefs (022).
- **`organizations`** / **`memberships`** — tenancy and roles.
- **`sales`** — DEPRECATED legacy flat table, RLS-locked with zero policies. Do not touch.

**Three distinctions that carry weight:**
1. `logged_via` (mechanism) and `source_platform` (where seen) are different axes.
2. `lot_state` determines eligibility — never platform, and **never `current_bid_usd`**.
3. Live lots overwrite; finished sightings accumulate immutably.

---

## 4. Client deliverables — live

Research runs: create, list, detail, curate (include/exclude), drag-and-drop ordering,
share-token generation and rotation.

**`run_type` drives display and averaging:**

| Type | Display | Average |
|---|---|---|
| `sold_comps` | Four-image grid, sale price per vehicle | Average sale price **with sample size** |
| `active_listings` | Single thumbnail → gallery, current bid, auction countdown | **None** — averaging live bids is misleading |
| `mixed` | Both sections | Sold section only |

**Capture eligibility, enforced at attach time** in two layers (modal filter + service
validation), keyed on lot state:

- `sold_comps` → `price_usd` present AND `current_bid_usd` null AND `lot_state ≠ 'active'`
  AND **not** `sale_confirmed = false`
- `active_listings` → any auction source AND `lot_state ≠ 'finished'`
  (bids **not** required — an unbid live lot is a valid option)
- `mixed` → either

**Public delivery:** `public-run` Edge Function with a strict field allow-list — never a
public RLS policy on a ledger table. Generic 404 for both a bad token and sharing-disabled.
`PublicRunView` is mobile-first, snapshot-dated, and reuses the shared `VehicleDetailModal`
with internal fields hidden. Static Open Graph meta tags for link previews.

---

## 5. Guardrails — the pre-share checklist

Three severity tiers (`DECISIONS.md` 4.9):

**Hard block — never overridable**
- Duplicate `asset_id` in the run
- Zero included listings

**Critical (red) — review tick + typed reason, recorded**
*Active listings only. Never sold comps.*
- Critical damage keywords in either damage field (case-insensitive substring — see
  `SCHEMA.md` §4). Covers mechanical, water/flood, burn, damage history, partial/rejected
  repair, undercarriage, unknown, frame, rollover, stripped, all-over, biohazard/chemical,
  VIN tampering, and ambiguous storm damage.
- Damage field empty or missing (unknown damage)
- `runs_and_drives` not `true`
- Spec breaches against a linked brief: mileage over max · year outside range ·
  not run-and-drive · title type not accepted

**Warn (yellow) — review tick alone**
- Fewer than 3 priced comps · missing prices · mixed models in a sold-comps run ·
  non-insurance seller · unconfirmed sale · soft spec mismatches (colour, transmission,
  fuel, trim)

The typed override reason persists to `research_runs.critical_override_reason` / `_by` /
`_at`, giving a dated record of who decided and why.

### Sale verification (A1)
`sold_comps` averaging is source-aware, not a blanket filter — see `DECISIONS.md` 4.2 and
`SCHEMA.md` §7 for the full three-state rule and the Yaris case that produced it.

The **average, the displayed sample size, and the `<3 comps` warning all read the counted
set**, never total attached rows. Otherwise exclusions become invisible to the exact
guardrail meant to catch thin samples.

### Spec matching
Runs only when a brief is linked, and only on active listings. Null / empty / `'either'`
never fires. A missing value on the *listing* never fires either.

---

## 6. Auction timing

`sale_date` is display text, not a timestamp (`SCHEMA.md` §6). All time logic goes through
the shared `parseAuctionDate()` helper in `src/utils/auctionDate.ts`, which returns a real
`Date` or `null` — never a fallback.

`AuctionCountdown` renders on active listings on **both** the staff and public views, holding
its own clock (30-second tick) so the parent never re-renders — an earlier per-second parent
tick caused the Add Captures modal to flicker open and closed.

States: live countdown · under 48h **red** · 48h+ **amber** · under 1 hour most urgent ·
auction passed muted · unparseable → "Auction date TBC", no countdown.

`sale_date` was added to the `public-run` allow-list (28 Aug) so the public page receives it.

---

## 7. Navigation — current state

**There is no router.** `react-router` is not installed. `App.tsx` matches
`/share/:token` manually and renders `PublicRunView`; everything else goes through
`AuthProvider` → `AuthGate` → `MainDashboard`, which swaps screens with `useState`
(`setView('dashboard' | 'list' | 'bulk-import' | 'research' | 'research-detail')`).

So `/share/:token` is the only real URL in the application.

This is a deliberate deferral (`DECISIONS.md` 8.4): converting now would touch every screen
and control at once, with no staging environment, for no visible benefit. Routing arrives
with the client portal in Phase D, which needs its own address anyway.

---

## 8. Operations

- **Automated monthly backup** — pg_cron → Edge Function → six CSVs → Resend to two
  addresses. Verified end-to-end including a real scheduled run. This is the pattern the
  auction alerts should reuse.
- **Currency normalisation** — `price_usd`, `exchange_rate` and `exchange_rate_date` frozen
  at capture, with live FX fetch. NGN and USD both verified.
- **Access** — dashboard and vehicle log restricted to superadmin; legacy `sales` table
  locked at the database level.
- **Migrations** — 001 → 022 applied. Always verify the next free number before creating a
  file (`AGENTS.md` §4.2).

---

## 9. What this solves

The problem the project began with — two hand-built Excel sheets per client — is **solved in
production**. A client receives a mobile link showing curated vehicles with photos, specs,
prices, auction countdowns, and (for market research) a real average with its sample size
disclosed.

Everything remaining turns a working deliverable into a platform: better data quality, wider
source coverage, landed-cost transparency, client self-service, and eventually a public
estimator that turns the accumulated ledger into a lead-generation engine for the brokerage.

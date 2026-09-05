# REPO_MAP.md — Read-only code inventory

**Status:** Snapshot only. Not a living document — regenerate rather than hand-edit.
**Generated:** 4 September 2026, by AI agent inventory pass (read-only; no code/doc/DB changes).
**Scope:** `src/`, `supabase/` only. Excludes node_modules, build output, lockfiles.

---

## Section A — File tree

```
src/
  App.tsx                          — top-level view router (state-based, no URL router); owns
                                      legacy sales CRUD, currency/exchange state, Data Detox stub,
                                      trim cleanup stub, and mounts ResearchRuns / ResearchRunDetail /
                                      ClientsList / PublicRunView / CarForm / Dashboard / CarTable / BulkImport
  index.tsx                        — React root mount
  types.ts                         — CarSale / Currency / CarStats / RecordType / SortField types
  vite-env.d.ts                    — Vite env typing

  components/
    AddCapturesModal.tsx           — modal to search unattached sightings and attach to a run;
                                      contains its own eligibility-rule copy (isUnconfirmed etc.)
    AuctionCountdown.tsx           — renders live countdown from parseAuctionDate(); 30s tick
    BulkImport.tsx                 — paired-image upload → Gemini vision extraction → review → save
    CarForm.tsx                    — legacy single-sale entry form (sales/ledger, not client briefs)
    CarTable.tsx                   — legacy sales table view (sort/filter/bulk-delete)
    ClientsList.tsx                — clients + buying-briefs UI; contains BriefForm (brief create/edit)
    Dashboard.tsx                  — charts/stats + Gemini market forecast panel
    LoginScreen.tsx                — Google OAuth sign-in screen
    PublicRunView.tsx              — public /share/:token client-facing view (reads public-run function)
    ResearchRunDetail.tsx          — single run's detail page: checklist, sharing, listings table
    ResearchRuns.tsx               — runs list page + "New Research Run" creation form
    VehicleDetailModal.tsx         — shared listing detail modal (staff + public variants)

  contexts/
    AuthContext.tsx                — session/org/role context (superadmin/staff/client)

  services/
    currencyService.ts             — exchange rate fetch/cache + USD conversion helpers
    geminiService.ts                — client-side Gemini calls (vision extraction proxies to Edge
                                      Function; 3 direct client-side Gemini SDK calls remain)
    researchService.ts             — all research_runs / research_run_listings / clients /
                                      client_briefs CRUD + spec-matching helper duplicate
    storageService.ts              — legacy `sales`-table-era CRUD; importSales/standardizeTrims/
                                      executeTrimCleanup are disabled/stubbed here
    supabaseClient.ts               — supabase-js client singleton

  utils/
    auctionDate.ts                 — parseAuctionDate() — the one shared date parser

supabase/
  functions/
    app-ingest/index.ts            — CarForm/BulkImport ledger writes; JWT + superadmin
    daily-sniper/index.ts          — built, unused; static x-sniper-secret auth
    extract-vehicle-vision/index.ts — server-side Gemini vision extraction; JWT + superadmin
    monthly-backup/index.ts        — pg_cron-triggered CSV export via Resend; static x-backup-secret
    public-run/index.ts            — public share-token deliverable; strict field allow-list
    research-capture/index.ts      — Chrome extension capture ingest; static x-research-secret
    store-images/index.ts          — server-side (Copart) image fetch/store; JWT required
    upload-images/index.ts         — extension-side (bid.cars) image byte upload; static secret

  migrations/
    001_create_sales.sql                  — legacy sales table (now deprecated/locked)
    002_create_assets_sightings.sql        — core assets/sightings ledger + source_platform_enum
    003_extend_assets_sightings.sql        — adds current_bid_usd, sale_date, has_key, etc.
    004_add_odometer_brand.sql
    005_add_bidcars_fields.sql             — adds source_auction_platform
    006_multitenant_foundation.sql          — organizations/memberships/org_id
    008_sightings_created_by.sql
    009_research_run_sharing.sql            — research_runs + share_token/share_enabled
    010_price_usd_normalisation.sql
    011_sighting_lot_state.sql              — adds lot_state
    012_run_type.sql
    013_backup_cron.sql
    014_stored_images.sql
    015_image_store_error.sql
    016_soft_delete_runs.sql
    018_lock_sales_table.sql
    019_auction_history.sql                 — auction_history table + sale_confirmed
    020_auction_history_cascade.sql
    021_critical_override.sql               — critical_override_reason/by/at on research_runs
    022_clients_briefs.sql                  — clients + client_briefs tables
    023_soft_delete_clients_briefs.sql      — deleted_at/deleted_by on clients/client_briefs
```
(Migration 007 and 017 are absent from the tree — not further investigated, out of scope.)

---

## Section B — Where the important things live

### B.1 Pre-share checklist rules (every rule, with location)
All defined inline in `src/components/ResearchRunDetail.tsx`, inside the render function, as
pushes onto a local `checklistItems` array:

1. Zero included listings (BLOCK) — `ResearchRunDetail.tsx:331`
   `  checklistItems.push({`  (id: `'zero_listings'`)
2. Duplicate vehicle by VIN (BLOCK) — `ResearchRunDetail.tsx:351`
   `  checklistItems.push({` (id: `'duplicate'`)
3. Critical damage / not-confirmed-run-and-drive (CRITICAL, active/mixed only) — `ResearchRunDetail.tsx:391`
   `    criticalByReason.forEach((ids, reason) => {`
4. Spec-match CRITICAL/WARN rules from client brief (active/mixed only, see B.6) — `ResearchRunDetail.tsx:472` and `:482`
5. No USD price (WARN) — `ResearchRunDetail.tsx:496`
   `  checklistItems.push({` (id: `'no_price'`)
6. Non-insurance seller (WARN) — `ResearchRunDetail.tsx:506`
   `  checklistItems.push({` (id: `'non_insurance'`)
7. Limited sample <3 sales (WARN, sold/mixed only) — `ResearchRunDetail.tsx:520`
   `    checklistItems.push({` (id: `'limited_sample'`)
8. Mixed models in a market-research group (WARN, sold/mixed only) — `ResearchRunDetail.tsx:557`
   `    checklistItems.push({` (id: `'different_model'`)
9. Unconfirmed sale (WARN, sold/mixed only) — `ResearchRunDetail.tsx:567`
   `    checklistItems.push({` (id: `'unconfirmed_sale'`)

### B.2 Hard-block / critical / warn tiering logic
`src/components/ResearchRunDetail.tsx:576-581`
```
576	  const hasBlocks = checklistItems.some(i => i.type === 'BLOCK' && !i.passed);
577	  const hasCriticals = checklistItems.some(i => i.type === 'CRITICAL' && !i.passed);
578	  const hasWarnings = checklistItems.some(i => i.type === 'WARN' && !i.passed);
579	  const canShare = !hasBlocks && 
580	    (!hasCriticals || (warningsReviewed && criticalOverrideReason.trim().length >= 10)) &&
581	    (!hasWarnings || warningsReviewed);
```
BLOCK always disables sharing regardless of overrides. CRITICAL requires the reviewed checkbox
plus a ≥10-character override reason. WARN-only requires just the reviewed checkbox.

### B.3 `isUnconfirmed` — both copies (debt register item 3) — CONFIRMED duplicated
Copy 1 — `src/services/researchService.ts:568`
`  const isUnconfirmed = l => l.sale_confirmed === false;`
Copy 2 — `src/components/AddCapturesModal.tsx:45`
`        const isUnconfirmed = (l: any) => l.sale_confirmed === false;`
Both are logically identical (`sale_confirmed === false`), each locally scoped inside its own
eligibility-gate function, not imported from a shared module.

### B.4 `parseAuctionDate` — definition and every call site
Definition — `src/utils/auctionDate.ts:1`
`export function parseAuctionDate(raw: string | null | undefined): Date | null {`
Only call site — `src/components/AuctionCountdown.tsx:18`
`  const d = parseAuctionDate(saleDateText);`
(Import at `AuctionCountdown.tsx:2`.) No other file in `src/` or `supabase/` calls it — grep
for `parseAuctionDate` across the repo returns exactly these three lines (definition, import,
call).

### B.5 Client-brief creation form — component and exact rendered input fields, in render order
Component: `BriefForm` inside `src/components/ClientsList.tsx:7-140` (both create and edit use
the same component; `initialData.id` present ⇒ edit mode).

Inputs rendered, in order, each with its line:
1. Make — text — `ClientsList.tsx:35`
2. Model — text — `ClientsList.tsx:39`
3. Trim — text — `ClientsList.tsx:44`
4. Quantity — number — `ClientsList.tsx:48`
5. Min Year — number — `ClientsList.tsx:54`
6. Max Year — number — `ClientsList.tsx:58`
7. Max Mileage — number — `ClientsList.tsx:64`
8. Transmission — select (either/automatic/manual) — `ClientsList.tsx:69`
9. Fuel Type — select (either/petrol/diesel/hybrid/electric) — `ClientsList.tsx:78`
10. Condition Required — select (either/run_and_drive/starts_needs_work/non_running/salvage_only) — `ClientsList.tsx:89`
11. Exterior Colour Preference — text — `ClientsList.tsx:100`
12. Interior Preference — text — `ClientsList.tsx:105`
13. Max Budget (USD) — number — `ClientsList.tsx:110`
14. Max Bid (USD) — number — `ClientsList.tsx:115`
15. Titles Accepted (comma separated) — text — `ClientsList.tsx:120`
16. Additional Notes — textarea — `ClientsList.tsx:128`

### B.6 Spec-matching rules against a client brief — rules (a)–(g), where defined
All in `src/components/ResearchRunDetail.tsx`, inside `if (brief) { ... }` at line 403, only
evaluated for `activeList` (active_listings or mixed run types, non-finished lots):

- (a) Max mileage exceeded — CRITICAL — `ResearchRunDetail.tsx:414`
  `        if (brief.max_mileage != null && l.mileage_miles != null && l.mileage_miles > brief.max_mileage) {`
- (b) Below minimum year — CRITICAL — `ResearchRunDetail.tsx:417`
  `        if (brief.year_min != null && l.year != null && l.year < brief.year_min) {`
- (c) Above maximum year — CRITICAL — `ResearchRunDetail.tsx:420`
  `        if (brief.year_max != null && l.year != null && l.year > brief.year_max) {`
- (d) Condition required = run_and_drive not met — CRITICAL — `ResearchRunDetail.tsx:423`
  `        if (brief.condition_required != null && brief.condition_required !== 'either' && brief.condition_required === 'run_and_drive') {`
- (e) Title type not in accepted list — CRITICAL — `ResearchRunDetail.tsx:428`
  `        if (brief.titles_accepted != null && brief.titles_accepted.length > 0 && l.title_type != null) {`
- (f) Colour differs — WARN — `ResearchRunDetail.tsx:450`
  `        if (brief.colour_preference != null && brief.colour_preference !== '' && brief.colour_preference.toLowerCase() !== 'either' && l.exterior_color != null) {`
  Transmission differs — WARN — `ResearchRunDetail.tsx:455`
  Fuel type differs — WARN — `ResearchRunDetail.tsx:460`
- (g) Trim differs — WARN — `ResearchRunDetail.tsx:465`
  `        if (brief.trim != null && brief.trim !== '' && brief.trim.toLowerCase() !== 'either' && l.trim != null) {`

(Colour/transmission/fuel/trim are four separate WARN rules at lines 450/455/460/465 — grouped
above as one "(f)/(g)" pair only because the prompt names 7 slots (a)-(g) for what is actually
8 individual `if` blocks; every block is listed with its own line number.)

### B.7 `ResearchRunDetail` — file and every component/hook/service it imports
File: `src/components/ResearchRunDetail.tsx:1-21`
```
1	import React, { useState, useEffect } from 'react';
2	import { useAuth } from '../contexts/AuthContext';
3	import { 
4	  getRun, 
5	  listRunListings, 
6	  updateRun, 
7	  setListingIncluded, 
8	  reorderListings, 
9	  removeListingFromRun, 
10	  rotateShareToken,
11	  storeImagesForRun,
12	  getSignedImageUrls,
13	  softDeleteRun,
14	  ResearchRun,
15	  RunListing,
16	  deleteSighting
17	} from '../services/researchService';
18	import AddCapturesModal from './AddCapturesModal';
19	import VehicleDetailModal from './VehicleDetailModal';
20	import AuctionCountdown from './AuctionCountdown';
21	import { ArrowLeft, Edit2, Check, ArrowUp, ArrowDown, Plus, Trash2, Loader2, Link as LinkIcon, Copy, RefreshCw, ImageIcon, GripVertical, AlertTriangle, X } from 'lucide-react';
```
React hooks used: `useState`, `useEffect` (React), `useAuth` (custom context hook).
Components: `AddCapturesModal`, `VehicleDetailModal`, `AuctionCountdown`.
Service functions: 13 named imports from `researchService` as listed above, plus types `ResearchRun`/`RunListing`.

### B.8 Research run creation form + runs list page
Both in `src/components/ResearchRuns.tsx` (single file, no separate creation-form component):
- Runs list rendering — `ResearchRuns.tsx:315-373`
- Creation form (`showNewForm` block) — `ResearchRuns.tsx:170-280`, submitted by `handleCreateRun` — `ResearchRuns.tsx:75-100`

### B.9 Service files reading/writing `research_runs`, `research_run_listings`, `clients`, `client_briefs`
- `src/services/researchService.ts` — sole service file touching all four tables (listRuns,
  createRun, getRun, updateRun, softDeleteRun, listDeletedRuns, restoreRun for `research_runs`;
  listRunListings, setListingIncluded, reorderListings, attachSightingToRun,
  removeListingFromRun for `research_run_listings`; listClients/createClient/updateClient/
  softDeleteClient/listDeletedClients/restoreClient for `clients`; listClientBriefs/
  createClientBrief/updateClientBrief/softDeleteClientBrief/listDeletedClientBriefs/
  restoreClientBrief for `client_briefs`).
- `supabase/functions/public-run/index.ts:57-105` — reads `research_run_listings` (joined to
  `sightings`/`assets`) and the parent `research_runs` row (read via `run` fetched earlier in
  the file, not shown in this excerpt).
No other file in `src/` or `supabase/` references these four table names directly (confirmed
via `grep -rn "research_runs\|research_run_listings\|from('clients')\|from(\"clients\")\|client_briefs" src supabase`).

### B.10 Share-token generation/rotation code
Generation (on run create) — `src/services/researchService.ts:129-131`
```
129	  const share_token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
130	    .map(b => b.toString(16).padStart(2, '0'))
131	    .join('');
```
Rotation — `src/services/researchService.ts:635-650`, function `rotateShareToken`:
```
635	export const rotateShareToken = async (runId: string): Promise<string> => {
636	  const share_token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
637	    .map(b => b.toString(16).padStart(2, '0'))
638	    .join('');
```
UI trigger — `src/components/ResearchRunDetail.tsx:125-133`, function `handleRotateToken`
(confirms via `window.confirm` before calling `rotateShareToken`).

### B.11 Every place `current_bid_usd` appears
| File:Line | Quoted line | Value or condition |
|---|---|---|
| `src/components/PublicRunView.tsx:100` | `const currentBid = typeof listing.current_bid_usd === 'number' ? listing.current_bid_usd : null;` | value |
| `src/components/PublicRunView.tsx:220` | `const soldListings = listings.filter(l => l.current_bid_usd === null);` | condition |
| `src/components/PublicRunView.tsx:221` | `const activeLivListings = listings.filter(l => l.current_bid_usd !== null);` | condition |
| `src/components/AddCapturesModal.tsx:48` | `const eligibleSold = (l: any) => hasValue(l.price_usd) && !hasValue(l.current_bid_usd) && l.lot_state !== 'active' && !isUnconfirmed(l);` | condition |
| `src/components/VehicleDetailModal.tsx:74` | `current_bid_usd?: number \| null;` | type decl |
| `src/components/VehicleDetailModal.tsx:118` | `const currentBid = typeof listing.current_bid_usd === 'number' ? listing.current_bid_usd : null;` | value |
| `src/components/ResearchRunDetail.tsx:297` | `{ label: "Market Research (Sold)", stats: getStats(includedListings.filter(l => l.lot_state !== 'active' && l.current_bid_usd === null), true), type: 'sold' },` | condition (combined with `lot_state`) |
| `src/components/ResearchRunDetail.tsx:298` | `{ label: "Client Options (Live)", stats: getStats(includedListings.filter(l => l.lot_state !== 'finished' && l.current_bid_usd !== null), false), type: 'active' }` | condition (combined with `lot_state`) |
| `src/components/ResearchRunDetail.tsx:1026` | `? (listing.current_bid_usd !== null ? 'Current bid' : 'Sale / Listed Price')` | condition (label choice, not liveness) |
| `src/services/researchService.ts:73` | `current_bid_usd: number \| null;` | type decl |
| `src/services/researchService.ts:462` | `current_bid_usd: raw.current_bid_usd ?? null,` | value (sourced from `sighting.raw_payload`, not the `current_bid_usd` column) |
| `src/services/researchService.ts:561` | `current_bid_usd: sightingData.raw_payload?.current_bid_usd ?? null,` | value (sourced from `raw_payload`) |
| `src/services/researchService.ts:571` | `const eligibleSold = (l: any) => hasValue(l.price_usd) && !hasValue(l.current_bid_usd) && l.lot_state !== 'active' && !isUnconfirmed(l);` | condition (combined with `lot_state`) |
| `src/services/researchService.ts:737` | `current_bid_usd: row.raw_payload?.current_bid_usd ?? null,` | value (sourced from `raw_payload`) |
| `supabase/functions/public-run/index.ts:74` | `          current_bid_usd,` | selected column (real `sightings.current_bid_usd`, not raw_payload) |
| `supabase/functions/public-run/index.ts:185` | `        current_bid_usd: sighting.current_bid_usd,` | value (real column) |
| `supabase/functions/public-run/index.ts:213` | `? publicListings.filter((l: any) => l.current_bid_usd === null)` | condition |
| `supabase/functions/research-capture/index.ts:206-210` | `const listedPriceToSave = (cf.current_bid_usd !== null && cf.current_bid_usd !== undefined) ? null : (cf.listed_price ?? null);` / `if (cf.current_bid_usd !== null && cf.current_bid_usd !== undefined) { priceUsd = cf.current_bid_usd; }` | condition + value |
| `supabase/functions/app-ingest/index.ts:198-200` | `if (v.current_bid_usd != null) {` / `price_usd = v.current_bid_usd;` | condition + value |
| `supabase/migrations/003_extend_assets_sightings.sql:13` | `ADD COLUMN IF NOT EXISTS current_bid_usd numeric,` | column definition |
| `supabase/migrations/010_price_usd_normalisation.sql:8,13` | `SET price_usd = COALESCE(current_bid_usd, listed_price),` | value |
| `supabase/migrations/011_sighting_lot_state.sql:6` | `WHERE lot_state IS NULL AND current_bid_usd IS NOT NULL;` | condition |

None of these uses `current_bid_usd` truthiness/null-checks as the sole determinant of
liveness without also gating on `lot_state` — checked specifically because of AGENTS.md §4.1's
three past bugs. Two files (`researchService.ts`, `AddCapturesModal.tsx`, `ResearchRunDetail.tsx`)
combine it with `lot_state` in every eligibility/grouping check found. Note: `researchService.ts`
reads `current_bid_usd` from `raw_payload` (JSON blob) rather than the real `sightings.current_bid_usd`
column that `public-run/index.ts` reads directly — both paths exist in the codebase side by side.
Search command used: `grep -rn "current_bid_usd" src supabase`.

### B.12 Every place `source_platform` or `auction_platform` appears
`source_platform`:
| File:Line | Quoted line |
|---|---|
| `src/components/VehicleDetailModal.tsx:79` | `source_platform?: string;` |
| `src/components/VehicleDetailModal.tsx:337` | `{typeof listing.source_platform === 'string' && listing.source_platform ? listing.source_platform : 'Unknown'}` |
| `src/components/ResearchRunDetail.tsx:1039` | `{listing.source_platform}` |
| `src/components/AddCapturesModal.tsx:43` | `const isAuctionSource = (l: any) => ['copart','bidcars','iaai'].includes(l.source_platform);` |
| `src/components/AddCapturesModal.tsx:77` | `s.source_platform.toLowerCase().includes(term)` |
| `src/components/AddCapturesModal.tsx:227` | `src={s.source_platform === 'copart' && s.image_urls[0].includes('_ful.jpg') ? s.image_urls[0].replace('_ful.jpg', '_thb.jpg') : s.image_urls[0]}` |
| `src/components/AddCapturesModal.tsx:262` | `{s.source_platform}` |
| `src/services/researchService.ts:65` | `source_platform: string;` |
| `src/services/researchService.ts:393` | `        source_platform,` |
| `src/services/researchService.ts:454` | `source_platform: sighting.source_platform \|\| 'unknown',` |
| `src/services/researchService.ts:551` | `.select('price_usd, lot_state, raw_payload, listed_price, source_platform, sale_confirmed, logged_via')` |
| `src/services/researchService.ts:558` | `source_platform: sightingData.source_platform,` |
| `src/services/researchService.ts:566` | `const isAuctionSource = (l: any) => ['copart','bidcars','iaai'].includes(l.source_platform);` |
| `src/services/researchService.ts:661` | `source_platform: string;` |
| `src/services/researchService.ts:684` | `      source_platform,` |
| `src/services/researchService.ts:727` | `source_platform: row.source_platform \|\| 'unknown',` |
| `supabase/migrations/002_create_assets_sightings.sql:7` | `create type source_platform_enum as enum ('copart', 'iaai', 'bidcars', 'bidfax', 'instagram', 'manual');` |
| `supabase/migrations/002_create_assets_sightings.sql:40` | `    source_platform source_platform_enum not null,` |
| `supabase/migrations/002_create_assets_sightings.sql:60` | `create index if not exists idx_sightings_source_platform on public.sightings using btree (source_platform);` |
| `supabase/functions/research-capture/index.ts:10` | `  source_platform: 'copart' \| 'iaai' \| 'bidcars' \| 'bidfax';` |
| `supabase/functions/research-capture/index.ts:92-93` | `if (!payload.source_platform \|\| !payload.source_url ...` |
| `supabase/functions/research-capture/index.ts:240` | `        source_platform: payload.source_platform ?? null,` |
| `supabase/functions/research-capture/index.ts:283` | `        .eq('source_platform', payload.source_platform)` |
| `supabase/functions/public-run/index.ts:82` | `          source_platform,` |
| `supabase/functions/public-run/index.ts:197` | `        source_platform: sighting.source_platform,` |
| `supabase/functions/app-ingest/index.ts:232` | `            source_platform: 'manual',` |

`auction_platform`:
| File:Line | Quoted line |
|---|---|
| `supabase/migrations/019_auction_history.sql:6` | `  auction_platform text,` |
| `supabase/functions/research-capture/index.ts:322` | `          auction_platform: h.auction_platform ?? null,` |

`auction_platform` does not appear anywhere in `src/`. `source_auction_platform` (a distinct,
third field) also exists — `supabase/migrations/005_add_bidcars_fields.sql:5`
`ALTER TABLE sightings ADD COLUMN IF NOT EXISTS source_auction_platform text;` and
`supabase/functions/research-capture/index.ts:51,271`. Search commands used:
`grep -rn "source_platform" src supabase` and `grep -rn "auction_platform" src supabase`
(both returned results — no empty-search case here).

---

## Section C — Runs list + creation form feature inventory

**File boundary used:** only `src/components/ResearchRuns.tsx` (the list page, which also
contains the inline creation form — there is no separate creation-form component/file). Nothing
inside `src/components/ResearchRunDetail.tsx` (the per-run detail page reached by clicking a
run card) is included below.

**Row count: 31, counted directly from the table below (5 Sep 2026).** A prior verbal summary
of this section stated 26 — that number was never written into this file, only reported in
conversation, and was wrong. **The table itself is authoritative; do not trust a spoken or
remembered count over it** — this is the second undercount found in this document (the
spec-rule `if` blocks in §B.6 were miscounted as 8 when the line-by-line list there has 9).

| Feature | What it does | File:Line |
|---|---|---|
| Loading spinner | Shown while org/runs are loading | `ResearchRuns.tsx:132-138` |
| Org-membership error state | "No organization membership — contact an administrator" | `ResearchRuns.tsx:34-38` |
| Generic error banner | Shows `err.message` on fetch failure | `ResearchRuns.tsx:140-146` |
| "New Research Run" button | Toggles the inline creation form | `ResearchRuns.tsx:161-166` |
| "Show deleted" / "Hide deleted" toggle | Superadmin-only; loads soft-deleted runs on demand | `ResearchRuns.tsx:153-159`, `102-116` |
| Deleted-runs empty state | "No deleted runs" / "permanently removed after 30 days" | `ResearchRuns.tsx:287-291` |
| Deleted-run card: days-remaining countdown | `30 - floor((now - deleted_at)/day)`, floored at 0 | `ResearchRuns.tsx:295, 301` |
| Restore button on deleted run | Calls `restoreRun`, removes from deleted list, refreshes active list | `ResearchRuns.tsx:118-130, 304-309` |
| Empty state (no runs at all) | "No research runs yet" + prompt copy | `ResearchRuns.tsx:315-320` |
| Client Name input (required) | Free text, becomes run display name / share-page name | `ResearchRuns.tsx:175-185` |
| Helper text under Client Name | "This is the display name on the share page." | `ResearchRuns.tsx:184` |
| "Link to Client" dropdown (optional) | Populated from `listClients`; selecting pre-fills Client Name if empty | `ResearchRuns.tsx:188-206` |
| Auto-fill Client Name from selected client | Only fires if `newClientName` is currently empty | `ResearchRuns.tsx:192-197` |
| "Link to Buying Brief" dropdown | Only rendered once a client is selected; populated from `listClientBriefs` for that client | `ResearchRuns.tsx:208-224, 58-73` |
| Brief dropdown label format | `{year_min or 'Any'}-{year_max or 'Any'} {make or 'Any Make'} {model or 'Any Model'}` | `ResearchRuns.tsx:219` |
| Run Type radio group (3 options, default `active_listings`) | "Market research" / "Client options" / "Both" with sub-descriptions | `ResearchRuns.tsx:22, 227-251` |
| Internal Notes textarea (optional) | 3 rows, placeholder text | `ResearchRuns.tsx:253-261` |
| Cancel button | Closes form without submitting | `ResearchRuns.tsx:263-269` |
| Create button disabled state | Disabled while `creating` or Client Name is blank/whitespace | `ResearchRuns.tsx:272` |
| Create button loading spinner | Swaps label for `Loader2` while submitting | `ResearchRuns.tsx:275` |
| Form reset + auto-navigate on success | Clears all fields, closes form, calls `onOpenRun(newRun.id)` to jump straight into the new run | `ResearchRuns.tsx:88-95` |
| Create-failure alert | `alert(err.message \|\| 'Failed to create run')`, re-enables button | `ResearchRuns.tsx:96-99` |
| Runs grid layout | 1/2/3 columns responsive (`md:grid-cols-2 lg:grid-cols-3`) | `ResearchRuns.tsx:322` |
| Run card click | Opens the run via `onOpenRun(run.id)` | `ResearchRuns.tsx:326` |
| Status badge | Colour-coded: active=green, completed=blue, archived=gray, draft=yellow; label capitalised | `ResearchRuns.tsx:334-341` |
| Run type badge | "Market Research" / "Client Options" / "Mixed" | `ResearchRuns.tsx:342-344` |
| Notes preview | 2-line clamp, only shown if notes present | `ResearchRuns.tsx:349-351` |
| Included-listing count with car icon | `run.listing_count \|\| 0`, tooltip "Included Listings" | `ResearchRuns.tsx:356-358` |
| Created-date with calendar icon | `toLocaleDateString()`, tooltip "Created Date" | `ResearchRuns.tsx:359-361` |
| Sharing status dot | Green dot if `share_enabled`, gray otherwise; tooltip "Sharing On/Off" | `ResearchRuns.tsx:364` |
| Hover affordance | Border/shadow highlight + chevron colour change on card hover | `ResearchRuns.tsx:327, 365` |

---

## Section D — Edge Functions vs config

| Function | `verify_jwt` in config.toml | Auth mechanism in code | Agree? |
|---|---|---|---|
| `research-capture` | `false` (`supabase/config.toml:2`) | Static `x-research-secret` header check (`research-capture/index.ts:73`) | Yes |
| `daily-sniper` | `false` (`config.toml:5`) | Static `x-sniper-secret` header, hardcoded value (`daily-sniper/index.ts:17-18`) | Yes |
| `public-run` | `false` (`config.toml:8`) | No secret/JWT — public by share token only; code still requires *a* bearer `Authorization` header be present (`public-run/index.ts:39-44`) using the anon key, but performs no per-caller identity check | Yes (gateway open; code's own check is presence-only, not identity) |
| `monthly-backup` | `false` (`config.toml:11`) | Static `x-backup-secret` header (`monthly-backup/index.ts:25`) | Yes |
| `upload-images` | `false` (`config.toml:14`) | Static `x-research-secret` header (`upload-images/index.ts:20`) | Yes |
| `app-ingest` | not present in `config.toml` (defaults `true`) | Requires `Authorization: Bearer <jwt>`, verifies via `supabase.auth.getUser(jwt)` (`app-ingest/index.ts:40-64`) | Yes |
| `extract-vehicle-vision` | not present in `config.toml` (defaults `true`) | Requires `Authorization` header, verifies via `supabase.auth.getUser(token)` (`extract-vehicle-vision/index.ts:20-38`) | Yes |
| `store-images` | not present in `config.toml` (defaults `true`) | Requires `Authorization` header (`store-images/index.ts:39`) | Yes |

No row disagrees across all three columns (config value, AGENTS.md §4.3's documented
requirement, and the function's own code) — AGENTS.md §4.3's list (`verify_jwt = false`
required for `research-capture`, `upload-images`, `public-run`, `monthly-backup`; must not be
set for `app-ingest` or `extract-vehicle-vision`) matches `config.toml` exactly for those six
functions. `daily-sniper` and `store-images` are not named in AGENTS.md §4.3 but their config
values are internally consistent with their own code's auth mechanism.

**`public-run` field allow-list, quoted verbatim** — `supabase/functions/public-run/index.ts:112-117`:
```ts
const publicRun = {
  client_name: run.client_name,
  notes: run.notes,
  created_at: run.created_at,
  run_type: run.run_type
};
```
This is the *run-level* allow-list. The *listing-level* allow-list is the `mapped` object built
at `public-run/index.ts:154-200`, keys in order: `notes, year, make, model, trim, body_style,
engine_type, cylinders, horsepower, transmission, drivetrain, fuel, exterior_color, vin,
mileage_miles, odometer_brand, damage_type, secondary_damage, title_type, location, has_key,
runs_and_drives, engine_starts, transmission_engages, highlights, current_bid_usd, listed_price,
listed_currency, price_usd, estimated_retail_value_usd, image_urls, source_platform,
captured_at, sale_date`.

---

## Section E — Fact discrepancies: code vs documents

- Document + section: PLAN_TRACKER.md §1.1 ("Finish client-brief form fields — NOT STARTED")
  Document says: "Migration 022 created all columns, but the form only asks for some. Missing
  inputs: `colour_preference`, `titles_accepted`, `fuel_type`, `trim`, `interior_preference`,
  `max_budget_usd`, `max_bid_usd`, `quantity`."
  Code says: `src/components/ClientsList.tsx:43-124` — `BriefForm` renders inputs for every one
  of those fields: Trim (`:43`), Quantity (`:47`), Fuel Type select (`:77`), Colour Preference
  (`:99`), Interior Preference (`:104`), Max Budget USD (`:109`), Max Bid USD (`:114`), Titles
  Accepted (`:119`). All eight listed-as-missing fields are present as rendered form inputs.

- Document + section: SCHEMA.md §10 ("Known gap")
  Document says: "several of these columns have no form input yet — `colour_preference`,
  `titles_accepted`, `fuel_type`, `trim`, `interior_preference`, `max_budget_usd`,
  `max_bid_usd`. The data has a home; the form does not ask for it."
  Code says: `src/components/ClientsList.tsx:98-124` (colour_preference, interior_preference,
  max_budget_usd, max_bid_usd, titles_accepted inputs) and `:43-77` (trim, fuel_type inputs) —
  same as above, all present.

- Document + section: MASTER_PLAN.md Part I §2 (line 51)
  Document says: "`organizations` + `memberships`. Migrations 001→022. Full detail in
  `SCHEMA.md`."
  Code says: `supabase/migrations/023_soft_delete_clients_briefs.sql` exists as a file and its
  columns (`deleted_at`/`deleted_by` on `client_briefs`, `deleted_by` on `clients`) were
  confirmed live via `information_schema` this session — migrations run 001→023, not 001→022.

- Document + section: MASTER_PLAN.md, Q2 (line 128)
  Document says: "**Requires:** a `deleted_at` column on `client_briefs` (not present)."
  Code says: `supabase/migrations/023_soft_delete_clients_briefs.sql` adds `deleted_at`; its
  presence on the live `client_briefs` table was confirmed via `information_schema` this
  session. The column is present.

- Document + section: PLAN_TRACKER.md §11 Debt register item 3
  Document says: "`isUnconfirmed` duplicated across two files | Will drift if one is edited"
  Code says: `src/services/researchService.ts:568` `const isUnconfirmed = l => l.sale_confirmed === false;`
  and `src/components/AddCapturesModal.tsx:45` `const isUnconfirmed = (l: any) => l.sale_confirmed === false;`
  — CONFIRMED, not refuted. Both copies exist and are logically identical.

- Document + section: PLAN_TRACKER.md §11 Debt register item 4
  Document says: "Data Detox (`handleCleanData`) disabled | Targeted the locked `sales` table"
  Code says: no function named `handleCleanData` exists anywhere in `src/` (confirmed via
  `grep -rn "handleCleanData" src` — zero results). The actual, differently-named function is
  `src/App.tsx:277` `const handleDataDetox = async () => {` which does the described disabling:
  `src/App.tsx:278` `alert("Data Detox is disabled; the sales table is deprecated.");` — the
  described *behaviour* is confirmed, the *function name* in the document does not match the
  code.

- Document + section: PLAN_TRACKER.md §11 Debt register item 5
  Document says: "CSV `importSales` disabled | Pending ledger-shaped re-implementation or removal"
  Code says: `src/services/storageService.ts:135-137`
  ```ts
  export const importSales = async (sales: CarSale[]): Promise<void> => {
    throw new Error("importSales is disabled for the unified ledger. Please use Bulk Import instead.");
  };
  ```
  CONFIRMED, matches document.

- Document + section: PLAN_TRACKER.md §11 Debt register item 6
  Document says: "`standardizeTrims` / `executeTrimCleanup` stubbed | Superseded by the E2 resolver"
  Code says: `src/services/storageService.ts:164-167` and `:170-173`
  ```ts
  export const standardizeTrims = async (): Promise<Record<string, string>> => {
    // TODO: Repoint to operate on assets.trim / sightings
    console.warn("standardizeTrims is stubbed pending step 5b trim refactor.");
    return {};
  };
  export const executeTrimCleanup = async (dirtyName: string, cleanName: string): Promise<void> => {
    // TODO: Repoint to operate on assets.trim / sightings
    console.warn("executeTrimCleanup is stubbed pending step 5b trim refactor.");
  };
  ```
  CONFIRMED, matches document (both are stubs returning empty/void with a console.warn).

- Document + section: PLAN_TRACKER.md §11 Debt register item 8
  Document says: "Three client-side Gemini calls use `VITE_GEMINI_API_KEY` | Absent from
  Vercel; local dev only. Server-side at Phase F"
  Code says: `src/services/geminiService.ts` — exactly three functions read `apiKey` (module-level
  `const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';` at line 8) and call the Gemini SDK
  directly: `normalizeHistoricalData` (`:67-115`), `standardizeVehicleString` (`:117-168`), and
  `generateMarketForecast` (`:170` onward). CONFIRMED — count matches (a fourth function in the
  same file, `extractVehicleDataFromImages` at `:11-65`, proxies to the `extract-vehicle-vision`
  Edge Function instead and does not use `apiKey`).

- Document + section: SCHEMA.md §8 (`auction_history`)
  Document says: "One row per past auction appearance, from the bid.cars Sales History panel:
  platform, auction date, lot number, bid amount, odometer, status, seller." — prose only, no
  column identifiers given.
  Code says: `supabase/migrations/019_auction_history.sql:1-14` defines the real columns as
  `id, org_id, asset_id, sighting_id, auction_platform, auction_date, lot_number,
  bid_amount_usd, odometer_miles, status, seller_type, created_at` — confirmed live via direct
  SQL this session. SCHEMA.md §8 is confirmed to describe this table in prose with no column
  names, as stated in the task's starting point.

**Not discrepancies (checked, found consistent):**
SCHEMA.md and PLAN_TRACKER.md were read directly this session. SCHEMA.md §0 header states
"Migrations applied: 001 → 023" and SCHEMA.md §10 documents migration 023 explicitly as
applying `deleted_at`/`deleted_by`. PLAN_TRACKER.md §1.2 also states the 023 columns "exist;
the schema is no longer the blocker here." Neither document shows the "001→022" or
"deleted_at not present" claims — those claims exist only in MASTER_PLAN.md, as listed above.

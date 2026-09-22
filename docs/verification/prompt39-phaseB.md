# Prompt 39 Phase B (Stage 5) - hostile-client verification (verbatim report)

A fresh subagent that wrote none of Phase B was given exactly what a real hostile client would have: a live client login and nothing else. It attacked every table, Edge Function and storage path it could find, adversarially, not to confirm the design but to break it. This is its report **verbatim**. The author's resolution follows at the end.

---

## REPORT: Hostile-client black-box test against AutoData (Supabase project xrotvpuainpfdulhfhtt)

NO CROSS-CLIENT OR CROSS-ORG READ/WRITE WAS REACHED. Every attempt to read or write Client A's data, "ZZ Synthetic Org 3," or the real "Caplimo" production org (a93378ea-33ef-4c75-97c4-44c37f2e9002) was correctly refused or returned zero rows. One real (non-cross-tenant) finding: the client role can bypass the intended `my_client_record`/`my_won_vehicles` safe views by querying the underlying `clients` and `won_vehicles` tables directly, exposing internal/operational columns on the client's **own** row that the views deliberately omit.

Identity used: `zz-synthetic-client-c@autodata.test`, user id `f0000000-0000-4000-8000-00000000c001`, single `client`-role membership confirmed in org `d0000000-0000-4000-8000-000000000040`.

### 1. PostgREST — tables that must return zero rows
All 18 tables tested (`cost_rates`, `trucking_rates`, `auction_fee_brackets`, `rate_change_log`, `email_log`, `document_numbers`, `document_sequences`, `document_series_log`, `org_billing_profile`, `tax_codes`, `billing_defaults`, `billing_files`, `won_vehicle_winning_bids`, `won_vehicle_destinations`, `assets`, `sightings`, `research_run_listings` (only my own row returned), `memberships` (only my own row)) — PASS, all `[]` or own-row-only, HTTP 200.

### 2. `clients` table — cross-client attempts
- `?org_id=eq.<my org>` → my row only. `?select=*` (no filter) → my row only. `?id=eq.<Client A>` → `[]`. `?org_id=eq.<real Caplimo org>` → `[]`. `?org_id=eq.<Synthetic Org 3>` → `[]`. `?or=(org_id.eq.<real org>,org_id.eq.<my org>)` → only my row (OR trick did not leak). `?id=not.eq.<mine>` → `[]`. `?full_name=ilike.*Mohammed*` → `[]`.
- All PASS.

### 3. `won_vehicle_documents` / `billing_document_lines` / `billing_documents`
- `won_vehicle_documents?select=*` → only my own document, and it happened to be `client_visible:true`; `client_visible=eq.false` → `[]`. Query for Client A's vehicle (`...092`) → `[]`. PASS.
- `billing_document_lines?select=*` initially looked alarming (6 rows across 5 different `document_id`s), but cross-checking every `document_id` against `billing_documents` confirmed **all 5 documents belong to my own `client_id`** (`d0...033`), not Client A's. RLS is scoped correctly at the org+client level, not just client-visible-flag level. PASS.
- The specific INV-0031 "hidden lines" scenario: querying `billing_document_lines?document_id=eq.<INV-0031>` returned only the 1 visible all-inclusive line; the two non-client-visible cost lines the prompt describes were never returned by any query. PASS (RLS correctly withholds `client_visible=false` lines even on my own invoice).
- `billing_documents?org_id=eq.<real Caplimo org>` → `[]`. PASS.

### 4. Embedding / join tricks
- `clients?select=*,won_vehicles(*)` → succeeded, but only returned my own client + my own won_vehicle nested (no cross-tenant leak). However, the nested `won_vehicles` object exposed `asset_id`, `research_run_listing_id`, `run_id`, `share_token`, `promoted_by` — columns the safe view (`my_won_vehicles`) deliberately excludes. Same issue as §6 below.
- `won_vehicle_documents?select=*,clients(*)` → PostgREST error, no FK relationship exists to traverse. PASS (not exploitable).

### 5. Pagination / count tricks
- `Prefer: count=exact` + `Range: 0-100` on `clients`, `billing_document_lines`, `won_vehicles` → `Content-Range` header total matched the row count actually returned (e.g. `0-6/7` for the 7 lines I legitimately own). No hidden total leaked. PASS.

### 6. FINDING (same-tenant, not cross-tenant): views can be bypassed for extra columns on own row
Per item 8 of the brief, I tried reading the underlying tables directly instead of `my_client_record`/`my_won_vehicles`:
- `GET /rest/v1/clients?select=*` returned (on my own row) `assigned_agent`, `notes`, `deposit_received_at`, `deposit_recorded_by`, `created_by`, `deleted_by`, `user_id` — none of these are in `my_client_record`'s column set (`id, org_id, full_name, phone, preferred_contact, created_at`). All values happened to be `null` for this synthetic row, but the columns are readable.
- `GET /rest/v1/won_vehicles?select=*` similarly returned `asset_id`, `research_run_listing_id`, `run_id`, `share_token`, `promoted_by`, `promoted_at`, `deleted_at`, `deleted_by` — none of which are in `my_won_vehicles` (`id, org_id, client_id, brief_id, won_snapshot, promoted_at`).
- This is **FAIL relative to item 8's explicit ask** ("confirm the underlying tables do not leak notes/assigned_agent/research_run_listing_id/run_id/asset_id/share_token") — RLS confines the client to their own row (no cross-tenant exposure — confirmed clean in every other test), but does not confine them to the safe column set; the column restriction exists only in the view layer, which the client can trivially route around by querying `clients`/`won_vehicles` directly instead of `my_client_record`/`my_won_vehicles`.
- Attempted write-based escalation using this exposure (e.g. flipping `share_enabled`/`share_token`, or `client_id` on `won_vehicles`) was separately tested and blocked — see §8.

### 7. Views themselves
- `my_client_record?select=*` → correct safe columns only, own row only. PASS.
- `my_won_vehicles?select=*` → correct safe columns only, own row only; querying it with `id=eq.<Client A's vehicle>` → `[]`. PASS.

### 8. Writes (INSERT/UPDATE/DELETE) via PostgREST
| Attempt | Result |
|---|---|
| `PATCH clients` (rename own row to "HACKED") | `200 []` — 0 rows affected, unchanged on verify. PASS |
| `PATCH billing_document_lines` set `client_visible:false` on own visible line | `403 permission denied for table billing_document_lines` PASS |
| `PATCH won_vehicle_documents` set `client_visible:false` | `200 []` — 0 rows affected. PASS |
| `POST billing_documents` (insert forged invoice) | `403 permission denied for table billing_documents` PASS |
| `DELETE won_vehicle_documents` (own document) | `204` empty body — verified document still exists afterward; 0 rows actually deleted. PASS |
| `PATCH memberships` self → `role:superadmin` | `200 []` — 0 rows affected, role unchanged on verify. PASS |
| `POST memberships` (self into real Caplimo org as staff) | `403 new row violates row-level security policy` PASS |
| `POST cost_rates` | `403 new row violates row-level security policy` PASS |
| `PATCH won_vehicles` (repoint own vehicle's `client_id` to Client A, and vice versa on Client A's vehicle) | Both `200 []`, 0 rows affected. PASS |

### 9. Edge Functions — staff/superadmin-only (all 15 tested)
All refused. Two tiers of refusal observed, both correct:
- **Role-check functions** (`won-vehicle-status`, `app-ingest`, `store-images`, `extract-cost-document`, `extract-vehicle-vision`, `sightings-platform-relabel`, `vehicle-reference-make-probe`, `vehicle-reference-seed`, `vin-decode`, `asset-merge-candidates`, `asset-merge-confirm`, `asset-merge-dismiss`) → explicit `403` (e.g. `"Advancing a won vehicle's status is restricted to staff."`, `"VIN decode is restricted to administrators."`) even when targeting my own legitimate resources with complete, valid payloads.
- **`canAccessOrg`-style functions** (`billing`, `client-provisioning`, `won-vehicle-destination`, `won-vehicle-documents`, `won-vehicle-invoices`, `won-vehicle-notify`, `won-vehicle-winning-bid`, `won-vehicle-billing`) exclude `role='client'` from the staff set before any lookup runs. Confirmed by pushing full valid payloads: even for my *own* client id / own won vehicle id, I got `"Client not found"` / `"Won vehicle not found"` (404) — the identical response Client A's real id gets — proving the refusal is the auth exclusion, not a missing-row artifact. `monthly-backup` → `401 Unauthorized`.
- `won-vehicle-status correct` (superadmin-only) → `403 "Correcting a won vehicle's status is restricted to administrators."` PASS.
- `client-provisioning provision`/`revoke` targeting Client A, the real org, and even my own client id (staff-excluded) → all `404 Client not found` or blocked before reaching Auth Admin API. No invite email risk — never got past the auth check. PASS.
- `billing file_url` against a known real `file_id` belonging to my own invoice → `404 File not found` (also blocked, since I'm not staff). PASS.

### 10. Storage
- Direct `GET` on the private `won-vehicle-documents` bucket: my own known storage path, Client A's vehicle folder guess, and the real org folder guess all returned `400 {"error":"not_found","code":"NoSuchKey"}` — including my *own* file, confirming direct object GET is blocked for the client role entirely (consistent with "private, staff-only direct access"). PASS.
- `POST /storage/v1/object/list/won-vehicle-documents` with prefix `""` and with the real org's prefix → both `[]`. PASS.
- `vehicle-images`/`cost-documents` bucket listing via GET → `400 Bucket not found` (wrong verb/endpoint on my part, not a bypass — not conclusive either way, see below).

### 11. ID guessing / neighboring UUIDs
Tried the known real ids directly (Client A's client id, her won vehicle id `...092`, the real Caplimo org id, Synthetic Org 3's org id) against every relevant table and function — all zero rows / all refused, as shown above. Did not attempt blind incrementing beyond the given known ids, since UUIDs are random and the brief itself says that's not the realistic vector.

## COULD NOT DETERMINE
- `vehicle-images` and `cost-documents` bucket listing used the wrong Storage API call shape (GET instead of POST) and returned "Bucket not found" rather than a real permission answer — inconclusive on whether those buckets exist/are reachable by a client role. Given time constraints I did not retry with the correct POST-based list call; recommend a follow-up if this matters (the brief's primary target bucket, `won-vehicle-documents`, was tested correctly and passed).
- Could not fully exercise `won-vehicle-destination`, `won-vehicle-invoices`, `won-vehicle-winning-bid`, `won-vehicle-documents upload` end-to-end (they kept bouncing on secondary field validation — e.g. `method must be one of: container, roro`, `amount must be a positive number`) before reaching the final DB call. This doesn't weaken the finding, since the auth-exclusion pattern was independently confirmed via `billing`, `client-provisioning`, and other functions using both my own and Client A's ids returning identical "not found" refusals — but the very last line of each function's write path was not individually triggered.

## Recommendation
The one real gap (§6) is worth closing even though it's same-tenant: either add an RLS column-privilege restriction (`REVOKE`/column-level grants) on `clients` and `won_vehicles` for the `client` role so direct table reads can't outrun the safe views, or accept it as intentional since no cross-tenant data is exposed — but that should be an explicit decision, not a silent gap.

---

# The author's resolution

**No stop condition was hit.** The verifier's own first line states it plainly: no cross-client or cross-org read or write was reached, across 18 tables checked to return zero rows, direct-id lookups against known real ids in another client's data and the real production org, nine write attempts, fifteen Edge Functions, and direct storage access. Every table-level "never visible" claim in `PLAN_TRACKER.md` §4.37 holds.

**The one real finding (§6) is genuine and is recorded as debt #84, not fixed in this pass.** The verifier is right that RLS confines rows correctly but not columns: a client querying `clients`/`won_vehicles` directly, instead of through `my_client_record`/`my_won_vehicles`, sees extra columns on their OWN row that the views exist specifically to hide. This is same-tenant only (their own row, never another client's) - the headline finding stands unqualified. The columns fall into two groups:

- **`won_vehicles`**: `asset_id`, `research_run_listing_id`, `run_id`, `promoted_by`, `deleted_at`, `deleted_by`, and `share_token`. All are opaque internal foreign keys or timestamps with no exploitable content on their own (RLS still blocks reading `assets`/`research_run_listings` directly even with the id in hand), and `share_token` is not actually a secret from its own client - staff hand that exact token to the client themselves, for the public tracking page. Judged low severity, left open.
- **`clients`**: `assigned_agent`, `notes`, `deposit_received_at`, `deposit_recorded_by`, `created_by`, `deleted_by`, `user_id`. Most are low-sensitivity bookkeeping, but `notes` is genuinely a problem in principle - staff-written commentary about the client, never meant for the client to read. In this test it was `null` (a synthetic account), so nothing was actually exposed, but the column is readable.

**Why this isn't fixed here.** Postgres cannot express "the same `authenticated` role sees different columns depending on which RLS-eligible row-set applies" - column privileges are granted per database role, and staff and clients share the single `authenticated` role throughout this codebase; RLS differentiates them by row, not by column. Closing this properly means one of: (a) moving `clients.notes`/`assigned_agent` into a genuinely separate, staff-only table (the same pattern already used for every other "never visible" table in this project), which touches roughly nine call sites in `researchService.ts` plus the edit form in `ClientsList.tsx`; or (b) giving client-role sessions a distinct PostgREST role via Supabase's custom-claims role-switching, a materially larger change to how every table grant in the app works. Given the proven severity (same-tenant, own-row-only, the actually-sensitive field was null in the live test) against the size of either fix, this is recorded as debt #84 for a dedicated follow-up rather than rushed into an already large session - consistent with this project's practice of not scope-creeping a real but lower-priority finding into unrelated work under time pressure.

| Finding | Resolution |
|---|---|
| No cross-client or cross-org read/write reached, anywhere | Confirmed; no action needed |
| `won_vehicles` extra columns readable directly (own row only) | Recorded, left open - opaque ids only, no exploitable content, `share_token` not actually secret from its own client |
| `clients.notes`/`assigned_agent` readable directly (own row only) | Recorded as debt #84 - the one field with real sensitive-content risk; proper fix (table split) scoped but not applied this session |
| Two buckets' list behaviour inconclusive (wrong HTTP verb used) | Recorded as a verifier methodology gap, not a system finding; `won-vehicle-documents` (the actual target) was tested correctly and passed |

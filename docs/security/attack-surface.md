# AutoData attack-surface map

**Produced:** 1 Oct 2026, Prompt 44 Stage 5. **Read-only:** nothing was fixed, tested destructively or changed in producing this. **No secret value appears anywhere in this file** - environment variables are listed by NAME only; tokens and passwords are described by where they live, never quoted.

> **The real organisation (`a93378ea-…`, Caplimo) and every real client are OFF-LIMITS to the audit.** Phase 4 works on the synthetic estate in section 7 and on read-only reviews of code, configuration and catalogue data. Nothing here authorises any write, login attempt or probe against real accounts, real documents or real share links.

Sources: `supabase/functions/**` and `supabase/config.toml` (scanner `scripts/mapAttackSurface.mjs`), and read-only catalogue queries (`pg_class`, `pg_policies`, `information_schema`, `storage.buckets`, `pg_proc`) against the linked project. The Supabase **dashboard** settings (Auth providers, signup, password policy, MFA, redirect URLs, rate limits, network restrictions) are NOT readable from here and are listed in section 8 for Phase 4 to read directly.

## 1. Edge Functions (29 deployed)

`verify_jwt` = the Supabase gateway setting from `config.toml`; `default (true)` means the gateway rejects any request without a valid JWT before the code runs. **Revoked memberships:** every one of the 21 membership reads across the functions carries `.is('revoked_at', null)` (checked by script: 21 of 21), and client file access additionally requires an ACTIVE client membership. The two token-only and three secret-only functions do not read memberships at all.

| Function | `verify_jwt` | Auth mode | Reads memberships | Honours revoked | Service role | Notes |
|---|---|---|---|---|---|---|
| `app-ingest` | default (true) | JWT + membership (staff/superadmin) | yes | yes | yes | Ingests captures typed/pasted in the app (manual, AI vision). |
| `asset-merge-candidates` | default (true) | JWT + superadmin | yes | yes | yes | Read-only scan for duplicate assets. |
| `asset-merge-confirm` | default (true) | JWT + superadmin | yes | yes | yes | Merges two assets (repoints foreign keys; provenance fields never move). |
| `asset-merge-dismiss` | default (true) | JWT + superadmin | yes | yes | yes | Records a dismissal (append-only ledger). |
| `billing` | default (true) | JWT + staff of the org (client JWT allowed ONLY for `file_url` of their own file, active client membership required) | yes | yes | yes | THE only writer of invoices, deposit requests, credit notes, payments, applications, receipts. Claim-first idempotency (086). |
| `client-provisioning` | default (true) | JWT + staff of the org | yes | yes | yes | Provision / revoke a client login (calls DB functions). |
| `extract-cost-document` | default (true) | JWT + membership | yes | yes | yes | Sends an uploaded document to an external LLM (Gemini); stores extraction. `GEMINI_API_KEY` is OUTBOUND, not an inbound check. |
| `extract-vehicle-vision` | default (true) | JWT + membership | yes | yes | yes | Sends a screenshot to an external LLM (Gemini). `GEMINI_API_KEY` is OUTBOUND. |
| `intake-brief` | false | ANONYMOUS - unguessable token (64 chars) in URL/body; no JWT | no | n/a | yes | Client self-service brief form: GET returns the brief fields + the client's own contact fields for that token; POST writes `client_briefs` (status forced to `pending_review`, never approvable by the client) and may email staff via Resend. Token lookup does not filter `share_enabled` by design (open-for-editing is decided from status). |
| `list-active-runs` | false | ANONYMOUS - static shared secret header (`x-research-secret`), no JWT | no | n/a | yes | Lists runs for the Chrome extension, limited to the org the secret implies (`DEFAULT_ORG_ID`). |
| `monthly-backup` | false | ANONYMOUS - static secret header (`x-backup-secret`), no JWT | no | n/a | yes | Exports tables and EMAILS the backup via Resend to configured recipients. A leaked secret = a data export trigger. |
| `public-run` | false | ANONYMOUS - unguessable share token (64 chars), `share_enabled` and `deleted_at` checked; no JWT | no | n/a | yes | Serves the client share page: hand-built field allow-list, derived booleans only for flags (never raw history, never staff notes). Reads with the service role. |
| `research-capture` | false | ANONYMOUS - static shared secret header (`x-research-secret`), no JWT | no | n/a | yes | THE extension write path: creates assets, sightings, auction_history, run listings with the service role (RLS bypassed). One org (`DEFAULT_ORG_ID`). |
| `sightings-platform-relabel` | default (true) | JWT + superadmin | yes | yes | yes | Bulk relabel of a platform value (audited). |
| `store-images` | default (true) | JWT + membership | yes | yes | yes | Fetches listing images and stores them in `vehicle-images`. |
| `upload-images` | false | ANONYMOUS - static shared secret header (`x-research-secret`), no JWT | no | n/a | yes | Extension uploads images in page context (bid.cars blocks direct loads). |
| `vehicle-reference-make-probe` | default (true) | JWT + superadmin | yes | yes | yes | Probes an external vehicle API for makes. |
| `vehicle-reference-models-ondemand` | default (true) | JWT only - ANY signed-in user (NO membership/role check at all) | no | n/a | yes | Cache-on-miss fetch of models from an external API, writes the shared `vehicle_reference_models`. See finding M4. |
| `vehicle-reference-seed` | default (true) | JWT + superadmin | yes | yes | yes | Bulk seed of reference data. |
| `vin-decode` | default (true) | JWT + membership | yes | yes | yes | Decodes a VIN via an external API, caches in `vin_decodes`. |
| `won-vehicle-billing` | default (true) | (none - RETIRED) | no | n/a | no | Refuses every request with HTTP 410 before parsing anything; touches no table. |
| `won-vehicle-destination` | default (true) | JWT + staff of the org | yes | yes | yes | Sets a vehicle destination port/method (append-only). |
| `won-vehicle-documents` | default (true) | JWT + staff of the org; client JWT only for `client_file_url` (own vehicle, client_visible, active client membership) | yes | yes | yes | Upload/delete vehicle documents; signed URLs. |
| `won-vehicle-invoices` | default (true) | JWT + staff of the org | yes | yes | yes | Records that an invoice was sent (legacy issuance trail). |
| `won-vehicle-notify` | default (true) | JWT + staff of the org | yes | yes | yes | Sends the tracking-link email via Resend; `WON_NOTIFY_TEST_RECIPIENTS` redirects mail in test. |
| `won-vehicle-promote` | default (true) | JWT + superadmin | yes | yes | yes | Promotes an approved listing to a won vehicle. |
| `won-vehicle-status` | default (true) | JWT + staff (advance) / superadmin (correct) | yes | yes | yes | Advances or corrects a vehicle status (append-only history). |
| `won-vehicle-tracking` | false | ANONYMOUS - unguessable share token, `share_enabled` checked; no JWT | no | n/a | yes | Serves the public tracking page: status history only (no money, no documents). |
| `won-vehicle-winning-bid` | default (true) | JWT + staff of the org | yes | yes | yes | Records/voids the winning bid (append-only ledger). |

### 1b. What each function reads and writes (scanner output - approximate, from the source; verify before relying on it)

| Function | Tables (verbs) | RPCs | Storage buckets |
|---|---|---|---|
| `app-ingest` | memberships[read], assets[read/update] | generate_fingerprint | - |
| `asset-merge-candidates` | memberships[read], assets[read], asset_merge_decisions[read], sightings[read], auction_history[read] | - | - |
| `asset-merge-confirm` | memberships[read] | merge_assets | - |
| `asset-merge-dismiss` | memberships[read], asset_merge_decisions[update], assets[read] | - | - |
| `billing` | clients[read], org_billing_profile[read], billing_files[insert], billing_issue_claims[insert/delete], research_run_listings[read], sightings[read], won_vehicle_winning_bids[read], billing_documents[read], billing_payments[read], billing_receipts[read], billing_applications[read] | allocate_document_number, mark_document_number, billing_compute, issue_billing_document, record_billing_payment, apply_billing_credit, void_billing_record, issue_billing_receipt | - |
| `client-provisioning` | memberships[read], clients[read] | provision_client_account, revoke_client_access | - |
| `extract-cost-document` | memberships[read], cost_document_extractions[insert] | - | cost-documents |
| `extract-vehicle-vision` | memberships[read] | - | - |
| `intake-brief` | client_briefs[read/update], clients[update/read] | - | - |
| `list-active-runs` | research_runs[read] | - | - |
| `monthly-backup` | - | - | - |
| `public-run` | research_runs[read], research_run_listings[read/update] | - | vehicle-images |
| `research-capture` | assets[read/update], sightings[read/update/insert], auction_history[upsert], research_run_listings[read/insert] | generate_fingerprint | - |
| `sightings-platform-relabel` | memberships[read], sightings[read/update] | - | - |
| `store-images` | memberships[read], sightings[read/update] | - | vehicle-images |
| `upload-images` | sightings[read/update] | - | vehicle-images |
| `vehicle-reference-make-probe` | memberships[read], vehicle_reference_makes[read/update] | - | - |
| `vehicle-reference-models-ondemand` | vehicle_reference_models[upsert] | - | - |
| `vehicle-reference-seed` | vehicle_reference_makes[upsert/read], vehicle_reference_models[upsert] | - | - |
| `vin-decode` | memberships[read], vin_decodes[read/upsert] | - | - |
| `won-vehicle-billing` | - | - | - |
| `won-vehicle-destination` | won_vehicles[read], trucking_rates[read], won_vehicle_destinations[read/update] | - | - |
| `won-vehicle-documents` | won_vehicles[read], won_vehicle_documents[read/update] | - | won-vehicle-documents |
| `won-vehicle-invoices` | won_vehicles[read], won_vehicle_documents[read], won_vehicle_invoice_issuances[read/update] | - | - |
| `won-vehicle-notify` | won_vehicles[read], clients[read] | - | - |
| `won-vehicle-promote` | - | promote_listing_to_won_vehicle | - |
| `won-vehicle-status` | - | advance_won_vehicle_status, correct_won_vehicle_status | - |
| `won-vehicle-tracking` | won_vehicles[read], won_vehicle_status_history[read] | - | - |
| `won-vehicle-winning-bid` | won_vehicles[read], won_vehicle_documents[read], won_vehicle_winning_bids[insert/read/update] | - | - |

## 2. Unauthenticated surfaces (no Supabase login required)

| Surface | URL / endpoint | Accepts | Returns / does | Guard |
|---|---|---|---|---|
| Login screen | `/` | Google OAuth (primary); email + password (added Prompt 41, for the synthetic test accounts and any provisioned user) | a Supabase session | Supabase Auth (settings in section 8) |
| Share page | `/share/<token>` -> `public-run` | 64-char token (query or body); POST with `listing_id` approves one listing | the run's name, created date, run type, allow-listed listing fields, derived stats and labels, signed image URLs (7 days) | token must match an ENABLED, non-deleted run; any lookup error answers a generic 404 |
| Tracking page | `/track/<token>` -> `won-vehicle-tracking` | 64-char token | status history only | token + `share_enabled` |
| Intake form | `/intake/<token>` -> `intake-brief` | 64-char token; POST body limited to an explicit field list | the brief form; writes `client_briefs` with status forced to `pending_review`; may email staff | token; revoked/approved briefs 404 identically |
| Extension write path | `research-capture`, `upload-images`, `list-active-runs` | header `x-research-secret` equal to ONE shared static secret (name `RESEARCH_CAPTURE_SECRET`) | captures written with the service role; image upload; run list for one org | static secret, compared with `!==` (not constant time), shared by three functions and embedded in the extension |
| Backup trigger | `monthly-backup` | header `x-backup-secret` (name `BACKUP_SECRET`) | exports data and emails it via Resend to configured recipients | static secret |
| Anon key REST | `https://<ref>.supabase.co/rest/v1/*` | the public anon key (ships in the JS bundle by design) | whatever RLS allows `anon` - see section 3 and finding M1 | RLS |

Token entropy: 64 alphanumeric characters. None of the token endpoints has application-level rate limiting (finding M7).

## 3. Tables and views (public schema)

52 base tables, 9 views. **Base tables with RLS disabled: 0.** Policies whose expression is literally `true`: see the flagged list below.

| Table | RLS | anon grant | Policies by command: who the expression admits |
|---|---|---|---|
| `asset_merge_decisions` | on | no | SELECT: superadmin / staff |
| `assets` | on | yes (RLS is the only barrier) | ALL: EVERYONE (true); DELETE: superadmin / staff; INSERT: superadmin / staff; SELECT: superadmin / staff; UPDATE: superadmin / staff |
| `auction_accounts` | on | no | INSERT: superadmin; SELECT: superadmin / staff; UPDATE: superadmin |
| `auction_fee_brackets` | on | no | INSERT: superadmin; SELECT: superadmin / staff; UPDATE: superadmin |
| `auction_fee_tiers` | on | no | SELECT: self (auth.uid()) |
| `auction_history` | on | yes (RLS is the only barrier) | SELECT: superadmin / staff; ALL: superadmin / staff |
| `auction_houses` | on | no | SELECT: self (auth.uid()) |
| `billing_applications` | on | no | SELECT: superadmin / staff |
| `billing_defaults` | on | no | INSERT: superadmin; SELECT: superadmin / staff; UPDATE: superadmin |
| `billing_document_lines` | on | no | SELECT: superadmin / staff / client (own rows) |
| `billing_documents` | on | no | SELECT: superadmin / staff / client (own rows) |
| `billing_documents_staff_notes` | on | yes (RLS is the only barrier) | ALL: superadmin / staff |
| `billing_files` | on | no | SELECT: superadmin / staff |
| `billing_issue_claims` | on | no | **no policy (deny all but service_role)** |
| `billing_payments` | on | no | SELECT: superadmin / staff / client (own rows) |
| `billing_payments_staff_notes` | on | yes (RLS is the only barrier) | ALL: superadmin / staff |
| `billing_receipts` | on | no | SELECT: superadmin / staff / client (own rows) |
| `billing_receipts_staff_notes` | on | yes (RLS is the only barrier) | ALL: superadmin / staff |
| `client_briefs` | on | yes (RLS is the only barrier) | DELETE: superadmin / staff; INSERT: superadmin / staff; SELECT: superadmin / staff / client (own rows); UPDATE: superadmin / staff |
| `client_staff_notes` | on | yes (RLS is the only barrier) | ALL: superadmin / staff |
| `clients` | on | yes (RLS is the only barrier) | DELETE: superadmin / staff; INSERT: superadmin / staff; SELECT: superadmin / staff / client (own rows); UPDATE: superadmin / staff |
| `cost_document_extractions` | on | yes (RLS is the only barrier) | DELETE: superadmin / staff; INSERT: superadmin / staff; SELECT: superadmin / staff; UPDATE: superadmin / staff |
| `cost_rates` | on | no | INSERT: superadmin; SELECT: superadmin / staff; UPDATE: superadmin |
| `document_numbers` | on | no | SELECT: superadmin / staff |
| `document_sequences` | on | no | SELECT: superadmin |
| `document_series_log` | on | no | SELECT: superadmin |
| `email_log` | on | yes (RLS is the only barrier) | SELECT: superadmin / staff |
| `memberships` | on | yes (RLS is the only barrier) | DELETE: superadmin; INSERT: superadmin; SELECT: superadmin / staff; UPDATE: superadmin |
| `org_billing_profile` | on | no | INSERT: superadmin; SELECT: superadmin / staff; UPDATE: superadmin |
| `org_settings` | on | yes (RLS is the only barrier) | INSERT: superadmin / staff; SELECT: superadmin / staff; UPDATE: superadmin / staff |
| `organizations` | on | yes (RLS is the only barrier) | DELETE: superadmin; INSERT: superadmin; SELECT: superadmin / any org member (incl. client role); UPDATE: superadmin |
| `rate_change_log` | on | no | SELECT: superadmin |
| `research_run_listings` | on | yes (RLS is the only barrier) | ALL: EVERYONE (true); DELETE: superadmin / staff; INSERT: superadmin / staff; SELECT: superadmin / staff; UPDATE: superadmin / staff |
| `research_runs` | on | yes (RLS is the only barrier) | ALL: EVERYONE (true); DELETE: superadmin / staff; INSERT: superadmin / staff; SELECT: superadmin / staff / client (own rows); UPDATE: superadmin / staff |
| `research_runs_staff_notes` | on | yes (RLS is the only barrier) | ALL: superadmin / staff |
| `sales` | on | yes (RLS is the only barrier) | ALL: EVERYONE (true) |
| `sightings` | on | yes (RLS is the only barrier) | ALL: EVERYONE (true); DELETE: superadmin / staff; INSERT: superadmin / staff; SELECT: superadmin / staff; UPDATE: superadmin / staff |
| `tax_codes` | on | no | INSERT: superadmin; SELECT: superadmin / staff; UPDATE: superadmin |
| `trucking_rates` | on | no | INSERT: superadmin; SELECT: superadmin / staff; UPDATE: superadmin |
| `vehicle_reference_makes` | on | yes (RLS is the only barrier) | SELECT: (see policy) |
| `vehicle_reference_models` | on | yes (RLS is the only barrier) | SELECT: (see policy) |
| `vin_decodes` | on | yes (RLS is the only barrier) | SELECT: (see policy) |
| `won_vehicle_actual_costs` | on | yes (RLS is the only barrier) | INSERT: superadmin / staff; SELECT: superadmin / staff; UPDATE: superadmin / staff |
| `won_vehicle_destinations` | on | yes (RLS is the only barrier) | SELECT: superadmin / staff |
| `won_vehicle_documents` | on | yes (RLS is the only barrier) | SELECT: superadmin / staff / client (own rows) |
| `won_vehicle_invoice_issuances` | on | yes (RLS is the only barrier) | SELECT: superadmin / staff |
| `won_vehicle_invoice_lines` | on | no | SELECT: superadmin / staff |
| `won_vehicle_payments` | on | no | SELECT: superadmin / staff |
| `won_vehicle_receipts` | on | no | SELECT: superadmin / staff |
| `won_vehicle_status_history` | on | yes (RLS is the only barrier) | SELECT: superadmin / staff / client (own rows) |
| `won_vehicle_winning_bids` | on | yes (RLS is the only barrier) | SELECT: superadmin / staff |
| `won_vehicles` | on | yes (RLS is the only barrier) | INSERT: superadmin / staff; SELECT: superadmin / staff / client (own rows); UPDATE: superadmin / staff |

### Views

| View | security_invoker | Access rule |
|---|---|---|
| `billing_document_balances` | false (runs as owner) | own explicit filter: staff of org / superadmin / the document's own client (082) |
| `billing_payment_remaining` | true | invoker |
| `client_account_status` | false (runs as owner) | own explicit filter: staff of org / superadmin only (080/084) |
| `client_account_status_base` | false (runs as owner) | NO GRANT to anon/authenticated/PUBLIC; only the two views above read it (084) |
| `my_account_status` | false (runs as owner) | own explicit filter: the caller's own client rows (084) |
| `my_client_record` | true | invoker: the client's own `clients` row via RLS |
| `my_won_vehicles` | true | invoker: own vehicles via RLS |
| `won_vehicle_actual_costs_current` | true | invoker: staff-only policies underneath |
| `won_vehicle_invoice_balances` | true | invoker |

### Flagged in the catalogue

- `assets` policy "all_assets_service" (ALL, roles {service_role}): expression `true` - service_role only, expected
- `research_run_listings` policy "all_research_run_listings_service" (ALL, roles {service_role}): expression `true` - service_role only, expected
- `research_runs` policy "all_research_runs_service" (ALL, roles {service_role}): expression `true` - service_role only, expected
- `sales` policy "Allow all access" (ALL, roles {public}): expression `true` - **admits everyone, including anonymous (finding M1)**
- `sightings` policy "all_sightings_service" (ALL, roles {service_role}): expression `true` - service_role only, expected
- anon holds ALL table privileges (including TRUNCATE, TRIGGER, REFERENCES) on 32 tables/views (Supabase defaults). PostgREST exposes no TRUNCATE, so this is not reachable through the API; it is relevant to any direct database credential (finding M5).

## 4. Storage buckets

| Bucket | Public | Size limit | Who can read | Who can write |
|---|---|---|---|---|
| `cost-documents` | private | none | superadmin (policy `cost_documents_superadmin_select`) | service_role only |
| `vehicle-images` | private | none | **any signed-in user with ANY membership row in the folder's org** - no role check, no `revoked_at` check (finding M2) | service_role only (via `store-images`, `upload-images`) |
| `won-vehicle-documents` | private | 10 MB; pdf, png, jpeg, webp | staff of the org (folder = org id) or superadmin; clients only through a signed URL from `billing` / `won-vehicle-documents` for their OWN files | service_role only |

All writes go through Edge Functions with the service role; there is no direct client write policy on `storage.objects`.

## 5. SECURITY DEFINER functions (public schema, 30)

All 30 have a fixed `search_path`. None is executable by PUBLIC by default except where listed. **Executable by `anon`:**

| Function | Why anon can execute it | Notes |
|---|---|---|
| `auction_accounts_log()` | explicit grant to anon / PUBLIC | trigger function |
| `billing_documents_number_void()` | explicit grant to anon / PUBLIC | trigger function |
| `billing_receipts_number_void()` | explicit grant to anon / PUBLIC | trigger function |
| `is_superadmin()` | explicit grant to anon / PUBLIC | helper used inside RLS expressions; returns false for anon |
| `link_new_auth_user_to_client()` | explicit grant to anon / PUBLIC | trigger on auth.users |
| `mark_number_voided_from_issuance()` | explicit grant to anon / PUBLIC | trigger function |
| `mark_number_voided_from_receipt()` | explicit grant to anon / PUBLIC | trigger function |
| `rate_table_guard()` | explicit grant to anon / PUBLIC | trigger function |
| `rls_auto_enable()` | explicit grant to anon / PUBLIC | event-trigger helper |
| `set_make_demoted(p_make_id uuid, p_demoted boolean, p_reason text)` | explicit grant to anon / PUBLIC | **callable by anon via `rpc`; its own guard is only "has ANY membership row" - no role, no `revoked_at` (finding M3)** |
| `user_org_ids()` | explicit grant to anon / PUBLIC | helper used inside RLS expressions; returns no rows for anon |

**Executable by `authenticated` (a signed-in client can call them; each checks its own caller):** `current_client_id`, `peek_next_document_number`, `provision_client_account`, `provision_client_account_by_email`, `revoke_client_access`, `set_document_client_visibility`, `user_is_staff`, plus the helpers above. **service_role only:** every document-numbering, issuing, voiding, importing and payment-recording function (`allocate_document_number`, `issue_billing_document`, `issue_billing_receipt`, `record_billing_payment`, `void_billing_record`, `import_*`, `configure_document_series`, `mark_document_number`, `apply_billing_credit`, `issue_generated_invoice`, `issue_receipt_record`).

## 6. Secrets and configuration - by NAME only

Names read through `Deno.env.get` (values are never printed or stored here):

| Name | Read by | Purpose |
|---|---|---|
| `APP_BASE_URL` | won-vehicle-notify | link base for emails |
| `BACKUP_FROM` | monthly-backup | sender address |
| `BACKUP_RECIPIENTS` | monthly-backup | who receives the backup email |
| `BACKUP_SECRET` | monthly-backup | authorises the backup export |
| `DEFAULT_ORG_ID` | list-active-runs, research-capture | the single org the extension path writes to |
| `GEMINI_API_KEY` | extract-cost-document, extract-vehicle-vision | outbound LLM provider key |
| `RESEARCH_CAPTURE_SECRET` | list-active-runs, research-capture, upload-images | the extension's shared static secret (3 functions) |
| `RESEND_API_KEY` | intake-brief, monthly-backup | outbound email provider key |
| `SUPABASE_ANON_KEY` | app-ingest, store-images | public by design (platform-provided) |
| `SUPABASE_SERVICE_ROLE_KEY` | app-ingest, asset-merge-candidates, asset-merge-confirm, asset-merge-dismiss, billing, client-provisioning, extract-cost-document, extract-vehicle-vision, intake-brief, list-active-runs, monthly-backup, public-run, research-capture, sightings-platform-relabel, store-images, upload-images, vehicle-reference-make-probe, vehicle-reference-models-ondemand, vehicle-reference-seed, vin-decode, won-vehicle-destination, won-vehicle-documents, won-vehicle-invoices, won-vehicle-notify, won-vehicle-promote, won-vehicle-status, won-vehicle-tracking, won-vehicle-winning-bid | bypasses RLS - the most powerful credential in the system |
| `SUPABASE_URL` | app-ingest, asset-merge-candidates, asset-merge-confirm, asset-merge-dismiss, billing, client-provisioning, extract-cost-document, extract-vehicle-vision, intake-brief, list-active-runs, monthly-backup, public-run, research-capture, sightings-platform-relabel, store-images, upload-images, vehicle-reference-make-probe, vehicle-reference-models-ondemand, vehicle-reference-seed, vin-decode, won-vehicle-destination, won-vehicle-documents, won-vehicle-invoices, won-vehicle-notify, won-vehicle-promote, won-vehicle-status, won-vehicle-tracking, won-vehicle-winning-bid | project URL (platform-provided) |
| `WON_NOTIFY_TEST_RECIPIENTS` | won-vehicle-notify | test redirect for notification mail |

Front end (build-time, public): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Test harness (never committed - `e2e/.env.e2e` is gitignored): synthetic account emails/passwords, user and client ids, the smoke share and tracking tokens, `E2E_BASE_URL`, `E2E_SMOKE_BASE_URL`.

## 7. The synthetic test estate (fair game) and the real estate (off-limits)

| Organisation | Status | Active members | Clients | Runs | Billing documents |
|---|---|---|---|---|---|
| `a93378ea…` Caplimo | **REAL - OFF-LIMITS** | 3 | 10 | 43 | 3 |
| `b0000000…` ZZ SYNTHETIC ORG (Prompt 37 Phase 2 test - not real) | synthetic | 0 | 2 | 2 | 0 |
| `b0000000…` ZZ SYNTHETIC ORG 2 (Prompt 38 acceptance - not real) | synthetic | 0 | 3 | 2 | 0 |
| `c0000000…` ZZ SYNTHETIC ORG 3 (Prompt 38 acceptance - not real) | synthetic | 0 | 3 | 2 | 3 |
| `d0000000…` ZZ SYNTHETIC ORG 4 (Prompt 38 acceptance - not real) | synthetic | 4 | 5 | 7 | 145 |

**Synthetic accounts** (all password-based, all in org 4 `d0000000-…`; passwords live only in the gitignored `e2e/.env.e2e`):

| Account | Role |
|---|---|
| `zz-not-yet-signed-up@autodata.test` | client @ d0000000 |
| `zz-preexisting-account@autodata.test` | client @ d0000000 |
| `zz-synthetic-client-c@autodata.test` | client @ d0000000 |
| `zz-synthetic-staff@autodata.test` | staff @ d0000000 |
| `zz-unprovisioned@autodata.test` | client @ d0000000 (REVOKED) |

**Synthetic fixtures the audit may use:** org-4 clients `ZZ Synthetic Client C` (account above), `ZZ Provisioning Target`, the pre-existing-account client; won vehicles `…0092` (belongs to a different org-4 client than client C), `…0093`, `…00a5`; runs `ZZ run sold twice`, `ZZ flags active`, `ZZ flags sold`, `ZZ mixed lot state`, `ZZ run Yaris`, `ZZ run Copart`; the permanent **smoke fixtures** - run `ZZ smoke share` with a share link and won vehicle `…0093` with a tracking link, both left ON (tokens in `e2e/.env.e2e`, never here). Org 4 holds ~145 synthetic billing documents. **Any write on org 4 is acceptable; any write, login or probe against org `a93378ea` or a real account is not.**

**Real estate (never touch):** org `a93378ea-…` (Caplimo): 2 active superadmin memberships, 1 active client membership, the real clients, ~43 runs, the real invoices (INV-0025…0028 history) and every real share link. The project also holds 5 non-synthetic auth accounts (2 without an active membership).

## 8. Not readable from here - Phase 4 must read these directly

- Supabase **Auth** dashboard: which providers are enabled, whether public sign-up is on, email confirmation, the **email + password** path added in Prompt 41 (is it enabled for everyone or restricted?), password policy and leaked-password protection, MFA, session lifetime, **redirect URL allow-list** (production domain vs localhost), JWT expiry.
- API settings: exposed schemas, `max_rows`, rate limits, network restrictions / SSL enforcement, database connection pooler exposure.
- Vercel project settings: environment variable exposure to the build, preview-deployment access, headers (CSP, frame-ancestors, HSTS) - `vercel.json` only rewrites everything to `/`.
- Edge Function logs retention and what the instrumented `billing` function logs (timings only; no document content).

## 9. Found during mapping (for Phase 4 to prioritise - NOTHING was fixed in this stage)

| # | Finding | Where | Why it matters |
|---|---|---|---|
| **M0 - RESOLVED 3 Oct 2026 (Prompt 45, migration 089)** - original finding follows; fix and evidence at the end of this row. | **Client account takeover by email match at signup.** `link_new_auth_user_to_client()` (migrations 026/070, trigger `on_auth_user_created_link_client`, enabled) fires AFTER INSERT on `auth.users` and links the single unlinked `clients` row whose email equals the new account's email, then creates a client membership. It never checks `email_confirmed_at`, so an account created at signup - before the address is proven - is linked and given access. `provision_client_account_by_email` (076/077/081) also links an EXISTING auth user found by email without a confirmation check, so an attacker who pre-registers a client's address is attached the moment staff provision that client. Read-only evidence (no account was created, no signup attempted): the trigger is enabled; the real org has **4 unlinked client records with an email address** (plus 1 linked), i.e. exactly the exposed population if signups are open. Whether Auth signups are open, and whether 'Confirm email' is enforced, is dashboard configuration not readable from here (section 8). | `supabase/migrations/026_client_account_linking.sql`, `070_client_provisioning.sql`, `076_provision_by_email.sql` | A third party who knows a client's email could register it, be linked to that client's record (invoices, vehicles, documents) and lock the real client out of linking. **Until cleared, provision no client beyond Mohammed.** Phase 4 to confirm signup settings first, then decide the fix (link only when `email_confirmed_at` is set, or disable open signup entirely - charter 7 says nobody self-registers). NOT fixed here. **RESOLVED:** every path now links through ONE function (`link_confirmed_auth_user_to_client`) that requires `email_confirmed_at` (or `phone_confirmed_at` for a phone match), requires the proven identity to match the record, and never overwrites a record that already has a `user_id`; a new trigger links an account the moment it is confirmed. Evidence: rolled-back proofs P1-P8 (unconfirmed signup, unconfirmed provisioning by email and by account id, and an unconfirmed phone all stayed unlinked with 0 memberships; confirmation, Google-at-creation and confirmed provisioning linked with exactly 1; an already-linked record was refused by every path; 0 unconfirmed accounts held a membership), and the same proof run against the OLD trigger body linked the unconfirmed account (so the test can fail). Existing links audited: 5 linked records, all confirmed, none mismatched (Mohammed: confirmed, email matches, active, Google). Still for Phase 4: Auth dashboard signup / email-confirmation settings (Bashir checks). |
| M1 | **The legacy `sales` table is open to anonymous users**: policy "Allow all access" (`true`, role PUBLIC) plus full anon grants; 169 rows of historical market sales (make, model, price, dealer, notes). Nothing in the app or the functions references it. | `public.sales` | Anyone holding the public anon key can read, insert, update or delete these rows through the REST API. Candidate to lock or drop. |
| M2 | **The `vehicle-images` storage read policy ignores role and revocation**: any membership row for the org (a client, or a REVOKED member) can read every image in that org's folder. | `storage.objects` policy `vehicle_images_authenticated_select` | A client can read all of an org's listing images; a revoked staff member keeps access. |
| M3 | **`set_make_demoted` is executable by anonymous callers and its only guard is "has any membership row"** - no role, no `revoked_at`. | `public.set_make_demoted` | A client or a revoked member can demote or restore a make in the SHARED reference vocabulary that every org's brief form uses. |
| M4 | **`vehicle-reference-models-ondemand` has no membership check at all** - any valid JWT (a client, a revoked user, an unprovisioned account) can call it. | Edge Function | Triggers outbound calls to an external API and writes the shared `vehicle_reference_models` table; a cost/abuse and data-integrity surface. |
| M5 | anon and authenticated hold TRUNCATE, TRIGGER and REFERENCES on most public tables (Supabase defaults). | grants | Not reachable through PostgREST; relevant to any direct DB credential. Cheap to revoke. |
| M6 | **One static secret guards three unauthenticated write/read paths** (`research-capture`, `upload-images`, `list-active-runs`), is compared with `!==`, is embedded in the Chrome extension, and the writes use the service role (RLS bypassed). Single org (`DEFAULT_ORG_ID`). | Edge Functions | Anyone who extracts the secret from the extension can write captures and read run lists with no user identity and no per-user audit. Rotation procedure is undocumented. |
| M7 | No application-level rate limiting on `public-run`, `won-vehicle-tracking`, `intake-brief` (a valid intake token can send staff email on each submission). | Edge Functions | 64-char tokens are not guessable, but a leaked or shared token is an unmetered door; `intake-brief` can generate email. |
| M8 | The email + password sign-in path exists on the production login screen. Whether the project restricts it (sign-up, confirmation, password policy) cannot be read from here. | Auth config | Section 8. |
| M9 | `monthly-backup` emails a data export on a valid secret; recipients are an environment value. | Edge Function | A leaked `BACKUP_SECRET` is an export trigger; the backup is only as private as the recipient mailbox. |
| M10 | Edge Functions answer CORS `Access-Control-Allow-Origin: *` everywhere, including the JWT-authenticated ones. | all functions | Safe for bearer-token APIs (no cookies), but worth confirming nothing relies on origin. |

**Confirmed good while mapping:** all 52 base tables have RLS on; `memberships` / `organizations` writes are superadmin-only; every `SECURITY DEFINER` function has a fixed `search_path`; every document-issuing function is service-role only; the four membership helper functions (`is_superadmin`, `user_is_staff`, `user_org_ids`, `current_client_id`) all filter `revoked_at`; all three storage buckets are private; the client-facing views each state their own access filter.

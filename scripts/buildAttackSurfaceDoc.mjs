// Builds docs/security/attack-surface.md from (a) the function scan (scripts/mapAttackSurface.mjs) and (b) read-only database
// catalogue queries saved by the Prompt 44 Stage 5 session. NAMES ONLY: no environment value, key or token value is read or
// written anywhere. Run after re-running the scan and the catalogue queries.
import fs from 'node:fs';
const S = process.argv[2];
const L = n => JSON.parse(fs.readFileSync(`${S}/as/${n}.json`, 'utf8')).rows;
const fnScan = JSON.parse(fs.readFileSync(`${S}/fn_scan.json`, 'utf8'));
const tables = L('tables'), pol = L('policies'), gr = L('grants'), bk = L('buckets'), df = L('definer'), orgs = L('orgs'), synth = L('synth_accounts');

const FN_NOTES = {
  'app-ingest': ['JWT + membership (staff/superadmin)', 'Ingests captures typed/pasted in the app (manual, AI vision).'],
  'asset-merge-candidates': ['JWT + superadmin', 'Read-only scan for duplicate assets.'],
  'asset-merge-confirm': ['JWT + superadmin', 'Merges two assets (repoints foreign keys; provenance fields never move).'],
  'asset-merge-dismiss': ['JWT + superadmin', 'Records a dismissal (append-only ledger).'],
  'billing': ['JWT + staff of the org (client JWT allowed ONLY for `file_url` of their own file, active client membership required)', 'THE only writer of invoices, deposit requests, credit notes, payments, applications, receipts. Claim-first idempotency (086).'],
  'client-provisioning': ['JWT + staff of the org', 'Provision / revoke a client login (calls DB functions).'],
  'extract-cost-document': ['JWT + membership', 'Sends an uploaded document to an external LLM (Gemini); stores extraction. `GEMINI_API_KEY` is OUTBOUND, not an inbound check.'],
  'extract-vehicle-vision': ['JWT + membership', 'Sends a screenshot to an external LLM (Gemini). `GEMINI_API_KEY` is OUTBOUND.'],
  'intake-brief': ['ANONYMOUS - unguessable token (64 chars) in URL/body; no JWT', 'Client self-service brief form: GET returns the brief fields + the client\'s own contact fields for that token; POST writes `client_briefs` (status forced to `pending_review`, never approvable by the client) and may email staff via Resend. Token lookup does not filter `share_enabled` by design (open-for-editing is decided from status).'],
  'list-active-runs': ['ANONYMOUS - static shared secret header (`x-research-secret`), no JWT', 'Lists runs for the Chrome extension, limited to the org the secret implies (`DEFAULT_ORG_ID`).'],
  'monthly-backup': ['ANONYMOUS - static secret header (`x-backup-secret`), no JWT', 'Exports tables and EMAILS the backup via Resend to configured recipients. A leaked secret = a data export trigger.'],
  'public-run': ['ANONYMOUS - unguessable share token (64 chars), `share_enabled` and `deleted_at` checked; no JWT', 'Serves the client share page: hand-built field allow-list, derived booleans only for flags (never raw history, never staff notes). Reads with the service role.'],
  'research-capture': ['ANONYMOUS - static shared secret header (`x-research-secret`), no JWT', 'THE extension write path: creates assets, sightings, auction_history, run listings with the service role (RLS bypassed). One org (`DEFAULT_ORG_ID`).'],
  'sightings-platform-relabel': ['JWT + superadmin', 'Bulk relabel of a platform value (audited).'],
  'store-images': ['JWT + membership', 'Fetches listing images and stores them in `vehicle-images`.'],
  'upload-images': ['ANONYMOUS - static shared secret header (`x-research-secret`), no JWT', 'Extension uploads images in page context (bid.cars blocks direct loads).'],
  'vehicle-reference-make-probe': ['JWT + superadmin', 'Probes an external vehicle API for makes.'],
  'vehicle-reference-models-ondemand': ['JWT only - ANY signed-in user (NO membership/role check at all)', 'Cache-on-miss fetch of models from an external API, writes the shared `vehicle_reference_models`. See finding M4.'],
  'vehicle-reference-seed': ['JWT + superadmin', 'Bulk seed of reference data.'],
  'vin-decode': ['JWT + membership', 'Decodes a VIN via an external API, caches in `vin_decodes`.'],
  'won-vehicle-billing': ['(none - RETIRED)', 'Refuses every request with HTTP 410 before parsing anything; touches no table.'],
  'won-vehicle-destination': ['JWT + staff of the org', 'Sets a vehicle destination port/method (append-only).'],
  'won-vehicle-documents': ['JWT + staff of the org; client JWT only for `client_file_url` (own vehicle, client_visible, active client membership)', 'Upload/delete vehicle documents; signed URLs.'],
  'won-vehicle-invoices': ['JWT + staff of the org', 'Records that an invoice was sent (legacy issuance trail).'],
  'won-vehicle-notify': ['JWT + staff of the org', 'Sends the tracking-link email via Resend; `WON_NOTIFY_TEST_RECIPIENTS` redirects mail in test.'],
  'won-vehicle-promote': ['JWT + superadmin', 'Promotes an approved listing to a won vehicle.'],
  'won-vehicle-status': ['JWT + staff (advance) / superadmin (correct)', 'Advances or corrects a vehicle status (append-only history).'],
  'won-vehicle-tracking': ['ANONYMOUS - unguessable share token, `share_enabled` checked; no JWT', 'Serves the public tracking page: status history only (no money, no documents).'],
  'won-vehicle-winning-bid': ['JWT + staff of the org', 'Records/voids the winning bid (append-only ledger).'],
};

let md = '';
const w = s => { md += s + '\n'; };
w('# AutoData attack-surface map');
w('');
w(`**Produced:** 1 Oct 2026, Prompt 44 Stage 5. **Read-only:** nothing was fixed, tested destructively or changed in producing this. **No secret value appears anywhere in this file** - environment variables are listed by NAME only; tokens and passwords are described by where they live, never quoted.`);
w('');
w('> **The real organisation (`a93378ea-…`, Caplimo) and every real client are OFF-LIMITS to the audit.** Phase 4 works on the synthetic estate in section 7 and on read-only reviews of code, configuration and catalogue data. Nothing here authorises any write, login attempt or probe against real accounts, real documents or real share links.');
w('');
w('Sources: `supabase/functions/**` and `supabase/config.toml` (scanner `scripts/mapAttackSurface.mjs`), and read-only catalogue queries (`pg_class`, `pg_policies`, `information_schema`, `storage.buckets`, `pg_proc`) against the linked project. The Supabase **dashboard** settings (Auth providers, signup, password policy, MFA, redirect URLs, rate limits, network restrictions) are NOT readable from here and are listed in section 8 for Phase 4 to read directly.');
w('');

w('## 1. Edge Functions (29 deployed)');
w('');
w('`verify_jwt` = the Supabase gateway setting from `config.toml`; `default (true)` means the gateway rejects any request without a valid JWT before the code runs. **Revoked memberships:** every one of the 21 membership reads across the functions carries `.is(\'revoked_at\', null)` (checked by script: 21 of 21), and client file access additionally requires an ACTIVE client membership. The two token-only and three secret-only functions do not read memberships at all.');
w('');
w('| Function | `verify_jwt` | Auth mode | Reads memberships | Honours revoked | Service role | Notes |');
w('|---|---|---|---|---|---|---|');
for (const f of fnScan) { const n = FN_NOTES[f.fn] ?? ['(review)', '']; w(`| \`${f.fn}\` | ${f.jwt} | ${n[0]} | ${f.readsMemberships ? 'yes' : 'no'} | ${f.readsMemberships ? (f.revoked ? 'yes' : '**NO**') : 'n/a'} | ${f.svc ? 'yes' : 'no'} | ${n[1]} |`); }
w('');
w('### 1b. What each function reads and writes (scanner output - approximate, from the source; verify before relying on it)');
w('');
w('| Function | Tables (verbs) | RPCs | Storage buckets |');
w('|---|---|---|---|');
for (const f of fnScan) w(`| \`${f.fn}\` | ${f.tables.length ? f.tables.join(', ') : '-'} | ${f.rpcs.length ? f.rpcs.join(', ') : '-'} | ${f.buckets.length ? f.buckets.join(', ') : '-'} |`);
w('');

w('## 2. Unauthenticated surfaces (no Supabase login required)');
w('');
w('| Surface | URL / endpoint | Accepts | Returns / does | Guard |');
w('|---|---|---|---|---|');
w('| Login screen | `/` | Google OAuth (primary); email + password (added Prompt 41, for the synthetic test accounts and any provisioned user) | a Supabase session | Supabase Auth (settings in section 8) |');
w('| Share page | `/share/<token>` -> `public-run` | 64-char token (query or body); POST with `listing_id` approves one listing | the run\'s name, created date, run type, allow-listed listing fields, derived stats and labels, signed image URLs (7 days) | token must match an ENABLED, non-deleted run; any lookup error answers a generic 404 |');
w('| Tracking page | `/track/<token>` -> `won-vehicle-tracking` | 64-char token | status history only | token + `share_enabled` |');
w('| Intake form | `/intake/<token>` -> `intake-brief` | 64-char token; POST body limited to an explicit field list | the brief form; writes `client_briefs` with status forced to `pending_review`; may email staff | token; revoked/approved briefs 404 identically |');
w('| Extension write path | `research-capture`, `upload-images`, `list-active-runs` | header `x-research-secret` equal to ONE shared static secret (name `RESEARCH_CAPTURE_SECRET`) | captures written with the service role; image upload; run list for one org | static secret, compared with `!==` (not constant time), shared by three functions and embedded in the extension |');
w('| Backup trigger | `monthly-backup` | header `x-backup-secret` (name `BACKUP_SECRET`) | exports data and emails it via Resend to configured recipients | static secret |');
w('| Anon key REST | `https://<ref>.supabase.co/rest/v1/*` | the public anon key (ships in the JS bundle by design) | whatever RLS allows `anon` - see section 3 and finding M1 | RLS |');
w('');
w('Token entropy: 64 alphanumeric characters. None of the token endpoints has application-level rate limiting (finding M7).');
w('');

w('## 3. Tables and views (public schema)');
w('');
const base = tables.filter(t => t.kind === 'table'), views = tables.filter(t => t.kind === 'view');
const grantBy = new Map(); gr.forEach(g => { if (!grantBy.has(g.table_name)) grantBy.set(g.table_name, {}); grantBy.get(g.table_name)[g.grantee] = g.privs; });
const who = (q) => { if (!q) return []; const r = new Set();
  if (/^\s*\(?true\)?\s*$/i.test(q)) r.add('EVERYONE (true)');
  if (/service_role/.test(q)) r.add('service_role');
  if (/is_superadmin\(\)/.test(q)) r.add('superadmin');
  if (/user_is_staff\(/.test(q)) r.add('staff');
  if (/current_client_id\(/.test(q)) r.add('client (own rows)');
  if (/user_org_ids\(\)/.test(q) && !/user_is_staff\(/.test(q)) r.add('any org member (incl. client role)');
  if (/auth\.uid\(\)/.test(q) && !r.size) r.add('self (auth.uid())');
  return [...r]; };
w(`${base.length} base tables, ${views.length} views. **Base tables with RLS disabled: ${base.filter(t => !t.rls).length}.** Policies whose expression is literally \`true\`: see the flagged list below.`);
w('');
w('| Table | RLS | anon grant | Policies by command: who the expression admits |');
w('|---|---|---|---|');
for (const t of base) {
  const ps = pol.filter(p => p.schemaname === 'public' && p.tablename === t.relname);
  const byCmd = {}; ps.forEach(p => { const e = new Set([...who(p.qual), ...who(p.with_check)]); (byCmd[p.cmd] ??= new Set()); e.forEach(x => byCmd[p.cmd].add(x)); if (!e.size) byCmd[p.cmd].add('(see policy)'); });
  const g = grantBy.get(t.relname)?.anon;
  w(`| \`${t.relname}\` | ${t.rls ? 'on' : '**OFF**'} | ${g ? 'yes (RLS is the only barrier)' : 'no'} | ${ps.length ? Object.entries(byCmd).map(([c, s]) => `${c}: ${[...s].join(' / ')}`).join('; ') : '**no policy (deny all but service_role)**'} |`);
}
w('');
w('### Views');
w('');
w('| View | security_invoker | Access rule |');
w('|---|---|---|');
const VIEW_NOTES = { billing_document_balances: 'own explicit filter: staff of org / superadmin / the document\'s own client (082)', client_account_status: 'own explicit filter: staff of org / superadmin only (080/084)', client_account_status_base: 'NO GRANT to anon/authenticated/PUBLIC; only the two views above read it (084)', my_account_status: 'own explicit filter: the caller\'s own client rows (084)', my_client_record: 'invoker: the client\'s own `clients` row via RLS', my_won_vehicles: 'invoker: own vehicles via RLS', billing_payment_remaining: 'invoker', won_vehicle_actual_costs_current: 'invoker: staff-only policies underneath', won_vehicle_invoice_balances: 'invoker' };
for (const v of views) w(`| \`${v.relname}\` | ${v.security_invoker === 'true' ? 'true' : 'false (runs as owner)'} | ${VIEW_NOTES[v.relname] ?? ''} |`);
w('');
w('### Flagged in the catalogue');
w('');
const trueP = pol.filter(p => p.schemaname === 'public' && (/^\s*\(?true\)?\s*$/i.test(p.qual || '') || /^\s*\(?true\)?\s*$/i.test(p.with_check || '')));
trueP.forEach(p => w(`- \`${p.tablename}\` policy "${p.policyname}" (${p.cmd}, roles ${p.roles}): expression \`true\`${/service_role/.test(p.roles) ? ' - service_role only, expected' : ' - **admits everyone, including anonymous (finding M1)**'}`));
w(`- anon holds ALL table privileges (including TRUNCATE, TRIGGER, REFERENCES) on ${[...grantBy.values()].filter(g => g.anon).length} tables/views (Supabase defaults). PostgREST exposes no TRUNCATE, so this is not reachable through the API; it is relevant to any direct database credential (finding M5).`);
w('');

w('## 4. Storage buckets');
w('');
w('| Bucket | Public | Size limit | Who can read | Who can write |');
w('|---|---|---|---|---|');
w('| `cost-documents` | private | none | superadmin (policy `cost_documents_superadmin_select`) | service_role only |');
w('| `vehicle-images` | private | none | **any signed-in user with ANY membership row in the folder\'s org** - no role check, no `revoked_at` check (finding M2) | service_role only (via `store-images`, `upload-images`) |');
w('| `won-vehicle-documents` | private | 10 MB; pdf, png, jpeg, webp | staff of the org (folder = org id) or superadmin; clients only through a signed URL from `billing` / `won-vehicle-documents` for their OWN files | service_role only |');
w('');
w('All writes go through Edge Functions with the service role; there is no direct client write policy on `storage.objects`.');
w('');

w('## 5. SECURITY DEFINER functions (public schema, 30)');
w('');
w('All 30 have a fixed `search_path`. None is executable by PUBLIC by default except where listed. **Executable by `anon`:**');
w('');
const anonDef = df.filter(f => /anon=X/.test(f.acl));
w('| Function | Why anon can execute it | Notes |');
w('|---|---|---|');
const DEF_NOTES = { auction_accounts_log: 'trigger function', billing_documents_number_void: 'trigger function', billing_receipts_number_void: 'trigger function', is_superadmin: 'helper used inside RLS expressions; returns false for anon', link_new_auth_user_to_client: 'trigger on auth.users', mark_number_voided_from_issuance: 'trigger function', mark_number_voided_from_receipt: 'trigger function', rate_table_guard: 'trigger function', rls_auto_enable: 'event-trigger helper', set_make_demoted: '**callable by anon via `rpc`; its own guard is only "has ANY membership row" - no role, no `revoked_at` (finding M3)**', user_org_ids: 'helper used inside RLS expressions; returns no rows for anon' };
anonDef.forEach(f => w(`| \`${f.proname}(${f.args})\` | explicit grant to anon / PUBLIC | ${DEF_NOTES[f.proname] ?? ''} |`));
w('');
w('**Executable by `authenticated` (a signed-in client can call them; each checks its own caller):** `current_client_id`, `peek_next_document_number`, `provision_client_account`, `provision_client_account_by_email`, `revoke_client_access`, `set_document_client_visibility`, `user_is_staff`, plus the helpers above. **service_role only:** every document-numbering, issuing, voiding, importing and payment-recording function (`allocate_document_number`, `issue_billing_document`, `issue_billing_receipt`, `record_billing_payment`, `void_billing_record`, `import_*`, `configure_document_series`, `mark_document_number`, `apply_billing_credit`, `issue_generated_invoice`, `issue_receipt_record`).');
w('');

w('## 6. Secrets and configuration - by NAME only');
w('');
w('Names read through `Deno.env.get` (values are never printed or stored here):');
w('');
w('| Name | Read by | Purpose |');
w('|---|---|---|');
const envMap = {}; fnScan.forEach(f => f.env.forEach(e => (envMap[e] ??= []).push(f.fn)));
const PURPOSE = { SUPABASE_URL: 'project URL (platform-provided)', SUPABASE_SERVICE_ROLE_KEY: 'bypasses RLS - the most powerful credential in the system', SUPABASE_ANON_KEY: 'public by design (platform-provided)', RESEARCH_CAPTURE_SECRET: 'the extension\'s shared static secret (3 functions)', BACKUP_SECRET: 'authorises the backup export', BACKUP_FROM: 'sender address', BACKUP_RECIPIENTS: 'who receives the backup email', RESEND_API_KEY: 'outbound email provider key', GEMINI_API_KEY: 'outbound LLM provider key', DEFAULT_ORG_ID: 'the single org the extension path writes to', APP_BASE_URL: 'link base for emails', WON_NOTIFY_TEST_RECIPIENTS: 'test redirect for notification mail' };
Object.keys(envMap).sort().forEach(e => w(`| \`${e}\` | ${envMap[e].join(', ')} | ${PURPOSE[e] ?? ''} |`));
w('');
w('Front end (build-time, public): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Test harness (never committed - `e2e/.env.e2e` is gitignored): synthetic account emails/passwords, user and client ids, the smoke share and tracking tokens, `E2E_BASE_URL`, `E2E_SMOKE_BASE_URL`.');
w('');

w('## 7. The synthetic test estate (fair game) and the real estate (off-limits)');
w('');
w('| Organisation | Status | Active members | Clients | Runs | Billing documents |');
w('|---|---|---|---|---|---|');
orgs.forEach(o => { const real = o.id.startsWith('a93378ea'); w(`| \`${o.id.slice(0, 8)}…\` ${o.name} | ${real ? '**REAL - OFF-LIMITS**' : 'synthetic'} | ${o.active_members} | ${o.clients} | ${o.runs} | ${o.docs} |`); });
w('');
w('**Synthetic accounts** (all password-based, all in org 4 `d0000000-…`; passwords live only in the gitignored `e2e/.env.e2e`):');
w('');
w('| Account | Role |');
w('|---|---|');
synth.forEach(a => w(`| \`${a.email}\` | ${a.memberships} |`));
w('');
w('**Synthetic fixtures the audit may use:** org-4 clients `ZZ Synthetic Client C` (account above), `ZZ Provisioning Target`, the pre-existing-account client; won vehicles `…0092` (belongs to a different org-4 client than client C), `…0093`, `…00a5`; runs `ZZ run sold twice`, `ZZ flags active`, `ZZ flags sold`, `ZZ mixed lot state`, `ZZ run Yaris`, `ZZ run Copart`; the permanent **smoke fixtures** - run `ZZ smoke share` with a share link and won vehicle `…0093` with a tracking link, both left ON (tokens in `e2e/.env.e2e`, never here). Org 4 holds ~145 synthetic billing documents. **Any write on org 4 is acceptable; any write, login or probe against org `a93378ea` or a real account is not.**');
w('');
w('**Real estate (never touch):** org `a93378ea-…` (Caplimo): 2 active superadmin memberships, 1 active client membership, the real clients, ~43 runs, the real invoices (INV-0025…0028 history) and every real share link. The project also holds 5 non-synthetic auth accounts (2 without an active membership).');
w('');

w('## 8. Not readable from here - Phase 4 must read these directly');
w('');
w('- Supabase **Auth** dashboard: which providers are enabled, whether public sign-up is on, email confirmation, the **email + password** path added in Prompt 41 (is it enabled for everyone or restricted?), password policy and leaked-password protection, MFA, session lifetime, **redirect URL allow-list** (production domain vs localhost), JWT expiry.');
w('- API settings: exposed schemas, `max_rows`, rate limits, network restrictions / SSL enforcement, database connection pooler exposure.');
w('- Vercel project settings: environment variable exposure to the build, preview-deployment access, headers (CSP, frame-ancestors, HSTS) - `vercel.json` only rewrites everything to `/`.');
w('- Edge Function logs retention and what the instrumented `billing` function logs (timings only; no document content).');
w('');

w('## 9. Found during mapping (for Phase 4 to prioritise - NOTHING was fixed in this stage)');
w('');
w('| # | Finding | Where | Why it matters |');
w('|---|---|---|---|');
w('| M1 | **The legacy `sales` table is open to anonymous users**: policy "Allow all access" (`true`, role PUBLIC) plus full anon grants; 169 rows of historical market sales (make, model, price, dealer, notes). Nothing in the app or the functions references it. | `public.sales` | Anyone holding the public anon key can read, insert, update or delete these rows through the REST API. Candidate to lock or drop. |');
w('| M2 | **The `vehicle-images` storage read policy ignores role and revocation**: any membership row for the org (a client, or a REVOKED member) can read every image in that org\'s folder. | `storage.objects` policy `vehicle_images_authenticated_select` | A client can read all of an org\'s listing images; a revoked staff member keeps access. |');
w('| M3 | **`set_make_demoted` is executable by anonymous callers and its only guard is "has any membership row"** - no role, no `revoked_at`. | `public.set_make_demoted` | A client or a revoked member can demote or restore a make in the SHARED reference vocabulary that every org\'s brief form uses. |');
w('| M4 | **`vehicle-reference-models-ondemand` has no membership check at all** - any valid JWT (a client, a revoked user, an unprovisioned account) can call it. | Edge Function | Triggers outbound calls to an external API and writes the shared `vehicle_reference_models` table; a cost/abuse and data-integrity surface. |');
w('| M5 | anon and authenticated hold TRUNCATE, TRIGGER and REFERENCES on most public tables (Supabase defaults). | grants | Not reachable through PostgREST; relevant to any direct DB credential. Cheap to revoke. |');
w('| M6 | **One static secret guards three unauthenticated write/read paths** (`research-capture`, `upload-images`, `list-active-runs`), is compared with `!==`, is embedded in the Chrome extension, and the writes use the service role (RLS bypassed). Single org (`DEFAULT_ORG_ID`). | Edge Functions | Anyone who extracts the secret from the extension can write captures and read run lists with no user identity and no per-user audit. Rotation procedure is undocumented. |');
w('| M7 | No application-level rate limiting on `public-run`, `won-vehicle-tracking`, `intake-brief` (a valid intake token can send staff email on each submission). | Edge Functions | 64-char tokens are not guessable, but a leaked or shared token is an unmetered door; `intake-brief` can generate email. |');
w('| M8 | The email + password sign-in path exists on the production login screen. Whether the project restricts it (sign-up, confirmation, password policy) cannot be read from here. | Auth config | Section 8. |');
w('| M9 | `monthly-backup` emails a data export on a valid secret; recipients are an environment value. | Edge Function | A leaked `BACKUP_SECRET` is an export trigger; the backup is only as private as the recipient mailbox. |');
w('| M10 | Edge Functions answer CORS `Access-Control-Allow-Origin: *` everywhere, including the JWT-authenticated ones. | all functions | Safe for bearer-token APIs (no cookies), but worth confirming nothing relies on origin. |');
w('');
w('**Confirmed good while mapping:** all 52 base tables have RLS on; `memberships` / `organizations` writes are superadmin-only; every `SECURITY DEFINER` function has a fixed `search_path`; every document-issuing function is service-role only; the four membership helper functions (`is_superadmin`, `user_is_staff`, `user_org_ids`, `current_client_id`) all filter `revoked_at`; all three storage buckets are private; the client-facing views each state their own access filter.');
fs.writeFileSync('docs/security/attack-surface.md', md);
console.log('written', md.length, 'chars');

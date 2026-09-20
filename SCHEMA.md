# SCHEMA.md — Database reference

**Status:** Living. Update when a migration lands.
**Supabase project ref:** `xrotvpuainpfdulhfhtt`
**Migrations applied:** 001 → 031 (007 and 017 were never allocated — not a gap)
**Last revised:** 9 September 2026

> Written because real time has been lost to not knowing which table holds which field.
> A rule written against a field the query does not return **fails silently** — it never
> fires and never errors. Check here first.

---

## 1. The core distinction

**`assets`** — one row per *physical vehicle*. VIN-fingerprinted (SHA256); falls back to a
make/model/year/trim/colour formula when no VIN. This is market intelligence.

**`sightings`** — one row per *observation* of an asset. ~30 fields. The same car seen on
Copart and bid.cars produces one asset and two sightings, with cross-source COALESCE
enrichment.

**Dedup behaviour:** live lots **overwrite** on re-capture; `finished` sightings
**accumulate immutably** (sold comps are historical records).

---

## 2. Which table holds what — the field most often got wrong

| Field | Table | Notes |
|---|---|---|
| `make`, `model`, `trim`, `year` | **assets** | |
| `vin`, `body_style`, `cylinders` | **assets** | |
| `engine_type`, `horsepower`, `drivetrain` | **assets** | |
| `transmission`, `fuel` | **assets** | |
| `exterior_color` | **assets** | note US spelling |
| `mileage_miles` | **sightings** | integer |
| `title_type` | **sightings** | free text, very messy — see §5 |
| `damage_type`, `secondary_damage` | **sightings** | free text — see §4 |
| `runs_and_drives`, `engine_starts`, `transmission_engages` | **sightings** | true booleans |
| `has_key` | **sightings** | **TEXT** "Yes"/"No", not boolean |
| `highlights` | **sightings** | **TEXT**, not an array |
| `sale_date` | **sightings** | **TEXT**, inconsistent — see §6 |
| `sale_confirmed` | **sightings** | boolean, nullable — see §7 |
| `logged_via` | **sightings** | mechanism, not platform — see §3 |
| `price_usd`, `exchange_rate`, `exchange_rate_date` | **sightings** | normalised at capture |
| `listed_price`, `listed_currency` | **sightings** | raw — never average these |
| `current_bid_usd` | **sightings** | `0` is real; `null` = no bids. **Never a liveness test** |
| `lot_state` | **sightings** | `active` \| `finished` \| `unknown` — the liveness test |
| `auction_appearance_count` | **sightings** | derived from `auction_history` |
| `seller`, `seller_type`, `location` | **sightings** | |
| `image_urls`, `stored_image_urls`, `image_store_status` | **sightings** | |
| `org_id`, `created_by`, `captured_at`, `raw_payload` | **sightings** | |

---

## 3. `logged_via` vs `source_platform` — different axes

- **`logged_via`** = *mechanism*: `manual_entry` | `extension_dom_capture` | `ai_vision` |
  `api_import`
- **`source_platform`** = *where the vehicle was seen*: copart, bid.cars, IAAI, dealer

These are independent. A rule needing "was this captured from an auction site?" uses
`logged_via`; a rule needing "which auction?" uses `source_platform`.

---

## 4. Damage — real observed values

Damage is **free text, inconsistently cased**, not Copart's official codes. Real values
currently in `damage_type` / `secondary_damage`:

```
Front end · Front End · Side · Right front · Rear · Rear End · Normal wear
Normal Wear · Minor dent / scratches · Left side · Left rear · Left front
Right rear · Right side · Roof · Storm damage · Mechanical · Unknown
```

Because there are no codes stored, **all damage matching is case-insensitive substring
matching** against a combined haystack of both damage fields.

**Copart's official code list** (for reference — these are the concepts to match, not the
stored values):

```
AO ALL OVER · BC BIOHAZARDOUS/CHEMICAL · BE BURN-ENGINE · BI BURN-INTERIOR · BN BURN
CC CASH FOR CLUNKERS · DH DAMAGE HISTORY · FD FRAME DAMAGE REPORTED · FR FRONT END
HL HAIL · MC MECHANICAL · MN MINOR DENTS/SCRATCHES · NW NORMAL WEAR
PR PARTIAL/INCOMPLETE REPAIR · RJ REJECTED REPAIR · RO ROLLOVER · RR REAR END
SD SIDE · ST STRIPPED · TP TOP/ROOF · UK UNKNOWN · UN UNDERCARRIAGE
VI MISSING/ALTERED VIN · VN VANDALISM · VP REPLACED VIN · WA WATER/FLOOD
```

**Critical keyword list currently in use** (active-listings runs only):

```
mechanical · water · flood · burn · damage history · partial · rejected
undercarriage · unknown · frame · rollover · stripped · all over · biohaz
chemical · missing · altered · replaced vin · vin · storm
```

`storm` is included deliberately: it could mean flood, hail or wind, so it is flagged as
ambiguous rather than passed clean.

Standardising damage into clean classes is future work (Estimator E2 resolver).

---

## 5. `title_type` — genuinely messy

Real observed values include:

```
Salvage (Mississippi) · Salvage certificate (CA) · Certificate of title (WV)
TX - · Cert of salvage > 75% damage (MD) · Mv-907a (New york) - parts only
Cert of title-reconstrctd coll (MA) · IL - Certificate Of Title · Clear (Indiana)
CA - Dis/dlr/exp Only Clean Title · NH - Certificate Of Title Title Absent
```

Format varies by state and by capture source. Title matching against a client brief is
therefore **approximate substring matching**, explicitly commented as such in code, pending
title standardisation. Do not treat it as reliable.

---

## 6. `sale_date` — TEXT, must be parsed

Real observed values:

| Value | Meaning |
|---|---|
| `"Thu. Aug 06, 2026 03:00 PM GMT+1"` | Full date + time + timezone (Copart, most common) |
| `"Future"` | Auction scheduled, date not yet published |
| `null` | Not captured |
| `"2026-09-04T13:30:04.181Z"` (ISO 8601) | bid.cars **active** lot only — see below |

Full date-and-time **is** available, which is what makes both the countdown and a 1-hour
email alert possible.

**bid.cars active lots — added 4 Sep 2026, and what the value means.** The live page's own
displayed date has no year (`"Friday, 4 September, 14:30"`), which `parseAuctionDate()`
correctly rejects rather than guess a year. Instead, capture reads the page's machine-readable
countdown offset (`#time-left`'s `data-initial-total-seconds`) and stores an absolute ISO
instant computed as capture time + offset seconds. **This value is bid-closing time, not
auction-start time** — the source element's own tooltip states bidding closes 30 minutes
before the live auction itself starts. Treat `sale_date` on an active bid.cars sighting as
"when bidding closes," not "when the auction starts," anywhere it is read — including the
alerts build (`PLAN_TRACKER.md` 4.1). Archived bid.cars lots are unaffected: `sale_date`
stays `null` for them, as before. See `docs/SOLVED.md` §4 for the full mechanism.

All time-based logic must use the shared helper:

```ts
// src/utils/auctionDate.ts
parseAuctionDate(raw: string | null | undefined): Date | null
```

Returns a real `Date`, or `null` for "Future" / empty / unparseable. **Never a fallback
date.** The alerts build must reuse this exact helper — a second parser would drift.

---

## 7. `sale_confirmed` — three states, three meanings

Derived from the last row's status in `auction_history` (bid.cars Sales History panel).

| Value | Meaning | Treatment in sold_comps |
|---|---|---|
| `true` | Confirmed sold | Attach ✓ · count in average ✓ |
| `false` | Confirmed **not** sold | **Hard block** from attaching |
| `null` + `logged_via` manual/vision | Verification concept does not apply | Attach ✓ · count ✓ |
| `null` + auction platform | Cannot verify | Attach ✓ · **badge** · not counted |

**Why this exists:** "Final bid" on bid.cars is not a sale price. A verified case — a 2010
Toyota Yaris ran **16 times over two months and never sold**, bids $875–$1,650, every row
"Not sold" — yet the page displayed "Final bid $1,100 USD". Sold comps built naively on that
field are polluted with rejected bids.

**Coverage gap — permanent, not pending.** The Sales History scan exists for bid.cars only.
**Copart has none, and B2 (Copart Sales History) is retired as not buildable** — DOM recon on
a live Copart lot (4 Sep 2026, lot 49917586) found no prior-sales or auction-history panel of
any kind (see `PLAN_TRACKER.md` B2 for the recon evidence). Every Copart sighting therefore
has `sale_confirmed = null` **permanently**, by design of the source, not as a temporary gap.
This is honest (we genuinely cannot confirm), but the "Unconfirmed sale" badge on Copart cars
is now a permanent property of that source, not a state pending a future build. Captures made
before the bid.cars scan existed (pre-03 Aug 2026) are also permanently null unless
re-captured.

---

## 8. `auction_history`

One row per past auction appearance, from the bid.cars Sales History panel only (source:
`supabase/migrations/019_auction_history.sql`, confirmed live via SQL 4 Sep 2026).

Real columns:
```
id · org_id · asset_id · sighting_id · auction_platform · auction_date · lot_number
bid_amount_usd · odometer_miles · status · seller_type · created_at
```

**The column is `auction_platform`, not `platform`.** A query written against `platform`
fails outright ("column does not exist"); a rule written against a field the query does not
return fails silently instead (`AGENTS.md` §4.10) — this exact naming assumption already
cost a failed query in this session.

Observed `status` values: `'Sold'`, `'Not sold'`, `'No information'`. `'No information'`
means unknown, not unsold.

Dedupe verified: re-capturing the same lot does not duplicate history rows.

Feeds `sale_confirmed` and `auction_appearance_count`. **Not yet feeding** the derived
flags (`previously_unsold`, `highest_rejected_bid`, prior-auction-history) — that is
Phase A2, still unbuilt. See `MASTER_PLAN.md` A2 for the flag definitions and rule.

---

## 9. Research runs

**`research_runs`**

```
id · org_id · client_name · target_spec · sheet_url · drive_folder_url
status · notes · created_at · updated_at
share_token · share_enabled · run_type · deleted_at · deleted_by
critical_override_reason · critical_override_by · critical_override_at   (migration 021)
client_id · client_brief_id                                              (migration 022)
deposit_override_reason · deposit_override_by · deposit_override_at      (migration 027)
```

`run_type` = `sold_comps` | `active_listings` | `mixed`

`sheet_url` and `drive_folder_url` are legacy — Google Drive/Sheets were permanently
dropped in favour of Supabase Storage.

**`research_run_listings`** — the join to sightings. Real columns (confirmed live,
9 Sep 2026):
```
id · run_id · sighting_id · position · image_order (jsonb) · notes · created_at · org_id
included
approved_at · approved_via · approved_by · approved_snapshot (jsonb)      (migration 028)
```
`approved_via` = `client` | `staff_relayed`, with a CHECK constraint pairing
`approved_via='client'` with `approved_by NULL` and `approved_via='staff_relayed'` with
`approved_by NOT NULL` — the two shapes cannot collapse into one field even by accident.
`approved_snapshot` is a server-side-computed copy of what the client actually saw
(identifying details, displayed price, displayed auction date) at approval time — never
built from the request body, never re-derived later from the live (mutable) listing row.
See `docs/SOLVED.md` topic 15.

---

## 10. Clients (migration 022)

**`clients`** — real columns (confirmed live, 9 Sep 2026):
```
id · org_id · full_name · email · phone · preferred_contact · assigned_agent
notes · created_at · created_by · deleted_at · deleted_by                    (migration 023)
user_id                                                                      (migration 026)
deposit_received_at · deposit_recorded_by                                   (migration 024)
```
**`deposit_received_at`/`deposit_recorded_by` on `clients` are historical fallback only,
not a live signal.** Migration 027 moved the actual deposit gate to `client_briefs` (below)
because a commitment fee is per-vehicle, not per-client-relationship — see
`docs/SOLVED.md` topic 14. `createRun()` reads `client_briefs.deposit_received_at`. These
two columns on `clients` are kept only because there is no staging environment to test a
drop against (`PLAN_TRACKER.md` debt #28) — do not read them for any new gate.

`user_id` (nullable, unique) links a client record to a Google-auth account by email/phone
match — see the account-linking note below §11.

**`client_briefs`** — one client may have many briefs over time. Real columns (confirmed
live, 9 Sep 2026, 39 total):
```
id · client_id · org_id
make · model · trim · year_min · year_max · max_mileage
transmission · fuel_type · condition_required · titles_accepted (text[])
colour_preference · interior_preference · quantity
max_budget_usd · max_bid_usd · additional_notes
created_at · created_by
deleted_at · deleted_by                                                      (migration 023)
preferred_auction_sources (text[]) · pickup_delivery_location
inspection_required (boolean) · inspection_scope (text)
payment_method · damage_tolerance_accepted (text[])
shipping_insurance_optin (boolean)
consent_to_bid (boolean) · consent_share_with_auction_houses (boolean)
status (pending_review|approved) · submitted_at · confirmation_sent_at       (migration 024)
share_token · share_enabled                                                  (migration 025)
deposit_received_at · deposit_recorded_by                                    (migration 027)
```
All boolean/consent fields are nullable tri-state (`true`/`false`/`NULL` = unanswered) —
`NULL` must never be coerced to `false`.

**Deposit gate lives here, not on `clients`** (migration 027, corrected from the original
model — see `docs/SOLVED.md` topic 14): a commitment fee buys the right to research *one*
vehicle, not every future vehicle for that client. `createRun()` checks
`brief?.deposit_received_at`; a run with no brief linked always requires the superadmin
override rather than defaulting to "no deposit needed."

**Form-field parity is now complete** — every one of the columns above has a rendered form
input (`BriefForm` in `ClientsList.tsx` for staff entry, `IntakeFormView.tsx` for client
self-submission). Make/model/trim/colour stay free text deliberately (no vehicle-database
dropdown source exists yet — `PLAN_TRACKER.md` debt #29). The one literal parity gap
remaining is the source Google Form's exact "I confirm these details are correct" checkbox
copy — the review-then-submit flow serves the same purpose but doesn't reproduce it verbatim
(`PLAN_TRACKER.md` debt #30).

**Captured, never enforced:** `max_budget_usd`, `max_bid_usd`, and `damage_tolerance_accepted`
exist so the client's stated limit/tolerance isn't lost, not because any code gates on it —
`DECISIONS.md` 3.6 is explicit that no budget/max-bid enforcement exists until landed cost is
calibrated. All nine spec-rule `if` blocks in `ResearchRunDetail.tsx` are active-listings/
client-risk checks unrelated to these fields — a reader should not assume a captured
preference is an enforced one.

**Migration 023 (5 Aug 2026)** added `deleted_at`/`deleted_by` to `client_briefs` and
`deleted_by` to `clients` (which already had `deleted_at`), plus indexes on both
`deleted_at` columns. The columns exist; the delete-confirmation UI that uses them is
built but its own confirmation step is unverified — see `PLAN_TRACKER.md` 1.2.

---

## 11. Other tables

- **`organizations`** / **`memberships`** — tenancy and roles. Caplimo `org_id`:
  `a93378ea-33ef-4c75-97c4-44c37f2e9002`
- **`cost_rates`** / **`trucking_rates`** / **`auction_fee_brackets`** — landed cost
  (Phase C1). See §14.
- **`sales`** — **DEPRECATED** legacy flat table. RLS enabled with **zero policies**
  (locked). Retained as historical backup only. **Do not read or write it.**
- **Account linking (migration 026)** — `clients.user_id` (nullable, unique) plus an
  `AFTER INSERT ON auth.users` trigger (`link_new_auth_user_to_client`) that matches a new
  signup to an existing client by email (case/whitespace-insensitive) or phone
  (Nigerian-format-normalised via `normalize_ng_phone()`), and links only when exactly one
  match exists. Never creates a client row from a signup — `PROJECT_CHARTER.md` §7's "the
  record always comes first" rule. Google-only currently; offered post-submission on the
  intake success screen, always skippable.

---

## 12. RLS pattern

Every ledger table is org-scoped with `org_id NOT NULL`. The standard policy shape:

```sql
CREATE POLICY <table>_insert ON public.<table>
  FOR INSERT WITH CHECK (org_id IN (SELECT user_org_ids()) OR is_superadmin());
```

New tables must follow this exact pattern. `org_id` is applied server-side on insert, not
trusted from the client.

---

## 13. Edge Functions

| Function | Auth | Purpose | `verify_jwt` |
|---|---|---|---|
| `research-capture` | static `X-Research-Secret` | extension captures | **false** |
| `list-active-runs` | static `X-Research-Secret` | extension run pick-list, org-scoped | **false** |
| `upload-images` | static `X-Research-Secret` | extension-side image bytes (bid.cars) | **false** |
| `app-ingest` | JWT + superadmin | CarForm / BulkImport writes | true |
| `extract-vehicle-vision` | JWT + superadmin | server-side Gemini vision | true |
| `store-images` | JWT + superadmin | server-side image fetch (Copart) | true |
| `public-run` | none (share token) | public client deliverable | **false** |
| `intake-brief` | none (share token) | client-facing intake form: read/write one brief, strict field allow-list both directions, confirmation email via Resend | **false** |
| `monthly-backup` | static `X-Backup-Secret` | pg_cron monthly CSV export via Resend | **false** |

Getting `verify_jwt` wrong surfaces as a CORS error in the browser. See `AGENTS.md` §4.3.

**The extension's session state — not server-side, but shapes what `research-capture` receives.**
`list-active-runs` only ever returns a pick-list; which run a given capture attaches to is
decided entirely client-side, in the extension's `chrome.storage.local`
(`sessionActive`/`activeRunId`/`activeRunClient`/`activeRunSub`/`activeRunLastActivity`), not by
anything server-side. Once a run is picked, every later capture across tabs reuses it silently
for up to 10 minutes of inactivity, or until "End run" is clicked — `research_run_id` on the
`research-capture` payload is simply whatever the popup's session state currently holds at
capture time. A capture landing in an unexpected run is a client-side session question, not a
server-side one; see `docs/SOLVED.md` topic 11 for the full mechanism and its stale-session
failure mode.

**`public-run` carries a strict field allow-list.** `sale_date` was added 28 Aug 2026 to
enable the public countdown. Any new public field requires an allow-list edit **and** a
redeploy.

---

## 14. Landed cost — `cost_rates` and `trucking_rates` (Phase C1)

Two separate ledgers, deliberately, not one reshaped. Both follow `PROJECT_CHARTER.md` §5.10:
`effective_from`/`effective_to`/`source` (`official_tariff` | `agent_quote` | `actual_paid`),
never edited in place — a changed rate is a new row, the superseded row gets an
`effective_to`. Both follow §12's exact RLS pattern.

**`cost_rates`** (migration 029) — rates that apply broadly and vary by tier: duty components
(each with a `basis` — `cif` | `cif_plus_prior` | `import_duty`, since the six locked
components in `DECISIONS.md` §3 don't all compute against the same base), ocean freight by
shipping method, and the service fee. `cost_category` + `label` + `basis` describe what a rate
applies to; `rate_value`/`rate_value_max` (max nullable) hold a point value or a range rather
than forcing an observed range into one averaged figure.

**`trucking_rates`** (migration 030) — **not a finer-grained `cost_rates`**. Real vendor
inland-trucking data prices each auction yard to each destination port individually — Tucson
IAAI to Texas is $825 while Phoenix IAAI to Texas is $925, same state, same vendor, same port.
A `cost_rates` state-tier row would discard exactly the information that makes this data worth
having. Grain: one row per vendor / auction platform / yard (state, city, street) / destination
port / shipping method (`container` | `roro`). `destination_port_raw` keeps the vendor's
spelling exactly as sent (`LOS ANGELOS`, `JACKSONVILLE YARD`, trailing-space `TEXAS `) per §5.8
(raw at capture, classify at read); `destination_port_normalized` is the trimmed/cased/aliased
form used for matching. `yard_state` is the full state name as the vendor wrote it, including
at least one known typo (`New Hamphire` on one sheet, `New Hampshire` on another) — normalised
at the matcher layer (`STATE_NAME_ALIASES` in `src/services/yardMatchingService.ts`), not
retroactively corrected in storage.

Populated only via the deterministic importer (`scripts/importTruckingRates.mjs` +
`scripts/lib/truckingRatesParser.mjs`) — no manual entry, no AI extraction. See
`docs/SOLVED.md` topic 17 for the importer's specifics (merged-state fill-down, per-sheet
column layout, port-name inconsistencies) and topic 16 for a real bug found while building the
yard matcher (an ambiguity check that could structurally never fire).

Two read-only views over `trucking_rates`, not two tables:
`src/services/truckingRatesService.ts` provides an **internal view** (every vendor's price,
current and superseded, so staff can see who's cheapest and the full history) and an
**estimator view** (a band and sample size across currently-effective rates only, per the
honesty doctrine §5.1 — never a bare figure). Matching a `sightings` row to a yard
(`src/services/yardMatchingService.ts`) is platform-first (a bid.cars sighting's real platform
is `sightings.source_auction_platform`, since bid.cars is a resale aggregator, not a yard
network — `source_platform` is always literally `'bidcars'` for those rows), then normalised
city/state, with an unmatched or ambiguous result surfaced as "not quotable" rather than any
approximation. Measured baseline: 65.5% matched, 34.5% unmatched, 0% ambiguous across all
171 live sightings (`PLAN_TRACKER.md` §4.9/debt #32-34).

**IAAI capture** (`chrome-extension/content-iaai.js`, Prompt 22 Stage 2/B1) reads a single
source: `document.getElementById('ProductDetailsVM')`, a `<script type="application/json">`
block IAAI embeds on every lot page regardless of login state — no DOM scraping. Location comes
through as `"City (ST)"` (`attrs.BranchName`), the same shape bid.cars uses but parsed by its
own `parseIaaiLocation()` in `yardMatchingService.ts` rather than reusing bid.cars' parser, so
future format quirks on either platform can't silently bleed into the other. `lot_state` is
always `'active'` — confirmed on the real platform that a sold/ended lot simply redirects to the
search page rather than rendering a "sold" view, so IAAI sightings carry no closed-lot state to
capture (see `docs/SOLVED.md` topic 21). `current_bid_usd`, `seller`, and `seller_type` are only
populated when `auctionInformation.userLoginStatus === true` in the embedded JSON; logged-out,
IAAI masks these fields (literal `"******"` for seller/seller_type, `0` for bid) rather than
omitting them, so the capture gates on the real login flag instead of pattern-matching each
field's mask shape.

**`auction_fee_brackets`** (migration 031) — the two genuinely bracket-shaped Copart buyer
fees (`fee_type`: `buyer_fee` | `bid_fee`), keyed on `member_account` (free text — Copart's
own two real accounts, `Jamilu Danmusa Danmusa (Copart Non-Licensed)` and `White Nexus Ltd
(Copart High-Volume Licensed)`) × `title_status` (`clean`|`non_clean`) × `payment_tier`
(`secured`|`unsecured`) × `bid_method` (`proxy`|`live`, nullable) × a `[bracket_min,
bracket_max]` range on final sale price (`bracket_max` null = open-ended, priced as a flat
`fee_unit='percent'` row above $15,000). A bracket table doesn't fit `cost_rates`'
one-row-one-figure shape, hence a second, purpose-built table. Flat per-unit Copart fees
(environmental, gate, title pickup, late payment) are `cost_rates` rows under a new
`auction_fee` category instead, kept distinct from `service_fee` (Caplimo's own brokerage
fee — a different thing). See `docs/SOLVED.md` topics 18-19 and `PLAN_TRACKER.md` §4.10.

**Secured/Unsecured is a property of the buying account, not a per-transaction choice** —
confirmed against three real invoices spanning different payment methods, all pricing as
Unsecured regardless (`docs/SOLVED.md` topic 18). **Default schedule for bid headroom is
Caplimo's own account** (`Jamilu Danmusa Danmusa`, Non-Licensed, matching invoices 1 & 3) —
`bidHeadroomService.ts`'s `DEFAULT_MEMBER_ACCOUNT`. White Nexus's High-Volume rows are kept
(historical, priced a real invoice) but are never the default; the cost-breakdown UI always
states which account/tier a figure was computed under (`PLAN_TRACKER.md` debt #42).

**`bidHeadroomService.ts`** is the single shared module computing auction fees, inland
trucking, ocean freight and duty as independently available/unavailable `CostComponent`s,
plus the derived headroom (`target landed cost − shipping − duty − auction fees − inland
trucking`). **Duty is permanently unavailable until C2 exists**, which means headroom cannot
be produced for any listing today — by design, never smoothed into a partial number. Shown
on `ResearchRunDetail` for active listings only, collapsed by default; confirmed to never
touch the sold-comps average and never reach `public-run`'s allow-list.

Neither the trucking ledger, the matcher, nor the fee/headroom module is wired into the
public share page — bid headroom stays internal-only, deliberately.

**Currency (migration 033, Prompt 28 Stage 2/C1d)** — all three rate tables (`cost_rates`,
`trucking_rates`, `auction_fee_brackets`) carry `currency` (`NOT NULL DEFAULT 'usd'`),
`amount_usd`, `fx_rate`, `fx_rate_date`. Additive only — every existing row backfilled to
`currency='usd'` with the other three `null`, no existing `rate_value`/`price`/`fee_value`
altered. A CHECK constraint on each table enforces the only two valid shapes: `currency='usd'`
with all three conversion fields `null` (nothing was converted — includes every
`fee_unit='percent'` row in `auction_fee_brackets`, since a percentage has no currency
dimension to convert regardless of what a source document's absolute figures were denominated
in), or `currency<>'usd'` with all three populated together — an auditor can reconstruct the
conversion from the row alone, never from a separate log.

**Frozen at confirmation, never recomputed at read** — `amount_usd`/`fx_rate`/`fx_rate_date`
are computed once, when a human confirms a staged extraction row as non-USD
(`costDocumentExtractionsService.ts`'s `confirmExtraction`, via `currencyService.ts`'s
`fetchExchangeRates`), and never touched again. This is deliberately **not**
`sightings.exchange_rate`'s mechanism copied verbatim (§1 above) — a sighting freezes a rate
because the underlying fact (a car sold for ₦X on date Y) is historical and immutable; a rate
row is a standing figure that stays current until superseded by `effective_from`/`effective_to`
(§5.10). Freezing the conversion at confirmation is the honest extension of that same
discipline to currency, not a second mechanism for a different reason. `rate_value`/`price`/
`fee_value` continue to hold the ORIGINAL-currency figure always (needed to audit against the
source document); `amount_usd` is the USD-equivalent, frozen once.

**No existing read site was touched.** `bidHeadroomService.ts` and `truckingRatesService.ts`
select an explicit column list that never included the new fields; every one of them keeps
reading `rate_value`/`price`/`fee_value` directly, unchanged, for every row that has ever
existed (all USD). `CostRatesAdmin.tsx`'s display was the one necessary exception — a `$`
prefix on a Naira figure would be exactly the mislabeling this feature exists to prevent, just
relocated to the admin screen — so it now shows the original currency and amount, with the
frozen USD-equivalent alongside for a non-USD row (`NGN 205,581.08 (≈ $155.04)`), never a
second conversion.

**Why this exists:** `extract-cost-document`'s currency guard (Prompt 22 Phase 3,
`docs/SOLVED.md` topic 25) correctly marks every monetary field `NOT_VISIBLE` on a document
that states a non-USD amount, since `rate_unit` only ever offered `usd|percent` — the guard was
right, but it meant the pipeline built to process real Nigerian assessment notices could not
confirm a single row from one. The guard is unchanged by this migration; the tables can now
hold what a human, reading the same document, types in.

---

## 15. `org_settings` and cost-document asset pairing (migrations 034/035, Prompt 29 Stages 4/6)

**`org_settings`** (migration 034) — one row per org, not per rate table, and deliberately
sparse: today it holds exactly one setting, `copart_payment_tier` (`secured`|`unsecured`,
default `unsecured`). Exists because `bidHeadroomService.ts` previously hardcoded
`PAYMENT_TIER = 'unsecured' as const` — correct today (all three real Copart invoices priced
Unsecured) but a real open question whose answer could change without a deploy (`DECISIONS.md`
§3/`PLAN_TRACKER.md` debt #43). RLS mirrors §12's standard pattern exactly, same as
`cost_rates`/`auction_fee_brackets`; "superadmin-editable" is enforced at the application layer
(`CostRatesAdmin.tsx`'s screen, already fully superadmin-gated), not a stricter RLS policy — the
same division of enforcement `cost_document_extractions` (§ below) already uses. A missing row
for an org resolves to the same default the old constant used
(`orgSettingsService.ts`'s `getPaymentTier`), so this table's introduction was a no-op for every
org until someone deliberately changes the setting.

**`cost_document_extractions` additions** (migration 035) — two independent, both-optional
additions to the staging table §11 already documents via `cost_rates`/`trucking_rates`/
`auction_fee_brackets`'s shared context:

- **`asset_id`** (nullable, FK to `assets`) pairs a staged document with the specific vehicle it
  describes — e.g. an assessment notice for one particular imported car. Paired with
  `asset_paired_by`/`asset_paired_at`, both set together or not at all (a shape CHECK enforces
  this), so a pairing is always traceable to the human who made it, at the moment they made it.
  **Never model-inferred**: `extract-cost-document`'s prompt does not read or suggest a
  chassis/VIN today, and this migration does not add that. If a future extraction pass ever does
  read one off an assessment notice, it must surface only as a candidate for a human to search
  for and confirm through the review screen's asset picker — never write `asset_id` directly.
- **`declared_value`/`declared_value_currency`** capture an assessment notice's own stated
  declared/assessed value, for later comparison against what was actually paid. A CHECK
  constrains both to be set together (a value with no currency can't later be compared) and
  only alongside `document_type = 'assessment_notice'` — this figure means nothing for a
  trucking/shipping/customs quote.

Both are additive, human-set-only fields on an existing table — no new duty calculator, no
automated official-vs-actual comparison is built. They exist to give that future comparison
somewhere to read from.

---

## 16. `sightings.raw_payload` — the canonical shape (Prompt 30 Stage 1, debt #55)

Two ingestion pipelines write this `jsonb` column, and until this stage they wrote genuinely
different shapes — the root cause behind four separate reader bugs across two prompts
(`current_bid_usd`, then `estimated_retail_value_usd`/`estimated_cost_low_usd`/
`estimated_cost_high_usd` — see `docs/SOLVED.md` §27 for the audit).

**Canonical shape, all rows written from Prompt 30 onward (both pipelines): FLAT.**
`research-capture/index.ts` used to write `{ ...payload }` — the whole request envelope, with
every real field nested under `payload.captured_fields`. It now spreads `captured_fields`
directly onto `raw_payload`'s top level, alongside the envelope's own metadata
(`source_platform`, `source_url`, `lot_state`, `research_run_id`, `raw_dom_snapshot`,
`auction_history`, `image_urls`) and any post-hoc stamps (`price_usd_conversion_failed`,
`attempted_currency`, `asset_fingerprint_outcome`) — exactly the flat-spread convention
`app-ingest/index.ts` already used correctly (`{ ...v, record_type, date_listed }`). One
canonical shape system-wide now, not two: copying "the obvious" `raw.<field>` pattern from
one pipeline into the other produces a correct result instead of a silent `null`.

**Legacy shape, 176 real rows written before this change (`logged_via =
'extension_dom_capture'` only): NESTED** — `raw_payload.captured_fields.<field>`, envelope
metadata at the top level. **Not rewritten by a migration** — nothing in the live codebase
reads `raw_payload` as a query surface for these rows today; every field ever read off it has
been fixed to read its real `sightings` column instead (§ above / `docs/SOLVED.md` §27). Both
shapes are handled transparently by the accessors below, so a future reader that does need
`raw_payload` works uniformly across old and new rows without needing to know which shape a
given row was written under.

**The rule:** prefer a real `sightings` column over `raw_payload` for anything that has one.
`raw_payload` is a provenance record of what was actually sent, not a query surface — every
captured field already has (or should have) a mirrored real column, written directly at
capture time, independent of whatever shape `raw_payload` itself takes. Reach into
`raw_payload` only for genuinely archival/debug purposes.

**When you do need to read `raw_payload`:** use `readRawPayloadField`/`requireRawPayloadField`
from `supabase/functions/_shared/rawPayload.ts` — never a bare `raw.<field>`. `readRawPayloadField`
returns `{ present, value }` rather than a bare value, so "field genuinely absent" and "field
present with a real `null` value" can never again be confused the way they were four times
before this stage. `requireRawPayloadField` throws instead, for a caller that should treat a
missing field as a bug rather than a legitimate absence — the "make the silent-null failure mode
loud" guardrail against a fifth reader bug. Proven with synthetic input (no live row exercises the
throw path by construction, same reasoning as `docs/SOLVED.md` topics 16/26): a request for a
field that exists under neither the flat top level nor the legacy `captured_fields` nesting
throws with a message naming the missing field, rather than resolving to `undefined`/`null`.

---

## 17. Asset merge (migrations 036/037/038, Prompt 32 Stages 2-3, debt #46)

**The merge record, on `assets` itself** (migration 036) — soft-retirement, same pattern as
`clients`/`client_briefs`' `deleted_at`/`deleted_by` (migration 023), pointed at a survivor
instead of "deleted":

| Column | Meaning |
|---|---|
| `merged_into_asset_id` | `NULL` for a live asset. Set on the orphan, pointing at the survivor. |
| `merged_at` | When a human confirmed the merge. |
| `merged_by` | `auth.users.id` of who confirmed it. |
| `vinless_identity_hash` | Every asset's own VIN-less canonical identity (migration 037), used by the symmetric-attach probe below. On an orphan, mutated to a sentinel at merge time — see below. |

Nothing is ever deleted. The orphan keeps every raw field it held (§5.8) and remains directly
queryable — that IS the audit record of "what the orphan held," no separate table needed.

**`merge_assets(p_survivor_id, p_orphan_id, p_confirmed_by)`** is the only path that actually
merges two assets — one atomic Postgres function (`supabase/functions/asset-merge-confirm` is
its only caller). It repoints every known `asset_id` FK to the survivor, then mutates the
orphan's `fingerprint_hash` AND `vinless_identity_hash` to `'merged:<original>:<orphan_id>'`
sentinels — both derived identity values, not raw captured fields, so this doesn't touch §5.8.
**Why both must be sentinelled:** without it, a future capture that recomputes the orphan's old
identity would resolve straight back to the dead row through whichever key was left live -
`research-capture`'s exact-hash lookup (guarded by `fingerprint_hash`) or Stage 3's new
symmetric-attach probe (guarded by `vinless_identity_hash`) - silently reviving the exact split
the merge just fixed. Caught twice in review during Prompt 32: once for `fingerprint_hash`
(Stage 2, before any deploy), once for `vinless_identity_hash` (Bashir's review of Stage 3,
migration 038, after the column existed but before its own backfill ran).

**Every `asset_id` FK a merge must repoint - re-verify this list whenever a migration adds a new
one, per the standing obligation below:**

| Table | Column | Notes |
|---|---|---|
| `sightings` | `asset_id` | |
| `auction_history` | `asset_id` | |
| `cost_document_extractions` | `asset_id` | Found during Prompt 32 Stage 2 pre-flight - Prompt 29 only knew about the first two. `asset_paired_by`/`asset_paired_at` on this table are provenance (who paired this document, when) and are deliberately NOT touched by a merge - only the FK moves. |
| `won_vehicles` | `asset_id` | **Added 20 Sep 2026 (migration 047)** - Prompt 34 Stage 2 created this FK but never joined it to `merge_assets()`, found in Prompt 34 Stage 4 pre-flight. Only the pointer moves: `won_snapshot`, `promoted_by`, `promoted_at` are provenance and stay exactly as recorded (proven in a rolled-back transaction: 2 vehicles repointed, snapshot and provenance byte-identical). `won_vehicle_documents` has no `asset_id` (it anchors to the won vehicle), so needs no entry. |

**Standing obligation for whoever adds a fourth:** a table with an `asset_id` FK that
`merge_assets()` doesn't know about is a half-merge waiting to happen - it will silently orphan
rows the moment someone writes to it after a merge, with no error to surface it. If you add such
a table, add it to `merge_assets()`'s repoint list (migration file, then redeploy) and to the
table above in the same change.

**Detection** (`supabase/functions/asset-merge-candidates`) and **conflict/abstention logic**
(`supabase/functions/_shared/assetMergeConflicts.ts`, a pure module so it can be - and is -
proven with synthetic input) are read-only and never merge anything themselves. See
`DECISIONS.md` for why a merge is always human-confirmed, never automatic, and `docs/SOLVED.md`
topics 31-32 for the fuller narrative.

---

## 18. Make tiering evidence (migration 045, Prompt 35 Stage 3)

`vehicle_reference_makes` (migration 039) gained seven columns. They hold **evidence and one human
flag**; there is deliberately **no tier column** — the tier is derived on read (`tierMakes` in
`src/services/vehicleReferenceService.ts`), so it cannot go stale.

| Column | Type | Meaning |
|---|---|---|
| `probed_at` | timestamptz, null | When `vehicle-reference-make-probe` last probed this make; null = never |
| `probe_years_checked` | integer[], default `{}` | Model years asked of NHTSA (stops at the first hit) |
| `car_model_years` | integer[], default `{}` | Probed years that returned ≥1 car/truck/MPV model |
| `probe_failed` | boolean, default false | No hit **and** a fetch failed — inconclusive, never used as "zero models" evidence |
| `demoted_at` / `demoted_by` / `demoted_reason` | timestamptz / uuid → `auth.users` / text | Staff demotion. Reversible; a demoted make stays searchable. Never a delete |

**Derived tier, in order:** demoted → 3 · traded count > 0 → 1 · never probed → 3 · a hit within the
last 3 model years → 2 · hits only older → 3 (`older_only`) · probe failed → 3 (`probe_inconclusive`) ·
no hit at all → 3 (`zero_models`). "Traded" is read live from `traded_make_counts()` (assets with
`merged_into_asset_id IS NULL` plus non-deleted briefs, `SECURITY INVOKER`, so RLS scopes it to the
caller's org), mapped through `resolveMakeAlias` only.

**Functions:** `traded_make_counts()` · `set_make_demoted(p_make_id, p_demoted, p_reason)` — `SECURITY
DEFINER`, any signed-in staff member (the reference tables have no client write policy, migration 041,
so this is the one narrow write path; it only sets or clears the flag).

**Known limit of the evidence** (`DECISIONS.md` §13, `docs/SOLVED.md` topic 33): NHTSA's year filter
treats a model as active from its first year until an end date is recorded, so a make with no recorded
end (AC Propulsion) has models in every year. The probe uses `GetModelsForMakeIdYear` (id-keyed)
because names containing a period 302 to a 404.

**Not in this migration:** no won-vehicle tables (043/044 — documented with Prompt 34 Stage 6, still owed).

---

## 19. Asset soft-delete (migration 046, Prompt 35 follow-up)

`assets.deleted_at timestamptz` and `assets.deleted_by uuid → auth.users`, both nullable, index on
`deleted_at` — migration 023's pattern. A soft-deleted asset keeps its row, sightings and fingerprint.
Distinct from the merge sentinel (`merged_into_asset_id`, §17), which means "merged into another asset".
Filtered by: `listAvailableSightings` (inner join on `assets`), `findRunIdsByVin`, `searchAssets`,
`traded_make_counts()`, `asset-merge-candidates`. **Not** filtered: `research-capture` fingerprint lookups
(see `PLAN_TRACKER.md` §4.22) and `getAssetById` (it displays an already-linked asset).

---

## 20. Won-vehicle documents (migration 047, Prompt 34 Stage 4)

**Anchor: the won vehicle, not the asset.** `won_vehicle_documents` has **no `asset_id`**. A won vehicle
is client-specific; the same physical car won for two clients must never show one client's invoice against
the other's record. Proven with two won vehicles on the *same* asset: neither listed the other's document.

| Column | Meaning |
|---|---|
| `org_id`, `won_vehicle_id` | Composite FK `(won_vehicle_id, org_id)` → `won_vehicles (id, org_id)` (new `UNIQUE (id, org_id)` on `won_vehicles`): a document cannot be filed under an org other than its vehicle's, enforced by the database |
| `document_type` | `invoice`, `receipt`, `shipping_document`, `bill_of_lading`, `title`, `assessment_notice`, `other` (CHECK). An assessment notice and a bill of lading are not interchangeable |
| `storage_path`, `original_filename`, `mime_type`, `size_bytes` | Path is `<org_id>/<won_vehicle_id>/<uuid>/<filename>` in the private `won-vehicle-documents` bucket |
| `uploaded_by`, `uploaded_at` | Who and when |
| `deleted_at`, `deleted_by` | Soft delete (migration 023's pair, CHECK'd together). The stored file is always retained |

**Access.** RLS is `SELECT` only (§12's pattern). There is **no INSERT/UPDATE/DELETE policy for any client
role**, on the table or on the bucket: the only writer is the `won-vehicle-documents` Edge Function (service
role; JWT + membership of the *vehicle's* org, the org is never taken from the request; upload and soft-delete
only). Bucket: private, 10 MB / PDF-PNG-JPEG-WebP as defence in depth behind the function's 8 MB cap; staff
`SELECT` scoped on the path's first folder (org) or superadmin. Never reachable through a share token
(`PROJECT_CHARTER.md` §7); `won-vehicle-tracking`'s allow-list has no document field.

**The seam with `cost_document_extractions` (stated, not fused).** That table stages documents for *rate
extraction* behind a human review gate; this one stores documents for *a client's vehicle*. One real invoice can
legitimately be both. They are separate tables with separate lifecycles and consumers. A document already paired
to an asset through `cost_document_extractions.asset_id` (Prompt 29 Stage 6, §15) is *read* through that
existing pairing, shown read-only and labelled "paired to the car, not to this client's purchase"; no second
link is stored on either table. Caveat: if the same asset ever backs two won vehicles, those paired rate
documents appear under both (they are Caplimo's cost documents, not client paperwork, and are superadmin-only to
download).

**Stated limits.** A signed download URL is valid 5 minutes and is a bearer link for that window. Uploads are
base64 through the function (8 MB cap). Files are not virus-scanned.

# SCHEMA.md — Database reference

**Status:** Living. Update when a migration lands.
**Supabase project ref:** `xrotvpuainpfdulhfhtt`
**Migrations applied:** 001 → 023
**Last revised:** 28 August 2026

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

Full date-and-time **is** available, which is what makes both the countdown and a 1-hour
email alert possible.

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

**Coverage gap:** the Sales History scan exists for bid.cars only. **Copart has none**, so
every Copart sighting has `sale_confirmed = null` permanently. This is honest (we genuinely
cannot confirm), but it means Copart cars always carry the "Unconfirmed sale" badge until
B2 (Copart Sales History) is built. Captures made before the scan existed (pre-03 Aug 2026)
are also permanently null unless re-captured.

---

## 8. `auction_history`

One row per past auction appearance, from the bid.cars Sales History panel:
platform, auction date, lot number, bid amount, odometer, status, seller.

Dedupe verified: re-capturing the same lot does not duplicate history rows.

Feeds `sale_confirmed` and `auction_appearance_count`. **Not yet feeding** the derived
flags (`previously_unsold`, `cross_platform_reappearance`, `highest_rejected_bid`) — that is
Phase A2, still unbuilt.

---

## 9. Research runs

**`research_runs`**

```
id · org_id · client_name · target_spec · sheet_url · drive_folder_url
status · notes · created_at · updated_at
share_token · share_enabled · run_type · deleted_at · deleted_by
critical_override_reason · critical_override_by · critical_override_at   (migration 021)
client_id · client_brief_id                                              (migration 022)
```

`run_type` = `sold_comps` | `active_listings` | `mixed`

`sheet_url` and `drive_folder_url` are legacy — Google Drive/Sheets were permanently
dropped in favour of Supabase Storage.

**`research_run_listings`** — the join to sightings, plus `position`, `included`, `notes`.
Carries curation and ordering.

---

## 10. Clients (migration 022)

**`clients`**
```
id · org_id · full_name · email · phone · preferred_contact · assigned_agent
notes · created_at · created_by · deleted_at · deleted_by                    (migration 023)
```

**`client_briefs`** — one client may have many briefs over time
```
id · client_id · org_id
make · model · trim · year_min · year_max · max_mileage
transmission · fuel_type · condition_required · titles_accepted (text[])
colour_preference · interior_preference · quantity
max_budget_usd · max_bid_usd · additional_notes
created_at · created_by
deleted_at · deleted_by                                                      (migration 023)
```

**Known gap:** several of these columns have no form input yet — `colour_preference`,
`titles_accepted`, `fuel_type`, `trim`, `interior_preference`, `max_budget_usd`,
`max_bid_usd`. The data has a home; the form does not ask for it. See `PLAN_TRACKER.md`.

**Migration 023 (5 Aug 2026)** added `deleted_at`/`deleted_by` to `client_briefs` and
`deleted_by` to `clients` (which already had `deleted_at`), plus indexes on both
`deleted_at` columns. The columns exist; the view/edit/soft-delete UI that uses them does
not yet — see `PLAN_TRACKER.md` 1.2.

---

## 11. Other tables

- **`organizations`** / **`memberships`** — tenancy and roles. Caplimo `org_id`:
  `a93378ea-33ef-4c75-97c4-44c37f2e9002`
- **`cost_rates`** — *not yet created*. Planned for landed cost (Phase C1).
- **`sales`** — **DEPRECATED** legacy flat table. RLS enabled with **zero policies**
  (locked). Retained as historical backup only. **Do not read or write it.**

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
| `upload-images` | static `X-Research-Secret` | extension-side image bytes (bid.cars) | **false** |
| `app-ingest` | JWT + superadmin | CarForm / BulkImport writes | true |
| `extract-vehicle-vision` | JWT + superadmin | server-side Gemini vision | true |
| `store-images` | JWT + superadmin | server-side image fetch (Copart) | true |
| `public-run` | none (share token) | public client deliverable | **false** |
| `monthly-backup` | static `X-Backup-Secret` | pg_cron monthly CSV export via Resend | **false** |
| `daily-sniper` | static secret | built, unused | — |

Getting `verify_jwt` wrong surfaces as a CORS error in the browser. See `AGENTS.md` §4.3.

**`public-run` carries a strict field allow-list.** `sale_date` was added 28 Aug 2026 to
enable the public countdown. Any new public field requires an allow-list edit **and** a
redeploy.

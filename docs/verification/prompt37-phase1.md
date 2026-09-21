# Prompt 37 Phase 1 - independent verification (verbatim report)

A fresh subagent that wrote none of Phase 1 was given the requirements and the code (not the author's reasoning or results) and told to verify cold, read-only, running database queries one at a time. This is its report **verbatim**. The author's resolution of each finding follows in the table at the end.

---

# Independent verification of Phase 1 (admin consolidation and rates architecture)

Requirements 1, 4 and 6 pass and 5 passes with one caveat. Requirement 2 passes on the fee path as scoped. Requirement 3 is partly verified: the pure arithmetic checks out, but the "no TypeScript change" claim has a timing gap. All database access was SELECT-only, run one query at a time. `npx tsc --noEmit -p .` is clean.

## 1. Regression figures: PASS

- **Live rows, my arithmetic.** I selected `auction_fee_brackets` for Caplimo's Non-Licensed tier, non_clean, unsecured, and the live `cost_rates` where `cost_category='auction_fee'`. The always-charged flat fees are Environmental 15, Gate 95 and Title Pickup 20, so 130 in total.
  - Price 1700: buyer fee 582.50, proxy bid fee 85, live 95, midpoint 90. Total 672.5 + 130 = 802.50. Proxy gives 797.50 and live gives 807.50.
  - Price 5000: buyer fee 1025, proxy 110, live 125, midpoint 117.5. Total 1272.50. Proxy gives 1265 and live gives 1280.
  - Price 1650, live: 555 + 95 + 130 = 780.
- **Live rows through the real code.** `/private/tmp/verif/live.mts` fed the 324 live bracket rows and the three flat fees to the real `supabase/functions/_shared/feeSchedule.ts` (`selectSchedule` then `auctionFeeFromRows`). All seven figures matched exactly. Clean title, unsecured at $1,700 returned 640 with a `partialReason`, matching the 640 quoted in migration 054's comment.
- **`check.mts` output.**
  - The oracle hash matches `golden.sha256`.
  - 7,736 grid points compared, 0 differences.
  - The 7 named figures all PASS.
  - It also reports that 20 points at the White Nexus schedule depend on physical row order in the old code. That is disclosed and comes from the old `findBracket` being unsorted.
- **`oldCore.mts` is faithful for the arithmetic.** I extracted `feeForBracket`, `findBracket`, `auctionFeeComponentFromRows`, `boundaryPair`, `combinedFeeAt` and `solveMaxBidForFees` from `git show HEAD:src/services/bidHeadroomService.ts`. Diffed against `oldCore.mts`, the bodies are identical apart from `export` keywords and comments.
- **What the oracle does not cover:**
  - It does not test the row-fetch path. Old flat fees were selected by three literal labels; new ones by `fee_applies='always'` for the house.
  - It does not test the platform gate, the IAA-yard regex, or the ordering of the title-unknown and price checks.
  - `check.mts` feeds the same flat-fee array to both sides.
  - I covered the flat-fee gap myself: the live `always` set is exactly the same three fees.
- **Snapshot vs live.** `rows_baseline.json` equals the live brackets as a multiset (324 rows, with `member_account` mapped to tier), so the snapshot is honest.

## 2. No hardcoded auction-house label in the fee path: PASS

I grepped src, supabase/functions and scripts case-insensitively for copart, iaai, `\biaa\b`, jamilu, white nexus, licensed and the fee-name literals. Classification of every hit that matters:

- **(a) Defects in the fee path: none.**
- **(b) Fee-path files, comments and examples only:**
  - `bidHeadroomService.ts:67-70` and `:161`, `feeSchedule.ts:5` and `auctionAccountsService.ts:4-6` are comments.
  - `costDocumentExtractionsService.ts:289` is an error-message example, "e.g. Copart U.S. Non-Licensed". Cosmetic.
  - `CostRatesAdmin.tsx:174` says "late payment, storage", which are role examples in UI text.
- **(b) Fee-path-adjacent but outside the fee arithmetic:**
  - `supabase/functions/extract-cost-document/index.ts:50,53` is the LLM prompt. It still says brackets are "auction_platform (copart or iaai), member_account", and the extraction service says the same. The UI now uses house and tier dropdowns, so this only affects the model's draft text.
  - `research-capture/index.ts:12`, `soldGroup.ts:74`, `researchService.ts:977`, `ResearchRunDetail.tsx:810`, `AddCapturesModal.tsx`, `ListingCostBreakdown.tsx:78`, `IntakeFormView.tsx:59` and `bidcarsLot.ts:19` concern capture, sale-confirmation and the intake form.
  - `store-images` is about image hosts.
  - `scripts/generateAuctionFeeRates.mjs`, `scripts/importTruckingRates.mjs` and `scripts/lib/truckingRatesParser.mjs` are seed and import scripts. The generate script carries a "superseded, do not re-run" note.
  - `scripts/feeRegression/*` is test data.
- **Yard matcher, honestly.** `src/services/yardMatchingService.ts:85,108,124,135,143,181` hardcodes copart and iaai. It has its own `resolveEffectivePlatform` (line 124), separate from the fee path's data-driven one.
  - For the fee requirement it is out of scope.
  - It is house-specific: the inland-trucking component, which the requirement did not name, will need code to add a new house's yards.
  - It also means two different "effective platform" resolvers coexist. On live data they agree (sightings: copart 36, iaai 3, bidcars/copart 101, bidcars/iaai 63, bidcars/null 7, manual 11). They would diverge for a `manual` row that has `source_auction_platform` set.

## 3. Synthetic IAAI proof: PARTIALLY VERIFIED

- **(a) Loader SQL is correct.** `node scripts/loadFeeSchedule.mjs ...synthetic-iaai.json --org a93378ea-...` produces valid SQL. It inserts one tier, one default account with `payment_tier` NULL, 8 brackets and 3 flat fees (two `always`, one `contingent`), inside BEGIN/COMMIT. It uses SQL escaping, and the values match the JSON.
- **(b) Hand and code agree.** The Yaris title 'Original (Texas) - salvage/rebuilt' classifies as salvage, which is non-clean.
  - By hand at $1,700: buyer fee 300 (1000-1999.99 bracket), proxy 50, live 60, midpoint 55, plus flat fees 111 + 22 = 133 (late payment is contingent and excluded). Total 488.00.
  - The real `feeSchedule.ts` with rows built from the JSON returned 488 (unknown method), 483 (proxy) and 493 (live).
  - At $5,000, 10% = 500 + 82.5 + 133 = 715.5, and the code returned 715.5.
- **(c) Database evidence.**
  - `rate_change_log` shows 8 INSERTs into `auction_fee_brackets` and 3 into `cost_rates` at 13:05:51 UTC. All were tier 'SYNTHETIC IAAI TEST TIER (delete me)', source `agent_quote`, values as in the JSON.
  - The same 8 and 3 rows were DELETEd at 13:07:33 UTC. All 11 row_ids appear in both INSERT and DELETE (intersection = 11).
  - Now there are 0 synthetic rows in `auction_fee_brackets.fee_tier`, `cost_rates.label`, `auction_accounts.holder_name` and `auction_fee_tiers.fee_tier`, and 0 iaai brackets, cost rates or accounts.
  - The tier and account inserts are not in `rate_change_log` because it only audits the three rate tables. Their insertion is unverifiable, only their absence.
  - The Admin page showed the synthetic tier and account while I was on it, then showed none after I navigated away and back. It was stale page state, and the database has none.
- **(d) Code trace.** `getAuctionFeeComponent` calls `resolveSchedule` (`bidHeadroomService.ts:151-202`). Every branch is keyed on data: `listAuctionHouses`, `location_prefixes`, `getDefaultAccount(orgId, platform)`, `fetchTierRows(platform, fee_tier)` and `fetchFlatFees(platform)`. Nothing depends on the house being Copart.
- **Weak spot on "no TypeScript change".**
  - File mtimes converted to UTC: `feeSchedule.ts` 12:53, `auctionAccountsService.ts` 12:56 and `FeeSchedulesAdmin.tsx` 13:00 are before the load window.
  - But `WonVehicleCosts.tsx` was modified at 13:08:19 UTC and `bidHeadroomService.ts` at 13:08:55, both after the removal at 13:07:33.
  - So the current `bidHeadroomService.ts` was never run against IAAI data if the pricing test happened in that window.
  - I could not run `resolveSchedule` end to end because it needs the Supabase client. I could not verify that a Yaris was priced.

## 4. Abstention: PASS

Every path in `resolveSchedule` and `auctionFeeFromRows` returns status 'unavailable' with a reason and `amountUsd` null:
- No platform, or a house not in `auction_houses`: "no resolvable auction platform" (line 155).
- Label contradicts yard: line 165.
- No account: line 170.
- Tier has no rows: line 182.
- Ambiguous schedule: line 186.
- Title unclassifiable with no title-independent rows: line 190.
- No price: line 193.
- No rows for this title and payment combination: line 196.
- No bracket covers the price: `feeSchedule.ts:130`.

`partialReason` (`feeSchedule.ts:170`) is preserved. It is set when either bid-fee bracket is missing, and `WonVehicleCosts.tsx:27-28,144` still renders "Partial" and counts it as missing.

What live data would produce today:
- **IAAI lot.** There are no accounts, brackets or cost rates for iaai, so it abstains with "no IAA (IAAI) account is set up".
- **Copart U.S. Licensed - Low Volume.** It has 0 rows and no account on it. Pricing under it would abstain with "no fee schedule is loaded for ...". White Nexus (High Volume tier) has only non-clean brackets, so a clean title abstains.

Caveats:
- `computeHeadroom` ignores `partialReason`. It checks status only, and this is unchanged from HEAD. A partial fee therefore feeds headroom as if complete.
- The partial message says "no bid-fee schedule is stored" even if a house genuinely charges no bid fee.

## 5. Admin area: PASS

- **App.tsx.** One 'Admin' top-nav button replaces the four (`App.tsx:657`). The view type is `'admin'`, still superadmin-gated, and no old view keys remain in `src/`.
- **AdminArea.tsx.** Two groups. Rates has Cost Rates, Trucking Rates and Fee schedules and accounts. Review queues has Document Extraction and Asset Merges.
- **Browser.** localhost:3000 shows exactly one Admin button. The nav lists the two groups with those five items, and the Fee schedules, Asset Merges and Document Extraction sections render. I clicked only nav buttons.
- **Old functions preserved:**
  - Cost Rates: add, supersede, history and view current. `TruckingRatesLookup` is unmodified.
  - Document Extraction: the diff only changes the field list, the dropdowns and the shell. Upload, the three tabs with counts, expand, the review detail (view document, pair, include, confirm, reject) and "Confirmed (2) / Rejected (1)" are intact.
  - Asset Merges: candidate cards and two-step merge are unchanged; refresh moved into the shell.
- **Payment tier** moved from Cost Rates to a per-account dropdown under Fee schedules.
- **Added:**
  - Auction Fee category with house, fee-role and charged fields.
  - Fee schedules panel with add-account, make-default and a read-only loaded-schedule summary.
  - Dismiss and Restore for asset merges, plus Dismissed and Merged tabs.
  - `ReviewQueueShell` (shared header, tabs and refresh).
  - The `asset-merge-dismiss` edge function.
- **Removed or changed function:** the Supersede button is hidden for non-USD cost rates (`CostRatesAdmin.tsx`, about line 395). Live data has one, an NGN duty_component "FCS". The UI tells the user to replace it via Document Extraction.
- **Not deployed:**
  - `supabase functions list` shows no `asset-merge-dismiss`.
  - `asset-merge-candidates` was last deployed 2026-09-21 00:55 UTC, before the filter change.
  - Until deployed, the Dismiss and Restore buttons will fail, and dismissed pairs would not be filtered from the pending list. This is inferred from the function list, not tested.

## 6. No amount, date or source altered: PASS

`rate_change_log` has UPDATE rows only for these tables: 324 on `auction_fee_brackets` at 12:51:46 UTC and 5 on `cost_rates` at 12:52:03 UTC.
- **`auction_fee_brackets`, 324 of 324.** `(old_row - 'fee_tier' - 'auction_platform' - 'fee_role' - 'fee_applies') = (new_row - ...)`. The only key whose value changed was `fee_tier`.
- **`cost_rates`, 5 of 5.** The only changed keys were `auction_platform`, `fee_applies` and `fee_role`.
- The table now has 324 rows and none with a null `fee_tier`.

Migration review:
- **053 and 054.** No statement touches an amount, date or source. The 054 comment says the Gate Fee, labelled "Non-Clean Title", keeps applying to clean titles. That is pre-existing behaviour and it is disclosed.
- **051 guard trigger.**
  - API roles (authenticated, service_role) can only set `effective_to` once (`effective_to >= effective_from`) or insert. They cannot edit or delete.
  - Direct DB sessions as postgres or supabase_admin are exempt but logged.
  - The only client writers in `src/` and `supabase/functions` are inserts (extraction confirm and `addCostRate`) and the close in `supersedeCostRate`, so all legitimate flows still work.
  - INSERT and UPDATE policies tighten to superadmin.
  - The admin-role path can still DELETE. The synthetic removal was one, at 13:07:33, logged.
- **052.** `auction_accounts` is not audited. `payment_tier`, `is_default` and `holder_name` are mutable with only `updated_at`/`updated_by`. Changing an account's payment tier silently changes every recomputed fee, including won-vehicle figures. No history is kept.
- **052 seeding.** It creates a Jamilu account for every org with an `org_settings` row. There is one such org, so no impact.

## OTHER FINDINGS

- **Unfinished by design.** `auction_fee_brackets.member_account` and `org_settings.copart_payment_tier` remain. The NOT NULL check on flat fees and the cleanup migration are deferred. The `orgSettingsService.ts` deletion is staged.
- **Unpaginated tier fetch.** `fetchTierRows` has no pagination. It is fine at 216 rows, but the repo has a known 1,000-row truncation problem.
- **Wrong-house account.** `resolveSchedule` does not check that a supplied `accountId` belongs to the lot's house. It abstains by accident, with a misleading reason, because the tier lookup finds no rows. No caller passes `accountId` today.
- **Currency convention.** Trucking and ocean-freight readers (`bidHeadroomService.ts:254,281`) still read raw values instead of `usdAmount`. The fee path uses it. No live non-USD trucking or ocean rate exists.
- **Unique index effect.** The `cost_rates_live_fee_role` index means confirming a second live fee of the same house and role fails with a raw unique-violation unless the old one is closed. The extraction path does not close it.
- **UI text.** The extraction page description says "fee schedule", but the document-type dropdown has no fee-schedule type. A leftover half-comment ("this control exists so...") remains in `CostRatesAdmin.tsx`.
- **`setDefaultAccount`.** It is two non-atomic updates, so a failure between them would leave the house with no default.
- **Untracked files.** `AutoData Platform Capabilities Overview.rtf` and `.claude/` are untracked and unrelated.

## COULD NOT DETERMINE

- **Searched, not found:** any live IAAI pricing evidence in the database (there is none; it was read-only), and any hardcoded house in the fee arithmetic.
- **Did not look:** the RLS policy text of tables other than the ones migrated, and `scripts/runYardMatcher.mjs` beyond the grep hits.
- **Could not run:** `resolveSchedule` end to end on the final code (needs the Supabase client). Whether the Yaris was actually priced from the synthetic tier is unverifiable from the database.

---

# The author's resolution of each finding

| Verifier finding | Resolution |
|---|---|
| Req 3: two files modified after the first removal, so final code never run against IAAI data | **Fixed by re-proof.** Loaded the synthetic schedule again at 13:20:35 UTC on the final code; source SHA-1 identical before and after (`bfaf8fa9...`); Yaris $488 (proxy $483, live $493) through the fee, headroom and boundary paths; removed at 13:20:58 UTC; database clean (324 / 6 / 0 synthetic) |
| Req 4: `computeHeadroom` ignored `partialReason` | **Fixed** - a partial component now counts as missing and names the reason |
| `resolveSchedule` accepted an account from another house | **Fixed** - abstains with "the chosen account belongs to a different auction house" |
| `fetchTierRows` unpaginated | **Fixed** - shared paged, count-verified helper |
| Trucking and ocean-freight readers ignored the currency convention | **Fixed** - both read through `usdAmount`; cheapest trucking quote is compared in dollars |
| Second live fee failed with a raw unique violation | **Fixed** - plain message telling the reviewer to supersede the current one |
| Extraction description said "fee schedule"; leftover half-comment in `CostRatesAdmin.tsx` | **Fixed** |
| `auction_accounts` changes leave no history | **Fixed** - migration 056 applied; a tier change is logged with who and old -> new |
| Dismiss/Restore and candidates filter not deployed | **Deployed** and tested end to end on dummy assets (the pending-list filter itself has had no real candidate to hide) |
| `setDefaultAccount` non-atomic | **Recorded, accepted** - a failure between the two updates leaves a house with no default, which abstains loudly rather than mispricing |
| Extraction prompt still says `member_account` | **Recorded** (debt #72) - the reviewer's tier choice (a foreign key) prevents a wrong write |
| Yard matcher hardcodes copart/iaai with its own resolver | **Recorded** (debt #71) - outside the fee requirement; agrees with the fee resolver on every real sighting |
| Oracle does not cover the row-fetch path, the platform gate or check ordering | **Covered separately**: live rows shown equal to the frozen snapshot row for row; the refactored service checked against the live database (seven figures, clean-title figures, Yaris trucking $475, all IAAI lots abstaining); the platform resolver checked against all 221 real sightings |
| Old `findBracket` depended on row order | **Disclosed and resolved** with an explicit rule (lower bracket wins); SOLVED topic 46 |

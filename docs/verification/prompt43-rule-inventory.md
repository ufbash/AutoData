# Prompt 43 Stage 2 - inventory of every risk, spec and quality rule (1 Oct 2026)

Read-only inventory taken BEFORE the extraction. "Test today" is what existed before Prompt 43 (grep of `scripts/` and
`e2e/`); the right-hand column of the final table in `PLAN_TRACKER.md` says what exists after.

## A. Where a rule can live (all of them)

| # | Place | What it decides |
|---|---|---|
| 1 | `ResearchRunDetail.tsx` (~500 lines inline, inside the component, fed by async state) | the pre-share checklist: every BLOCK / CRITICAL / WARN / INFO below, and the per-listing badges |
| 2 | `ResearchRunDetail.tsx` `getStats` | what counts in the sold average, the composition line, the range counts |
| 3 | `supabase/functions/_shared/soldGroup.ts` (shared with `public-run`) | sold population, sale-confirmation classification, "counts toward the average" (incl. repeat sale since 1 Oct) |
| 4 | `supabase/functions/public-run/index.ts` | the client page's own stats, `sale_unconfirmed`, `repeat_sale`, `range_status` (via soldGroup) |
| 5 | `src/services/researchService.ts` `addListingToRun` | ATTACH-time eligibility (sold run / active run) - a separate, un-shared copy of "is this listing sold/active" |
| 6 | `src/utils/auctionHistoryFlags.ts` | prior appearance, previously sold/unsold, odometer rollback, repeat sale |
| 7 | `supabase/functions/_shared/specVocabulary.ts` | colour / transmission / fuel / trim matchers, preference parser, title classifier (one classifier since Prompt 31) |
| 8 | `src/services/bidHeadroomService.ts` | title classification for max-bid headroom (uses the shared classifier) |
| 9 | `ResearchRuns.tsx` / `researchService.createRun` | the deposit gate (run start refused without a deposit unless overridden with a recorded reason); brief `pending_review` gating |

## B. The checklist rules (place 1) - 21 distinct items

| Rule key | Severity | Applies to | Inputs | Badge today | Test before Prompt 43 |
|---|---|---|---|---|---|
| zero_listings | BLOCK | all | included count | none (no offenders) | none |
| duplicate | BLOCK | all | `vin` across included listings | "Duplicate vehicle" | e2e 12 (this session) |
| prior_auction_history | BLOCK | active portion (active runs; mixed non-finished) | auction_history rows per asset | "PRIOR AUCTION HISTORY" | e2e 12 |
| prior_auction_not_checkable | INFO | active portion | no history rows | "History not checkable" | none |
| critical damage keywords (id `critical_<reason>`) | CRITICAL | active portion | damage_type + secondary_damage vs 20 keywords | "CRITICAL" | e2e 12 (flood only) |
| unknown damage (`critical_unknown_damage`) | CRITICAL | active portion | empty damage_type | "CRITICAL" | none |
| not confirmed run-and-drive | CRITICAL | active portion | `runs_and_drives !== true` | "CRITICAL" | none |
| spec_critical: max mileage | CRITICAL | active portion + approved brief | mileage vs brief | "SPEC CRITICAL" | none |
| spec_critical: year below min / above max | CRITICAL | same | year vs brief | "SPEC CRITICAL" | none |
| spec_critical: condition = run and drive | CRITICAL | same | runs_and_drives | "SPEC CRITICAL" | none |
| spec_critical: titles accepted / title ambiguous | CRITICAL | same | title_type vs brief via classifier | "SPEC CRITICAL" | none |
| spec_warn: colour | WARN | same | exterior_color vs brief via parsePreference | "SPEC WARN" | none |
| spec_warn: transmission | WARN | same | | "SPEC WARN" | none |
| spec_warn: fuel | WARN | same | | "SPEC WARN" | none |
| spec_warn: trim | WARN | same | trim + VIN decode | "SPEC WARN" | none |
| odometer_rollback | CRITICAL | all run types | history odometer decreasing over time | "Odometer rollback" | e2e 12 |
| repeat_sale | CRITICAL | sold population (added 1 Oct) | 2+ distinct Sold events | "SOLD TWICE - excluded from average" | unit + e2e 11/12 |
| range_disclosure | INFO | sold population | year vs brief range | "Outside requested year range" | none |
| no_price | WARN | all | price_usd null | "No price" | none |
| non_insurance | WARN | all | seller_type regex | "Non-insurance seller" | none |
| limited_sample | WARN | sold/mixed | priced count < 3 | (no offenders, no badge) | none |
| different_model | WARN | sold/mixed | make+model majority | "Different model" | none |
| population_mismatch (A1b) | WARN | sold/mixed | source_platform US-auction vs other | "Population mismatch" | none |
| population_unknown (A1b) | INFO | sold/mixed | source_platform null | "Unknown source" | none |
| unconfirmed_sale | WARN | sold/mixed | classifySaleConfirmation | "Unconfirmed sale" | e2e 12 |

## C. Findings of the inventory (things that were wrong or fragile, not "expected more" speculation)

1. **Unknown-badge silence is real and structural:** `listingBadges` is an if/else chain on item ids; an item with no
   matching branch yields `text = ''` and the badge is skipped (`if (text)`). `zero_listings`, `limited_sample` and
   `prior_auction_not_checkable`'s offenders pass through; a NEW rule with a new id shows nothing.
2. **Two ids are built with `Math.random()`** (`spec_critical_<random>`, `spec_warn_<random>`): the id changes on every
   render, so nothing can key on it and any test would have to match by prefix.
3. **Five different definitions of "sold" / "active"** still exist outside `soldGroup.ts`: the attach-time eligibility
   in `researchService.addListingToRun` (`lot_state !== 'active'` = sold-eligible, `!finished` = active-eligible - so
   `NULL` lot state is eligible for BOTH), the active-group filter `lot_state !== 'finished' && current_bid_usd !== null`
   in `ResearchRunDetail`'s mixed stats, the checklist's `activeList = lot_state !== 'finished'`, `isInSoldPopulation`
   (mixed: `!== 'active' && current_bid_usd === null`) - and these disagree on NULL lot state.
4. **`getStats` mileage average includes excluded comps** (only the PRICE average honours `countsTowardSoldAverage`).
   Not changed here; reported.
5. **Rules the user may assume exist but do not:** nothing flags a re-sold car's FIRST sale damage (no damage column in
   `auction_history`, decision 4.12); `sale_confirmed = false` blocks only at attach time and nowhere after.
6. **Spec rules are gated on an approved brief** (`pending_review` drives nothing) - correct, but a run with a pending
   brief shows no spec rule at all and no hint that they were skipped.
7. Everything above sits inside one component whose rules depend on `auctionHistoryFlags` / `decodedByVin` state set
   AFTER the first render: for one render the checklist is computed with empty maps ("not checkable"), then recomputed.

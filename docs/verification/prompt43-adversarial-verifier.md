# Prompt 43 Stage 6 - independent adversarial verification of the rules module (verbatim)

Fresh subagent that wrote none of the code, read-only on the repo, read-only SELECTs only, no browser. Run 1 Oct 2026.
The report below is the subagent's own text, unedited. Triage and what was done about each finding is in
`PLAN_TRACKER.md` debt #124; nothing here has been softened or reordered.

---

I found no case where the staff page and public-run disagree on which listings are flagged or which prices sit in the sold average. I found one real disagreement on the mileage average, plus some latent history-key weaknesses and design gaps. All of it comes from reading the code, a 20,000-case fuzz run (scratch scripts in .../scratchpad/adversary/) and read-only SELECTs. The three existing unit/parity scripts pass (103/103, repeat-sale all passed, parity 40 identical / 3 intended / 0 unexplained).

(a) FINDINGS

1. **Mileage average disagrees between the staff page and public-run when a sighting has mileage 0.** Severity: medium-low, because it is latent today.
   - Repro: a sold listing with mileage_miles = 0 plus one with 100000. Public-run counts the 0 (`typeof l.mileage_miles === 'number'`) and gives avg_mileage 50000. The staff page gets 100000, because the listing mapper turns 0 into null and `getStats` then skips it.
   - Where: `src/services/researchService.ts:~839` (`mileage_miles: sighting.mileage_miles || null`) versus `supabase/functions/public-run/index.ts:~463`.
   - Data: 2 of 253 real sightings have mileage 0; neither is in a live run yet (see the DB query below).
   - This is exactly the divergence the module was meant to prevent, and it sits outside the module.
2. **A new reason on an already-flagged listing is not reported as "newly flagged" after sharing.** Severity: medium.
   - Repro: a snapshot taken while L1 is flagged for flood damage, then L1 also becomes "not confirmed run-and-drive". `flagKeys` yields `critical_damage:L1` twice, and `newlyFlagged(items, snapshot, true)` returns []. I ran this.
   - The same collapse applies to `spec_critical`, `spec_warn` and `prior_auction_history`, whose items for one listing share a key.
   - Where: `supabase/functions/_shared/riskRules.ts:~389` (the key is `${item.rule}:${id}`, not the item id).
   - A shared run can pick up a second critical reason and the staff warning stays silent.
3. **A finished lot with a current_bid_usd in a mixed run is in no average and carries no label.** Severity: medium-low; it matches the code comment but not the "never silent" spirit.
   - Repro: mixed run, lot_state 'finished', current_bid_usd 9000, price_usd 9000, bidcars or copart. I ran `classifyListing`: population 'none', countsInAverage false, no badge from `listingBadges`.
   - public-run sets `sale_unconfirmed` to false and `lot_state_unknown` to false for it, so the client sees a car that is in no average with no explanation.
   - Where: `soldGroup.ts:~123-132`, `riskRules.ts` (no rule for the 'none' population), `public-run/index.ts:~441-447`.
   - Not present in live mixed runs now; one finished Copart lot with a bid exists in an active_listings run.
4. **Unknown-lot-state listings in a mixed run still reach the client with no risk check and no share block.** Severity: medium as a design observation; it is what charter 5.7 and decision 4.17 say.
   - Repro: mixed run, lot_state 'unknown' or null, damage_type 'flood'. No CRITICAL badge, no prior-auction-history BLOCK; the only badge is INFO "Lot state unknown", and INFO never blocks sharing.
   - public-run still lists it, labelled. This is the AGENTS 4.1 incident #1 pattern (flood car unflagged on the client page). The doctrine chose it, but nothing stops sharing while such a car is unclassified.
   - Real data: 1 mixed-run listing has null lot_state, with sale_confirmed true.
5. **Average mileage includes repeat-sale and unconfirmed sales.** Severity: low. Both sides agree, so this is not a parity bug.
   - Repro: a repeat-sale listing has the badge "SOLD TWICE - excluded from average", yet its mileage still enters avg_mileage on both the staff page (`getStats`) and public-run. Only the price average excludes it.
   - Where: `ResearchRunDetail.tsx:~365-368` and `public-run/index.ts:~463`. The code comment calls this deliberate for unconfirmed sales; it is not stated for repeat sales.
6. **Repeat-sale event key is `platform::lot_number` only.** Severity: low for now. In today's data (see the history rows under (b)) it is correct.
   - Missed: two real sales with the same platform and lot but different dates count as 1 (probe: relist at the same lot gives soldEventCount 1).
   - Missed: rows with a null lot_number collapse per platform (two null-lot Sold rows give 1).
   - Double-counted: 'Copart' vs 'copart' for the same lot gives 2, and a lot with trailing whitespace ('1' vs '1 ') gives 2.
   - Missed: the status match is exact 'Sold', so 'SOLD' or 'Sold ' scores 0.
   - Where: `supabase/functions/_shared/auctionHistory.ts:~62-68`.
   - Live data has only 'Sold', 'Not sold', 'No information', 'Copart'/'IAAI' casing and no null lots, so none of this fires today. The extension stores status raw (`chrome-extension/content-bidcars.js:132`).
7. **A prior Sold plus a current lot whose own history row says 'No information' is not detected as a repeat sale.** Severity: low.
   - 2 live sightings are in this state: 0d3763a3… (Copart 55526775 Sold 2025-07, current lot 60489396) and 97bad2b2… (IAAI 37445007 Sold 2023, current lot 64610326). Both have sale_confirmed null, so they are excluded from the average anyway as unconfirmed (bidcars null).
   - Risk: if sale_confirmed later becomes true without a second 'Sold' history row, the car enters the average.
   - Detection is also asset-level: 42 of 230 assets have no VIN, so a car split across two assets cannot be seen.
8. **`spec_critical` and `spec_warn` ids are truncated to 80 characters.** Severity: theoretical. Two title-type reasons whose first ~55 title characters match would collide.
   - Where: `riskRules.ts:~133`, together with `newFlags` being deduped by `item.id` in `ResearchRunDetail.tsx:~703`.
   - I did not manage to collide them with realistic input; two long distinct titles produced distinct ids.
9. **Dead rule on live data.** Severity: info.
   - Staff mapping turns source_platform into `|| 'unknown'`, and the column is NOT NULL enum, so `population_unknown` (INFO) can never fire on the staff page. An 'unknown' string counts as non-auction instead. The legacy behaviour was the same; the unit test passes only with a null the app never produces.

(b) HELD UP

- **Staff versus public-run sold average.** In 20,000 random mixed, sold_comps and active runs, the staff `getStats` logic and public-run's stats loop gave identical priced_count, price sum, count and mileage sum.
- **Flagged cars in the average.** `soldPriceCount` matched `getStats`. No repeat-sale listing, and no unknown-lot-state listing in a mixed run, ever got `countsInAverage` true.
- **Populations.** In a mixed run a listing is never in both the sold and active populations.
- **Zero values.** price_usd 0 is kept on both sides; current_bid_usd 0 is treated as a real bid, not null.
- **Staff page bypass.** `ResearchRunDetail.tsx` has no second copy of the rules. Averages use `isInSoldPopulation`, `populationOf` and `countsTowardSoldAverage`; checklist and badges use `evaluateRun` and `listingBadges`.
- **Repeat-sale merge.** `withRepeatSale` is idempotent and runs identically on both sides; history is keyed by asset id on both.
- **Unregistered rules.** An unregistered rule renders as a visible "UNLABELLED FLAG"; `limited_sample` and `zero_listings` have null badges by design.
- **Casing and types.** lot_state, logged_via and source_platform are DB enums, so casing variants cannot occur. price_usd and current_bid_usd are numeric.
- **History data.** Real data has exactly one status vocabulary and the unique index is (asset_id, auction_date, lot_number, bid_amount_usd), which allows null-bid duplicates. Real duplicates exist (asset 291ef99c… has two identical Sold rows, 4339656a… has three) and are correctly counted as 1 sale each. Only fixtures (a different org, d0000000-…) have real 2-Sold repeat sales. In the real org no run holds a repeat-sale car.
- **Pagination.** There are 183 history rows in total, so public-run's unpaginated history read (which has no completeness check, unlike the staff page) is not truncated today.
- **Initial load.** The staff page shows a spinner until history, flags and decodes have loaded, so the checklist is not rendered with an empty flag map. A later refresh uses the previous flags until the new ones arrive.
- **public-run mapping.** `soldGroupShape` and the staff mapper agree on lot_state, bid, price and sale_confirmed; source_platform and logged_via differ in null versus 'unknown', but that does not change classification.

(c) NOT CHECKED

- I replicated the staff `getStats` and public-run stats loops in a script rather than running the React component or the Deno function, since I may not sign in or run a browser. A divergence introduced by rendering, or by the PostgREST response shape (numeric as number versus string), is unverified.
- I did not try to make the 80-character id collision happen on real brief data.
- I did not check `PublicRunView` rendering beyond `sale_unconfirmed` and `repeat_sale` wording, and did not check `app-ingest` or research-capture normalisation of auction_history writes (only the extension parser).
- I did not test concurrent edits, asset merge ordering, or the approval POST path.

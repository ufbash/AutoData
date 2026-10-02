# Prompt 44 Stage 6 - independent adversarial verification (verbatim)

Fresh subagent that wrote none of the code; read-only on the repo; read-only SELECTs only; no browser; could not execute `billing`. Run 1-2 Oct 2026
against the build as it stood before the fixes it prompted. The report below is the subagent's own text, unedited. Triage and what was done about each
finding is in `PLAN_TRACKER.md` debt #133.

---

ADVERSARIAL VERIFICATION REPORT (read-only; scratch probes in /private/tmp/claude-501/-Users-cc-AutoData/6b3272c0-26dd-49be-bc30-d1eafd1c3fe3/scratchpad/adversary2/: fuzz.mts, fuzz2.mts, attach.mts, probe.mts, hist.mts)

Existing tests: testRiskRules.mts 137/137 pass, testRepeatSale.mts all pass.

(a) FINDINGS, ranked

1. HIGH (doctrine consequence, live data): every hand-entered or screenshot comp is now permanently in NO population and no average, and staff cannot fix it.
   - All 11 sightings with logged_via manual_entry (10) or ai_vision (1) have lot_state NULL (query: select logged_via, lot_state, count(*) from sightings where logged_via in ('manual_entry','ai_vision','api_import')). No code path sets lot_state for them: CarForm.tsx:448, storageService.ts:145 and app-ingest/index.ts:239 never write it.
   - soldGroup.ts:109 (`if (lotStateUnknown(listing)) return false`) runs before the sale-confirmation test. So the `ENTRY_METHODS_WITHOUT_MECHANISM` carve-out (soldGroup.ts:73, "manual comps still count") is now dead for sold_comps and mixed runs.
   - Live case: one manual_entry listing with a price and lot_state null sits in a sold_comps run. It is excluded from the average and count on both sides.
   - The advice in riskRules.ts:~373 ("re-capture that lot from its auction page") is impossible for a manual entry.
   - Reproduce: soldGroup.countsInSoldAverageForRun({lot_state:null, price_usd:5000, logged_via:'manual_entry', ...}, 'sold_comps') returns false.
   - Check this is what the owner meant by "unknown belongs to no population on EVERY run type". Either way, there is no UI to set lot_state on a manual comp.

2. HIGH (violates doctrine point 4, "unknown-state listings may still be added to any run"): attachEligibility (soldGroup.ts:181-196) still blocks many unknown-state listings. An exhaustive enumeration in attach.mts found:
   - sold_comps: an unknown lot state is refused whenever price is null or any current_bid_usd is present (230 of the enumerated combos, e.g. {lot_state:null, price_usd:null}).
   - active_listings: an unknown lot state is refused whenever source_platform is not copart/bidcars/iaai, e.g. 'manual' or null (108 combos).
   - mixed: both of the above combine, so a non-US-platform, unknown-state listing with no price is refused (92 combos).
   - Live evidence of the inconsistency: 3 existing included listings in active_listings runs have source_platform='manual' and lot_state=null. The module would now refuse to attach them.
   - The service (researchService.ts:1028) and the modal filter (AddCapturesModal.tsx:46) both call the same function, so they agree with each other, but both contradict point 4.
   - Fix: allow lotStateUnknown(c) in all branches.
   - Not found: any attachable listing that lands in 'none', any live lot accepted into sold_comps, or any finished lot accepted into active_listings.

3. MEDIUM: negative mileage makes the staff and public mileage averages disagree (doctrine point 3).
   - The staff mapper turns 0 into null with `|| null` (researchService.ts:839) and ResearchRunDetail.tsx:364 uses `!== null`, so a negative value is included. public-run/index.ts:~478 uses `> 0`, so a negative value is excluded.
   - Reproduce: sold_comps run, a confirmed priced listing with mileage_miles=-100. Staff gives avgM=-100, mC=1; public gives avgM=null, mC=0.
   - Fuzz: this was the ONLY divergence in 80,000 runs.
   - Live data has 0 negative mileages, and the column is a plain integer with no CHECK constraint (migration 002:48), so it is latent only.
   - Everything else (priced_count, average, min/max, mileage count and average) matched across staff getStats, the public-run loop and the module on sold_comps and mixed runs. 20,000 runs with negatives and 60,000 without. Inputs covered: null/0/negative price and mileage, sale_confirmed null/true/false, lot_state null/unknown/active/finished/undefined, bid null/0/positive, repeat-sale flags, platforms and logged_via.
   - Zero price and zero bid are treated identically on both sides. A mileage listing without a price is excluded from the mileage average on both sides.

4. MEDIUM: staff checklist is silent about a sale_confirmed=false comp, while public-run labels it "Unconfirmed sale".
   - riskRules.ts:~378 builds `unconfirmed` from only the platform_has_no_mechanism and inconclusive kinds. confirmed_not_sold is excluded from the average (countsTowardSoldAverage) but gets no flag.
   - probe.mts: a sold_comps run with 3 confirmed comps plus one sale_confirmed=false gives an empty failed-rule list. The price count drops 4 to 3 with no WARN, and the "N of M excluded" count would also be wrong.
   - Reachable because attach blocks false, but a later re-capture can flip a listing to false.

5. MEDIUM: public client page, active_listings run, unknown-lot-state listing.
   - The `lot_state_unknown` label exists only in the isSold branch of PublicRunView.tsx:192. active_listings and the live column of a mixed run render with isSold=false, so there is no label.
   - On an active_listings run the page renders every listing (PublicRunView.tsx:~468), so the unlabelled unknown car also gets the "Approve this vehicle" button.
   - In mixed runs, "Other listings" renders with isSold=true, so an unknown or bid-only lot is captioned "Final Sale Price", although the lot may be live.

6. MEDIUM, pre-existing but it is a definition of "approvable" outside the module:
   - Staff "record approval" button is gated only by `lot_state !== 'finished'` (ResearchRunDetail.tsx:1033), so it shows on unknown-state listings and on listings in sold_comps runs.
   - public-run's approval POST (index.ts:~108-215) accepts any included listing id regardless of population. A client can approve a sold comp or unknown lot from the API, since listing ids are in the payload.
   - recordApproval (researchService.ts:~925) has no population check.

7. LOW-MEDIUM: billing claim logic (086 is applied to the linked DB; a unique index on billing_documents(org_id, idempotency_key) exists, migration 063:121). By reasoning only; I could not execute it.
   a) Stale takeover is not owner-safe. releaseClaim deletes by (org, key) only, with no claimed_at or claimed_by match (billing/index.ts:~148). Two losers that both see ageMs > 90s can interleave: L1 releases and claims, L2 releases L1's fresh claim and claims, so A, L1 and L2 all run concurrently. The winner's release also deletes someone else's claim. The unique key stops a double document, but the others burn a number (recorded as abandoned, still a series gap) and the user sees a raw 23505 as a 400 via rpcError.
   b) A genuinely slow winner (over 90s, e.g. the stall of #109) is taken over while still running, with the same result.
   c) An isolate killed between claim and release leaves the claim stuck. It self-heals only after 90s, and in the meantime losers wait 25s and get a 409.
   d) If releaseClaim or abandon throws a network exception inside the catch block (lines ~419-424), the original error is masked and the claim is left in place. supabase-js normally returns {error} rather than throwing, so this is low likelihood.
   e) claim_key `issue:${idem}` and `receipt:${payment_id}` cannot collide. request_hash is stored but never compared at claim time, so a different-payload loser waits up to 25s before getting 409 via replay().
   - The receipt path mirrors this and has a unique partial index backing it (064:103).

8. LOW (latent): public-run history read has no pagination or count check (index.ts:~268-275). It uses `.in('asset_id', 100 ids)` under PostgREST's default 1000-row cap, with no max_rows in config.toml. If a chunk exceeds 1000 history rows, repeat-sale flags are silently missed on the client page. The staff read throws via assertComplete instead, so the two would diverge. Live data is far below the cap (126 rows in total, at most 17 per asset).

9. LOW: false repeat sale from sloppy rows. auctionHistory.ts keys a sold event on platform+lot+date. The same sale stored twice with one date null, or in two date formats, or under two platforms, counts as 2 events, so repeatSale is true (hist.mts: all three return true). That gives a CRITICAL flag plus exclusion. No live rows are affected today (126 rows).

10. LOW: other definitions outside the module.
   - ListingCostBreakdown.tsx:72-73 defines its own "confirmed sale" (finished && sale_confirmed === true). It ignores repeat_sale and the manual-entry carve-out. It is a fee basis, not an average.
   - ResearchRunDetail.tsx:1002 reads raw lot_state for a label only.
   - riskRules.ts repeat_sale message filters `r.status === 'Sold'` exactly, while the detection uses normalised case. Cosmetic.

11. LOW: staff page flags are loaded after the listings (ResearchRunDetail.tsx:106-122). There is a render window where listings are set and flags are still empty, so repeat-sale cars briefly count in the sold average. If listAuctionHistoryForAssets throws, loadData sets the error state and the page shows the error.

(b) HELD UP
- Grep of src/, supabase/functions/ and chrome-extension/ shows the staff getStats, public-run and the module all route sold/active/average membership through soldGroup.ts. Remaining raw reads are legitimate: capture-time code (research-capture 348-474, app-ingest 204, extension content scripts, researchService mappers) and the items in finding 10.
- lot_state is a Postgres enum (active/finished/unknown) per migration 011, so garbage strings cannot reach the mixed-run `!== 'active'` fallthrough. Live distribution: null 34, unknown 2, active 45, finished 172.
- Unknown lot state is excluded from every average and count on all three run types in the module, staff and public. Risk checks still run on unknown listings in active/mixed runs: a flood-damaged unknown car triggers critical_damage in both (probe.mts).
- Repeat sale is excluded from price and mileage on both sides (fuzz). The module detects it and public-run's `repeat_sale` and `sale_unconfirmed` are consistent with it.
- The mileage average covers exactly the price-average set on both sides (including 0 mileage), except for negative values (finding 3).
- No listing vanishes from the public page. A mixed run covers sold, active and "Other" (unknown or none). sold_comps and active_listings render all listings. A null sighting or asset classifies as unknown and lands in "Other".
- public-run's new fields are only derived booleans or strings: population, repeat_sale, lot_state_unknown, bid_only_lot, sale_unconfirmed. No history rows, flags or staff data leak. The history rows stay server-side and approved_by/approved_snapshot are not exposed.
- Migration 086 is applied. The claim-first happy path is sound: it claims before allocate, the loser polls and returns the same document via replay(), request_hash mismatch gives 409, and every throw between claim and release (allocate failure, racedIn, the main try/catch) releases the claim. A DB-unique idempotency key prevents double documents even when claims race. The issue_receipt path mirrors this.

(c) NOT CHECKED
- I did not execute billing (forbidden), so findings 7a-7d are reasoned only and I did not test double-click, stale-takeover or isolate-kill behaviour. I did not read issue_billing_document, issue_billing_receipt or allocate_document_number bodies in full.
- The fuzz re-implements staff getStats and the public loop by reading the code. It did not run the React component or the Deno function. The staff mapper's `|| null` and `?? null` behaviour was taken from researchService.ts:839-874.
- I did not run scripts/parityRiskRules.mts or scripts/blastRadius.mts, and did not check the e2e specs.
- I did not read all of ResearchRunDetail.tsx or the other modified components (ClientDashboard, WonVehicleDetail, InvoiceEditor, BillingSection and others) for population or average logic. The grep found no lot_state or average usage there.
- Whether PostgREST returns numeric price_usd as a JSON number (the public-run `typeof === 'number'` checks depend on it) was not tested. The direct SQL path returns strings.
- I did not check the Chrome extension capture paths beyond grep.

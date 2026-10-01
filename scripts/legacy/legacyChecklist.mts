// FROZEN LEGACY BASELINE for Prompt 43 Stage 2 parity. GENERATED MECHANICALLY (not retyped) from
// `git show 434b68d:src/components/ResearchRunDetail.tsx` - the inline pre-share checklist and getStats exactly as they
// were BEFORE the repeat-sale rule (5973cd4) and before the module extraction. Do not edit; do not "fix". Its only job is
// to be the old behaviour that the new module is compared against on every real run.
// @ts-nocheck
import { parsePreference, colourMatches, transmissionMatches, fuelMatches, trimMatches, isTitleAccepted, classifyTitleStatus } from '../../supabase/functions/_shared/specVocabulary.ts';
import { countsTowardSoldAverage, isInSoldPopulation, classifySaleConfirmation } from './soldGroup.legacy.ts';

export function legacyChecklist({ run, listings, auctionHistoryFlags, auctionHistoryRows, decodedByVin }) {
  const includedListings = listings.filter(l => l.included);
  const includedCount = includedListings.length;
  const getStats = (list: RunListing[], isSoldGroup: boolean, brief?: ClientBrief | null) => {
    let tP = 0, pC = 0, minP = Infinity, maxP = -Infinity, tM = 0, mC = 0;
    let rangeInCount = 0, rangeOutCount = 0, rangeUnknownCount = 0;
    const rangeStated = isSoldGroup && !!brief && (brief.year_min != null || brief.year_max != null);
    list.forEach(l => {
      // PROMPT 29 Stage 2 - the inline predicate that used to live here is now the shared
      // definition in supabase/functions/_shared/soldGroup.ts, imported literally by both this
      // component and public-run. Same rule, one copy (debt #47/#50).
      const includePrice = isSoldGroup ? countsTowardSoldAverage(l) : true;

      const p = l.price_usd;
      if (p !== null && includePrice) {
        tP += p; pC++;
        if (p < minP) minP = p;
        if (p > maxP) maxP = p;
        if (rangeStated) {
          if (l.year == null) {
            rangeUnknownCount++;
          } else {
            const belowMin = brief!.year_min != null && l.year < brief!.year_min;
            const aboveMax = brief!.year_max != null && l.year > brief!.year_max;
            if (belowMin || aboveMax) rangeOutCount++; else rangeInCount++;
          }
        }
      }
      if (l.mileage_miles !== null) {
        tM += l.mileage_miles; mC++;
      }
    });
    return {
      avgPrice: pC > 0 ? tP / pC : null,
      minPrice: pC > 0 ? minP : null,
      maxPrice: pC > 0 ? maxP : null,
      priceCount: pC,
      avgMileage: mC > 0 ? tM / mC : null,
      count: list.length,
      rangeStated,
      rangeInCount,
      rangeOutCount,
      rangeUnknownCount,
    };
  };
  const isMixed = run.run_type === 'mixed';
  const isSoldComps = run.run_type === 'sold_comps';
  const isActiveListings = run.run_type === 'active_listings';
  // Pre-Share Checklist
  const CRITICAL_KEYWORDS = [
    'mechanical', // MC
    'water', // WA/flood
    'flood', // WA/flood
    'burn', // BN/BE/BI
    'damage history', // DH
    'partial', // PR
    'rejected', // RJ
    'undercarriage', // UN
    'unknown', // UK
    'frame', // FD
    'rollover', // RO
    'stripped', // ST
    'all over', // AO
    'biohaz', // BC
    'chemical', // BC equivalent
    'missing', // VI/VN/VP
    'altered', // VI/VN/VP
    'replaced vin', // VI/VN/VP
    'vin', // VI/VN/VP
    'storm' // Ambiguous
  ];

  const checklistItems: { id: string, type: 'BLOCK' | 'CRITICAL' | 'WARN' | 'INFO', message: string, offenderIds: string[], passed: boolean }[] = [];

  // 1. Zero listings (BLOCK)
  checklistItems.push({
    id: 'zero_listings',
    type: 'BLOCK',
    message: includedCount === 0 ? 'Zero included listings.' : 'At least one listing included',
    offenderIds: [],
    passed: includedCount > 0
  });

  // 2. Duplicate vehicle (BLOCK)
  const duplicateOffenders: string[] = [];
  const vinToIds = new Map<string, string[]>();
  includedListings.forEach(l => {
    if (l.vin) {
      if (!vinToIds.has(l.vin)) vinToIds.set(l.vin, []);
      vinToIds.get(l.vin)!.push(l.id);
    }
  });
  vinToIds.forEach((ids) => {
    if (ids.length > 1) duplicateOffenders.push(...ids);
  });
  checklistItems.push({
    id: 'duplicate',
    type: 'BLOCK',
    message: duplicateOffenders.length > 0 ? `Duplicate vehicle in run (${duplicateOffenders.length} listings)` : 'No duplicate vehicles',
    offenderIds: duplicateOffenders,
    passed: duplicateOffenders.length === 0
  });

  if (isActiveListings || isMixed) {
    const activeList = isMixed ? includedListings.filter(l => l.lot_state !== 'finished') : includedListings;
    
    const criticalByReason = new Map<string, string[]>();
    activeList.forEach(l => {
      const dmg = ((l.damage_type || '') + ' ' + (l.secondary_damage || '')).trim().toLowerCase();
      
      let matchedKeyword = '';
      for (const kw of CRITICAL_KEYWORDS) {
        if (dmg.includes(kw)) {
          matchedKeyword = kw;
          break;
        }
      }
      
      const reasons: string[] = [];
      if (matchedKeyword) {
        reasons.push(matchedKeyword === 'storm' ? 'ambiguous storm damage' : `${matchedKeyword} damage`);
      } else if (!l.damage_type || l.damage_type.trim() === '') {
        reasons.push('unknown damage');
      }
      
      if (l.runs_and_drives !== true) {
        reasons.push('not confirmed run-and-drive');
      }
      
      reasons.forEach(r => {
        if (!criticalByReason.has(r)) criticalByReason.set(r, []);
        criticalByReason.get(r)!.push(l.id);
      });
    });

    criticalByReason.forEach((ids, reason) => {
      checklistItems.push({
        id: `critical_${reason.replace(/\s+/g, '_')}`,
        type: 'CRITICAL',
        message: `${ids.length} listing(s) flagged CRITICAL: ${reason}.`,
        offenderIds: ids,
        passed: false
      });
    });

    // SPEC MATCH RULES
    // A pending_review brief (client self-submitted, not yet staff-approved) must not drive
    // flags - that is the entire reason review is mandatory (Prompt 15 Phase 6). Only an
    // approved brief (or a legacy brief with no status column value at all, from before this
    // concept existed) gates spec matching.
    const brief = run.client_brief && run.client_brief.status !== 'pending_review' ? run.client_brief : null;
    if (brief) {
      const specCritical = new Map<string, string[]>();
      const specWarn = new Map<string, string[]>();

      const addSpecRule = (map: Map<string, string[]>, reason: string, id: string) => {
        if (!map.has(reason)) map.set(reason, []);
        map.get(reason)!.push(id);
      };

      activeList.forEach(l => {
        // CRITICAL rules
        if (brief.max_mileage != null && l.mileage_miles != null && l.mileage_miles > brief.max_mileage) {
          addSpecRule(specCritical, `exceeds requested maximum mileage (${l.mileage_miles.toLocaleString()} vs ${brief.max_mileage.toLocaleString()} max)`, l.id);
        }
        if (brief.year_min != null && l.year != null && l.year < brief.year_min) {
          addSpecRule(specCritical, `below minimum year (${l.year} vs ${brief.year_min} min)`, l.id);
        }
        if (brief.year_max != null && l.year != null && l.year > brief.year_max) {
          addSpecRule(specCritical, `above maximum year (${l.year} vs ${brief.year_max} max)`, l.id);
        }
        if (brief.condition_required != null && brief.condition_required !== 'either' && brief.condition_required === 'run_and_drive') {
          if (l.runs_and_drives !== true) {
            addSpecRule(specCritical, `does not meet condition: Run and Drive`, l.id);
          }
        }
        if (brief.titles_accepted != null && brief.titles_accepted.length > 0 && l.title_type != null) {
          // PROMPT 31 Stage 3 (debt #58) - was its own inline classifier here, independently
          // written from bidHeadroomService.ts's, and confirmed disagreeing with it on real data
          // (a bare "Certificate of Title" value). Both now resolve through the one shared
          // classifier (_shared/specVocabulary.ts), which takes the more severe reading: a title
          // it can't confidently classify is never silently treated as accepted.
          if (!isTitleAccepted(l.title_type, brief.titles_accepted)) {
            const { status } = classifyTitleStatus(l.title_type);
            // Surfaces the ambiguous case distinctly rather than resolving it silently into the
            // same message a confidently-wrong title gets - a staff member reading this should
            // see "this needs a human to check" as a different fact from "this is salvage".
            const reason = status === 'unknown'
              ? `title type could not be confidently classified (raw: "${l.title_type}") - treated as not accepted pending manual review`
              : `title type not accepted (${l.title_type} vs [${brief.titles_accepted.join(',')}])`;
            addSpecRule(specCritical, reason, l.id);
          }
        }

        // WARN rules
        // colour/transmission/fuel_type go through parsePreference (Any/Either/blank -> no
        // rule; "Any, except X" -> flag only on a match to the excluded value; anything else
        // -> a required value) and the vocabulary matchers (Gas/Petrol, Gray/Grey,
        // Automatic/Auto) so wording differences no longer read as mismatches. Prompt 16 -
        // previously these compared the raw brief string directly, so a negative preference
        // like "Any, except White" matched nothing, ever, and "petrol" never matched "Gas".
        if (l.exterior_color != null) {
          const colourPref = parsePreference(brief.colour_preference);
          if (colourPref.kind === 'exclude') {
            if (colourMatches(l.exterior_color, colourPref.value)) {
              addSpecRule(specWarn, `colour excluded (${l.exterior_color} matches "${colourPref.value}", which was excluded)`, l.id);
            }
          } else if (colourPref.kind === 'required') {
            if (!colourMatches(l.exterior_color, colourPref.value)) {
              addSpecRule(specWarn, `colour differs (${l.exterior_color} vs ${colourPref.value} requested)`, l.id);
            }
          }
        }
        if (l.transmission != null) {
          const transmissionPref = parsePreference(brief.transmission);
          if (transmissionPref.kind === 'exclude') {
            if (transmissionMatches(l.transmission, transmissionPref.value)) {
              addSpecRule(specWarn, `transmission excluded (${l.transmission} matches "${transmissionPref.value}", which was excluded)`, l.id);
            }
          } else if (transmissionPref.kind === 'required') {
            if (!transmissionMatches(l.transmission, transmissionPref.value)) {
              addSpecRule(specWarn, `transmission differs (${l.transmission} vs ${transmissionPref.value} requested)`, l.id);
            }
          }
        }
        if (l.fuel != null) {
          const fuelPref = parsePreference(brief.fuel_type);
          if (fuelPref.kind === 'exclude') {
            if (fuelMatches(l.fuel, fuelPref.value)) {
              addSpecRule(specWarn, `fuel type excluded (${l.fuel} matches "${fuelPref.value}", which was excluded)`, l.id);
            }
          } else if (fuelPref.kind === 'required') {
            if (!fuelMatches(l.fuel, fuelPref.value)) {
              addSpecRule(specWarn, `fuel type differs (${l.fuel} vs ${fuelPref.value} requested)`, l.id);
            }
          }
        }
        if (brief.trim != null && brief.trim !== '' && brief.trim.toLowerCase() !== 'either' && l.trim != null) {
          const decoded = l.vin ? decodedByVin.get(l.vin) : undefined;
          if (!trimMatches(l.trim, brief.trim, brief.model, decoded?.model, decoded?.trim, decoded?.series)) {
            addSpecRule(specWarn, `trim differs (${l.trim} vs ${brief.trim} requested)`, l.id);
          }
        }
      });

      specCritical.forEach((ids, reason) => {
        checklistItems.push({
          id: `spec_critical_${Math.random()}`,
          type: 'CRITICAL',
          message: `${ids.length} listing(s) flagged CRITICAL: ${reason}.`,
          offenderIds: ids,
          passed: false
        });
      });

      specWarn.forEach((ids, reason) => {
        checklistItems.push({
          id: `spec_warn_${Math.random()}`,
          type: 'WARN',
          message: `${ids.length} listing(s) flagged WARN: ${reason}.`,
          offenderIds: ids,
          passed: false
        });
      });
    }

    // A2 Rule 1 — prior auction history (HARD BLOCK, active portion only, never overridable)
    // A2 Rule 3 — not checkable (INFO, never rendered as a clean pass)
    const priorAuctionByDetail = new Map<string, string[]>();
    const notCheckableOffenders: string[] = [];
    activeList.forEach(l => {
      const flags = l.asset_id ? auctionHistoryFlags.get(l.asset_id) : undefined;
      if (!flags || !flags.checkable) {
        notCheckableOffenders.push(l.id);
        return;
      }
      if (flags.hasPriorAuctionHistory) {
        const rows = (l.asset_id && auctionHistoryRows.get(l.asset_id)) || [];
        const dates = rows
          .map(r => r.auction_date)
          .filter((d): d is string => !!d)
          .sort();
        const dateText = dates.length > 0 ? dates.join(', ') : 'date unknown';
        // PROMPT 27 - the trigger (any prior appearance blocks, DECISIONS.md 4.8) is
        // unchanged; only the wording now distinguishes what the data actually says.
        // previouslySold takes priority when both are true - a car that has EVER sold and
        // reappeared is the closer-to-fraud signal (PROJECT_CHARTER.md S6), the stronger fact
        // to surface. Neither flag true (status absent/unparseable on every row) gets neutral
        // wording that claims neither - never defaults to the stronger "sold" claim.
        const outcomeText = flags.previouslySold
          ? 'and has sold at a prior auction'
          : flags.previouslyUnsold
          ? 'but did not sell at its prior auction(s) (reserve not met / no sale)'
          : 'sale outcome of prior appearance(s) not recorded';
        const detail = `has been to auction before (${flags.appearanceCount} prior appearance${flags.appearanceCount === 1 ? '' : 's'}: ${dateText}), ${outcomeText}`;
        if (!priorAuctionByDetail.has(detail)) priorAuctionByDetail.set(detail, []);
        priorAuctionByDetail.get(detail)!.push(l.id);
      }
    });

    if (priorAuctionByDetail.size === 0) {
      checklistItems.push({
        id: 'prior_auction_history',
        type: 'BLOCK',
        message: 'No prior auction history detected',
        offenderIds: [],
        passed: true
      });
    } else {
      priorAuctionByDetail.forEach((ids, detail) => {
        checklistItems.push({
          id: `prior_auction_history_${detail}`,
          type: 'BLOCK',
          message: `${ids.length} listing(s) blocked: this vehicle ${detail}.`,
          offenderIds: ids,
          passed: false
        });
      });
    }

    checklistItems.push({
      id: 'prior_auction_not_checkable',
      type: 'INFO',
      message: notCheckableOffenders.length > 0
        ? `Prior auction history not checkable for this source (${notCheckableOffenders.length} listing(s)) — bid.cars Sales History coverage only, Copart not yet available.`
        : 'Prior auction history checked for all listings',
      offenderIds: notCheckableOffenders,
      passed: notCheckableOffenders.length === 0
    });
  }

  // A2 Rule 2 — odometer rollback (CRITICAL, all run types including sold_comps, overridable).
  // A data-integrity rule, not client protection: applies regardless of run_type.
  const odometerRollbackOffenders: string[] = [];
  includedListings.forEach(l => {
    const flags = l.asset_id ? auctionHistoryFlags.get(l.asset_id) : undefined;
    if (flags?.checkable && flags.odometerRollback) {
      odometerRollbackOffenders.push(l.id);
    }
  });
  checklistItems.push({
    id: 'odometer_rollback',
    type: 'CRITICAL',
    message: odometerRollbackOffenders.length > 0
      ? `${odometerRollbackOffenders.length} listing(s) show odometer rollback across auction appearances — recorded mileage decreased between appearances, meaning the record may not describe the vehicle it claims to.`
      : 'No odometer rollback detected',
    offenderIds: odometerRollbackOffenders,
    passed: odometerRollbackOffenders.length === 0
  });

  // PROMPT 28 Stage 1 - sold-comps range disclosure (debt #52, decided). Applies regardless of
  // run_type, deliberately outside the isActiveListings||isMixed gate above - unlike the nine
  // spec rules, this is not a client-protection check on an active listing (PROJECT_CHARTER.md
  // S5.6 forbids that here) and must reach a sold_comps run's own listings, which is exactly
  // where the real 2012-Accord-in-a-2013-2016-brief case lives. INFO only, never WARN: a comp
  // outside the requested range is legitimate market history, not a defect - it stays in the
  // average and the count, always. Mirrors the exact same "is this listing in the sold group,
  // and is its price actually counted" logic getStats uses for the same run, so the per-listing
  // label can never disagree with the composition line it sits next to.
  // PROMPT 29 Stage 2 - both halves (sold-group membership, and whether the price counts) now
  // come from the shared definition rather than a fourth inline copy.
  const soldGroupForDisclosure = includedListings.filter(l => isInSoldPopulation(l, run.run_type as any));
  const rangeDisclosureOffenders: string[] = [];
  if (run.client_brief && (run.client_brief.year_min != null || run.client_brief.year_max != null)) {
    soldGroupForDisclosure.forEach(l => {
      if (l.price_usd === null || !countsTowardSoldAverage(l) || l.year == null) return; // absence is not violation - unknown year says nothing
      const belowMin = run.client_brief!.year_min != null && l.year < run.client_brief!.year_min;
      const aboveMax = run.client_brief!.year_max != null && l.year > run.client_brief!.year_max;
      if (belowMin || aboveMax) rangeDisclosureOffenders.push(l.id);
    });
  }
  if (rangeDisclosureOffenders.length > 0) {
    checklistItems.push({
      id: 'range_disclosure',
      type: 'INFO',
      message: `${rangeDisclosureOffenders.length} sold comp(s) fall outside the brief's requested year range - included in the average as legitimate market history, not flagged as a defect.`,
      offenderIds: rangeDisclosureOffenders,
      passed: false
    });
  }

  // 5. No price (WARN)
  const noPriceOffenders = includedListings.filter(l => l.price_usd === null).map(l => l.id);
  checklistItems.push({
    id: 'no_price',
    type: 'WARN',
    message: noPriceOffenders.length > 0 ? `No USD price (${noPriceOffenders.length} listings)` : 'All listings have a USD price',
    offenderIds: noPriceOffenders,
    passed: noPriceOffenders.length === 0
  });

  // 6. Non-insurance seller (WARN)
  const nonInsuranceOffenders = includedListings.filter(l => l.seller_type && /non-insurance/i.test(l.seller_type)).map(l => l.id);
  checklistItems.push({
    id: 'non_insurance',
    type: 'WARN',
    message: nonInsuranceOffenders.length > 0 ? `Non-insurance seller (${nonInsuranceOffenders.length} listings)` : 'No non-insurance sellers',
    offenderIds: nonInsuranceOffenders,
    passed: nonInsuranceOffenders.length === 0
  });

  if (isSoldComps || isMixed) {
    // PROMPT 29 Stage 2 (debt #50) - this was the third, divergent definition of the sold
    // group (`lot_state === 'finished'` alone). It now routes through the same shared
    // predicate as the displayed average and the client page. Verified 11 Sep 2026 that both
    // predicates select identical rows on every live mixed run, so no WARN count moved.
    const soldList = includedListings.filter(l => isInSoldPopulation(l, run.run_type as any));
    const soldStats = getStats(soldList, true);
    
    // 3. Limited sample (WARN)
    const limitedSample = soldStats.priceCount > 0 && soldStats.priceCount < 3;
    checklistItems.push({
      id: 'limited_sample',
      type: 'WARN',
      message: limitedSample ? `Market research average is based on only ${soldStats.priceCount} sales. Limited sample.` : 'Sufficient sample size',
      offenderIds: [],
      passed: !limitedSample
    });

    // 4. Different model (WARN)
    const counts: Record<string, string[]> = {};
    soldList.forEach(l => {
      const key = `${l.make} ${l.model}`;
      if (!counts[key]) counts[key] = [];
      counts[key].push(l.id);
    });
    const keys = Object.keys(counts);
    let differentModelOffenders: string[] = [];
    let diffMsg = 'Models are consistent';
    
    if (keys.length > 1) {
      let maxCount = -1;
      let majorityKey = keys[0];
      keys.forEach(k => {
        if (counts[k].length > maxCount) {
          maxCount = counts[k].length;
          majorityKey = k;
        }
      });
      keys.forEach(k => {
        if (k !== majorityKey) {
          differentModelOffenders.push(...counts[k]);
        }
      });
      const compStr = Object.entries(counts).map(([k, ids]) => `${ids.length}× ${k}`).join(', ');
      diffMsg = `Market research contains mixed models: ${compStr} (${differentModelOffenders.length} listings)`;
    }

    checklistItems.push({
      id: 'different_model',
      type: 'WARN',
      message: diffMsg,
      offenderIds: differentModelOffenders,
      passed: differentModelOffenders.length === 0
    });

    // A1b — population coherence (WARN). sale_confirmed says "is this a real sale?" but not
    // "is this the same kind of price, from the same population?" Mixing US auction results
    // with non-auction prices (dealer asking prices, manual entries) in one average compares
    // different markets. Does not touch the average - flag only.
    const US_AUCTION_SOURCES = ['copart', 'bidcars', 'iaai'];
    let usAuctionCount = 0;
    let nonAuctionCount = 0;
    let unknownCount = 0;
    const nonAuctionOffenders: string[] = [];
    const unknownSourceOffenders: string[] = [];
    soldList.forEach(l => {
      const sp = l.source_platform ? l.source_platform.toLowerCase() : null;
      if (!sp) {
        unknownCount++;
        unknownSourceOffenders.push(l.id);
      } else if (US_AUCTION_SOURCES.includes(sp)) {
        usAuctionCount++;
      } else {
        nonAuctionCount++;
        nonAuctionOffenders.push(l.id);
      }
    });
    const populationMixed = usAuctionCount > 0 && nonAuctionCount > 0;
    let populationMsg = 'Comps are from a single population';
    if (populationMixed) {
      populationMsg = `Average mixes ${usAuctionCount} US auction comp${usAuctionCount === 1 ? '' : 's'} with ${nonAuctionCount} non-auction comp${nonAuctionCount === 1 ? '' : 's'}; these are different markets.`;
      if (unknownCount > 0) {
        populationMsg += ` ${unknownCount} listing${unknownCount === 1 ? '' : 's'} with unknown source platform excluded from this comparison.`;
      }
    }
    checklistItems.push({
      id: 'population_mismatch',
      type: 'WARN',
      message: populationMsg,
      offenderIds: populationMixed ? nonAuctionOffenders : [],
      passed: !populationMixed
    });

    // A1b (Prompt 15) — report unknown source_platform even when the mismatch warn above
    // doesn't fire. An all-unknown (or single-known-population-plus-unknown) run previously
    // showed nothing at all, reading as a clean single-population average. INFO, not a warn:
    // this states what is knowable, not a fault. Suppressed when the warn already fires and
    // mentions the same unknown count, so it is never reported twice.
    if (unknownCount > 0 && !populationMixed) {
      checklistItems.push({
        id: 'population_unknown',
        type: 'INFO',
        message: `${unknownCount} listing${unknownCount === 1 ? '' : 's'} with unknown source platform — excluded from the population comparison above, not counted as auction or non-auction.`,
        offenderIds: unknownSourceOffenders,
        passed: false
      });
    }

    // Unconfirmed Sale (WARN)
    // PROMPT 29 Stage 2 - same shared classifier. A row is flagged here exactly when its null
    // is NOT the structural kind (an entry method with no sales-history mechanism at all) -
    // i.e. 'platform_has_no_mechanism' (Copart/IAAI, unconfirmable by platform) or
    // 'inconclusive' (bid.cars checked and got no determinate answer). Same set as before,
    // now named rather than re-derived from a raw null test.
    const unconfirmedSaleOffenders = soldList
      .filter(l => {
        const kind = classifySaleConfirmation(l).kind;
        return kind === 'platform_has_no_mechanism' || kind === 'inconclusive';
      })
      .map(l => l.id);
    checklistItems.push({
      id: 'unconfirmed_sale',
      type: 'WARN',
      message: unconfirmedSaleOffenders.length > 0 ? `${unconfirmedSaleOffenders.length} of ${soldList.length} included listings have unconfirmed sale status and are excluded from the average below.` : 'All sold listings are confirmed',
      offenderIds: unconfirmedSaleOffenders,
      passed: unconfirmedSaleOffenders.length === 0
    });
  }

  return { checklistItems, getStats, includedListings };
}

// PROMPT 43 Stage 2 - ONE home for the risk, spec and quality rules.
//
// Before this file the pre-share checklist was ~500 lines inline in a React component, fed by state set AFTER the
// first render, with a badge renderer that silently dropped any rule it did not recognise, two ids built with
// Math.random(), and no test on most rules. A car that sold twice was stored perfectly and flagged nowhere; a
// moved column broke every client link for nine days. The same shape of failure kept returning because there was no
// single place a rule lived and no test that could fail.
//
// This module is PURE: no database access, no React, no Deno APIs. It imports only other shared pure files. The staff
// page (`ResearchRunDetail.tsx`) and `public-run` both import it, so they cannot disagree about which listings are
// flagged or excluded - the same arrangement `soldGroup.ts` gave the sold population (Prompt 29).
//
// THE REGISTRY IS THE CONTRACT. Every rule has a `RuleKey`; every key is in RULE_REGISTRY with its badge text (or an
// explicit `null` = "no per-listing badge by design"). `badgeFor` throws on a key that is not registered, and the UI
// renders that as a visible "UNLABELLED FLAG", never as silence. A new rule that is not registered fails the tests.

import { parsePreference, colourMatches, transmissionMatches, fuelMatches, trimMatches, isTitleAccepted, classifyTitleStatus } from './specVocabulary.ts';
import { isInSoldPopulation, isInActivePopulation, populationOf, countsTowardSoldAverage, classifySaleConfirmation, lotStateUnknown } from './soldGroup.ts';
import type { RunType, SoldGroupListing } from './soldGroup.ts';
import type { AuctionHistoryFlags, AuctionHistoryRow } from './auctionHistory.ts';

export type Severity = 'BLOCK' | 'CRITICAL' | 'WARN' | 'INFO';

export type RuleKey =
  | 'zero_listings' | 'duplicate' | 'prior_auction_history' | 'prior_auction_not_checkable'
  | 'critical_damage' | 'spec_critical' | 'spec_warn' | 'odometer_rollback' | 'repeat_sale'
  | 'range_disclosure' | 'no_price' | 'non_insurance' | 'limited_sample' | 'different_model'
  | 'population_mismatch' | 'population_unknown' | 'unconfirmed_sale' | 'lot_state_unknown' | 'bid_only_not_a_sale' | 'possible_repeat_sale';

/** badge text per rule; `null` = the rule deliberately has no per-listing badge (it names no individual listing). */
export const RULE_REGISTRY: Record<RuleKey, { badge: string | null; severity: Severity[] }> = {
  zero_listings: { badge: null, severity: ['BLOCK'] },
  duplicate: { badge: 'Duplicate vehicle', severity: ['BLOCK'] },
  prior_auction_history: { badge: 'PRIOR AUCTION HISTORY', severity: ['BLOCK'] },
  prior_auction_not_checkable: { badge: 'History not checkable', severity: ['INFO'] },
  critical_damage: { badge: 'CRITICAL', severity: ['CRITICAL'] },
  spec_critical: { badge: 'SPEC CRITICAL', severity: ['CRITICAL'] },
  spec_warn: { badge: 'SPEC WARN', severity: ['WARN'] },
  odometer_rollback: { badge: 'Odometer rollback', severity: ['CRITICAL'] },
  repeat_sale: { badge: 'SOLD TWICE - excluded from average', severity: ['CRITICAL'] },
  range_disclosure: { badge: 'Outside requested year range', severity: ['INFO'] },
  no_price: { badge: 'No price', severity: ['WARN'] },
  non_insurance: { badge: 'Non-insurance seller', severity: ['WARN'] },
  limited_sample: { badge: null, severity: ['WARN'] },
  different_model: { badge: 'Different model', severity: ['WARN'] },
  population_mismatch: { badge: 'Population mismatch', severity: ['WARN'] },
  population_unknown: { badge: 'Unknown source', severity: ['INFO'] },
  unconfirmed_sale: { badge: 'Unconfirmed sale', severity: ['WARN'] },
  lot_state_unknown: { badge: 'Lot state unknown - not in any average', severity: ['WARN'] },
  possible_repeat_sale: { badge: 'May be a re-sale - check', severity: ['WARN'] },
  bid_only_not_a_sale: { badge: 'Final bid only - not a confirmed sale, not in any average', severity: ['INFO'] },
};

export interface RuleItem {
  id: string;
  rule: RuleKey;
  type: Severity;
  message: string;
  offenderIds: string[];
  passed: boolean;
}

/**
 * The badge for one failed item. THROWS on an unregistered rule - the caller (UI) catches and renders a visible
 * "UNLABELLED FLAG"; tests call this over every emitted item so an unregistered rule cannot ship.
 */
export function badgeFor(item: { rule: string; id?: string }): string {
  const entry = (RULE_REGISTRY as Record<string, { badge: string | null }>)[item.rule];
  if (!entry) throw new Error(`Unregistered rule "${item.rule}" (item ${item.id ?? '?'}) - add it to RULE_REGISTRY with a badge`);
  return entry.badge ?? '';
}

/** What the UI shows for any item, never silence: a registered badge, '' for a deliberate no-badge, or a loud label. */
export function badgeOrUnlabelled(item: { rule: string; id?: string }): string {
  try { return badgeFor(item); } catch { return `UNLABELLED FLAG (${item.rule ?? item.id ?? 'unknown rule'})`; }
}

// ---------------------------------------------------------------- inputs

export interface RuleListing extends SoldGroupListing {
  id: string;
  asset_id: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  exterior_color?: string | null;
  transmission?: string | null;
  fuel?: string | null;
  mileage_miles: number | null;
  damage_type: string | null;
  secondary_damage: string | null;
  title_type: string | null;
  runs_and_drives: boolean | null;
  seller_type: string | null;
}

/** The brief fields the rules read (a superset of nothing the rules ignore). `status` gates all spec rules. */
export interface RuleBrief {
  status?: string | null;
  model?: string | null;
  trim?: string | null;
  year_min?: number | null;
  year_max?: number | null;
  max_mileage?: number | null;
  condition_required?: string | null;
  titles_accepted?: string[] | null;
  colour_preference?: string | null;
  transmission?: string | null;
  fuel_type?: string | null;
}

export interface DecodedVin { model: string | null; trim: string | null; series: string | null }
export interface HistoryRowDetail extends AuctionHistoryRow { asset_id?: string }

export interface RunRuleInput {
  runType: RunType;
  /** the run's raw brief; a `pending_review` brief is ignored for spec rules INSIDE the module (never trust the caller) */
  brief: RuleBrief | null;
  /** included listings only */
  listings: RuleListing[];
  /** per asset: the derived flags (checkable, prior appearances, rollback, repeat sale) */
  historyFlags: Map<string, AuctionHistoryFlags>;
  /** per asset: the raw rows, used only to word the messages (dates, bids, mileage) */
  historyRows: Map<string, HistoryRowDetail[]>;
  decoded: Map<string, DecodedVin>;
}

// ---------------------------------------------------------------- shared small pieces

const CRITICAL_KEYWORDS = [
  'mechanical', 'water', 'flood', 'burn', 'damage history', 'partial', 'rejected', 'undercarriage', 'unknown', 'frame',
  'rollover', 'stripped', 'all over', 'biohaz', 'chemical', 'missing', 'altered', 'replaced vin', 'vin', 'storm',
];
const US_AUCTION_SOURCES = ['copart', 'bidcars', 'iaai'];

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, 200);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** The listing as the soldGroup predicates see it, with the repeat-sale fact merged from auction history. */
export function withRepeatSale<T extends RuleListing>(l: T, historyFlags: Map<string, AuctionHistoryFlags>): T {
  return l.asset_id && historyFlags.get(l.asset_id)?.repeatSale ? { ...l, repeat_sale: true } : l;
}

/** Sold-population price count (what the average is built from), via the shared predicate. */
export function soldPriceCount(list: RuleListing[], runType: RunType): number {
  return list.filter(l => isInSoldPopulation(l, runType) && l.price_usd !== null && countsTowardSoldAverage(l)).length;
}

// ---------------------------------------------------------------- the rules

export function evaluateRun(input: RunRuleInput): RuleItem[] {
  const { runType, historyFlags, historyRows, decoded } = input;
  const listings = input.listings.map(l => withRepeatSale(l, historyFlags));
  const items: RuleItem[] = [];
  const push = (it: RuleItem) => items.push(it);
  const isActiveRun = runType === 'active_listings';
  const isMixed = runType === 'mixed';
  const isSoldRun = runType === 'sold_comps';
  // a pending_review brief drives no spec rule (Prompt 15 Phase 6): enforced HERE, not by the caller
  const brief = input.brief && input.brief.status !== 'pending_review' ? input.brief : null;

  // 1. zero listings (BLOCK)
  push({ id: 'zero_listings', rule: 'zero_listings', type: 'BLOCK',
    message: listings.length === 0 ? 'Zero included listings.' : 'At least one listing included', offenderIds: [], passed: listings.length > 0 });

  // 2. duplicate vehicle (BLOCK)
  const vinToIds = new Map<string, string[]>();
  listings.forEach(l => { if (l.vin) { if (!vinToIds.has(l.vin)) vinToIds.set(l.vin, []); vinToIds.get(l.vin)!.push(l.id); } });
  const duplicateOffenders: string[] = [];
  vinToIds.forEach(ids => { if (ids.length > 1) duplicateOffenders.push(...ids); });
  push({ id: 'duplicate', rule: 'duplicate', type: 'BLOCK',
    message: duplicateOffenders.length > 0 ? `Duplicate vehicle in run (${duplicateOffenders.length} listings)` : 'No duplicate vehicles',
    offenderIds: duplicateOffenders, passed: duplicateOffenders.length === 0 });

  // The ACTIVE portion: client options. active run: every listing; mixed run: only lots KNOWN to be active
  // (soldGroup.isInActivePopulation); sold run: none. Risk and spec rules apply here and only here (4.8).
  // PROMPT 44 Stage 1a: an unknown lot state is in NO population (so in no average or count) - but 'unknown' is not
  // 'safe': in an active or mixed run it MAY be a live lot a client could be offered, so the risk and spec checks still
  // run on it as a precaution (a flood car with no recorded lot state must never reach a client unflagged - AGENTS.md
  // 4.1). In a sold run nothing is risk-checked, as before (4.8).
  const activeList = isSoldRun ? [] : listings.filter(l => isInActivePopulation(l, runType) || lotStateUnknown(l));

  if (isActiveRun || isMixed) {
    // critical damage / unknown damage / not confirmed run-and-drive
    const criticalByReason = new Map<string, string[]>();
    activeList.forEach(l => {
      const dmg = ((l.damage_type || '') + ' ' + (l.secondary_damage || '')).trim().toLowerCase();
      let matchedKeyword = '';
      for (const kw of CRITICAL_KEYWORDS) { if (dmg.includes(kw)) { matchedKeyword = kw; break; } }
      const reasons: string[] = [];
      if (matchedKeyword) reasons.push(matchedKeyword === 'storm' ? 'ambiguous storm damage' : `${matchedKeyword} damage`);
      else if (!l.damage_type || l.damage_type.trim() === '') reasons.push('unknown damage');
      if (l.runs_and_drives !== true) reasons.push('not confirmed run-and-drive');
      reasons.forEach(r => { if (!criticalByReason.has(r)) criticalByReason.set(r, []); criticalByReason.get(r)!.push(l.id); });
    });
    criticalByReason.forEach((ids, reason) => push({ id: `critical_${reason.replace(/\s+/g, '_')}`, rule: 'critical_damage', type: 'CRITICAL',
      message: `${ids.length} listing(s) flagged CRITICAL: ${reason}.`, offenderIds: ids, passed: false }));

    // SPEC MATCH RULES (approved brief only)
    if (brief) {
      const specCritical = new Map<string, string[]>();
      const specWarn = new Map<string, string[]>();
      const add = (m: Map<string, string[]>, reason: string, id: string) => { if (!m.has(reason)) m.set(reason, []); m.get(reason)!.push(id); };
      activeList.forEach(l => {
        if (brief.max_mileage != null && l.mileage_miles != null && l.mileage_miles > brief.max_mileage)
          add(specCritical, `exceeds requested maximum mileage (${l.mileage_miles.toLocaleString()} vs ${brief.max_mileage.toLocaleString()} max)`, l.id);
        if (brief.year_min != null && l.year != null && l.year < brief.year_min) add(specCritical, `below minimum year (${l.year} vs ${brief.year_min} min)`, l.id);
        if (brief.year_max != null && l.year != null && l.year > brief.year_max) add(specCritical, `above maximum year (${l.year} vs ${brief.year_max} max)`, l.id);
        if (brief.condition_required != null && brief.condition_required !== 'either' && brief.condition_required === 'run_and_drive' && l.runs_and_drives !== true)
          add(specCritical, `does not meet condition: Run and Drive`, l.id);
        if (brief.titles_accepted != null && brief.titles_accepted.length > 0 && l.title_type != null && !isTitleAccepted(l.title_type, brief.titles_accepted)) {
          const { status } = classifyTitleStatus(l.title_type);
          add(specCritical, status === 'unknown'
            ? `title type could not be confidently classified (raw: "${l.title_type}") - treated as not accepted pending manual review`
            : `title type not accepted (${l.title_type} vs [${brief.titles_accepted.join(',')}])`, l.id);
        }
        if (l.exterior_color != null) {
          const p = parsePreference(brief.colour_preference);
          if (p.kind === 'exclude' && colourMatches(l.exterior_color, p.value)) add(specWarn, `colour excluded (${l.exterior_color} matches "${p.value}", which was excluded)`, l.id);
          else if (p.kind === 'required' && !colourMatches(l.exterior_color, p.value)) add(specWarn, `colour differs (${l.exterior_color} vs ${p.value} requested)`, l.id);
        }
        if (l.transmission != null) {
          const p = parsePreference(brief.transmission);
          if (p.kind === 'exclude' && transmissionMatches(l.transmission, p.value)) add(specWarn, `transmission excluded (${l.transmission} matches "${p.value}", which was excluded)`, l.id);
          else if (p.kind === 'required' && !transmissionMatches(l.transmission, p.value)) add(specWarn, `transmission differs (${l.transmission} vs ${p.value} requested)`, l.id);
        }
        if (l.fuel != null) {
          const p = parsePreference(brief.fuel_type);
          if (p.kind === 'exclude' && fuelMatches(l.fuel, p.value)) add(specWarn, `fuel type excluded (${l.fuel} matches "${p.value}", which was excluded)`, l.id);
          else if (p.kind === 'required' && !fuelMatches(l.fuel, p.value)) add(specWarn, `fuel type differs (${l.fuel} vs ${p.value} requested)`, l.id);
        }
        if (brief.trim != null && brief.trim !== '' && brief.trim.toLowerCase() !== 'either' && l.trim != null) {
          const d = l.vin ? decoded.get(l.vin) : undefined;
          if (!trimMatches(l.trim, brief.trim, brief.model, d?.model, d?.trim, d?.series)) add(specWarn, `trim differs (${l.trim} vs ${brief.trim} requested)`, l.id);
        }
      });
      specCritical.forEach((ids, reason) => push({ id: `spec_critical_${slug(reason)}`, rule: 'spec_critical', type: 'CRITICAL',
        message: `${ids.length} listing(s) flagged CRITICAL: ${reason}.`, offenderIds: ids, passed: false }));
      specWarn.forEach((ids, reason) => push({ id: `spec_warn_${slug(reason)}`, rule: 'spec_warn', type: 'WARN',
        message: `${ids.length} listing(s) flagged WARN: ${reason}.`, offenderIds: ids, passed: false }));
    }

    // A2 rule 1 - prior auction history (HARD BLOCK, active portion, never overridable); rule 3 - not checkable (INFO)
    const priorByDetail = new Map<string, string[]>();
    const notCheckable: string[] = [];
    activeList.forEach(l => {
      const flags = l.asset_id ? historyFlags.get(l.asset_id) : undefined;
      if (!flags || !flags.checkable) { notCheckable.push(l.id); return; }
      if (flags.hasPriorAuctionHistory) {
        const dates = (((l.asset_id && historyRows.get(l.asset_id)) || []) as HistoryRowDetail[]).map(r => r.auction_date).filter((d): d is string => !!d).sort();
        const dateText = dates.length > 0 ? dates.join(', ') : 'date unknown';
        const outcome = flags.previouslySold ? 'and has sold at a prior auction'
          : flags.previouslyUnsold ? 'but did not sell at its prior auction(s) (reserve not met / no sale)'
          : 'sale outcome of prior appearance(s) not recorded';
        const detail = `has been to auction before (${flags.appearanceCount} prior appearance${flags.appearanceCount === 1 ? '' : 's'}: ${dateText}), ${outcome}`;
        if (!priorByDetail.has(detail)) priorByDetail.set(detail, []);
        priorByDetail.get(detail)!.push(l.id);
      }
    });
    if (priorByDetail.size === 0) push({ id: 'prior_auction_history', rule: 'prior_auction_history', type: 'BLOCK', message: 'No prior auction history detected', offenderIds: [], passed: true });
    else priorByDetail.forEach((ids, detail) => push({ id: `prior_auction_history_${detail}`, rule: 'prior_auction_history', type: 'BLOCK',
      message: `${ids.length} listing(s) blocked: this vehicle ${detail}.`, offenderIds: ids, passed: false }));
    push({ id: 'prior_auction_not_checkable', rule: 'prior_auction_not_checkable', type: 'INFO',
      message: notCheckable.length > 0
        ? `Prior auction history could not be checked for ${plural(notCheckable.length, 'listing')}: only bid.cars records a sales history to check against, so a car from another source may have been through auction before without us knowing.`
        : 'Prior auction history checked for all listings',
      offenderIds: notCheckable, passed: notCheckable.length === 0 });
  }

  // A2 rule 2 - odometer rollback (CRITICAL, every run type: data integrity, not client protection)
  const rollback = listings.filter(l => { const f = l.asset_id ? historyFlags.get(l.asset_id) : undefined; return !!(f?.checkable && f.odometerRollback); }).map(l => l.id);
  push({ id: 'odometer_rollback', rule: 'odometer_rollback', type: 'CRITICAL',
    message: rollback.length > 0
      ? `${rollback.length} listing(s) show odometer rollback across auction appearances — recorded mileage decreased between appearances, meaning the record may not describe the vehicle it claims to.`
      : 'No odometer rollback detected', offenderIds: rollback, passed: rollback.length === 0 });

  // repeat sale (CRITICAL, sold population, every run type; DECISIONS 4.16, charter 5.6 as amended)
  const repeatOffenders: string[] = [];
  const repeatDetails: string[] = [];
  listings.forEach(l => {
    if (!l.repeat_sale || !isInSoldPopulation(l, runType)) return;
    repeatOffenders.push(l.id);
    const sales = (((l.asset_id && historyRows.get(l.asset_id)) || []) as HistoryRowDetail[]).filter(r => (r.status ?? '').trim().toLowerCase() === 'sold').slice()
      .sort((a, b) => String(a.auction_date ?? '').localeCompare(String(b.auction_date ?? '')))
      .map(r => `${r.auction_date ?? 'date unknown'}${r.bid_amount_usd != null ? ` $${Number(r.bid_amount_usd).toLocaleString('en-US')}` : ''}${r.odometer_miles != null ? ` at ${Number(r.odometer_miles).toLocaleString('en-US')} mi` : ''}`);
    repeatDetails.push(`${[l.year, l.make, l.model].filter(Boolean).join(' ') || 'vehicle'}${l.vin ? ` (VIN ${l.vin})` : ''}: sold ${sales.join(' then ')}`);
  });
  push({ id: 'repeat_sale', rule: 'repeat_sale', type: 'CRITICAL',
    message: repeatOffenders.length > 0
      ? `${repeatOffenders.length} listing(s) are RE-SALES - the vehicle sold at auction more than once, so its price reflects a repair history and is EXCLUDED from the sold average: ${repeatDetails.join('; ')}.`
      : 'No repeat-sale vehicles in the sold group', offenderIds: repeatOffenders, passed: repeatOffenders.length === 0 });

  // POSSIBLE repeat sale (WARN, sold population): one recorded Sold plus an appearance whose outcome is NOT recorded
  // ('No information'). It MAY have sold again - unknown, not 'sold once' - so it is not excluded from the average (that is
  // for two CONFIRMED sales) but staff must look before the price is relied on.
  const possibleOffenders = listings.filter(l => isInSoldPopulation(l, runType) && !l.repeat_sale && !!(l.asset_id && historyFlags.get(l.asset_id)?.possibleRepeatSale));
  push({ id: 'possible_repeat_sale', rule: 'possible_repeat_sale', type: 'WARN',
    message: possibleOffenders.length > 0
      ? `${plural(possibleOffenders.length, 'sold comp')} MAY be a re-sale: the vehicle has one recorded auction sale and another appearance whose outcome is not recorded ("No information"). Check it before relying on the price.`
      : 'No sold comp has an unrecorded appearance beside a recorded sale',
    offenderIds: possibleOffenders.map(l => l.id), passed: possibleOffenders.length === 0 });

  // sold-comps range disclosure (INFO, every run type)
  const soldForDisclosure = listings.filter(l => isInSoldPopulation(l, runType));
  const rangeOffenders: string[] = [];
  // NB: uses the RAW brief, not the pending-gated one - this is a disclosure, not a spec rule, and public-run discloses
  // against the same raw brief; gating it here would make the staff page and the client page disagree.
  const rawBrief = input.brief;
  if (rawBrief && (rawBrief.year_min != null || rawBrief.year_max != null)) {
    soldForDisclosure.forEach(l => {
      if (l.price_usd === null || !countsTowardSoldAverage(l) || l.year == null) return;
      if ((rawBrief.year_min != null && l.year < rawBrief.year_min) || (rawBrief.year_max != null && l.year > rawBrief.year_max)) rangeOffenders.push(l.id);
    });
  }
  if (rangeOffenders.length > 0) push({ id: 'range_disclosure', rule: 'range_disclosure', type: 'INFO',
    message: `${rangeOffenders.length} sold comp(s) fall outside the brief's requested year range - included in the average as legitimate market history, not flagged as a defect.`,
    offenderIds: rangeOffenders, passed: false });

  // no price (WARN) and non-insurance seller (WARN)
  const noPrice = listings.filter(l => l.price_usd === null).map(l => l.id);
  push({ id: 'no_price', rule: 'no_price', type: 'WARN',
    message: noPrice.length > 0 ? `No USD price (${noPrice.length} listings)` : 'All listings have a USD price', offenderIds: noPrice, passed: noPrice.length === 0 });
  const nonIns = listings.filter(l => l.seller_type && /non-insurance/i.test(l.seller_type)).map(l => l.id);
  push({ id: 'non_insurance', rule: 'non_insurance', type: 'WARN',
    message: nonIns.length > 0 ? `Non-insurance seller (${nonIns.length} listings)` : 'No non-insurance sellers', offenderIds: nonIns, passed: nonIns.length === 0 });

  if (isSoldRun || isMixed) {
    const soldList = listings.filter(l => isInSoldPopulation(l, runType));
    // limited sample (WARN)
    const priceCount = soldPriceCount(listings, runType);
    const limited = priceCount > 0 && priceCount < 3;
    push({ id: 'limited_sample', rule: 'limited_sample', type: 'WARN',
      message: limited ? `Market research average is based on only ${plural(priceCount, 'sale')}. Limited sample.` : 'Sufficient sample size', offenderIds: [], passed: !limited });

    // different model (WARN)
    const counts: Record<string, string[]> = {};
    soldList.forEach(l => { const key = `${l.make} ${l.model}`; if (!counts[key]) counts[key] = []; counts[key].push(l.id); });
    const keys = Object.keys(counts);
    const diffOffenders: string[] = [];
    let diffMsg = 'Models are consistent';
    if (keys.length > 1) {
      let maxCount = -1, majorityKey = keys[0];
      keys.forEach(k => { if (counts[k].length > maxCount) { maxCount = counts[k].length; majorityKey = k; } });
      keys.forEach(k => { if (k !== majorityKey) diffOffenders.push(...counts[k]); });
      diffMsg = `Market research contains mixed models: ${Object.entries(counts).map(([k, ids]) => `${ids.length}× ${k}`).join(', ')} (${diffOffenders.length} listings)`;
    }
    push({ id: 'different_model', rule: 'different_model', type: 'WARN', message: diffMsg, offenderIds: diffOffenders, passed: diffOffenders.length === 0 });

    // A1b population coherence (WARN) + unknown source (INFO)
    let usAuction = 0, nonAuction = 0, unknownSource = 0;
    const nonAuctionIds: string[] = [], unknownSourceIds: string[] = [];
    soldList.forEach(l => {
      const sp = l.source_platform ? l.source_platform.toLowerCase() : null;
      if (!sp) { unknownSource++; unknownSourceIds.push(l.id); }
      else if (US_AUCTION_SOURCES.includes(sp)) usAuction++;
      else { nonAuction++; nonAuctionIds.push(l.id); }
    });
    const mixedPop = usAuction > 0 && nonAuction > 0;
    let popMsg = 'Comps are from a single population';
    if (mixedPop) {
      popMsg = `Average mixes ${usAuction} US auction comp${usAuction === 1 ? '' : 's'} with ${nonAuction} non-auction comp${nonAuction === 1 ? '' : 's'}; these are different markets.`;
      if (unknownSource > 0) popMsg += ` ${unknownSource} listing${unknownSource === 1 ? '' : 's'} with unknown source platform excluded from this comparison.`;
    }
    push({ id: 'population_mismatch', rule: 'population_mismatch', type: 'WARN', message: popMsg, offenderIds: mixedPop ? nonAuctionIds : [], passed: !mixedPop });
    if (unknownSource > 0 && !mixedPop) push({ id: 'population_unknown', rule: 'population_unknown', type: 'INFO',
      message: `${unknownSource} listing${unknownSource === 1 ? '' : 's'} with unknown source platform — excluded from the population comparison above, not counted as auction or non-auction.`,
      offenderIds: unknownSourceIds, passed: false });

    // unconfirmed sale (WARN)
    // every comp whose sale is not confirmed AS A SALE is out of the average and must be NAMED: unconfirmable by platform,
    // inconclusive, or confirmed NOT sold (sale_confirmed = false - e.g. a later re-capture flipped it)
    const unconfirmed = soldList.filter(l => { const k = classifySaleConfirmation(l).kind; return k === 'platform_has_no_mechanism' || k === 'inconclusive' || k === 'confirmed_not_sold'; }).map(l => l.id);
    push({ id: 'unconfirmed_sale', rule: 'unconfirmed_sale', type: 'WARN',
      message: unconfirmed.length > 0 ? `${unconfirmed.length} of ${soldList.length} included listings have an unconfirmed or not-sold status and are excluded from the average below.` : 'All sold listings are confirmed',
      offenderIds: unconfirmed, passed: unconfirmed.length === 0 });
  }

  // lot state unknown (INFO, every run type; PROJECT_CHARTER 5.7 as extended). In a MIXED run these listings are in no
  // population at all; in a typed run the run's own type still places them (staff chose it at attach time) but staff
  // are told which listings still need classifying either way.
  const unknownLot = listings.filter(l => lotStateUnknown(l));
  // An unknown lot state is in no average and no count on EVERY run type (charter 5.7 as extended). It is a WARN, not an
  // INFO: sharing needs a reviewed tick, because a client page would otherwise show a car that is in no figure with
  // nothing asked of staff. Risk checks still run on it in active and mixed runs (see activeList).
  if (unknownLot.length > 0) push({ id: 'lot_state_unknown', rule: 'lot_state_unknown', type: 'WARN',
    message: `${plural(unknownLot.length, 'listing')} with unknown lot state - in NO average and NO count${isSoldRun ? '' : ' (risk checks still run on it)'}. To fix: re-capture that lot from its auction page so its live/finished state is recorded, or remove it from the run. For a hand-entered or screenshot comp there is no page to re-capture: use Classify on its row.`,
    offenderIds: unknownLot.map(l => l.id), passed: false });

  // a FINISHED lot that only carries a bid (4.1: a final bid alone is not a sale) is in neither group of a mixed run -
  // name it, so a car that is in no average never has no explanation (the verifier found it silent)
  const bidOnly = isMixed ? listings.filter(l => populationOf(l, runType) === 'none') : [];
  if (bidOnly.length > 0) push({ id: 'bid_only_not_a_sale', rule: 'bid_only_not_a_sale', type: 'INFO',
    message: `${plural(bidOnly.length, 'finished listing')} carry only a bid, not a confirmed sale - in no average.`,
    offenderIds: bidOnly.map(l => l.id), passed: false });

  return items;
}

/** Every failed item that names a listing, as listing id -> badges. Throws never; unknown rules are labelled loudly. */
export function listingBadges(items: RuleItem[]): Map<string, { type: Severity; text: string }[]> {
  const map = new Map<string, { type: Severity; text: string }[]>();
  items.filter(i => !i.passed).forEach(item => item.offenderIds.forEach(id => {
    const text = badgeOrUnlabelled(item);
    if (!text) return; // a registered rule that has no per-listing badge by design
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push({ type: item.type, text });
  }));
  return map;
}

/** One-call classification of a listing for BOTH the staff page and public-run: group + whether its price counts. */
export function classifyListing(l: RuleListing, runType: RunType, historyFlags: Map<string, AuctionHistoryFlags>) {
  const m = withRepeatSale(l, historyFlags);
  const population = populationOf(m, runType);
  return {
    population,
    repeatSale: m.repeat_sale === true,
    /** the sale-confirmation/repeat-sale predicate alone (price not considered) - what public-run's `sale_unconfirmed` means */
    countsTowardAverage: countsTowardSoldAverage(m),
    countsInAverage: population === 'sold' && m.price_usd !== null && countsTowardSoldAverage(m),
    lotStateUnknown: lotStateUnknown(m),
  };
}

// ---------------------------------------------------------------- "newly flagged since sharing was switched on"

/** One stable key per unresolved BLOCK/CRITICAL/WARN flag: rule + listing (or the rule alone when it names no listing). */
export function flagKeys(items: RuleItem[]): { key: string; item: RuleItem; listingId: string | null }[] {
  const out: { key: string; item: RuleItem; listingId: string | null }[] = [];
  items.filter(i => !i.passed && i.type !== 'INFO').forEach(item => {
    // keyed on the item id (it carries the REASON), not just the rule: a listing that already had one critical reason and
    // gains a second must read as new (found by the Prompt 43 adversarial verifier)
    if (item.offenderIds.length === 0) out.push({ key: item.id, item, listingId: null });
    else item.offenderIds.forEach(id => out.push({ key: `${item.id}:${id}`, item, listingId: id }));
  });
  return out;
}

/**
 * Flags that are on a SHARED run now and were not accounted for when sharing was switched on.
 *  - with a snapshot (taken when sharing was enabled): everything not in it is new;
 *  - without one (run shared before this existed): the baseline is unknowable, so only what could never have been
 *    accepted is reported - any BLOCK, and a CRITICAL when no override reason was ever recorded.
 */
export function newlyFlagged(items: RuleItem[], snapshot: string[] | null, hasOverrideReason: boolean) {
  const known = snapshot ? new Set(snapshot) : null;
  return flagKeys(items).filter(f => known
    ? !known.has(f.key)
    : f.item.type === 'BLOCK' || (f.item.type === 'CRITICAL' && !hasOverrideReason));
}

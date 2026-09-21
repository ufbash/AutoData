import { supabase } from './supabaseClient';
import { matchSightingToYard } from './yardMatchingService';
import { listActiveYardKeys } from './truckingRatesService';
import type { YardKey, SightingForMatching } from './yardMatchingService';
import { listAuctionHouses, getAccount, getDefaultAccount } from './auctionAccountsService';
import type { AuctionAccount, PaymentTier } from './auctionAccountsService';
import { classifyTitleStatus as classifySharedTitleStatus } from '../../supabase/functions/_shared/specVocabulary.ts';
import { usdAmount } from '../../supabase/functions/_shared/rateConventions.ts';
import { fetchAllVerified } from '../../supabase/functions/_shared/paginatedRead';
import {
  unavailable, findBracket, selectSchedule, auctionFeeFromRows, boundaryPair, combinedFeeAt, solveMaxBidForFees, solverSupports, feeForBracket,
} from '../../supabase/functions/_shared/feeSchedule.ts';
import type { CostComponent, ComponentStatus, FeeBasis, FeeBracketRow, FlatFee, ScheduleRows, FeeBracketBoundary } from '../../supabase/functions/_shared/feeSchedule.ts';

export type { CostComponent, ComponentStatus, FeeBasis, FeeBracketBoundary };

// PROMPT 21 Phase 3 — the single shared cost-breakdown and bid-headroom module. Not scattered
// across components: isUnconfirmed is already duplicated as debt because that happened once
// (PLAN_TRACKER.md debt #3).
//
// Formula (the design, decided): target landed cost − shipping − duty − auction fees −
// inland trucking = maximum sensible bid. Trucking never touches the sold-comps average
// (PROJECT_CHARTER.md S5.6) - this module is never called anywhere near that calculation.
//
// Every component is independently available/unavailable. Headroom requires ALL of them
// available AND a target landed cost - missing any one makes headroom unavailable, never
// smaller, never zero-filled (PROJECT_CHARTER.md S5.1/S5.4).

export interface BidHeadroomResult {
  auctionFees: CostComponent;
  inlandTrucking: CostComponent;
  oceanFreight: CostComponent;
  duty: CostComponent;
  targetLandedCostUsd: number | null;
  headroom: CostComponent;
  // Which official fee tier (and account) the auction-fee figure was computed under - shown
  // prominently, not buried in a source line, so it is never ambiguous which basis a headroom number
  // rests on. Null only when no basis could be resolved at all (no platform, or no account set up).
  pricedUnder: { feeTier: string; holder: string | null; titleStatus: string; paymentTier: string } | null;
  // PROMPT 26 - null for a finished listing (headroom on a sold car is meaningless; there's no
  // future bid to solve for). For an active listing, 'available' only when shipping, trucking
  // AND duty are all available too - which duty being permanently blocked today means never,
  // in practice, until C2 unblocks. Built correctly now so it is ready then, per the same
  // reasoning as the solver it wraps.
  maxBidSolve: MaxBidSolveResult | null;
}

// --- Title status classification ---
// SCHEMA.md S5: title_type is genuinely messy, format varies by state and capture source.
// PROMPT 31 Stage 3 (debt #58) - this used to be its own independent classifier, diverging from
// ResearchRunDetail.tsx's separate inline one (confirmed disagreeing on real data - a bare
// "Certificate of Title" value). Both now resolve through the single shared classifier in
// `_shared/specVocabulary.ts`; this function is a thin binary view onto it; preserving this
// module's own long-standing 'clean'|'non_clean'|'unknown' abstain-rather-than-guess contract
// for the auction-fee bracket lookup (a wrong guess in EITHER direction produces a wrong dollar
// figure, so 'unknown' must stay reachable here) without touching its four call sites below.
// Verified byte-identical against every real title_type value in production before this change.
export function classifyTitleStatus(titleType: string | null | undefined): 'clean' | 'non_clean' | 'unknown' {
  const { status, isFloodBranded } = classifySharedTitleStatus(titleType);
  if (isFloodBranded) return 'non_clean'; // flood always non-clean here, matching the prior regex's own explicit flood match
  if (status === 'unknown') return 'unknown';
  if (status === 'clean') return 'clean';
  return 'non_clean'; // salvage | rebuilt | non_repairable
}

// --- Effective platform ---
// The lot's real auction house: the capture source itself when that source IS a configured house (a direct
// Copart or IAAI capture), otherwise the house an aggregator (bid.cars) recorded in source_auction_platform.
// Which houses exist is data (auction_houses), not a list in this file. Verified identical to the previous
// hardcoded rule on all 221 real sightings (21 Sep 2026): bidcars/copart, bidcars/iaai, bidcars/null,
// copart, iaai and manual all resolve as before.
function resolveEffectivePlatform(sighting: SightingForMatching, houses: { auction_platform: string }[]): string | null {
  const isHouse = (v: string | null | undefined) => !!v && houses.some(h => h.auction_platform === v);
  if (isHouse(sighting.source_platform)) return sighting.source_platform;
  if (isHouse(sighting.source_auction_platform)) return sighting.source_auction_platform as string;
  return null;
}

export type { FeeBracketRow };
export { feeForBracket, findBracket };

export interface AuctionFeeInput {
  sighting: SightingForMatching;
  titleType: string | null;
  // Either the actual confirmed sale price (a finished, sale_confirmed=true listing's price_usd) or a
  // staff-entered candidate bid on an active listing. Never current_bid_usd on its own.
  referencePriceUsd: number | null;
  // Shown as the abstention reason when referencePriceUsd is null, so the UI can say WHY.
  referencePriceUnavailableDetail?: string;
  orgId: string;
  // Price under a specific account instead of the org's default account for the house.
  accountId?: string;
  // Override the account's own payment tier (a what-if); absent means the account's tier.
  paymentTier?: PaymentTier;
  // How the winning bid was placed, when known. Absent for every listing that has not been won - the
  // fee then stays a range across both methods.
  bidMethod?: 'proxy' | 'live' | null;
}

// PROMPT 37 Phase 1 - which schedule a lot prices against is DATA: the org's account for the lot's auction
// house, that account's official fee tier, and its payment tier. This function names no house, no account
// and no fee. A house with no account, or an account whose tier has no schedule loaded, abstains and says so.
type Resolved =
  | { ok: true; house: { auction_platform: string; display_name: string }; account: AuctionAccount; basis: FeeBasis; schedule: ScheduleRows; titleStatus: 'clean' | 'non_clean'; paymentTier: string }
  | { ok: false; component: CostComponent };

interface ResolveArgs {
  orgId: string;
  sighting: SightingForMatching;
  titleType: string | null;
  accountId?: string;
  paymentTier?: PaymentTier;
  // When present the reference price is checked in the same precedence order the fee always used.
  price?: { value: number | null; detail?: string };
}

async function fetchTierRows(orgId: string, platform: string, feeTier: string): Promise<FeeBracketRow[]> {
  const rows = await fetchAllVerified<any>(
    'fee brackets',
    (from, to) => supabase
      .from('auction_fee_brackets')
      .select('fee_type, title_status, payment_tier, bid_method, bracket_min, bracket_max, fee_unit, fee_value, source, effective_from, currency, amount_usd')
      .eq('org_id', orgId).eq('auction_platform', platform).eq('fee_tier', feeTier).is('effective_to', null)
      .order('bracket_min').order('id').range(from, to),
    () => supabase.from('auction_fee_brackets').select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('auction_platform', platform).eq('fee_tier', feeTier).is('effective_to', null),
  );
  return rows.map((r: any): FeeBracketRow => ({
    fee_type: r.fee_type, title_status: r.title_status, payment_tier: r.payment_tier, bid_method: r.bid_method,
    bracket_min: Number(r.bracket_min), bracket_max: r.bracket_max === null ? null : Number(r.bracket_max),
    fee_unit: r.fee_unit,
    // A percent is a pure ratio; a dollar bracket is read in dollars (rateConventions.usdAmount).
    fee_value: r.fee_unit === 'percent' ? Number(r.fee_value) : usdAmount(r, r.fee_value, 'fee bracket'),
    source: r.source, effective_from: r.effective_from,
  }));
}

async function fetchFlatFees(orgId: string, platform: string): Promise<FlatFee[]> {
  const { data, error } = await supabase
    .from('cost_rates')
    .select('label, fee_role, rate_value, source, effective_from, currency, amount_usd')
    .eq('org_id', orgId)
    .eq('cost_category', 'auction_fee')
    .eq('auction_platform', platform)
    .eq('fee_applies', 'always')
    .is('effective_to', null);
  if (error) throw new Error(`Failed to load flat auction fees: ${error.message}`);
  return (data || []).map((r: any): FlatFee => ({
    label: r.label, fee_role: r.fee_role, source: r.source, effective_from: r.effective_from, rate_value: usdAmount(r, r.rate_value, 'flat fee'),
  }));
}

async function resolveSchedule(args: ResolveArgs): Promise<Resolved> {
  const houses = await listAuctionHouses();
  const platform = resolveEffectivePlatform(args.sighting, houses);
  if (!platform) {
    return { ok: false, component: unavailable('no resolvable auction platform', `source_platform=${args.sighting.source_platform}`) };
  }
  const house = houses.find(h => h.auction_platform === platform)!;

  // A capture that labels a lot with one house while its yard names another is contradictory: pricing under
  // either schedule would be a confident wrong number, so no fee is quoted (Yaris, debt #61). The prefixes
  // that identify a house's yards ("IAA ...") are data on auction_houses, not a regex here.
  const leading = (args.sighting.location ?? '').trim().split(/[\s,(/-]+/)[0]?.toUpperCase() ?? '';
  const other = leading ? houses.find(h => h.auction_platform !== platform && h.location_prefixes.some(p => p.toUpperCase() === leading)) : undefined;
  if (other) {
    return { ok: false, component: unavailable('platform label contradicts the yard', `source_auction_platform="${args.sighting.source_auction_platform}" but location="${args.sighting.location}" names a ${other.display_name} yard - no fee is quoted rather than pricing under ${house.display_name}'s schedule`) };
  }

  const account = args.accountId ? await getAccount(args.orgId, args.accountId) : await getDefaultAccount(args.orgId, platform);
  if (account && account.auction_platform !== platform) {
    return { ok: false, component: unavailable('the chosen account belongs to a different auction house', `account "${account.holder_name}" is a ${account.auction_platform} account but this lot is at ${house.display_name}`) };
  }
  if (!account) {
    return { ok: false, component: unavailable(`no ${house.display_name} account is set up`, `add the ${house.display_name} account this org buys through (with its official fee tier) under Admin > Rates > Fee schedules and accounts`) };
  }

  const titleStatus = classifyTitleStatus(args.titleType);
  const paymentTier = args.paymentTier ?? account.payment_tier;
  const basisBase = { houseName: house.display_name, feeTier: account.fee_tier, holder: account.holder_name, memberNumber: account.member_number, paymentTier: paymentTier ?? 'n/a' };
  const abstain = (reason: string, detail: string, title: string): Resolved => ({
    ok: false, component: { ...unavailable(reason, detail), basis: { ...basisBase, titleStatus: title } },
  });

  const [tierRows, flatFees] = await Promise.all([fetchTierRows(args.orgId, platform, account.fee_tier), fetchFlatFees(args.orgId, platform)]);
  if (tierRows.length === 0) {
    return abstain(`no fee schedule is loaded for ${account.fee_tier}`, `${house.display_name} account "${account.holder_name}" is on ${account.fee_tier}, which has no fee brackets loaded yet - load its schedule (Admin > Rates > Fee schedules and accounts) rather than pricing it under another tier`, titleStatus);
  }

  const selected = selectSchedule(tierRows, titleStatus, paymentTier, flatFees);
  if (selected.ok === false) return abstain('the fee schedule is ambiguous', selected.reason, titleStatus);

  // Same precedence the fee has always had: an unclassifiable title abstains before a missing price does.
  if (titleStatus === 'unknown' && selected.rows.buyerFeeRows.length === 0) {
    return abstain('title status could not be classified', `title_type="${args.titleType ?? ''}" matched neither a clean nor non-clean indicator`, 'unknown');
  }
  if (args.price && (args.price.value === null || args.price.value === undefined)) {
    return abstain('no price to bracket against', args.price.detail ?? 'no confirmed sale price and no candidate bid entered', titleStatus);
  }
  if (selected.rows.buyerFeeRows.length === 0) {
    return abstain(`no fee schedule is loaded for ${account.fee_tier} under a ${titleStatus} title / ${paymentTier ?? 'n/a'} payment`, `${account.fee_tier} has brackets loaded, but none for this title status and payment tier`, titleStatus);
  }
  return {
    ok: true, house, account, titleStatus: titleStatus as 'clean' | 'non_clean', paymentTier: paymentTier ?? 'n/a', schedule: selected.rows,
    basis: { ...basisBase, titleStatus },
  };
}

export async function getAuctionFeeComponent(input: AuctionFeeInput): Promise<CostComponent> {
  const r = await resolveSchedule({
    orgId: input.orgId, sighting: input.sighting, titleType: input.titleType, accountId: input.accountId, paymentTier: input.paymentTier,
    price: { value: input.referencePriceUsd, detail: input.referencePriceUnavailableDetail },
  });
  if (r.ok === false) return r.component;
  const component = auctionFeeFromRows(input.referencePriceUsd!, r.account.fee_tier, r.titleStatus, r.schedule, r.paymentTier, input.bidMethod ?? null);
  return { ...component, basis: r.basis };
}

export interface InlandTruckingInput {
  sighting: SightingForMatching;
  destinationPortNormalized: string | null;
  shippingMethod: 'container' | 'roro' | null;
  orgId: string;
}

export async function getInlandTruckingComponent(input: InlandTruckingInput): Promise<CostComponent> {
  if (!input.destinationPortNormalized || !input.shippingMethod) {
    return unavailable('no destination port/method selected for this run', '');
  }

  // Complete, paginated yard list (debt #68) - a bare select silently returns only the first 1,000 rows.
  const yards = await listActiveYardKeys(input.orgId);

  const matchResult = matchSightingToYard(input.sighting, yards);
  if (matchResult.status !== 'matched' || !matchResult.matchedYard) {
    return unavailable(`trucking not quotable: ${matchResult.status}`, matchResult.reason);
  }

  const { data: rates, error: ratesError } = await supabase
    .from('trucking_rates')
    .select('vendor, price, source, effective_from, currency, amount_usd')
    .eq('org_id', input.orgId)
    .eq('auction_platform', matchResult.effectivePlatform!)
    .eq('yard_state', matchResult.matchedYard.yard_state)
    .eq('yard_city', matchResult.matchedYard.yard_city)
    .eq('destination_port_normalized', input.destinationPortNormalized)
    .eq('shipping_method', input.shippingMethod)
    .is('effective_to', null);

  if (ratesError) throw new Error(`Failed to load trucking rates: ${ratesError.message}`);
  if (!rates || rates.length === 0) {
    return unavailable('trucking not quotable: no current rate for this yard/port/method', `${matchResult.matchedYard.yard_city}, ${matchResult.matchedYard.yard_state} -> ${input.destinationPortNormalized} (${input.shippingMethod})`);
  }

  // Cheapest in DOLLARS: a non-USD quote is compared by its frozen USD equivalent, never by its raw figure.
  const priced = (rates as any[]).map(r => ({ ...r, usd: usdAmount(r, r.price, 'trucking rate') })).sort((a, b) => a.usd - b.usd);
  const cheapest = priced[0];
  return {
    status: 'available',
    amountUsd: cheapest.usd,
    reason: null,
    detail: `Cheapest of ${rates.length} current quote(s) for ${matchResult.matchedYard.yard_city}, ${matchResult.matchedYard.yard_state} -> ${input.destinationPortNormalized} (${input.shippingMethod})`,
    sourceRows: [{ label: `${cheapest.vendor} (inland trucking)`, source: cheapest.source, effectiveFrom: cheapest.effective_from }],
  };
}

export async function getOceanFreightComponent(orgId: string, shippingMethod: 'container' | 'roro' | null, destinationPortLabel: string | null): Promise<CostComponent> {
  if (!shippingMethod || !destinationPortLabel) {
    return unavailable('no shipping method/destination selected for this run', '');
  }

  const { data, error } = await supabase
    .from('cost_rates')
    .select('label, rate_value, rate_value_max, source, effective_from, currency, amount_usd')
    .eq('org_id', orgId)
    .eq('cost_category', 'ocean_freight')
    .ilike('label', `%${shippingMethod}%`)
    .ilike('label', `%${destinationPortLabel}%`)
    .is('effective_to', null);

  if (error) throw new Error(`Failed to load ocean freight rates: ${error.message}`);
  if (!data || data.length === 0) {
    return unavailable('no ocean freight rate stored for this method/destination', `looked for cost_rates.cost_category='ocean_freight' matching "${shippingMethod}" and "${destinationPortLabel}" - none entered yet (PLAN_TRACKER.md debt #35)`);
  }

  const row = data[0] as any;
  // A non-USD rate is read through its frozen USD equivalent; its max shares that frozen exchange rate.
  const valueUsd = usdAmount(row, row.rate_value, 'ocean freight rate');
  const maxUsd = row.rate_value_max ? (valueUsd / Number(row.rate_value)) * Number(row.rate_value_max) : null;
  const amount = maxUsd !== null ? (valueUsd + maxUsd) / 2 : valueUsd;
  return {
    status: 'available',
    amountUsd: amount,
    reason: null,
    detail: row.rate_value_max ? `Midpoint of $${row.rate_value}-$${row.rate_value_max} range` : `$${row.rate_value}`,
    sourceRows: [{ label: row.label, source: row.source, effectiveFrom: row.effective_from }],
  };
}

// C2 remains blocked on collecting 10+ assessment notices (PLAN_TRACKER.md). Explicitly "not
// yet calculable" - never zero, never estimated. Do not build C2 here (PROMPT_21 out of scope).
export function getDutyComponent(): CostComponent {
  return unavailable('C2 duty calculator not yet built', 'blocked on collecting 10+ assessment notices (PLAN_TRACKER.md Phase C); the 51.47% formula exists but is uncalibrated for declared-CIF purposes');
}

// PROMPT 26 - fee as a function of bid, not a bracket lookup on a guessed reference price. Buyer fees are
// tiered by actual sale price; there is no single correct price to look up a bracket against for a car that
// hasn't sold. The arithmetic itself lives in _shared/feeSchedule.ts.

export interface FeeBoundaries {
  buyerFee: { current: FeeBracketBoundary; next: FeeBracketBoundary | null };
  bidFee: { current: FeeBracketBoundary; next: FeeBracketBoundary | null }; // midpoint of proxy/live
}

// Mode B (PROMPT 26 Phase 2) - "the bracket boundaries around that candidate," so staff can see the step
// changes near a bid they're actually considering.
export async function getFeeBracketBoundaries(
  orgId: string,
  sighting: SightingForMatching,
  titleType: string | null,
  candidateBidUsd: number,
  accountId?: string,
  paymentTier?: PaymentTier
): Promise<FeeBoundaries | null> {
  const r = await resolveSchedule({ orgId, sighting, titleType, accountId, paymentTier });
  if (r.ok === false) return null;
  const rows = r.schedule;

  const buyerFee = boundaryPair(rows.buyerFeeRows, candidateBidUsd, p => {
    const b = findBracket(rows.buyerFeeRows, p);
    return b ? feeForBracket(b, p) : 0;
  });
  const bidFee = boundaryPair(rows.bidFeeProxyRows, candidateBidUsd, p => {
    const pr = findBracket(rows.bidFeeProxyRows, p);
    const lv = findBracket(rows.bidFeeLiveRows, p);
    return pr && lv ? (feeForBracket(pr, p) + feeForBracket(lv, p)) / 2 : 0;
  });
  if (!buyerFee || !bidFee) return null;
  return { buyerFee, bidFee };
}

export interface MaxBidSolveResult {
  status: ComponentStatus;
  maxBidUsd: number | null;
  feeAtMaxBidUsd: number | null;
  reason: string | null;
}

export function computeHeadroom(
  targetLandedCostUsd: number | null,
  auctionFees: CostComponent,
  inlandTrucking: CostComponent,
  oceanFreight: CostComponent,
  duty: CostComponent
): CostComponent {
  if (targetLandedCostUsd === null) {
    return unavailable('no client budget stated', 'target landed cost comes from client_briefs.max_budget_usd, which is null for this brief');
  }
  // A PARTIAL component (available, but a sub-part such as the bid fee has no stored schedule) is missing
  // information too: it must never feed a headroom figure as though it were complete.
  const missing = [
    ['auction fees', auctionFees], ['inland trucking', inlandTrucking],
    ['ocean freight', oceanFreight], ['duty', duty],
  ].filter(([, c]) => (c as CostComponent).status === 'unavailable' || !!(c as CostComponent).partialReason).map(([name, c]) => (c as CostComponent).status === 'unavailable' ? name : `${name} (partial: ${(c as CostComponent).partialReason})`);

  if (missing.length > 0) {
    return unavailable('one or more cost components unavailable', `missing: ${missing.join(', ')} - a headroom figure computed with any of these silently zeroed would be dangerously and falsely precise`);
  }

  const headroomAmount = targetLandedCostUsd - oceanFreight.amountUsd! - duty.amountUsd! - auctionFees.amountUsd! - inlandTrucking.amountUsd!;
  return {
    status: 'available',
    amountUsd: Math.round(headroomAmount * 100) / 100,
    reason: null,
    detail: `$${targetLandedCostUsd} target − $${oceanFreight.amountUsd} shipping − $${duty.amountUsd} duty − $${auctionFees.amountUsd} auction fees − $${inlandTrucking.amountUsd} trucking`,
    sourceRows: [...auctionFees.sourceRows, ...inlandTrucking.sourceRows, ...oceanFreight.sourceRows],
  };
}

export interface ComputeBidHeadroomInput {
  orgId: string;
  sighting: SightingForMatching;
  titleType: string | null;
  referencePriceUsd: number | null;
  referencePriceUnavailableDetail?: string;
  destinationPortNormalized: string | null;
  destinationPortLabel: string | null;
  shippingMethod: 'container' | 'roro' | null;
  targetLandedCostUsd: number | null; // from client_briefs.max_budget_usd
  accountId?: string; // defaults to the org's default account for the lot's auction house
  paymentTier?: PaymentTier; // optional what-if override of the account's own payment tier
  // PROMPT 26 - a sold car has no future bid to size headroom for; forces headroom to abstain
  // regardless of what other components are available, while still letting the cost
  // components themselves render (that's the number that validates the fee model against
  // reality). Also gates whether a max-bid solve is even attempted.
  isFinishedLot: boolean;
}

export async function computeBidHeadroom(input: ComputeBidHeadroomInput): Promise<BidHeadroomResult> {
  const [auctionFees, inlandTrucking, oceanFreight] = await Promise.all([
    getAuctionFeeComponent({
      sighting: input.sighting, titleType: input.titleType, referencePriceUsd: input.referencePriceUsd,
      referencePriceUnavailableDetail: input.referencePriceUnavailableDetail,
      orgId: input.orgId, accountId: input.accountId, paymentTier: input.paymentTier,
    }),
    getInlandTruckingComponent({
      sighting: input.sighting, destinationPortNormalized: input.destinationPortNormalized,
      shippingMethod: input.shippingMethod, orgId: input.orgId,
    }),
    getOceanFreightComponent(input.orgId, input.shippingMethod, input.destinationPortLabel),
  ]);
  const duty = getDutyComponent();

  const headroom = input.isFinishedLot
    ? unavailable('bid headroom does not apply to a finished/sold listing', 'the auction has already ended - there is no future bid to size a headroom for. See the auction-fee figure above, which reflects the actual/confirmed price where one exists.')
    : computeHeadroom(input.targetLandedCostUsd, auctionFees, inlandTrucking, oceanFreight, duty);

  let maxBidSolve: MaxBidSolveResult | null = null;
  if (!input.isFinishedLot) {
    const canSolve = input.targetLandedCostUsd !== null
      && inlandTrucking.status === 'available'
      && oceanFreight.status === 'available'
      && duty.status === 'available';
    if (!canSolve) {
      maxBidSolve = {
        status: 'unavailable', maxBidUsd: null, feeAtMaxBidUsd: null,
        reason: 'shipping, trucking, and duty must all be available to solve for a maximum bid (duty is currently always unavailable - C2 is blocked)',
      };
    } else {
      const r = await resolveSchedule({ orgId: input.orgId, sighting: input.sighting, titleType: input.titleType, accountId: input.accountId, paymentTier: input.paymentTier });
      if (r.ok === false) {
        maxBidSolve = { status: 'unavailable', maxBidUsd: null, feeAtMaxBidUsd: null, reason: r.component.reason };
      } else if (!solverSupports(r.schedule)) {
        maxBidSolve = { status: 'unavailable', maxBidUsd: null, feeAtMaxBidUsd: null, reason: 'this schedule has a percent bid fee, which the max-bid solver cannot solve exactly - no figure is given rather than a wrong one' };
      } else {
        const targetAfterOtherCosts = input.targetLandedCostUsd! - inlandTrucking.amountUsd! - oceanFreight.amountUsd! - duty.amountUsd!;
        const maxBid = solveMaxBidForFees(targetAfterOtherCosts, r.schedule);
        if (maxBid !== null) {
          const feeAtMaxBid = combinedFeeAt(maxBid, r.schedule);
          maxBidSolve = {
            status: 'available',
            maxBidUsd: Math.round(maxBid * 100) / 100,
            feeAtMaxBidUsd: feeAtMaxBid !== null ? Math.round(feeAtMaxBid * 100) / 100 : null,
            reason: null,
          };
        } else {
          maxBidSolve = { status: 'unavailable', maxBidUsd: null, feeAtMaxBidUsd: null, reason: 'no bracket region produces a self-consistent solution for this target' };
        }
      }
    }
  }

  // The basis the fee was computed under (or attempted under) - shown so a headroom figure never rests on an
  // unstated schedule. Null only when no account could be resolved at all.
  const pricedUnder = auctionFees.basis
    ? { feeTier: auctionFees.basis.feeTier, holder: auctionFees.basis.holder, titleStatus: auctionFees.basis.titleStatus, paymentTier: auctionFees.basis.paymentTier }
    : null;

  return { auctionFees, inlandTrucking, oceanFreight, duty, targetLandedCostUsd: input.targetLandedCostUsd, headroom, pricedUnder, maxBidSolve };
}

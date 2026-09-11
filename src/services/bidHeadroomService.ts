import { supabase } from './supabaseClient';
import { matchSightingToYard } from './yardMatchingService';
import type { YardKey, SightingForMatching } from './yardMatchingService';
// PROMPT 29 Stage 4 - PaymentTier's single definition lives in orgSettingsService.ts, the
// module that owns reading/writing it as configuration. Imported, not redefined.
import type { PaymentTier } from './orgSettingsService';
import { DEFAULT_PAYMENT_TIER } from './orgSettingsService';

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

export type ComponentStatus = 'available' | 'unavailable';

export interface CostComponent {
  status: ComponentStatus;
  amountUsd: number | null;
  reason: string | null; // populated only when unavailable
  detail: string; // human-readable explanation of what this figure is / came from
  sourceRows: { label: string; source: string; effectiveFrom: string }[]; // dated provenance
}

export interface BidHeadroomResult {
  auctionFees: CostComponent;
  inlandTrucking: CostComponent;
  oceanFreight: CostComponent;
  duty: CostComponent;
  targetLandedCostUsd: number | null;
  headroom: CostComponent;
  // Which member account/tier the auction-fee figure was actually computed under - shown
  // prominently, not buried in a source line, so it is never ambiguous which basis a
  // headroom number rests on (a real correction: an earlier default silently priced against
  // a one-off middleman's cheaper schedule instead of Caplimo's own account).
  pricedUnder: { memberAccount: string; titleStatus: string; paymentTier: string } | null;
  // PROMPT 26 - null for a finished listing (headroom on a sold car is meaningless; there's no
  // future bid to solve for). For an active listing, 'available' only when shipping, trucking
  // AND duty are all available too - which duty being permanently blocked today means never,
  // in practice, until C2 unblocks. Built correctly now so it is ready then, per the same
  // reasoning as the solver it wraps.
  maxBidSolve: MaxBidSolveResult | null;
}

const unavailable = (reason: string, detail = ''): CostComponent => ({
  status: 'unavailable', amountUsd: null, reason, detail, sourceRows: [],
});

// --- Title status classification ---
// SCHEMA.md S5: title_type is genuinely messy, format varies by state and capture source.
// Every fee row confirmed this session (PROMPT_21 Phase 1/2) is Non-Clean - Caplimo's real
// invoices are 100% salvage titles. Rather than guess on ambiguous text, this classifier only
// returns 'clean' on an unambiguous positive match and otherwise defaults to 'non_clean' -
// matching the dominant real-world pattern for this business - but returns 'unknown' when the
// text gives no signal at all, which makes the auction-fee component abstain rather than
// silently assume a title status with no evidence either way.
const CLEAN_INDICATORS = /\bclean title\b|\bclear\b/i;
const NON_CLEAN_INDICATORS = /salvage|rebuilt|reconstruct|junk|parts only|flood|certificate of salvage|cert of salvage|cert of title-reconstrctd/i;

export function classifyTitleStatus(titleType: string | null | undefined): 'clean' | 'non_clean' | 'unknown' {
  if (!titleType || !titleType.trim()) return 'unknown';
  if (NON_CLEAN_INDICATORS.test(titleType)) return 'non_clean';
  if (CLEAN_INDICATORS.test(titleType)) return 'clean';
  return 'unknown';
}

// --- Effective platform (shared logic with the Prompt 20 matcher - bid.cars is a resale
// aggregator, never a yard network; its real platform is source_auction_platform) ---
function resolveEffectivePlatform(sighting: SightingForMatching): string | null {
  if (sighting.source_platform === 'copart' || sighting.source_platform === 'iaai') return sighting.source_platform;
  if (sighting.source_platform === 'bidcars') return sighting.source_auction_platform || null;
  return null;
}

export interface AuctionFeeBracketRow {
  member_account: string;
  fee_type: 'buyer_fee' | 'bid_fee';
  title_status: 'clean' | 'non_clean';
  payment_tier: 'secured' | 'unsecured';
  bid_method: 'proxy' | 'live' | null;
  bracket_min: number;
  bracket_max: number | null;
  fee_unit: 'usd' | 'percent';
  fee_value: number;
  source: string;
  effective_from: string;
}

export function feeForBracket(row: AuctionFeeBracketRow, referencePrice: number): number {
  return row.fee_unit === 'percent' ? referencePrice * (row.fee_value / 100) : row.fee_value;
}

export function findBracket(rows: AuctionFeeBracketRow[], referencePrice: number): AuctionFeeBracketRow | null {
  return rows.find(r => referencePrice >= r.bracket_min && (r.bracket_max === null || referencePrice <= r.bracket_max)) || null;
}

export interface AuctionFeeInput {
  sighting: SightingForMatching;
  titleType: string | null;
  // PROMPT 26 - no longer a guessed reference price. Either the actual confirmed sale price
  // (a finished, sale_confirmed=true listing's price_usd) or a staff-entered candidate bid on
  // an active listing. Never current_bid_usd on its own - that was the bug this prompt fixes.
  referencePriceUsd: number | null;
  // Shown as the abstention reason when referencePriceUsd is null, so the UI can say WHY
  // (sale unconfirmed vs. no candidate entered yet) instead of one generic message.
  referencePriceUnavailableDetail?: string;
  orgId: string;
  memberAccount?: string; // defaults to the confirmed default account below
  paymentTier?: PaymentTier; // PROMPT 29 Stage 4 - defaults to DEFAULT_PAYMENT_TIER below
}

// CORRECTED (see PLAN_TRACKER.md debt) - the default is Caplimo's OWN Copart account, not
// White Nexus. White Nexus is a one-off middleman that bought on Caplimo's behalf for a
// single invoice; it is not the entity Caplimo's own research-run client options should be
// priced against. Defaulting to White Nexus's cheaper High-Volume schedule would assume a
// discount Caplimo does not itself receive - understating cost on every listing,
// systematically, in the direction that loses money. Jamilu Danmusa Danmusa is Caplimo's own
// account (Non-Licensed), confirmed against invoices 1 & 3. White Nexus's High-Volume rows
// stay stored - they priced a real purchase and S5.10 requires that invoice to stay
// explicable - but they are historical, not the default.
export const DEFAULT_MEMBER_ACCOUNT = 'Jamilu Danmusa Danmusa (Copart Non-Licensed)';
// PROMPT 29 Stage 4 - was a hardcoded constant; now configuration (org_settings, migration
// 034). Both real Copart accounts price as Unsecured on every invoice seen - including one
// funded mostly by wire and one where a $400 security deposit is on file with Copart
// (PLAN_TRACKER.md debt #43 - open question, not yet resolved). This module never defaults to
// Secured itself; DEFAULT_PAYMENT_TIER is only the fallback for an org with no settings row
// yet, and is deliberately identical to the value the old hardcoded constant held, so a
// missing settings row changes nothing.

interface AuctionFeeRows {
  buyerFeeRows: AuctionFeeBracketRow[];
  bidFeeProxyRows: AuctionFeeBracketRow[];
  bidFeeLiveRows: AuctionFeeBracketRow[];
  flatFees: { label: string; source: string; effective_from: string; rate_value: number }[];
  flatFeeTotal: number;
}

// Extracted (PROMPT 26) so the forward calculation (getAuctionFeeComponent, a known price ->
// a fee) and the inverse one (solveMaxBidForFees, a target -> the bid that produces it) share
// one fetch instead of two copies of the same query drifting apart over time.
async function fetchAuctionFeeRows(orgId: string, platform: string, memberAccount: string, titleStatus: 'clean' | 'non_clean', paymentTier: PaymentTier): Promise<AuctionFeeRows> {
  const { data, error } = await supabase
    .from('auction_fee_brackets')
    .select('member_account, fee_type, title_status, payment_tier, bid_method, bracket_min, bracket_max, fee_unit, fee_value, source, effective_from')
    .eq('org_id', orgId)
    .eq('auction_platform', platform)
    .eq('member_account', memberAccount)
    .eq('title_status', titleStatus)
    .eq('payment_tier', paymentTier)
    .is('effective_to', null);
  if (error) throw new Error(`Failed to load auction fee brackets: ${error.message}`);

  const rows = (data || []) as AuctionFeeBracketRow[];
  const buyerFeeRows = rows.filter(r => r.fee_type === 'buyer_fee');
  const bidFeeRows = rows.filter(r => r.fee_type === 'bid_fee');
  const bidFeeProxyRows = bidFeeRows.filter(r => r.bid_method === 'proxy');
  const bidFeeLiveRows = bidFeeRows.filter(r => r.bid_method === 'live');

  const { data: flatFeeData, error: flatFeeError } = await supabase
    .from('cost_rates')
    .select('label, rate_value, source, effective_from')
    .eq('org_id', orgId)
    .eq('cost_category', 'auction_fee')
    .in('label', ['Copart Environmental Fee', 'Copart Gate Fee (Non-Clean Title)', 'Copart Title Pickup Fee'])
    .is('effective_to', null);
  if (flatFeeError) throw new Error(`Failed to load flat auction fees: ${flatFeeError.message}`);
  const flatFees = (flatFeeData || []) as any[];
  const flatFeeTotal = flatFees.reduce((sum, f) => sum + Number(f.rate_value), 0);

  return { buyerFeeRows, bidFeeProxyRows, bidFeeLiveRows, flatFees, flatFeeTotal };
}

function auctionFeeComponentFromRows(
  priceUsd: number,
  memberAccount: string,
  titleStatus: 'clean' | 'non_clean',
  rows: AuctionFeeRows,
  paymentTier: PaymentTier
): CostComponent {
  const buyerBracket = findBracket(rows.buyerFeeRows, priceUsd);
  if (!buyerBracket) {
    return unavailable('no buyer-fee bracket covers this price', `price $${priceUsd} against ${memberAccount}`);
  }

  const proxyBracket = findBracket(rows.bidFeeProxyRows, priceUsd);
  const liveBracket = findBracket(rows.bidFeeLiveRows, priceUsd);

  // Bid method (proxy vs. live) for a future bid on an active listing is genuinely unknown
  // ahead of time - shown as a range with both real figures, never collapsed into one guessed
  // number (PROJECT_CHARTER.md S5.1: show the underlying figures).
  const bidFeeLow = proxyBracket && liveBracket ? Math.min(feeForBracket(proxyBracket, priceUsd), feeForBracket(liveBracket, priceUsd)) : null;
  const bidFeeHigh = proxyBracket && liveBracket ? Math.max(feeForBracket(proxyBracket, priceUsd), feeForBracket(liveBracket, priceUsd)) : null;

  const buyerFeeAmount = feeForBracket(buyerBracket, priceUsd);
  const bidFeeMid = bidFeeLow !== null && bidFeeHigh !== null ? (bidFeeLow + bidFeeHigh) / 2 : 0;
  const total = buyerFeeAmount + bidFeeMid + rows.flatFeeTotal;

  const sourceRows = [
    { label: `Buyer fee (${memberAccount}, ${titleStatus}, ${paymentTier})`, source: buyerBracket.source, effectiveFrom: buyerBracket.effective_from },
    ...rows.flatFees.map(f => ({ label: f.label, source: f.source, effectiveFrom: f.effective_from })),
  ];
  if (proxyBracket) sourceRows.push({ label: 'Bid fee (proxy)', source: proxyBracket.source, effectiveFrom: proxyBracket.effective_from });
  if (liveBracket) sourceRows.push({ label: 'Bid fee (live)', source: liveBracket.source, effectiveFrom: liveBracket.effective_from });

  const bidFeeNote = bidFeeLow !== null && bidFeeHigh !== null
    ? (bidFeeLow === bidFeeHigh ? `$${bidFeeLow.toFixed(2)}` : `$${bidFeeLow.toFixed(2)}-$${bidFeeHigh.toFixed(2)} depending on bid method (not yet known)`)
    : 'not available';

  return {
    status: 'available',
    amountUsd: Math.round(total * 100) / 100,
    reason: null,
    detail: `Buyer fee $${buyerFeeAmount.toFixed(2)} + bid fee ${bidFeeNote} + flat fees $${rows.flatFeeTotal.toFixed(2)} (Environmental/Gate/Title Pickup), at price $${priceUsd}`,
    sourceRows,
  };
}

export async function getAuctionFeeComponent(input: AuctionFeeInput): Promise<CostComponent> {
  const platform = resolveEffectivePlatform(input.sighting);
  if (!platform) {
    return unavailable('no resolvable auction platform', `source_platform=${input.sighting.source_platform}`);
  }
  if (platform !== 'copart') {
    return unavailable(`no stored fee schedule for platform "${platform}" yet`, 'only Copart fee schedules are confirmed and stored (PROMPT_21 Phase 2) - no IAAI invoice exists to cross-check its published tables against');
  }

  const titleStatus = classifyTitleStatus(input.titleType);
  if (titleStatus === 'unknown') {
    return unavailable('title status could not be classified', `title_type="${input.titleType ?? ''}" matched neither a clean nor non-clean indicator`);
  }

  if (input.referencePriceUsd === null || input.referencePriceUsd === undefined) {
    return unavailable('no price to bracket against', input.referencePriceUnavailableDetail ?? 'no confirmed sale price and no candidate bid entered');
  }

  const memberAccount = input.memberAccount || DEFAULT_MEMBER_ACCOUNT;
  const paymentTier = input.paymentTier ?? DEFAULT_PAYMENT_TIER;
  const rows = await fetchAuctionFeeRows(input.orgId, platform, memberAccount, titleStatus, paymentTier);
  return auctionFeeComponentFromRows(input.referencePriceUsd, memberAccount, titleStatus, rows, paymentTier);
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

  const { data: yards, error: yardsError } = await supabase
    .from('trucking_rates')
    .select('auction_platform, yard_state, yard_city, yard_street')
    .eq('org_id', input.orgId)
    .is('effective_to', null);
  if (yardsError) throw new Error(`Failed to load yards: ${yardsError.message}`);

  const matchResult = matchSightingToYard(input.sighting, (yards || []) as YardKey[]);
  if (matchResult.status !== 'matched' || !matchResult.matchedYard) {
    return unavailable(`trucking not quotable: ${matchResult.status}`, matchResult.reason);
  }

  const { data: rates, error: ratesError } = await supabase
    .from('trucking_rates')
    .select('vendor, price, source, effective_from')
    .eq('org_id', input.orgId)
    .eq('auction_platform', matchResult.effectivePlatform!)
    .eq('yard_state', matchResult.matchedYard.yard_state)
    .eq('yard_city', matchResult.matchedYard.yard_city)
    .eq('destination_port_normalized', input.destinationPortNormalized)
    .eq('shipping_method', input.shippingMethod)
    .is('effective_to', null)
    .order('price', { ascending: true });

  if (ratesError) throw new Error(`Failed to load trucking rates: ${ratesError.message}`);
  if (!rates || rates.length === 0) {
    return unavailable('trucking not quotable: no current rate for this yard/port/method', `${matchResult.matchedYard.yard_city}, ${matchResult.matchedYard.yard_state} -> ${input.destinationPortNormalized} (${input.shippingMethod})`);
  }

  const cheapest = rates[0] as any;
  return {
    status: 'available',
    amountUsd: Number(cheapest.price),
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
    .select('label, rate_value, rate_value_max, source, effective_from')
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
  const amount = row.rate_value_max ? (Number(row.rate_value) + Number(row.rate_value_max)) / 2 : Number(row.rate_value);
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

// PROMPT 26 - fee as a function of bid, not a bracket lookup on a guessed reference price.
// Copart/IAAI buyer fees are tiered by actual sale price; there is no single correct price to
// look up a bracket against for a car that hasn't sold. Model the fee as fees(bid) instead.

export interface FeeBracketBoundary {
  min: number;
  max: number | null;
  feeLabel: string; // "$385" for a flat bracket, "12.5% of price" for the terminal percent one
}

export interface FeeBoundaries {
  buyerFee: { current: FeeBracketBoundary; next: FeeBracketBoundary | null };
  bidFee: { current: FeeBracketBoundary; next: FeeBracketBoundary | null }; // midpoint of proxy/live
}

function boundaryPair(rows: AuctionFeeBracketRow[], price: number, feeAt: (p: number) => number): { current: FeeBracketBoundary; next: FeeBracketBoundary | null } | null {
  const sorted = [...rows].sort((a, b) => a.bracket_min - b.bracket_min);
  const idx = sorted.findIndex(r => price >= r.bracket_min && (r.bracket_max === null || price <= r.bracket_max));
  if (idx === -1) return null;
  const cur = sorted[idx];
  const nxt = idx + 1 < sorted.length ? sorted[idx + 1] : null;
  const label = (b: AuctionFeeBracketRow, feeVal: number) => (b.fee_unit === 'percent' ? `${b.fee_value}% of price` : `$${feeVal.toFixed(2)}`);
  return {
    current: { min: cur.bracket_min, max: cur.bracket_max, feeLabel: label(cur, feeAt(price)) },
    next: nxt ? { min: nxt.bracket_min, max: nxt.bracket_max, feeLabel: label(nxt, feeAt(nxt.bracket_min)) } : null,
  };
}

// Mode B (PROMPT 26 Phase 2) - "the bracket boundaries around that candidate," so staff can
// see the step changes near a bid they're actually considering. Never called with a guessed
// price - only a staff-entered candidate or (for display symmetry) a confirmed sale price.
export async function getFeeBracketBoundaries(
  orgId: string,
  sighting: SightingForMatching,
  titleType: string | null,
  candidateBidUsd: number,
  memberAccount?: string,
  paymentTier?: PaymentTier
): Promise<FeeBoundaries | null> {
  const platform = resolveEffectivePlatform(sighting);
  if (platform !== 'copart') return null;
  const titleStatus = classifyTitleStatus(titleType);
  if (titleStatus === 'unknown') return null;

  const acct = memberAccount || DEFAULT_MEMBER_ACCOUNT;
  const rows = await fetchAuctionFeeRows(orgId, platform, acct, titleStatus, paymentTier ?? DEFAULT_PAYMENT_TIER);

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

function combinedFeeAt(bid: number, rows: AuctionFeeRows): number | null {
  const buyerBracket = findBracket(rows.buyerFeeRows, bid);
  if (!buyerBracket) return null;
  const proxyBracket = findBracket(rows.bidFeeProxyRows, bid);
  const liveBracket = findBracket(rows.bidFeeLiveRows, bid);
  const bidFeeMid = proxyBracket && liveBracket ? (feeForBracket(proxyBracket, bid) + feeForBracket(liveBracket, bid)) / 2 : 0;
  return feeForBracket(buyerBracket, bid) + bidFeeMid + rows.flatFeeTotal;
}

// Mode A (PROMPT 26 Phase 2) - solve for the maximum bid where
// bid + fees(bid) + shipping + trucking + duty <= targetLandedCost. Replaces the earlier
// single-bracket scaffold (buyer fee only) with the real combined function: buyer fee AND
// bid-fee-midpoint AND the flat fees, all as steps of bid. Correct by construction wherever
// monotonicity holds (verified against all 108 real bracket rows, Phase 1 - zero violations):
// within any region bounded by two consecutive breakpoints from EITHER bracket set, both the
// buyer-fee bracket and the bid-fee brackets are constant, so total(bid) = bid + constant (or,
// in the one open-ended percent bracket, a one-step linear equation) is directly solvable, and
// monotonicity guarantees at most one region contains the true answer.
function solveMaxBidForFees(targetAfterOtherCosts: number, rows: AuctionFeeRows): number | null {
  const breakpoints = Array.from(new Set([
    ...rows.buyerFeeRows.map(r => r.bracket_min),
    ...rows.bidFeeProxyRows.map(r => r.bracket_min),
    ...rows.bidFeeLiveRows.map(r => r.bracket_min),
  ])).sort((a, b) => a - b);

  for (let i = 0; i < breakpoints.length; i++) {
    const regionMin = breakpoints[i];
    const regionMaxExclusive = i + 1 < breakpoints.length ? breakpoints[i + 1] : null;
    const buyerBracket = findBracket(rows.buyerFeeRows, regionMin);
    if (!buyerBracket) continue;
    const proxyBracket = findBracket(rows.bidFeeProxyRows, regionMin);
    const liveBracket = findBracket(rows.bidFeeLiveRows, regionMin);
    const bidFeeMid = proxyBracket && liveBracket ? (feeForBracket(proxyBracket, regionMin) + feeForBracket(liveBracket, regionMin)) / 2 : 0;

    const candidate = buyerBracket.fee_unit === 'usd'
      ? targetAfterOtherCosts - buyerBracket.fee_value - bidFeeMid - rows.flatFeeTotal
      : (targetAfterOtherCosts - bidFeeMid - rows.flatFeeTotal) / (1 + buyerBracket.fee_value / 100);

    const withinBuyerBracket = candidate >= buyerBracket.bracket_min && (buyerBracket.bracket_max === null || candidate <= buyerBracket.bracket_max);
    const withinRegion = candidate >= regionMin && (regionMaxExclusive === null || candidate < regionMaxExclusive);
    if (withinBuyerBracket && withinRegion) {
      return candidate;
    }
  }
  return null;
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
  const missing = [
    ['auction fees', auctionFees], ['inland trucking', inlandTrucking],
    ['ocean freight', oceanFreight], ['duty', duty],
  ].filter(([, c]) => (c as CostComponent).status === 'unavailable').map(([name]) => name);

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
  memberAccount?: string;
  paymentTier?: PaymentTier; // PROMPT 29 Stage 4 - defaults to DEFAULT_PAYMENT_TIER below
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
      orgId: input.orgId, memberAccount: input.memberAccount, paymentTier: input.paymentTier,
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
      const platform = resolveEffectivePlatform(input.sighting);
      const titleStatus = classifyTitleStatus(input.titleType);
      if (platform === 'copart' && titleStatus !== 'unknown') {
        const memberAccount = input.memberAccount || DEFAULT_MEMBER_ACCOUNT;
        const rows = await fetchAuctionFeeRows(input.orgId, platform, memberAccount, titleStatus, input.paymentTier ?? DEFAULT_PAYMENT_TIER);
        const targetAfterOtherCosts = input.targetLandedCostUsd! - inlandTrucking.amountUsd! - oceanFreight.amountUsd! - duty.amountUsd!;
        const maxBid = solveMaxBidForFees(targetAfterOtherCosts, rows);
        if (maxBid !== null) {
          const feeAtMaxBid = combinedFeeAt(maxBid, rows);
          maxBidSolve = {
            status: 'available',
            maxBidUsd: Math.round(maxBid * 100) / 100,
            feeAtMaxBidUsd: feeAtMaxBid !== null ? Math.round(feeAtMaxBid * 100) / 100 : null,
            reason: null,
          };
        } else {
          maxBidSolve = { status: 'unavailable', maxBidUsd: null, feeAtMaxBidUsd: null, reason: 'no bracket region produces a self-consistent solution for this target' };
        }
      } else {
        maxBidSolve = { status: 'unavailable', maxBidUsd: null, feeAtMaxBidUsd: null, reason: 'no bracket schedule for this platform/title status' };
      }
    }
  }

  // Shown regardless of whether the auction-fee component actually succeeded, so the panel
  // always states what basis was ATTEMPTED, not just what basis produced a number.
  const pricedUnder = {
    memberAccount: input.memberAccount || DEFAULT_MEMBER_ACCOUNT,
    titleStatus: classifyTitleStatus(input.titleType),
    paymentTier: input.paymentTier ?? DEFAULT_PAYMENT_TIER,
  };

  return { auctionFees, inlandTrucking, oceanFreight, duty, targetLandedCostUsd: input.targetLandedCostUsd, headroom, pricedUnder, maxBidSolve };
}

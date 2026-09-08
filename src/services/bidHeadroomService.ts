import { supabase } from './supabaseClient';
import { matchSightingToYard } from './yardMatchingService';
import type { YardKey, SightingForMatching } from './yardMatchingService';

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
  referencePriceUsd: number | null; // current_bid_usd ?? listed_price ?? price_usd
  orgId: string;
  memberAccount?: string; // defaults to the confirmed default account below
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
// Both real Copart accounts price as Unsecured on every invoice seen - including one funded
// mostly by wire and one where a $400 security deposit is on file with Copart (PLAN_TRACKER.md
// debt - open question, not yet resolved). Secured is not offered as a silent default; it
// stays official_tariff, unconfirmed, until Copart confirms what actually secures an account.
const PAYMENT_TIER = 'unsecured' as const;

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
    return unavailable('no reference price to bracket against', 'current_bid_usd, listed_price, and price_usd are all null');
  }

  const memberAccount = input.memberAccount || DEFAULT_MEMBER_ACCOUNT;

  const { data, error } = await supabase
    .from('auction_fee_brackets')
    .select('member_account, fee_type, title_status, payment_tier, bid_method, bracket_min, bracket_max, fee_unit, fee_value, source, effective_from')
    .eq('org_id', input.orgId)
    .eq('auction_platform', platform)
    .eq('member_account', memberAccount)
    .eq('title_status', titleStatus)
    .eq('payment_tier', PAYMENT_TIER)
    .is('effective_to', null);

  if (error) throw new Error(`Failed to load auction fee brackets: ${error.message}`);

  const rows = (data || []) as AuctionFeeBracketRow[];
  const buyerFeeRows = rows.filter(r => r.fee_type === 'buyer_fee');
  const bidFeeRows = rows.filter(r => r.fee_type === 'bid_fee');

  const buyerBracket = findBracket(buyerFeeRows, input.referencePriceUsd);
  if (!buyerBracket) {
    return unavailable('no buyer-fee bracket covers this price', `reference price $${input.referencePriceUsd} against ${memberAccount}`);
  }

  const proxyBracket = findBracket(bidFeeRows.filter(r => r.bid_method === 'proxy'), input.referencePriceUsd);
  const liveBracket = findBracket(bidFeeRows.filter(r => r.bid_method === 'live'), input.referencePriceUsd);

  // Bid method (proxy vs. live) for a future bid on an active listing is genuinely unknown
  // ahead of time - shown as a range with both real figures, never collapsed into one guessed
  // number (PROJECT_CHARTER.md S5.1: show the underlying figures).
  const bidFeeLow = proxyBracket && liveBracket ? Math.min(feeForBracket(proxyBracket, input.referencePriceUsd), feeForBracket(liveBracket, input.referencePriceUsd)) : null;
  const bidFeeHigh = proxyBracket && liveBracket ? Math.max(feeForBracket(proxyBracket, input.referencePriceUsd), feeForBracket(liveBracket, input.referencePriceUsd)) : null;

  const { data: flatFeeData, error: flatFeeError } = await supabase
    .from('cost_rates')
    .select('label, rate_value, source, effective_from')
    .eq('org_id', input.orgId)
    .eq('cost_category', 'auction_fee')
    .in('label', ['Copart Environmental Fee', 'Copart Gate Fee (Non-Clean Title)', 'Copart Title Pickup Fee'])
    .is('effective_to', null);

  if (flatFeeError) throw new Error(`Failed to load flat auction fees: ${flatFeeError.message}`);
  const flatFees = flatFeeData || [];
  const flatFeeTotal = flatFees.reduce((sum, f: any) => sum + Number(f.rate_value), 0);

  const buyerFeeAmount = feeForBracket(buyerBracket, input.referencePriceUsd);
  const bidFeeMid = bidFeeLow !== null && bidFeeHigh !== null ? (bidFeeLow + bidFeeHigh) / 2 : 0;
  const total = buyerFeeAmount + bidFeeMid + flatFeeTotal;

  const sourceRows = [
    { label: `Buyer fee (${memberAccount}, ${titleStatus}, ${PAYMENT_TIER})`, source: buyerBracket.source, effectiveFrom: buyerBracket.effective_from },
    ...flatFees.map((f: any) => ({ label: f.label, source: f.source, effectiveFrom: f.effective_from })),
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
    detail: `Buyer fee $${buyerFeeAmount.toFixed(2)} + bid fee ${bidFeeNote} + flat fees $${flatFeeTotal.toFixed(2)} (Environmental/Gate/Title Pickup), at reference price $${input.referencePriceUsd}`,
    sourceRows,
  };
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

// The bracket circularity, resolved (PROMPT_21 Phase 1): for the ~40 fixed-dollar brackets,
// scan in ascending order and take the one bracket where the candidate bid is self-consistent
// with the bracket it would fall in - not iteration, a single deterministic pass over an
// ordered, finite set. For the terminal percentage bracket, solve the one-step linear
// equation directly. This only ever runs today if every other component is available, which
// duty being permanently blocked currently prevents - implemented now so it is correct and
// ready the moment C2 unblocks, not because it executes yet.
function solveMaxBidAgainstBracket(targetAfterOtherCosts: number, brackets: AuctionFeeBracketRow[]): number | null {
  const sorted = [...brackets].sort((a, b) => a.bracket_min - b.bracket_min);
  for (const bracket of sorted) {
    if (bracket.fee_unit === 'usd') {
      const candidate = targetAfterOtherCosts - bracket.fee_value;
      if (candidate >= bracket.bracket_min && (bracket.bracket_max === null || candidate <= bracket.bracket_max)) {
        return candidate;
      }
    } else {
      // percent: bid + bid*(rate/100) = targetAfterOtherCosts => bid = target / (1 + rate/100)
      const candidate = targetAfterOtherCosts / (1 + bracket.fee_value / 100);
      if (candidate >= bracket.bracket_min && (bracket.bracket_max === null || candidate <= bracket.bracket_max)) {
        return candidate;
      }
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
  destinationPortNormalized: string | null;
  destinationPortLabel: string | null;
  shippingMethod: 'container' | 'roro' | null;
  targetLandedCostUsd: number | null; // from client_briefs.max_budget_usd
  memberAccount?: string;
}

export async function computeBidHeadroom(input: ComputeBidHeadroomInput): Promise<BidHeadroomResult> {
  const [auctionFees, inlandTrucking, oceanFreight] = await Promise.all([
    getAuctionFeeComponent({
      sighting: input.sighting, titleType: input.titleType, referencePriceUsd: input.referencePriceUsd,
      orgId: input.orgId, memberAccount: input.memberAccount,
    }),
    getInlandTruckingComponent({
      sighting: input.sighting, destinationPortNormalized: input.destinationPortNormalized,
      shippingMethod: input.shippingMethod, orgId: input.orgId,
    }),
    getOceanFreightComponent(input.orgId, input.shippingMethod, input.destinationPortLabel),
  ]);
  const duty = getDutyComponent();
  const headroom = computeHeadroom(input.targetLandedCostUsd, auctionFees, inlandTrucking, oceanFreight, duty);

  // Shown regardless of whether the auction-fee component actually succeeded, so the panel
  // always states what basis was ATTEMPTED, not just what basis produced a number.
  const pricedUnder = {
    memberAccount: input.memberAccount || DEFAULT_MEMBER_ACCOUNT,
    titleStatus: classifyTitleStatus(input.titleType),
    paymentTier: PAYMENT_TIER,
  };

  return { auctionFees, inlandTrucking, oceanFreight, duty, targetLandedCostUsd: input.targetLandedCostUsd, headroom, pricedUnder };
}

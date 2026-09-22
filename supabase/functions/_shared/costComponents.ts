// PROMPT 38 (debt #79) - the auction-fee, inland-trucking, ocean-freight and duty components, shared by the browser
// (bidHeadroomService.ts binds these to its supabase client) and the billing Edge Function, which RECOMPUTES a computed
// invoice line from these same functions and refuses the line if its figure differs. "Computed" is therefore a verified
// claim, not a label a caller can attach to any number.
//
// This is the logic that lived in bidHeadroomService.ts, moved not rewritten (the frozen Copart regression and the IAAI
// synthetic proof still run against the same arithmetic in _shared/feeSchedule.ts). Two behaviours were tightened while
// moving, both invisible on today's data and both in the direction of abstaining rather than guessing (charter 5.1):
//   * trucking: ties on price break by vendor then id, so "the cheapest quote" names the same vendor every time;
//   * freight: two matching stored rates abstain (the old code took the first row the database happened to return).
import { unavailable, auctionFeeFromRows, selectSchedule } from './feeSchedule.ts';
import type { CostComponent, FeeBasis, ScheduleRows } from './feeSchedule.ts';
import { classifyTitleStatus as classifySharedTitleStatus } from './specVocabulary.ts';
import { usdAmount } from './rateConventions.ts';
import { matchSightingToYard } from './yardMatching.ts';
import type { SightingForMatching } from './yardMatching.ts';
import { listAuctionHouses, getAccount, getDefaultAccount, listActiveYardKeys, fetchTierRows, fetchFlatFees } from './costReads.ts';
import type { Db, AuctionAccount, PaymentTier } from './costReads.ts';

export type { CostComponent };

// --- Title status classification (a thin binary view onto the shared classifier; 'unknown' stays reachable so the fee abstains)
export function classifyTitleStatus(titleType: string | null | undefined): 'clean' | 'non_clean' | 'unknown' {
  const { status, isFloodBranded } = classifySharedTitleStatus(titleType);
  if (isFloodBranded) return 'non_clean';
  if (status === 'unknown') return 'unknown';
  if (status === 'clean') return 'clean';
  return 'non_clean'; // salvage | rebuilt | non_repairable
}

// --- Effective platform: the capture source when it IS a configured house, otherwise the house an aggregator recorded
export function resolveEffectivePlatform(sighting: SightingForMatching, houses: { auction_platform: string }[]): string | null {
  const isHouse = (v: string | null | undefined) => !!v && houses.some(h => h.auction_platform === v);
  if (isHouse(sighting.source_platform)) return sighting.source_platform;
  if (isHouse(sighting.source_auction_platform)) return sighting.source_auction_platform as string;
  return null;
}

export interface AuctionFeeInput {
  sighting: SightingForMatching;
  titleType: string | null;
  referencePriceUsd: number | null;
  referencePriceUnavailableDetail?: string;
  orgId: string;
  accountId?: string;
  paymentTier?: PaymentTier;
  bidMethod?: 'proxy' | 'live' | null;
}

export type Resolved =
  | { ok: true; house: { auction_platform: string; display_name: string }; account: AuctionAccount; basis: FeeBasis; schedule: ScheduleRows; titleStatus: 'clean' | 'non_clean'; paymentTier: string }
  | { ok: false; component: CostComponent };

export interface ResolveArgs {
  orgId: string;
  sighting: SightingForMatching;
  titleType: string | null;
  accountId?: string;
  paymentTier?: PaymentTier;
  price?: { value: number | null; detail?: string };
}

export async function resolveSchedule(db: Db, args: ResolveArgs): Promise<Resolved> {
  const houses = await listAuctionHouses(db);
  const platform = resolveEffectivePlatform(args.sighting, houses);
  if (!platform) {
    return { ok: false, component: unavailable('no resolvable auction platform', `source_platform=${args.sighting.source_platform}`) };
  }
  const house = houses.find(h => h.auction_platform === platform)!;

  // A capture that labels a lot with one house while its yard names another is contradictory: no fee is quoted (Yaris, debt #61).
  const leading = (args.sighting.location ?? '').trim().split(/[\s,(/-]+/)[0]?.toUpperCase() ?? '';
  const other = leading ? houses.find(h => h.auction_platform !== platform && h.location_prefixes.some(p => p.toUpperCase() === leading)) : undefined;
  if (other) {
    return { ok: false, component: unavailable('platform label contradicts the yard', `source_auction_platform="${args.sighting.source_auction_platform}" but location="${args.sighting.location}" names a ${other.display_name} yard - no fee is quoted rather than pricing under ${house.display_name}'s schedule`) };
  }

  const account = args.accountId ? await getAccount(db, args.orgId, args.accountId) : await getDefaultAccount(db, args.orgId, platform);
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

  const [tierRows, flatFees] = await Promise.all([fetchTierRows(db, args.orgId, platform, account.fee_tier), fetchFlatFees(db, args.orgId, platform)]);
  if (tierRows.length === 0) {
    return abstain(`no fee schedule is loaded for ${account.fee_tier}`, `${house.display_name} account "${account.holder_name}" is on ${account.fee_tier}, which has no fee brackets loaded yet - load its schedule (Admin > Rates > Fee schedules and accounts) rather than pricing it under another tier`, titleStatus);
  }

  const selected = selectSchedule(tierRows, titleStatus, paymentTier, flatFees);
  if (selected.ok === false) return abstain('the fee schedule is ambiguous', selected.reason, titleStatus);

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

export async function auctionFeeComponent(db: Db, input: AuctionFeeInput): Promise<CostComponent> {
  const r = await resolveSchedule(db, {
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

export async function inlandTruckingComponent(db: Db, input: InlandTruckingInput): Promise<CostComponent> {
  if (!input.destinationPortNormalized || !input.shippingMethod) {
    return unavailable('no destination port/method selected for this run', '');
  }
  const yards = await listActiveYardKeys(db, input.orgId);
  const matchResult = matchSightingToYard(input.sighting, yards);
  if (matchResult.status !== 'matched' || !matchResult.matchedYard) {
    return unavailable(`trucking not quotable: ${matchResult.status}`, matchResult.reason);
  }
  const { data: rates, error: ratesError } = await db.from('trucking_rates')
    .select('id, vendor, price, source, effective_from, currency, amount_usd')
    .eq('org_id', input.orgId)
    .eq('auction_platform', matchResult.effectivePlatform!)
    .eq('yard_state', matchResult.matchedYard.yard_state)
    .eq('yard_city', matchResult.matchedYard.yard_city)
    .eq('destination_port_normalized', input.destinationPortNormalized)
    .eq('shipping_method', input.shippingMethod)
    .is('effective_to', null)
    .order('id');
  if (ratesError) throw new Error(`Failed to load trucking rates: ${ratesError.message}`);
  if (!rates || rates.length === 0) {
    return unavailable('trucking not quotable: no current rate for this yard/port/method', `${matchResult.matchedYard.yard_city}, ${matchResult.matchedYard.yard_state} -> ${input.destinationPortNormalized} (${input.shippingMethod})`);
  }
  // Cheapest in DOLLARS (a non-USD quote by its frozen USD equivalent); ties break by vendor then id so the answer is stable.
  const priced = (rates as any[]).map(r => ({ ...r, usd: usdAmount(r, r.price, 'trucking rate') }))
    .sort((a, b) => a.usd - b.usd || String(a.vendor).localeCompare(String(b.vendor)) || String(a.id).localeCompare(String(b.id)));
  const cheapest = priced[0];
  return {
    status: 'available',
    amountUsd: cheapest.usd,
    reason: null,
    detail: `Cheapest of ${rates.length} current quote(s) for ${matchResult.matchedYard.yard_city}, ${matchResult.matchedYard.yard_state} -> ${input.destinationPortNormalized} (${input.shippingMethod})`,
    sourceRows: [{ label: `${cheapest.vendor} (inland trucking)`, source: cheapest.source, effectiveFrom: cheapest.effective_from }],
  };
}

export async function oceanFreightComponent(db: Db, orgId: string, shippingMethod: 'container' | 'roro' | null, destinationPortLabel: string | null): Promise<CostComponent> {
  if (!shippingMethod || !destinationPortLabel) {
    return unavailable('no shipping method/destination selected for this run', '');
  }
  const escape = (s: string) => s.replace(/[\\%_]/g, m => '\\' + m);   // a stored label containing % or _ must not act as a wildcard
  const { data, error } = await db.from('cost_rates')
    .select('id, label, rate_value, rate_value_max, source, effective_from, currency, amount_usd')
    .eq('org_id', orgId).eq('cost_category', 'ocean_freight')
    .ilike('label', `%${escape(shippingMethod)}%`).ilike('label', `%${escape(destinationPortLabel)}%`)
    .is('effective_to', null).order('id');
  if (error) throw new Error(`Failed to load ocean freight rates: ${error.message}`);
  if (!data || data.length === 0) {
    return unavailable('no ocean freight rate stored for this method/destination', `looked for cost_rates.cost_category='ocean_freight' matching "${shippingMethod}" and "${destinationPortLabel}" - none entered yet (PLAN_TRACKER.md debt #35)`);
  }
  if (data.length > 1) {
    return unavailable('ambiguous ocean freight rate', `${data.length} stored rates match "${shippingMethod}" and "${destinationPortLabel}" - no freight is quoted rather than picking one (charter 5.1)`);
  }
  const row = data[0] as any;
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

// C2 remains blocked on collecting 10+ assessment notices. Explicitly "not yet calculable" - never zero, never estimated.
export function dutyComponent(): CostComponent {
  return unavailable('C2 duty calculator not yet built', 'blocked on collecting 10+ assessment notices (PLAN_TRACKER.md Phase C); the 51.47% formula exists but is uncalibrated for declared-CIF purposes');
}

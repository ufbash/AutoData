import { supabase } from './supabaseClient';
import type { SightingForMatching } from './yardMatchingService';
import { listAuctionHouses, getAccount, getDefaultAccount } from './auctionAccountsService';
import type { AuctionAccount, PaymentTier } from './auctionAccountsService';
import {
  classifyTitleStatus as sharedClassifyTitleStatus, resolveSchedule as sharedResolveSchedule, auctionFeeComponent as sharedAuctionFeeComponent,
  inlandTruckingComponent as sharedInlandTruckingComponent, oceanFreightComponent as sharedOceanFreightComponent, dutyComponent as sharedDutyComponent,
} from '../../supabase/functions/_shared/costComponents.ts';
import type { AuctionFeeInput, InlandTruckingInput, Resolved, ResolveArgs } from '../../supabase/functions/_shared/costComponents.ts';
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

// PROMPT 38 (debt #79) - the cost logic (title classification, effective platform, schedule resolution, the auction-fee,
// trucking, freight and duty components and their database reads) moved to supabase/functions/_shared/costComponents.ts
// and costReads.ts, taking the database client as an argument. The billing Edge Function recomputes computed invoice lines
// from those same functions; this module keeps every export it always had and binds them to the browser's supabase client.
export const classifyTitleStatus = sharedClassifyTitleStatus;
export type { FeeBracketRow };
export { feeForBracket, findBracket };
export type { AuctionFeeInput, InlandTruckingInput, Resolved, ResolveArgs };

const resolveSchedule = (args: ResolveArgs): Promise<Resolved> => sharedResolveSchedule(supabase, args);
export const getAuctionFeeComponent = (input: AuctionFeeInput): Promise<CostComponent> => sharedAuctionFeeComponent(supabase, input);
export const getInlandTruckingComponent = (input: InlandTruckingInput): Promise<CostComponent> => sharedInlandTruckingComponent(supabase, input);
export const getOceanFreightComponent = (orgId: string, shippingMethod: 'container' | 'roro' | null, destinationPortLabel: string | null): Promise<CostComponent> =>
  sharedOceanFreightComponent(supabase, orgId, shippingMethod, destinationPortLabel);
export const getDutyComponent = sharedDutyComponent;

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

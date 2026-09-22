import { getAuctionFeeComponent, getInlandTruckingComponent, getOceanFreightComponent, getDutyComponent } from './bidHeadroomService';
import type { CostComponent } from './bidHeadroomService';
import type { WonVehicle, WonVehicleContext, WinningBid, WonVehicleDestination } from './wonVehicleService';
import type { EditorLine } from './billingService';
import { listCurrentActuals, ActualComponent } from './actualCostsService';

// PROMPT 40 Stage 2 - which components genuinely compute, for the editor's "add a computed line" offer. Mirrors
// the reasoning the deleted Phase 2 prefill used (never invent a figure; abstain visibly), rewired onto the
// current engine's line shape. ONLY a component that computes for real, with a traceable source, is offered as a
// computed line - the server (billing/index.ts) recomputes and refuses on any disagreement regardless, so this
// is a convenience for staff, never a trust boundary.
//
// PROMPT 41 Stage 2/3 - a recorded actual now wins over the estimate here too: offered first, ahead of the
// computed figure, as an 'actual' state - document-backed when the actual carries an uploaded bill, staff-entered
// with a note otherwise. The estimate is never lost; computeOffers simply doesn't reach it once an actual exists.
export interface PrefillOffer {
  component: 'vehicle_price' | 'auction_fees' | 'inland_trucking' | 'ocean_freight' | 'duty' | 'service_fee';
  label: string;
  state: 'computed' | 'actual' | 'needs_figure';
  amountUsd: number | null;
  description: string;
  reason: string | null;
  sourceRef: string | null;
  evidenceDocumentId?: string | null;
}

const fromComponent = (component: PrefillOffer['component'], label: string, c: CostComponent | null, describe: string, exactOnly: { ok: boolean; why: string } = { ok: true, why: '' }): PrefillOffer => {
  if (!c || c.status !== 'available' || c.amountUsd === null) return { component, label, state: 'needs_figure', amountUsd: null, description: describe, reason: c?.reason ?? 'not calculated', sourceRef: null };
  if (c.partialReason) return { component, label, state: 'needs_figure', amountUsd: null, description: describe, reason: `partial: ${c.partialReason}`, sourceRef: null };
  if (!exactOnly.ok) return { component, label, state: 'needs_figure', amountUsd: null, description: describe, reason: exactOnly.why, sourceRef: null };
  const ref = c.sourceRows.map(r => `${r.label} (${r.source}, effective ${r.effectiveFrom})`).join('; ');
  if (!ref) return { component, label, state: 'needs_figure', amountUsd: null, description: describe, reason: 'the figure has no traceable source', sourceRef: null };
  return { component, label, state: 'computed', amountUsd: c.amountUsd, description: describe, reason: null, sourceRef: ref };
};

export const computeOffers = async (
  wonVehicle: WonVehicle, context: WonVehicleContext, winningBid: WinningBid | null, destination: WonVehicleDestination | null,
): Promise<PrefillOffer[]> => {
  const sighting = context.sighting;
  const sightingForCosts = sighting ? { id: sighting.id, source_platform: sighting.source_platform, source_auction_platform: sighting.source_auction_platform, location: sighting.location } : null;
  const offers: PrefillOffer[] = [];

  const actuals = await listCurrentActuals(wonVehicle.id).catch(() => []);
  const actualFor = (c: ActualComponent) => actuals.find(a => a.component === c) ?? null;
  const actualOffer = (component: PrefillOffer['component'], label: string, actualComponent: ActualComponent, describe: string): PrefillOffer | null => {
    const a = actualFor(actualComponent);
    if (!a || a.currency !== 'usd') return null; // a non-USD actual needs its own FX handling in the editor, not silently converted here
    return { component, label, state: 'actual', amountUsd: a.amount, description: describe, reason: null, sourceRef: a.note || 'staff-recorded actual', evidenceDocumentId: a.evidence_document_id };
  };

  offers.push(winningBid
    ? { component: 'vehicle_price', label: 'Vehicle price', state: 'computed', amountUsd: Number(winningBid.amount_usd), description: 'Vehicle price (winning bid)', reason: null, sourceRef: winningBid.id }
    : { component: 'vehicle_price', label: 'Vehicle price', state: 'needs_figure', amountUsd: null, description: 'Vehicle price (winning bid)', reason: 'no winning bid has been recorded', sourceRef: null });

  if (!sightingForCosts) {
    for (const [c, ac, l] of [['auction_fees', 'auction_fees', 'Auction fees'], ['inland_trucking', 'inland_trucking', 'Inland trucking'], ['ocean_freight', 'ocean_freight', 'Ocean freight']] as const) {
      offers.push(actualOffer(c, l, ac, l) ?? { component: c, label: l, state: 'needs_figure', amountUsd: null, description: l, reason: 'the source listing capture is no longer available', sourceRef: null });
    }
  } else {
    const [fees, trucking, freight] = await Promise.all([
      winningBid ? getAuctionFeeComponent({ sighting: sightingForCosts, titleType: sighting!.title_type, referencePriceUsd: Number(winningBid.amount_usd), orgId: wonVehicle.org_id, bidMethod: winningBid.bid_method }) : Promise.resolve(null),
      getInlandTruckingComponent({ sighting: sightingForCosts, destinationPortNormalized: destination?.destination_port ?? null, shippingMethod: destination?.shipping_method ?? null, orgId: wonVehicle.org_id }),
      getOceanFreightComponent(wonVehicle.org_id, destination?.shipping_method ?? null, destination?.destination_port ?? null),
    ]);
    offers.push(actualOffer('auction_fees', 'Auction fees', 'auction_fees', 'Auction fees (actual)') ?? fromComponent('auction_fees', 'Auction fees', fees, 'Auction fees (at the recorded winning bid)',
      { ok: !!winningBid && !!winningBid.bid_method, why: !winningBid ? 'no winning bid recorded to price the fee at' : 'the bid method (proxy or live) is not recorded, so the fee is a range, not a figure' }));
    offers.push(actualOffer('inland_trucking', 'Inland trucking', 'inland_trucking', 'Inland trucking (actual)') ?? fromComponent('inland_trucking', 'Inland trucking', trucking, destination ? `US inland transport to ${destination.destination_port} (${destination.shipping_method === 'roro' ? 'RoRo' : 'container'})` : 'US inland transport'));
    const freightIsRange = !!freight && freight.status === 'available' && /Midpoint of/.test(freight.detail);
    offers.push(actualOffer('ocean_freight', 'Ocean freight', 'ocean_freight', 'Ocean freight (actual)') ?? fromComponent('ocean_freight', 'Ocean freight', freight, destination ? `Ocean freight to ${destination.destination_port}` : 'Ocean freight', { ok: !freightIsRange, why: 'the stored rate is a range, not one figure' }));
  }
  offers.push(actualOffer('duty', 'Import duty', 'duty', 'Import duty (actual)') ?? fromComponent('duty', 'Import duty', getDutyComponent(), 'Import duty'));
  return offers;
};

export const offerToLine = (o: PrefillOffer, position: number, taxCode: string | null = null): EditorLine | null => {
  if (o.amountUsd === null) return null;
  if (o.state === 'actual') {
    return o.evidenceDocumentId
      ? { position, section: 'Vehicle Purchase', description: o.description, quantity: 1, rate: o.amountUsd, discountType: 'none', discountValue: 0, taxCode, clientVisible: true, origin: 'document_backed', sourceDocumentId: o.evidenceDocumentId, component: o.component }
      : { position, section: 'Vehicle Purchase', description: o.description, quantity: 1, rate: o.amountUsd, discountType: 'none', discountValue: 0, taxCode, clientVisible: true, origin: 'staff_entered', basis: o.sourceRef ?? 'staff-recorded actual cost', component: o.component };
  }
  if (o.state !== 'computed') return null;
  return {
    position, section: 'Vehicle Purchase', description: o.description, quantity: 1, rate: o.amountUsd,
    discountType: 'none', discountValue: 0, taxCode, clientVisible: true, origin: 'computed', component: o.component,
  };
};

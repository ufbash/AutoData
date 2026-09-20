import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  CostComponent, DEFAULT_MEMBER_ACCOUNT,
  getAuctionFeeComponent, getInlandTruckingComponent, getOceanFreightComponent, getDutyComponent,
} from '../services/bidHeadroomService';
import { matchSightingToYard, MatchResult } from '../services/yardMatchingService';
import { listPortsForYard, listActiveYardKeys, PortSummary } from '../services/truckingRatesService';
import { getPaymentTier, PaymentTier, DEFAULT_PAYMENT_TIER } from '../services/orgSettingsService';
import type { WonVehicle, WonVehicleContext, WonVehicleDestination } from '../services/wonVehicleService';
import WonVehicleDestinationPanel from './WonVehicleDestination';

// PROMPT 35 Stage 1 - per-component cost view for a bought car. Every figure comes from the
// shared bidHeadroomService functions the run breakdown already uses; this file owns no fee
// arithmetic. No landed-cost total is rendered unless EVERY component is available - a total
// that silently omits duty would look complete (PROJECT_CHARTER.md S5.1).

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const Row: React.FC<{ label: string; component: CostComponent; note?: string }> = ({ label, component, note }) => (
  <div className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0 gap-4">
    <div>
      <div className="text-xs font-bold text-gray-600">{label}</div>
      {note && <div className="text-[10px] text-gray-400">{note}</div>}
    </div>
    {component.status === 'available' ? (
      <div className="text-right">
        <div className="text-sm font-bold text-[#403f4c]">{money(component.amountUsd!)}{component.partialReason && <span className="ml-2 text-[10px] font-bold text-amber-600 uppercase">Partial</span>}</div>
        {component.partialReason && <div className="text-[10px] text-amber-700 max-w-xs" data-testid="partial-reason">{component.partialReason}</div>}
        <div className="text-[10px] text-gray-400 max-w-xs">{component.detail}</div>
        {component.sourceRows.map((s, i) => (
          <div key={i} className="text-[10px] text-gray-400 max-w-xs">{s.label} — {s.source}, eff. {s.effectiveFrom}</div>
        ))}
      </div>
    ) : (
      <div className="text-right">
        <div className="text-xs font-bold text-amber-600 uppercase tracking-wide">Not calculable</div>
        <div className="text-[10px] text-gray-500 max-w-xs">{component.reason}</div>
        {component.detail && <div className="text-[10px] text-gray-400 max-w-xs">{component.detail}</div>}
      </div>
    )}
  </div>
);

const WonVehicleCosts: React.FC<{ wonVehicle: WonVehicle; context: WonVehicleContext; winningBidUsd: number | null; winningBidMethod: 'proxy' | 'live' | null; winningBidKey: string; destination: WonVehicleDestination | null; destinations: WonVehicleDestination[]; onDestinationChanged: () => void }> = ({ wonVehicle, context, winningBidUsd, winningBidMethod, winningBidKey, destination, destinations, onDestinationChanged }) => {
  const snapshot = wonVehicle.won_snapshot as any;
  const sighting = context.sighting;
  const [tier, setTier] = useState<PaymentTier>(DEFAULT_PAYMENT_TIER);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [ports, setPorts] = useState<PortSummary[]>([]);
  const [fees, setFees] = useState<CostComponent | null>(null);
  const [trucking, setTrucking] = useState<CostComponent | null>(null);
  const [shipping, setShipping] = useState<CostComponent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Ports THIS yard can quote - only an annotation on the destination options; the destination itself is the saved one.
  const quotedFromYard = new Set(ports.map(p => `${p.destination_port_normalized}|${p.shipping_method}`));

  const sightingForCosts = sighting ? {
    id: sighting.id,
    source_platform: sighting.source_platform,
    source_auction_platform: sighting.source_auction_platform,
    location: sighting.location,
  } : null;

  // Price basis: the FROZEN approved price. Non-USD prices are not converted here - the snapshot
  // does not carry a frozen USD figure for them, and re-deriving one from today's FX rate would
  // undo the freeze.
  // Debt #60: once staff have recorded the real winning bid, fees are computed at THAT; until then
  // at the frozen approved price, and the label says which.
  const approvedPriceUsd: number | null = snapshot?.listed_currency === 'USD' && typeof snapshot?.display_price === 'number' ? snapshot.display_price : null;
  const priceUsd: number | null = winningBidUsd ?? approvedPriceUsd;
  const priceUnavailableDetail = snapshot?.listed_currency && snapshot.listed_currency !== 'USD'
    ? `approved price is in ${snapshot.listed_currency}; the snapshot holds no frozen USD figure, so none is derived from today's rate`
    : 'the frozen snapshot holds no approved price';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const t = await getPaymentTier(wonVehicle.org_id);
        if (cancelled) return;
        setTier(t);
        if (!sightingForCosts) {
          setMatch(null);
          return;
        }
        // Complete, paginated yard list (debt #68) - a bare select returns only the first 1,000 rows.
        const yards = await listActiveYardKeys(wonVehicle.org_id);
        const m = matchSightingToYard(sightingForCosts, yards);
        if (cancelled) return;
        setMatch(m);
        if (m.status === 'matched' && m.matchedYard) {
          const p = await listPortsForYard(wonVehicle.org_id, m.effectivePlatform!, m.matchedYard.yard_state, m.matchedYard.yard_city);
          if (!cancelled) setPorts(p);
        } else {
          setPorts([]);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load cost inputs.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wonVehicle.id, sighting?.id]);

  useEffect(() => {
    if (loading || !sightingForCosts) return;
    let cancelled = false;
    (async () => {
      try {
        const [f, tr, sh] = await Promise.all([
          getAuctionFeeComponent({
            sighting: sightingForCosts, titleType: sighting!.title_type, referencePriceUsd: priceUsd,
            referencePriceUnavailableDetail: priceUnavailableDetail, orgId: wonVehicle.org_id, paymentTier: tier,
            // Only meaningful with a recorded winning bid; the approved-price fallback stays a range.
            bidMethod: winningBidUsd !== null ? winningBidMethod : null,
          }),
          getInlandTruckingComponent({
            sighting: sightingForCosts, destinationPortNormalized: destination?.destination_port ?? null,
            shippingMethod: destination?.shipping_method ?? null, orgId: wonVehicle.org_id,
          }),
          getOceanFreightComponent(wonVehicle.org_id, destination?.shipping_method ?? null, destination?.destination_port ?? null),
        ]);
        if (cancelled) return;
        setFees(f); setTrucking(tr); setShipping(sh);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to compute costs.');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tier, destination?.id, wonVehicle.id, winningBidKey]);

  if (!sighting) {
    return <div className="text-xs text-gray-500">The source listing's capture is no longer available, so cost inputs (yard, title, platform) cannot be resolved.</div>;
  }
  if (loading) return <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;

  const duty = getDutyComponent();
  const components: { name: string; c: CostComponent | null }[] = [
    { name: 'Auction fees', c: fees }, { name: 'Trucking', c: trucking }, { name: 'Shipping', c: shipping }, { name: 'Duty', c: duty },
  ];
  const missing = components.filter(x => !x.c || x.c.status !== 'available' || !!x.c.partialReason);
  const landed = missing.length === 0 ? components.reduce((sum, x) => sum + x.c!.amountUsd!, 0) : null;

  return (
    <div>
      {error && <div className="text-xs text-[#ba3b46] mb-2">{error}</div>}

      <div className="text-[10px] text-gray-500 mb-2 bg-gray-50 rounded p-2">
        Fees priced under <strong>{DEFAULT_MEMBER_ACCOUNT}</strong>, <strong>{tier === 'secured' ? 'Secured' : 'Unsecured'}</strong> schedule
        (org setting), {winningBidUsd !== null
          ? <>at the <strong>recorded winning bid</strong> of {money(winningBidUsd)}</>
          : <>at the <strong>approved price</strong>{priceUsd !== null ? ` of ${money(priceUsd)}` : ''} — no winning bid has been recorded yet</>}.
        Yard, title and platform are read from the captured listing as it stands now.
      </div>

      <Row label="Auction fees" component={fees ?? { status: 'unavailable', amountUsd: null, reason: 'computing…', detail: '', sourceRows: [] }} />

      {match && (
        <div className="text-[10px] text-gray-500 py-1">
          Yard match: <strong>{match.status}</strong> — {match.reason}
        </div>
      )}
      <WonVehicleDestinationPanel wonVehicle={wonVehicle} destinations={destinations} quotedFromYard={quotedFromYard} onChanged={onDestinationChanged} />

      <Row label="Trucking" component={trucking ?? { status: 'unavailable', amountUsd: null, reason: 'computing…', detail: '', sourceRows: [] }} />
      <Row label="Shipping" component={shipping ?? { status: 'unavailable', amountUsd: null, reason: 'computing…', detail: '', sourceRows: [] }} />
      <Row label="Duty" component={duty} />

      <div className="mt-3 p-3 rounded-lg border border-gray-200 bg-gray-50" data-testid="landed-cost">
        {landed !== null ? (
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold text-gray-700">Landed cost</span>
            <span className="text-lg font-bold text-[#403f4c]">{money(landed)}</span>
          </div>
        ) : (
          <div>
            <div className="text-sm font-bold text-gray-700">Landed cost: not calculable</div>
            <div className="text-[11px] text-gray-500 mt-1">
              No total is shown until every component is real. Missing: {missing.map(m => m.name).join(', ')}.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WonVehicleCosts;

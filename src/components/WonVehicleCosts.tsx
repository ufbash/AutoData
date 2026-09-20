import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import {
  CostComponent, DEFAULT_MEMBER_ACCOUNT,
  getAuctionFeeComponent, getInlandTruckingComponent, getOceanFreightComponent, getDutyComponent,
} from '../services/bidHeadroomService';
import { matchSightingToYard, MatchResult, YardKey } from '../services/yardMatchingService';
import { listPortsForYard, PortSummary } from '../services/truckingRatesService';
import { getPaymentTier, PaymentTier, DEFAULT_PAYMENT_TIER } from '../services/orgSettingsService';
import type { WonVehicle, WonVehicleContext } from '../services/wonVehicleService';

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

const WonVehicleCosts: React.FC<{ wonVehicle: WonVehicle; context: WonVehicleContext }> = ({ wonVehicle, context }) => {
  const snapshot = wonVehicle.won_snapshot as any;
  const sighting = context.sighting;
  const [tier, setTier] = useState<PaymentTier>(DEFAULT_PAYMENT_TIER);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [ports, setPorts] = useState<PortSummary[]>([]);
  const [portKey, setPortKey] = useState('');
  const [fees, setFees] = useState<CostComponent | null>(null);
  const [trucking, setTrucking] = useState<CostComponent | null>(null);
  const [shipping, setShipping] = useState<CostComponent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedPort = ports.find(p => `${p.destination_port_normalized}|${p.shipping_method}` === portKey) || null;

  const sightingForCosts = sighting ? {
    id: sighting.id,
    source_platform: sighting.source_platform,
    source_auction_platform: sighting.source_auction_platform,
    location: sighting.location,
  } : null;

  // Price basis: the FROZEN approved price. Non-USD prices are not converted here - the snapshot
  // does not carry a frozen USD figure for them, and re-deriving one from today's FX rate would
  // undo the freeze.
  const priceUsd: number | null = snapshot?.listed_currency === 'USD' && typeof snapshot?.display_price === 'number' ? snapshot.display_price : null;
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
        const { data: yards } = await supabase
          .from('trucking_rates')
          .select('auction_platform, yard_state, yard_city, yard_street')
          .eq('org_id', wonVehicle.org_id)
          .is('effective_to', null);
        const m = matchSightingToYard(sightingForCosts, (yards || []) as YardKey[]);
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
          }),
          getInlandTruckingComponent({
            sighting: sightingForCosts, destinationPortNormalized: selectedPort?.destination_port_normalized ?? null,
            shippingMethod: selectedPort?.shipping_method ?? null, orgId: wonVehicle.org_id,
          }),
          getOceanFreightComponent(wonVehicle.org_id, selectedPort?.shipping_method ?? null, selectedPort?.destination_port_normalized ?? null),
        ]);
        if (cancelled) return;
        setFees(f); setTrucking(tr); setShipping(sh);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to compute costs.');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tier, portKey, wonVehicle.id]);

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
        (org setting), at the <strong>approved price</strong>{priceUsd !== null ? ` of ${money(priceUsd)}` : ''} — the final winning bid is not recorded.
        Yard, title and platform are read from the captured listing as it stands now.
      </div>

      <Row label="Auction fees" component={fees ?? { status: 'unavailable', amountUsd: null, reason: 'computing…', detail: '', sourceRows: [] }} />

      <div className="py-2 border-b border-gray-100">
        <div className="text-xs font-bold text-gray-600 mb-1">Destination (needed for trucking and shipping)</div>
        {match && (
          <div className="text-[10px] text-gray-500 mb-1">
            Yard match: <strong>{match.status}</strong> — {match.reason}
          </div>
        )}
        {ports.length > 0 ? (
          <select value={portKey} onChange={e => setPortKey(e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1">
            <option value="">Choose destination port / method…</option>
            {ports.map(p => {
              const k = `${p.destination_port_normalized}|${p.shipping_method}`;
              return <option key={k} value={k}>{p.destination_port_normalized} ({p.shipping_method})</option>;
            })}
          </select>
        ) : (
          <div className="text-[10px] text-gray-400">No quotable ports for this yard.</div>
        )}
        <div className="text-[10px] text-gray-400 mt-1">The destination is not stored on the won vehicle yet, so this choice is not saved.</div>
      </div>

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

import React, { useState, useEffect } from 'react';
import { RunListing } from '../services/researchService';
import { listPortsForYard, PortSummary } from '../services/truckingRatesService';
import { computeBidHeadroom, getFeeBracketBoundaries, BidHeadroomResult, CostComponent, FeeBoundaries } from '../services/bidHeadroomService';
import { Loader2, Info } from 'lucide-react';

// PROMPT 21 Phase 4, revised PROMPT 26 - the cost breakdown per listing. Collapsed by default
// so staff aren't forced to scroll past a cost table to curate a run. Landed cost and headroom
// are visually and textually distinct from the sold-comps average - this never touches that
// calculation (PROJECT_CHARTER.md S5.6), it only ever reads from research_run_listings/
// sightings and the rate tables.
//
// PROMPT 26 - no longer reference-price-based for an active listing. There is no correct
// single price for a car that hasn't sold, so auction fees are computed as a function of a
// staff-entered candidate bid, never current_bid_usd on its own. A finished, sale_confirmed
// listing uses the actual confirmed sale price (price_usd) - a real fact, not a guess.

interface ListingCostBreakdownProps {
  orgId: string;
  listing: RunListing;
  maxBudgetUsd: number | null | undefined;
}

const ComponentRow: React.FC<{ label: string; component: CostComponent }> = ({ label, component }) => (
  <div className="flex items-start justify-between py-1.5 border-b border-gray-100 last:border-0 gap-4">
    <span className="text-xs font-medium text-gray-500 whitespace-nowrap">{label}</span>
    {component.status === 'available' ? (
      <div className="text-right">
        <div className="text-sm font-bold text-[#403f4c]">${component.amountUsd!.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
        <div className="text-[10px] text-gray-400 max-w-xs">{component.detail}</div>
        {component.sourceRows.length > 0 && (
          <div className="text-[10px] text-gray-400 max-w-xs">
            {component.sourceRows.map((s, i) => (
              <div key={i}>{s.label} — {s.source}, eff. {s.effectiveFrom}</div>
            ))}
          </div>
        )}
      </div>
    ) : (
      <div className="text-right">
        <div className="text-xs font-bold text-amber-600 uppercase tracking-wide">Not quotable</div>
        <div className="text-[10px] text-gray-400 max-w-xs">{component.reason}</div>
      </div>
    )}
  </div>
);

const BoundaryRow: React.FC<{ label: string; boundary: FeeBoundaries['buyerFee'] }> = ({ label, boundary }) => (
  <div className="flex items-start justify-between py-1 text-[10px] text-gray-500 gap-4">
    <span className="whitespace-nowrap">{label}</span>
    <div className="text-right">
      <div>
        ${boundary.current.min.toLocaleString()}{boundary.current.max !== null ? `–$${boundary.current.max.toLocaleString()}` : '+'} → {boundary.current.feeLabel}
      </div>
      {boundary.next && (
        <div className="text-gray-400">
          next: ${boundary.next.min.toLocaleString()}{boundary.next.max !== null ? `–$${boundary.next.max.toLocaleString()}` : '+'} → {boundary.next.feeLabel}
        </div>
      )}
    </div>
  </div>
);

const ListingCostBreakdown: React.FC<ListingCostBreakdownProps> = ({ orgId, listing, maxBudgetUsd }) => {
  const [ports, setPorts] = useState<PortSummary[]>([]);
  const [selectedPort, setSelectedPort] = useState<PortSummary | null>(null);
  const [result, setResult] = useState<BidHeadroomResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boundaries, setBoundaries] = useState<FeeBoundaries | null>(null);

  const isFinished = listing.lot_state === 'finished';
  const isConfirmedSale = isFinished && listing.sale_confirmed === true;
  // PROMPT 24 Phase 1 asymmetry, PROMPT 26 §Phase 3 - Copart/IAAI have no confirmation
  // mechanism at all (sale_confirmed is only ever written by bid.cars' own content script), so
  // null there means "unconfirmable by platform," not "suspicious." Same abstention rendering
  // either way for now - distinct labelling deferred, not built (docs/SOLVED.md topic 23).
  const isUnconfirmablePlatform = listing.source_platform === 'copart' || listing.source_platform === 'iaai';

  // Candidate bid - staff-entered, prefilled from current_bid_usd as a convenience only.
  // Prefilling is fine; the fee is computed from whatever THIS field currently holds, which
  // stays fully editable - current_bid_usd never re-derives a fee on its own after this.
  const [candidateBidInput, setCandidateBidInput] = useState<string>(
    !isFinished && listing.current_bid_usd != null ? String(listing.current_bid_usd) : ''
  );
  const candidateBidUsd = (() => {
    const n = parseFloat(candidateBidInput);
    return candidateBidInput.trim() !== '' && !isNaN(n) ? n : null;
  })();

  const sighting = {
    id: listing.sighting_id,
    source_platform: listing.source_platform,
    source_auction_platform: listing.source_auction_platform,
    location: listing.location,
  };

  // The price basis for the fee calculation - never a guess. A confirmed sale price for a
  // finished listing, a staff-entered candidate for an active one, or nothing at all when
  // neither exists (an explicit abstention, not a fallback to current_bid_usd).
  let priceUsd: number | null = null;
  let priceUnavailableDetail = 'no confirmed sale price and no candidate bid entered';
  if (isConfirmedSale) {
    priceUsd = listing.price_usd;
  } else if (isFinished) {
    priceUnavailableDetail = isUnconfirmablePlatform
      ? `sale confirmation is not available on ${listing.source_platform} - it exposes no sales-history mechanism to confirm whether this lot actually sold`
      : 'this platform marked the final bid as not a confirmed sale, or its status could not be determined - a fee based on an unconfirmed price would defeat the reason sale_confirmed exists';
  } else {
    priceUsd = candidateBidUsd;
    priceUnavailableDetail = 'enter a candidate bid above to see the fee at that price';
  }

  // Discover which destination ports are even quotable for this listing's yard, once, on
  // mount - the port/method picker only ever offers real options, never a free-text guess.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Reuse the yard search only to discover ports for THIS listing's own yard - the
        // matcher itself (inside computeBidHeadroom) is what actually enforces platform-first,
        // exact-match rules. This is just populating a picker.
        const { matchSightingToYard } = await import('../services/yardMatchingService');
        const { data: yardRows } = await (await import('../services/supabaseClient')).supabase
          .from('trucking_rates')
          .select('auction_platform, yard_state, yard_city, yard_street')
          .eq('org_id', orgId)
          .is('effective_to', null);
        const match = matchSightingToYard(sighting, yardRows || []);
        if (cancelled) return;
        if (match.status === 'matched' && match.matchedYard) {
          const p = await listPortsForYard(orgId, match.effectivePlatform!, match.matchedYard.yard_state, match.matchedYard.yard_city);
          if (cancelled) return;
          setPorts(p);
          setSelectedPort(prev => prev || p[0] || null);
        } else {
          setPorts([]);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load ports.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, listing.sighting_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await computeBidHeadroom({
          orgId,
          sighting,
          titleType: listing.title_type,
          referencePriceUsd: priceUsd,
          referencePriceUnavailableDetail: priceUnavailableDetail,
          destinationPortNormalized: selectedPort?.destination_port_normalized ?? null,
          destinationPortLabel: selectedPort?.destination_port_normalized ?? null,
          shippingMethod: selectedPort?.shipping_method ?? null,
          targetLandedCostUsd: maxBudgetUsd ?? null,
          isFinishedLot: isFinished,
        });
        if (!cancelled) setResult(r);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to compute cost breakdown.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, listing.sighting_id, selectedPort, maxBudgetUsd, priceUsd, isFinished]);

  // Mode B's bracket-boundary display - only ever fetched for a real price basis (a candidate
  // bid or a confirmed sale price), never a guess.
  useEffect(() => {
    let cancelled = false;
    if (priceUsd === null || result?.maxBidSolve?.status === 'available') {
      setBoundaries(null);
      return;
    }
    (async () => {
      try {
        const b = await getFeeBracketBoundaries(orgId, sighting, listing.title_type, priceUsd!);
        if (!cancelled) setBoundaries(b);
      } catch {
        if (!cancelled) setBoundaries(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, listing.sighting_id, priceUsd, result?.maxBidSolve?.status]);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mt-2" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Landed Cost &amp; Bid Headroom (internal only — never shown to clients)</h4>
        {ports.length > 0 && (
          <select
            value={selectedPort ? `${selectedPort.destination_port_normalized}|${selectedPort.shipping_method}` : ''}
            onChange={e => {
              const [port, method] = e.target.value.split('|');
              setSelectedPort(ports.find(p => p.destination_port_normalized === port && p.shipping_method === method) || null);
            }}
            className="text-xs border border-gray-300 rounded px-2 py-1"
          >
            {ports.map((p, i) => (
              <option key={i} value={`${p.destination_port_normalized}|${p.shipping_method}`}>
                {p.destination_port_normalized} ({p.shipping_method})
              </option>
            ))}
          </select>
        )}
      </div>

      {!isFinished && (
        <div className="mb-3 flex items-center gap-3">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">
            Candidate bid
          </label>
          <input
            type="number"
            value={candidateBidInput}
            onChange={e => setCandidateBidInput(e.target.value)}
            placeholder="Enter a bid to price"
            className="text-sm border border-gray-300 rounded px-2 py-1 w-32"
          />
          {listing.current_bid_usd != null && (
            <span className="text-[10px] text-gray-400">Current bid: ${listing.current_bid_usd.toLocaleString()} (context only, not the fee basis)</span>
          )}
        </div>
      )}

      {isFinished && (
        <div className={`mb-3 text-[11px] font-medium rounded px-2 py-1.5 border ${isConfirmedSale ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          {isConfirmedSale
            ? `Confirmed sale price: $${listing.price_usd?.toLocaleString()} (fee computed against the actual price, not a guess)`
            : `Sale not confirmed — ${priceUnavailableDetail}`}
        </div>
      )}

      {!loading && result?.pricedUnder && (
        <div className="mb-3 text-[11px] font-bold text-[#403f4c] bg-[#a58039]/10 border border-[#a58039]/30 rounded px-2 py-1.5">
          Priced under: {result.pricedUnder.memberAccount} — {result.pricedUnder.titleStatus}, {result.pricedUnder.paymentTier}
        </div>
      )}

      {loading && <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 text-[#a58039] animate-spin" /></div>}
      {error && <div className="text-xs text-red-600">{error}</div>}

      {!loading && result && (
        <div>
          <ComponentRow label="Auction fees" component={result.auctionFees} />
          <ComponentRow label="Inland trucking" component={result.inlandTrucking} />
          <ComponentRow label="Ocean freight" component={result.oceanFreight} />
          <ComponentRow label="Duty" component={result.duty} />

          {!isFinished && result.maxBidSolve?.status === 'available' && (
            <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
              <div className="font-bold text-green-800">Max bid against target: ${result.maxBidSolve.maxBidUsd!.toLocaleString()}</div>
              <div className="text-[10px] text-green-700">Fee at that bid: ${result.maxBidSolve.feeAtMaxBidUsd!.toLocaleString()}</div>
            </div>
          )}

          {!isFinished && result.maxBidSolve?.status === 'unavailable' && boundaries && (
            <div className="mt-2 p-2 bg-white border border-gray-200 rounded">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Bracket boundaries at this bid</div>
              <BoundaryRow label="Buyer fee" boundary={boundaries.buyerFee} />
              <BoundaryRow label="Bid fee (proxy/live mid)" boundary={boundaries.bidFee} />
            </div>
          )}

          <div className="mt-3 pt-3 border-t-2 border-[#a58039]/30">
            <div className="flex items-start justify-between gap-4">
              <span className="text-sm font-bold text-[#403f4c]">Bid Headroom</span>
              {result.headroom.status === 'available' ? (
                <div className="text-right">
                  <div className="text-lg font-bold text-green-700">${result.headroom.amountUsd!.toLocaleString()}</div>
                  <div className="text-[10px] text-gray-400">{result.headroom.detail}</div>
                </div>
              ) : (
                <div className="text-right">
                  <div className="text-xs font-bold text-amber-600 uppercase tracking-wide">Unavailable</div>
                  <div className="text-[10px] text-gray-400 max-w-xs">{result.headroom.reason}: {result.headroom.detail}</div>
                </div>
              )}
            </div>
            {!isFinished && result.targetLandedCostUsd == null && (
              <div className="flex items-start gap-1.5 mt-2 text-[10px] text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-1.5">
                <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
                No client budget stated on this brief (max_budget_usd) — headroom cannot be computed against a target that doesn't exist. This is informational only, never an enforced limit (DECISIONS.md 3.6).
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ListingCostBreakdown;

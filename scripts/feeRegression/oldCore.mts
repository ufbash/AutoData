// FROZEN COPY of the fee arithmetic in src/services/bidHeadroomService.ts as it stood at commit
// 478e8f2 (before Prompt 37 Phase 1). It exists only as a regression oracle: the refactored code must
// reproduce this file's output byte-for-byte on every real Copart schedule. Do not "improve" it and do
// not import it from the app.
export type ComponentStatus = 'available' | 'unavailable';
export type PaymentTier = 'secured' | 'unsecured';
export interface CostComponent {
  status: ComponentStatus; amountUsd: number | null; reason: string | null; partialReason?: string;
  detail: string; sourceRows: { label: string; source: string; effectiveFrom: string }[];
}

const unavailable = (reason: string, detail = ''): CostComponent => ({
  status: 'unavailable', amountUsd: null, reason, detail, sourceRows: [],
});

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

export interface AuctionFeeRows {
  buyerFeeRows: AuctionFeeBracketRow[];
  bidFeeProxyRows: AuctionFeeBracketRow[];
  bidFeeLiveRows: AuctionFeeBracketRow[];
  flatFees: { label: string; source: string; effective_from: string; rate_value: number }[];
  flatFeeTotal: number;
}

export function auctionFeeComponentFromRows(
  priceUsd: number,
  memberAccount: string,
  titleStatus: 'clean' | 'non_clean',
  rows: AuctionFeeRows,
  paymentTier: PaymentTier,
  bidMethod: 'proxy' | 'live' | null = null
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
  //
  // PROMPT 35 follow-up (debt #60): for a WON vehicle, staff can record how the winning bid was
  // placed. When bidMethod is given, only that method's bracket applies and the figure is exact,
  // not a range; when it is absent (every other caller, and a won vehicle with no method recorded)
  // this is unchanged.
  const methodKnown = bidMethod === 'proxy' || bidMethod === 'live';
  const knownBracket = bidMethod === 'proxy' ? proxyBracket : bidMethod === 'live' ? liveBracket : null;
  const bidFeeLow = methodKnown
    ? (knownBracket ? feeForBracket(knownBracket, priceUsd) : null)
    : (proxyBracket && liveBracket ? Math.min(feeForBracket(proxyBracket, priceUsd), feeForBracket(liveBracket, priceUsd)) : null);
  const bidFeeHigh = methodKnown
    ? bidFeeLow
    : (proxyBracket && liveBracket ? Math.max(feeForBracket(proxyBracket, priceUsd), feeForBracket(liveBracket, priceUsd)) : null);

  const buyerFeeAmount = feeForBracket(buyerBracket, priceUsd);
  const bidFeeMid = bidFeeLow !== null && bidFeeHigh !== null ? (bidFeeLow + bidFeeHigh) / 2 : 0;
  const total = buyerFeeAmount + bidFeeMid + rows.flatFeeTotal;

  const sourceRows = [
    { label: `Buyer fee (${memberAccount}, ${titleStatus}, ${paymentTier})`, source: buyerBracket.source, effectiveFrom: buyerBracket.effective_from },
    ...rows.flatFees.map(f => ({ label: f.label, source: f.source, effectiveFrom: f.effective_from })),
  ];
  if (proxyBracket && bidMethod !== 'live') sourceRows.push({ label: 'Bid fee (proxy)', source: proxyBracket.source, effectiveFrom: proxyBracket.effective_from });
  if (liveBracket && bidMethod !== 'proxy') sourceRows.push({ label: 'Bid fee (live)', source: liveBracket.source, effectiveFrom: liveBracket.effective_from });

  const bidFeeNote = bidFeeLow !== null && bidFeeHigh !== null
    ? (methodKnown
      ? `$${bidFeeLow.toFixed(2)} (${bidMethod} bid)`
      : (bidFeeLow === bidFeeHigh ? `$${bidFeeLow.toFixed(2)}` : `$${bidFeeLow.toFixed(2)}-$${bidFeeHigh.toFixed(2)} depending on bid method (not yet known)`))
    : 'not available';

  return {
    status: 'available',
    amountUsd: Math.round(total * 100) / 100,
    reason: null,
    partialReason: bidFeeLow === null ? 'no bid-fee schedule is stored for this title status / payment tier, so the bid fee is not included in this figure' : undefined,
    detail: `Buyer fee $${buyerFeeAmount.toFixed(2)} + bid fee ${bidFeeNote} + flat fees $${rows.flatFeeTotal.toFixed(2)} (Environmental/Gate/Title Pickup), at price $${priceUsd}`,
    sourceRows,
  };
}

export interface FeeBracketBoundary {
  min: number;
  max: number | null;
  feeLabel: string; // "$385" for a flat bracket, "12.5% of price" for the terminal percent one
}

export interface FeeBoundaries {
  buyerFee: { current: FeeBracketBoundary; next: FeeBracketBoundary | null };
  bidFee: { current: FeeBracketBoundary; next: FeeBracketBoundary | null }; // midpoint of proxy/live
}

export function boundaryPair(rows: AuctionFeeBracketRow[], price: number, feeAt: (p: number) => number): { current: FeeBracketBoundary; next: FeeBracketBoundary | null } | null {
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

export interface MaxBidSolveResult {
  status: ComponentStatus;
  maxBidUsd: number | null;
  feeAtMaxBidUsd: number | null;
  reason: string | null;
}

export function combinedFeeAt(bid: number, rows: AuctionFeeRows): number | null {
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
export function solveMaxBidForFees(targetAfterOtherCosts: number, rows: AuctionFeeRows): number | null {
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

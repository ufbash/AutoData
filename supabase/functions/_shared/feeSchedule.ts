// PROMPT 37 Phase 1 - the auction-fee arithmetic, extracted from bidHeadroomService.ts and made
// auction-house-neutral. Pure: no imports, no database, no house, no account. The caller (the service)
// asks the database which rows belong to a house's tier; everything here only does sums over rows.
//
// Regression: for every real Copart schedule this must reproduce the pre-Phase-1 arithmetic byte for byte -
// scripts/feeRegression/ diffs it against a frozen copy of the old code over every bracket boundary.

export type ComponentStatus = 'available' | 'unavailable';

export interface FeeBasis {
  houseName: string;
  feeTier: string;
  holder: string | null;
  memberNumber: string | null;
  titleStatus: string;
  paymentTier: string;
}

export interface CostComponent {
  status: ComponentStatus;
  amountUsd: number | null;
  reason: string | null; // populated only when unavailable
  // Set when the component is 'available' but a sub-part has no stored schedule and was left out of
  // amountUsd. A partial figure must never feed a landed total as though it were complete.
  partialReason?: string;
  detail: string;
  sourceRows: { label: string; source: string; effectiveFrom: string }[];
  // Which account / tier / title / payment tier this figure rests on (or was attempted under).
  basis?: FeeBasis;
}

export const unavailable = (reason: string, detail = ''): CostComponent => ({
  status: 'unavailable', amountUsd: null, reason, detail, sourceRows: [],
});

export interface FeeBracketRow {
  fee_type: 'buyer_fee' | 'bid_fee';
  title_status: 'clean' | 'non_clean' | 'any';
  payment_tier: 'secured' | 'unsecured' | 'any';
  bid_method: 'proxy' | 'live' | null;
  bracket_min: number;
  bracket_max: number | null;
  fee_unit: 'usd' | 'percent';
  fee_value: number; // already in USD when fee_unit is 'usd' (see rateConventions.usdAmount)
  source: string;
  effective_from: string;
}

export interface FlatFee {
  label: string;
  fee_role: string;
  source: string;
  effective_from: string;
  rate_value: number; // USD
}

export interface ScheduleRows {
  buyerFeeRows: FeeBracketRow[];
  bidFeeProxyRows: FeeBracketRow[];
  bidFeeLiveRows: FeeBracketRow[];
  flatFees: FlatFee[];
  flatFeeTotal: number;
}

export function feeForBracket(row: FeeBracketRow, referencePrice: number): number {
  return row.fee_unit === 'percent' ? referencePrice * (row.fee_value / 100) : row.fee_value;
}

// First matching bracket, lowest bracket_min first. The order is explicit because several schedules share a
// boundary (a price of exactly 500 satisfies both 100-500 and 500-1000): the lower bracket wins, always.
export function findBracket(rows: FeeBracketRow[], referencePrice: number): FeeBracketRow | null {
  const ordered = [...rows].sort((a, b) => a.bracket_min - b.bracket_min);
  return ordered.find(r => referencePrice >= r.bracket_min && (r.bracket_max === null || referencePrice <= r.bracket_max)) || null;
}

// A schedule that does not vary by title or payment method is stored once with 'any'. For each group of
// rows (buyer fee, proxy bid fee, live bid fee) the MOST SPECIFIC matching partition wins; two different
// partitions tied for most specific is ambiguous and the caller must abstain rather than pick one.
export type SelectResult = { ok: true; rows: ScheduleRows } | { ok: false; reason: string };

export function selectSchedule(
  rows: FeeBracketRow[],
  titleStatus: 'clean' | 'non_clean' | 'unknown',
  paymentTier: 'secured' | 'unsecured' | null,
  flatFees: FlatFee[],
): SelectResult {
  const eligible = rows.filter(r =>
    (r.title_status === 'any' || r.title_status === titleStatus) &&
    (r.payment_tier === 'any' || (paymentTier !== null && r.payment_tier === paymentTier)));

  const pick = (group: FeeBracketRow[], label: string): { rows: FeeBracketRow[] } | { error: string } => {
    if (group.length === 0) return { rows: [] };
    const rank = (r: FeeBracketRow) => (r.title_status !== 'any' ? 1 : 0) + (r.payment_tier !== 'any' ? 1 : 0);
    const top = Math.max(...group.map(rank));
    const keys = new Set(group.filter(r => rank(r) === top).map(r => `${r.title_status}|${r.payment_tier}`));
    if (keys.size > 1) return { error: `${label}: more than one equally specific schedule matches (${[...keys].join(' and ')})` };
    return { rows: group.filter(r => rank(r) === top) };
  };

  const buyer = pick(eligible.filter(r => r.fee_type === 'buyer_fee'), 'buyer fee');
  const proxy = pick(eligible.filter(r => r.fee_type === 'bid_fee' && r.bid_method === 'proxy'), 'proxy bid fee');
  const live = pick(eligible.filter(r => r.fee_type === 'bid_fee' && r.bid_method === 'live'), 'live bid fee');
  for (const g of [buyer, proxy, live]) if ('error' in g) return { ok: false, reason: g.error };

  const sortedFlat = [...flatFees].sort((a, b) => a.fee_role.localeCompare(b.fee_role));
  return {
    ok: true,
    rows: {
      buyerFeeRows: (buyer as { rows: FeeBracketRow[] }).rows,
      bidFeeProxyRows: (proxy as { rows: FeeBracketRow[] }).rows,
      bidFeeLiveRows: (live as { rows: FeeBracketRow[] }).rows,
      flatFees: sortedFlat,
      flatFeeTotal: sortedFlat.reduce((sum, f) => sum + Number(f.rate_value), 0),
    },
  };
}

const roleWords = (role: string) => role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export function auctionFeeFromRows(
  priceUsd: number,
  basisLabel: string,
  titleStatus: string,
  rows: ScheduleRows,
  paymentTier: string,
  bidMethod: 'proxy' | 'live' | null = null,
): CostComponent {
  const buyerBracket = findBracket(rows.buyerFeeRows, priceUsd);
  if (!buyerBracket) {
    return unavailable('no buyer-fee bracket covers this price', `price $${priceUsd} against ${basisLabel}`);
  }

  const proxyBracket = findBracket(rows.bidFeeProxyRows, priceUsd);
  const liveBracket = findBracket(rows.bidFeeLiveRows, priceUsd);

  // Bid method (proxy vs. live) for a future bid is genuinely unknown ahead of time - shown as a range with
  // both real figures, never collapsed into one guessed number (PROJECT_CHARTER 5.1). For a WON vehicle,
  // staff record how the winning bid was placed; then only that method's bracket applies and the figure is exact.
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
    { label: `Buyer fee (${basisLabel}, ${titleStatus}, ${paymentTier})`, source: buyerBracket.source, effectiveFrom: buyerBracket.effective_from },
    ...rows.flatFees.map(f => ({ label: f.label, source: f.source, effectiveFrom: f.effective_from })),
  ];
  if (proxyBracket && bidMethod !== 'live') sourceRows.push({ label: 'Bid fee (proxy)', source: proxyBracket.source, effectiveFrom: proxyBracket.effective_from });
  if (liveBracket && bidMethod !== 'proxy') sourceRows.push({ label: 'Bid fee (live)', source: liveBracket.source, effectiveFrom: liveBracket.effective_from });

  const bidFeeNote = bidFeeLow !== null && bidFeeHigh !== null
    ? (methodKnown
      ? `$${bidFeeLow.toFixed(2)} (${bidMethod} bid)`
      : (bidFeeLow === bidFeeHigh ? `$${bidFeeLow.toFixed(2)}` : `$${bidFeeLow.toFixed(2)}-$${bidFeeHigh.toFixed(2)} depending on bid method (not yet known)`))
    : 'not available';

  const flatNames = rows.flatFees.map(f => roleWords(f.fee_role)).join('/');
  return {
    status: 'available',
    amountUsd: Math.round(total * 100) / 100,
    reason: null,
    partialReason: bidFeeLow === null ? 'no bid-fee schedule is stored for this title status / payment tier, so the bid fee is not included in this figure' : undefined,
    detail: `Buyer fee $${buyerFeeAmount.toFixed(2)} + bid fee ${bidFeeNote} + flat fees $${rows.flatFeeTotal.toFixed(2)} (${flatNames}), at price $${priceUsd}`,
    sourceRows,
  };
}

export interface FeeBracketBoundary {
  min: number;
  max: number | null;
  feeLabel: string;
}

export function boundaryPair(rows: FeeBracketRow[], price: number, feeAt: (p: number) => number): { current: FeeBracketBoundary; next: FeeBracketBoundary | null } | null {
  const sorted = [...rows].sort((a, b) => a.bracket_min - b.bracket_min);
  const idx = sorted.findIndex(r => price >= r.bracket_min && (r.bracket_max === null || price <= r.bracket_max));
  if (idx === -1) return null;
  const cur = sorted[idx];
  const nxt = idx + 1 < sorted.length ? sorted[idx + 1] : null;
  const label = (b: FeeBracketRow, feeVal: number) => (b.fee_unit === 'percent' ? `${b.fee_value}% of price` : `$${feeVal.toFixed(2)}`);
  return {
    current: { min: cur.bracket_min, max: cur.bracket_max, feeLabel: label(cur, feeAt(price)) },
    next: nxt ? { min: nxt.bracket_min, max: nxt.bracket_max, feeLabel: label(nxt, feeAt(nxt.bracket_min)) } : null,
  };
}

export function combinedFeeAt(bid: number, rows: ScheduleRows): number | null {
  const buyerBracket = findBracket(rows.buyerFeeRows, bid);
  if (!buyerBracket) return null;
  const proxyBracket = findBracket(rows.bidFeeProxyRows, bid);
  const liveBracket = findBracket(rows.bidFeeLiveRows, bid);
  const bidFeeMid = proxyBracket && liveBracket ? (feeForBracket(proxyBracket, bid) + feeForBracket(liveBracket, bid)) / 2 : 0;
  return feeForBracket(buyerBracket, bid) + bidFeeMid + rows.flatFeeTotal;
}

// True when the max-bid solver's assumptions hold for these rows. The solver treats the bid fee as constant
// inside each region and only the buyer fee may be a percent; a percent bid-fee bracket would be solved
// wrongly and silently, so the caller must abstain instead.
export function solverSupports(rows: ScheduleRows): boolean {
  return ![...rows.bidFeeProxyRows, ...rows.bidFeeLiveRows].some(r => r.fee_unit === 'percent');
}

// Solve for the maximum bid where bid + fees(bid) <= target (after the other cost components). Correct by
// construction wherever total fees are monotone in the bid: within any region bounded by two consecutive
// breakpoints from EITHER bracket set, the buyer-fee and bid-fee brackets are constant, so the equation is
// directly solvable.
export function solveMaxBidForFees(targetAfterOtherCosts: number, rows: ScheduleRows): number | null {
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

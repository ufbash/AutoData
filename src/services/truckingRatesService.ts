import { supabase } from './supabaseClient';

// PROMPT 20 Phase 4 - two reads over one ledger, never a second table.
// Deliberately not wired into research runs or the public share page yet - that is a
// separate decision (PLAN_TRACKER.md).

export interface TruckingRateRow {
  id: string;
  vendor: string;
  auction_platform: string;
  yard_state: string;
  yard_city: string;
  yard_street: string | null;
  destination_port_raw: string;
  destination_port_normalized: string;
  shipping_method: 'container' | 'roro';
  price: number;
  source: 'official_tariff' | 'agent_quote' | 'actual_paid';
  effective_from: string;
  effective_to: string | null;
}

export interface YardSummary {
  auction_platform: string;
  yard_state: string;
  yard_city: string;
}

export interface PortSummary {
  destination_port_raw: string;
  destination_port_normalized: string;
  shipping_method: 'container' | 'roro';
}

export const searchTruckingYards = async (orgId: string, query: string): Promise<YardSummary[]> => {
  let q = supabase
    .from('trucking_rates')
    .select('auction_platform, yard_state, yard_city')
    .eq('org_id', orgId);

  if (query.trim()) {
    q = q.or(`yard_city.ilike.%${query.trim()}%,yard_state.ilike.%${query.trim()}%`);
  }

  const { data, error } = await q.limit(2000);
  if (error) throw new Error(`Failed to search yards: ${error.message}`);

  const seen = new Map<string, YardSummary>();
  (data || []).forEach(row => {
    const key = `${row.auction_platform}|${row.yard_state}|${row.yard_city}`;
    if (!seen.has(key)) seen.set(key, row);
  });
  return Array.from(seen.values()).sort((a, b) =>
    a.auction_platform.localeCompare(b.auction_platform) ||
    a.yard_state.localeCompare(b.yard_state) ||
    a.yard_city.localeCompare(b.yard_city)
  ).slice(0, 50);
};

export const listPortsForYard = async (
  orgId: string,
  auctionPlatform: string,
  yardState: string,
  yardCity: string
): Promise<PortSummary[]> => {
  const { data, error } = await supabase
    .from('trucking_rates')
    .select('destination_port_raw, destination_port_normalized, shipping_method')
    .eq('org_id', orgId)
    .eq('auction_platform', auctionPlatform)
    .eq('yard_state', yardState)
    .eq('yard_city', yardCity);

  if (error) throw new Error(`Failed to list ports: ${error.message}`);

  const seen = new Map<string, PortSummary>();
  (data || []).forEach(row => {
    const key = `${row.destination_port_normalized}|${row.shipping_method}`;
    if (!seen.has(key)) seen.set(key, row as PortSummary);
  });
  return Array.from(seen.values()).sort((a, b) =>
    a.shipping_method.localeCompare(b.shipping_method) ||
    a.destination_port_normalized.localeCompare(b.destination_port_normalized)
  );
};

async function fetchRatesForCombination(
  orgId: string,
  auctionPlatform: string,
  yardState: string,
  yardCity: string,
  destinationPortNormalized: string,
  shippingMethod: 'container' | 'roro'
): Promise<TruckingRateRow[]> {
  const { data, error } = await supabase
    .from('trucking_rates')
    .select('*')
    .eq('org_id', orgId)
    .eq('auction_platform', auctionPlatform)
    .eq('yard_state', yardState)
    .eq('yard_city', yardCity)
    .eq('destination_port_normalized', destinationPortNormalized)
    .eq('shipping_method', shippingMethod);

  if (error) throw new Error(`Failed to fetch trucking rates: ${error.message}`);
  return data || [];
}

export interface InternalView {
  current: TruckingRateRow[]; // sorted cheapest first - "so staff can see who is cheapest"
  history: TruckingRateRow[]; // superseded, most recently closed first
}

// 4.1 Internal view: every vendor's price for this yard-port-method, current AND
// superseded (superseded rows stay visible as history, never hidden - Checkpoint 4).
export const getInternalView = async (
  orgId: string,
  auctionPlatform: string,
  yardState: string,
  yardCity: string,
  destinationPortNormalized: string,
  shippingMethod: 'container' | 'roro'
): Promise<InternalView> => {
  const rows = await fetchRatesForCombination(orgId, auctionPlatform, yardState, yardCity, destinationPortNormalized, shippingMethod);
  const current = rows.filter(r => !r.effective_to).sort((a, b) => a.price - b.price);
  const history = rows.filter(r => r.effective_to).sort((a, b) => (b.effective_to! < a.effective_to! ? -1 : 1));
  return { current, history };
};

export interface EstimatorView {
  sampleSize: number;
  minPrice: number | null;
  maxPrice: number | null;
  mostRecentEffectiveFrom: string | null;
  quotes: TruckingRateRow[]; // the currently-effective rows the aggregate is built from
}

// 4.2 Estimator view: an aggregate across vendors, honesty-doctrine shaped (PROJECT_CHARTER.md
// S5.1) - a band and the sample size, never a single confident figure. Only effective_to IS
// NULL rows count (Checkpoint 4: a superseded rate must not pull the aggregate). No AI, no
// invented figures (S5.4) - this is a min/max/count over real rows, nothing synthesised.
export const getEstimatorView = async (
  orgId: string,
  auctionPlatform: string,
  yardState: string,
  yardCity: string,
  destinationPortNormalized: string,
  shippingMethod: 'container' | 'roro'
): Promise<EstimatorView> => {
  const rows = await fetchRatesForCombination(orgId, auctionPlatform, yardState, yardCity, destinationPortNormalized, shippingMethod);
  const current = rows.filter(r => !r.effective_to);

  if (current.length === 0) {
    return { sampleSize: 0, minPrice: null, maxPrice: null, mostRecentEffectiveFrom: null, quotes: [] };
  }

  const prices = current.map(r => r.price);
  const mostRecentEffectiveFrom = current.reduce((latest, r) => (r.effective_from > latest ? r.effective_from : latest), current[0].effective_from);

  return {
    sampleSize: current.length,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    mostRecentEffectiveFrom,
    quotes: current,
  };
};

// Human-readable estimator string in the exact shape the prompt specifies, e.g.
// "Birmingham -> Savannah: $425-$500 across 3 quotes, most recent Nov 2025."
export const formatEstimatorSummary = (yardCity: string, portLabel: string, view: EstimatorView): string => {
  if (view.sampleSize === 0) return `${yardCity} -> ${portLabel}: no current quotes.`;
  const dateLabel = view.mostRecentEffectiveFrom
    ? new Date(view.mostRecentEffectiveFrom + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : 'unknown date';
  const priceLabel = view.minPrice === view.maxPrice
    ? `$${view.minPrice}`
    : `$${view.minPrice}-$${view.maxPrice}`;
  const quoteLabel = view.sampleSize === 1 ? '1 quote' : `${view.sampleSize} quotes`;
  return `${yardCity} -> ${portLabel}: ${priceLabel} across ${quoteLabel}, most recent ${dateLabel}.`;
};

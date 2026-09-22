// PROMPT 38 (debt #79) - the database reads the cost components need, shared by the browser and the billing Edge Function.
// Every function takes the database client as an argument (`db`): the browser passes its own supabase client, the Edge
// Function passes a service-role client. The filters, ORDER BYs and pagination live HERE, once, so the two sides cannot
// drift (a difference between what the browser shows and what the server recomputes would be the very bug #79 exists to
// prevent). Any read of "all rows" is paged and count-verified (debt #68: PostgREST caps a bare select at 1,000 rows).
import { fetchAllVerified } from './paginatedRead.ts';
import { usdAmount } from './rateConventions.ts';
import type { FeeBracketRow, FlatFee } from './feeSchedule.ts';
import type { YardKey } from './yardMatching.ts';

/** The one method of the supabase-js client these reads use. Structural, so both the browser and the Deno client satisfy it. */
export interface Db { from(table: string): any }

export type PaymentTier = 'secured' | 'unsecured';
export interface AuctionHouse { auction_platform: string; display_name: string; location_prefixes: string[] }
export interface AuctionAccount {
  id: string; org_id: string; auction_platform: string; fee_tier: string; holder_name: string; member_number: string | null;
  payment_tier: PaymentTier | null; is_default: boolean; notes: string | null; updated_at: string;
}

// Houses are 4 rows of reference data: cached per client object (the browser's singleton keeps it for the page; a server
// client is created per request, so nothing goes stale there).
const housesCache = new WeakMap<object, Promise<AuctionHouse[]>>();
export const listAuctionHouses = (db: Db): Promise<AuctionHouse[]> => {
  let p = housesCache.get(db);
  if (!p) {
    p = (async () => {
      const { data, error } = await db.from('auction_houses').select('auction_platform, display_name, location_prefixes').order('auction_platform');
      if (error) { housesCache.delete(db); throw new Error(`Failed to load auction houses: ${error.message}`); }
      return (data || []) as AuctionHouse[];
    })();
    housesCache.set(db, p);
  }
  return p;
};

export const getAccount = async (db: Db, orgId: string, accountId: string): Promise<AuctionAccount | null> => {
  const { data, error } = await db.from('auction_accounts').select('*').eq('org_id', orgId).eq('id', accountId).maybeSingle();
  if (error) throw new Error(`Failed to load auction account: ${error.message}`);
  return (data as AuctionAccount) ?? null;
};

export const getDefaultAccount = async (db: Db, orgId: string, auctionPlatform: string): Promise<AuctionAccount | null> => {
  const { data, error } = await db.from('auction_accounts').select('*').eq('org_id', orgId).eq('auction_platform', auctionPlatform).eq('is_default', true).maybeSingle();
  if (error) throw new Error(`Failed to load the default ${auctionPlatform} account: ${error.message}`);
  return (data as AuctionAccount) ?? null;
};

/** Every distinct active yard for the org - the complete list the yard matcher must see. */
export const listActiveYardKeys = async (db: Db, orgId: string): Promise<YardKey[]> => {
  const rows = await fetchAllVerified<YardKey>(
    'Yard list',
    (from, to) => db.from('trucking_rates').select('auction_platform, yard_state, yard_city, yard_street').eq('org_id', orgId).is('effective_to', null).order('id').range(from, to),
    () => db.from('trucking_rates').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('effective_to', null),
  );
  const seen = new Map<string, YardKey>();
  for (const r of rows) seen.set(`${r.auction_platform}|${r.yard_state}|${r.yard_city}|${r.yard_street ?? ''}`, r);
  return Array.from(seen.values());
};

export async function fetchTierRows(db: Db, orgId: string, platform: string, feeTier: string): Promise<FeeBracketRow[]> {
  const rows = await fetchAllVerified<any>(
    'fee brackets',
    (from, to) => db.from('auction_fee_brackets')
      .select('fee_type, title_status, payment_tier, bid_method, bracket_min, bracket_max, fee_unit, fee_value, source, effective_from, currency, amount_usd')
      .eq('org_id', orgId).eq('auction_platform', platform).eq('fee_tier', feeTier).is('effective_to', null)
      .order('bracket_min').order('id').range(from, to),
    () => db.from('auction_fee_brackets').select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('auction_platform', platform).eq('fee_tier', feeTier).is('effective_to', null),
  );
  return rows.map((r: any): FeeBracketRow => ({
    fee_type: r.fee_type, title_status: r.title_status, payment_tier: r.payment_tier, bid_method: r.bid_method,
    bracket_min: Number(r.bracket_min), bracket_max: r.bracket_max === null ? null : Number(r.bracket_max),
    fee_unit: r.fee_unit,
    // A percent is a pure ratio; a dollar bracket is read in dollars (rateConventions.usdAmount).
    fee_value: r.fee_unit === 'percent' ? Number(r.fee_value) : usdAmount(r, r.fee_value, 'fee bracket'),
    source: r.source, effective_from: r.effective_from,
  }));
}

export async function fetchFlatFees(db: Db, orgId: string, platform: string): Promise<FlatFee[]> {
  const { data, error } = await db.from('cost_rates')
    .select('label, fee_role, rate_value, source, effective_from, currency, amount_usd')
    .eq('org_id', orgId).eq('cost_category', 'auction_fee').eq('auction_platform', platform).eq('fee_applies', 'always').is('effective_to', null)
    .order('fee_role').order('label');
  if (error) throw new Error(`Failed to load flat auction fees: ${error.message}`);
  return (data || []).map((r: any): FlatFee => ({
    label: r.label, fee_role: r.fee_role, source: r.source, effective_from: r.effective_from, rate_value: usdAmount(r, r.rate_value, 'flat fee'),
  }));
}

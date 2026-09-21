import { supabase } from './supabaseClient';
import { fetchAllVerified } from '../../supabase/functions/_shared/paginatedRead';

// PROMPT 37 Phase 1 - the data the fee path used to hold as Copart constants: which auction houses exist,
// each house's OFFICIAL fee tiers, and the buying accounts (with their own payment tier) an org holds.
// Nothing here names a house or a person; adding IAAI is inserting rows.

export type PaymentTier = 'secured' | 'unsecured';

export interface AuctionHouse {
  auction_platform: string;
  display_name: string;
  location_prefixes: string[];
}

export interface AuctionFeeTier {
  auction_platform: string;
  fee_tier: string;
  eligibility: string | null;
  source_url: string | null;
  notes: string | null;
  sort_order: number;
}

export interface AuctionAccount {
  id: string;
  org_id: string;
  auction_platform: string;
  fee_tier: string;
  holder_name: string;
  member_number: string | null;
  payment_tier: PaymentTier | null; // null = this house has no Secured/Unsecured distinction
  is_default: boolean;
  notes: string | null;
  updated_at: string;
}

// Houses and tiers are small, global reference data: read once per page load.
let housesPromise: Promise<AuctionHouse[]> | null = null;
export const listAuctionHouses = (): Promise<AuctionHouse[]> => {
  if (!housesPromise) {
    housesPromise = (async () => {
      const { data, error } = await supabase.from('auction_houses').select('auction_platform, display_name, location_prefixes').order('auction_platform');
      if (error) { housesPromise = null; throw new Error(`Failed to load auction houses: ${error.message}`); }
      return (data || []) as AuctionHouse[];
    })();
  }
  return housesPromise;
};

export const listFeeTiers = async (auctionPlatform?: string): Promise<AuctionFeeTier[]> => {
  let q = supabase.from('auction_fee_tiers').select('*').order('auction_platform').order('sort_order');
  if (auctionPlatform) q = q.eq('auction_platform', auctionPlatform);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to load fee tiers: ${error.message}`);
  return (data || []) as AuctionFeeTier[];
};

export const listAccounts = async (orgId: string): Promise<AuctionAccount[]> => {
  const { data, error } = await supabase.from('auction_accounts').select('*').eq('org_id', orgId).order('auction_platform').order('is_default', { ascending: false }).order('holder_name');
  if (error) throw new Error(`Failed to load auction accounts: ${error.message}`);
  return (data || []) as AuctionAccount[];
};

export const getAccount = async (orgId: string, accountId: string): Promise<AuctionAccount | null> => {
  const { data, error } = await supabase.from('auction_accounts').select('*').eq('org_id', orgId).eq('id', accountId).maybeSingle();
  if (error) throw new Error(`Failed to load auction account: ${error.message}`);
  return (data as AuctionAccount) ?? null;
};

// The org's default buying account for a house, or null when none is set up (the fee then abstains and says so).
export const getDefaultAccount = async (orgId: string, auctionPlatform: string): Promise<AuctionAccount | null> => {
  const { data, error } = await supabase.from('auction_accounts').select('*').eq('org_id', orgId).eq('auction_platform', auctionPlatform).eq('is_default', true).maybeSingle();
  if (error) throw new Error(`Failed to load the default ${auctionPlatform} account: ${error.message}`);
  return (data as AuctionAccount) ?? null;
};

export interface NewAccountInput {
  auction_platform: string;
  fee_tier: string;
  holder_name: string;
  member_number: string | null;
  payment_tier: PaymentTier | null;
  notes?: string | null;
}

export const addAccount = async (orgId: string, userId: string, input: NewAccountInput): Promise<AuctionAccount> => {
  const { data, error } = await supabase.from('auction_accounts').insert({ ...input, org_id: orgId, created_by: userId, is_default: false }).select('*').single();
  if (error) throw new Error(`Failed to add the account: ${error.message}`);
  return data as AuctionAccount;
};

export const setAccountPaymentTier = async (accountId: string, tier: PaymentTier | null): Promise<void> => {
  const { error } = await supabase.from('auction_accounts').update({ payment_tier: tier }).eq('id', accountId);
  if (error) throw new Error(`Failed to save the payment tier: ${error.message}`);
};

// Exactly one default per org and house: clear the old one first (the unique index refuses two).
export const setDefaultAccount = async (orgId: string, accountId: string, auctionPlatform: string): Promise<void> => {
  const { error: clearError } = await supabase.from('auction_accounts').update({ is_default: false }).eq('org_id', orgId).eq('auction_platform', auctionPlatform).eq('is_default', true);
  if (clearError) throw new Error(`Failed to change the default account: ${clearError.message}`);
  const { error } = await supabase.from('auction_accounts').update({ is_default: true }).eq('id', accountId);
  if (error) throw new Error(`Failed to set the default account: ${error.message}`);
};

export interface FeeScheduleSummary {
  fee_tier: string;
  buyer_rows: number;
  bid_rows: number;
  title_statuses: string[];
  payment_tiers: string[];
  effective_from_min: string | null;
}

// What is actually loaded for a house, per tier - the read-only "Loaded schedules" view.
export const summariseSchedules = async (orgId: string, auctionPlatform: string): Promise<FeeScheduleSummary[]> => {
  const data = await fetchAllVerified<{ fee_tier: string; fee_type: string; title_status: string; payment_tier: string; effective_from: string }>(
    'fee schedule rows',
    (from, to) => supabase.from('auction_fee_brackets')
      .select('fee_tier, fee_type, title_status, payment_tier, effective_from')
      .eq('org_id', orgId).eq('auction_platform', auctionPlatform).is('effective_to', null).not('fee_tier', 'is', null)
      .order('id').range(from, to),
    () => supabase.from('auction_fee_brackets').select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('auction_platform', auctionPlatform).is('effective_to', null).not('fee_tier', 'is', null),
  );
  const by = new Map<string, FeeScheduleSummary>();
  for (const r of data) {
    const s = by.get(r.fee_tier) ?? { fee_tier: r.fee_tier, buyer_rows: 0, bid_rows: 0, title_statuses: [], payment_tiers: [], effective_from_min: null };
    if (r.fee_type === 'buyer_fee') s.buyer_rows++; else s.bid_rows++;
    if (!s.title_statuses.includes(r.title_status)) s.title_statuses.push(r.title_status);
    if (!s.payment_tiers.includes(r.payment_tier)) s.payment_tiers.push(r.payment_tier);
    if (!s.effective_from_min || r.effective_from < s.effective_from_min) s.effective_from_min = r.effective_from;
    by.set(r.fee_tier, s);
  }
  return [...by.values()];
};

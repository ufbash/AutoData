// The derivation lives in supabase/functions/_shared/auctionHistory.ts so the staff page, the rules module and
// public-run all read ONE definition (public-run used to re-count repeat sales itself). Re-exported here so existing
// imports keep working.
export * from '../../supabase/functions/_shared/auctionHistory.ts';

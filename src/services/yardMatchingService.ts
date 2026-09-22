// PROMPT 38 (debt #79): the yard matcher moved to _shared/yardMatching.ts (pure, no imports) so the billing Edge Function
// runs the same matching the browser does. This file keeps the old import path working.
export * from '../../supabase/functions/_shared/yardMatching.ts';

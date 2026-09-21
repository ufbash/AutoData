-- PROMPT 37 Phase 1 - flat auction fees are looked up by ROLE for a HOUSE, not by a label string.
--
-- Before: bidHeadroomService searched cost_rates for the literal labels 'Copart Environmental Fee',
-- 'Copart Gate Fee (Non-Clean Title)' and 'Copart Title Pickup Fee'. Now a flat auction fee says which
-- house it belongs to (auction_platform), what it is (fee_role) and whether it is charged on every
-- purchase ('always') or only in some circumstances ('contingent' - late payment, storage; debts #39/#40).
-- The code sums the 'always' fees for the house; it names no fee.
--
-- Additive: the existing labels stay (they are the display text). The five existing auction_fee rows are
-- backfilled below; their amounts, dates and sources are untouched. The Gate Fee keeps applying to every
-- title status exactly as before (the clean-title figures $640 / $1,130 include it) - whether a "Non-Clean
-- Title" fee should apply to clean titles is a decision recorded for Bashir, not changed here.
-- The shape CHECK (an auction_fee row must carry all three) is added in the cleanup migration, after the
-- code that writes them is deployed - the deployed extraction-confirm path does not set these columns yet.

ALTER TABLE public.cost_rates ADD COLUMN IF NOT EXISTS auction_platform text REFERENCES public.auction_houses (auction_platform);
ALTER TABLE public.cost_rates ADD COLUMN IF NOT EXISTS fee_role text;
ALTER TABLE public.cost_rates ADD COLUMN IF NOT EXISTS fee_applies text;
ALTER TABLE public.cost_rates ADD CONSTRAINT cost_rates_fee_role_format CHECK (fee_role IS NULL OR fee_role ~ '^[a-z][a-z0-9_]*$');
ALTER TABLE public.cost_rates ADD CONSTRAINT cost_rates_fee_applies_check CHECK (fee_applies IS NULL OR fee_applies IN ('always', 'contingent'));

UPDATE public.cost_rates SET auction_platform = 'copart', fee_role = 'environmental', fee_applies = 'always'
  WHERE cost_category = 'auction_fee' AND label = 'Copart Environmental Fee' AND fee_role IS NULL;
UPDATE public.cost_rates SET auction_platform = 'copart', fee_role = 'gate', fee_applies = 'always'
  WHERE cost_category = 'auction_fee' AND label = 'Copart Gate Fee (Non-Clean Title)' AND fee_role IS NULL;
UPDATE public.cost_rates SET auction_platform = 'copart', fee_role = 'title_pickup', fee_applies = 'always'
  WHERE cost_category = 'auction_fee' AND label = 'Copart Title Pickup Fee' AND fee_role IS NULL;
UPDATE public.cost_rates SET auction_platform = 'copart', fee_role = 'late_payment', fee_applies = 'contingent'
  WHERE cost_category = 'auction_fee' AND label = 'Copart Late Payment Fee' AND fee_role IS NULL;
-- Storage came from a real Copart invoice (Prompt 22 extraction verification, PLAN_TRACKER 823).
UPDATE public.cost_rates SET auction_platform = 'copart', fee_role = 'storage', fee_applies = 'contingent'
  WHERE cost_category = 'auction_fee' AND label = 'Storage' AND fee_role IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cost_rates_live_fee_role ON public.cost_rates (org_id, auction_platform, fee_role)
  WHERE effective_to IS NULL AND cost_category = 'auction_fee' AND fee_role IS NOT NULL;

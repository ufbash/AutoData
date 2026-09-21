-- PROMPT 37 Phase 1 - fee brackets belong to an official TIER of an auction house, not to a person.
--
-- Additive on purpose: the deployed app still filters brackets by member_account, so that column is kept
-- (made nullable) and every existing row keeps its old value. The new fee_tier column is backfilled from
-- it, and the new code reads fee_tier only. member_account is dropped in the cleanup migration after the
-- new code is deployed. No amount, date, source or bracket boundary changes.
--
--  * title_status and payment_tier gain the value 'any' - a schedule that does not vary by title or by
--    payment method (IAAI has no Secured/Unsecured) is stored once, not four times. Copart has no 'any'
--    rows, so its lookups are unchanged.
--  * The auction_platform CHECK list becomes a foreign key to auction_houses, so a house is data.
--  * At most one LIVE row per schedule cell: a duplicate would be summed silently by a reader.

ALTER TABLE public.auction_fee_brackets ADD COLUMN IF NOT EXISTS fee_tier text;
ALTER TABLE public.auction_fee_brackets ALTER COLUMN member_account DROP NOT NULL;

UPDATE public.auction_fee_brackets SET fee_tier = 'Copart U.S. Non-Licensed'
  WHERE fee_tier IS NULL AND auction_platform = 'copart' AND member_account = 'Jamilu Danmusa Danmusa (Copart Non-Licensed)';
UPDATE public.auction_fee_brackets SET fee_tier = 'Copart U.S. Licensed - High Volume'
  WHERE fee_tier IS NULL AND auction_platform = 'copart' AND member_account = 'White Nexus Ltd (Copart High-Volume Licensed)';

ALTER TABLE public.auction_fee_brackets ADD CONSTRAINT auction_fee_brackets_tier_or_account
  CHECK (fee_tier IS NOT NULL OR member_account IS NOT NULL);
ALTER TABLE public.auction_fee_brackets
  ADD CONSTRAINT auction_fee_brackets_tier_fk FOREIGN KEY (auction_platform, fee_tier)
  REFERENCES public.auction_fee_tiers (auction_platform, fee_tier);

ALTER TABLE public.auction_fee_brackets DROP CONSTRAINT auction_fee_brackets_title_status_check;
ALTER TABLE public.auction_fee_brackets ADD CONSTRAINT auction_fee_brackets_title_status_check
  CHECK (title_status IN ('clean', 'non_clean', 'any'));
ALTER TABLE public.auction_fee_brackets DROP CONSTRAINT auction_fee_brackets_payment_tier_check;
ALTER TABLE public.auction_fee_brackets ADD CONSTRAINT auction_fee_brackets_payment_tier_check
  CHECK (payment_tier IN ('secured', 'unsecured', 'any'));

ALTER TABLE public.auction_fee_brackets DROP CONSTRAINT auction_fee_brackets_auction_platform_check;
ALTER TABLE public.auction_fee_brackets ADD CONSTRAINT auction_fee_brackets_house_fk
  FOREIGN KEY (auction_platform) REFERENCES public.auction_houses (auction_platform);
ALTER TABLE public.trucking_rates DROP CONSTRAINT trucking_rates_auction_platform_check;
ALTER TABLE public.trucking_rates ADD CONSTRAINT trucking_rates_house_fk
  FOREIGN KEY (auction_platform) REFERENCES public.auction_houses (auction_platform);

CREATE UNIQUE INDEX IF NOT EXISTS auction_fee_brackets_live_key ON public.auction_fee_brackets
  (org_id, auction_platform, fee_tier, fee_type, title_status, payment_tier, (coalesce(bid_method, '')), bracket_min)
  WHERE effective_to IS NULL AND fee_tier IS NOT NULL;
CREATE INDEX IF NOT EXISTS auction_fee_brackets_tier_lookup_idx ON public.auction_fee_brackets
  (org_id, auction_platform, fee_tier, fee_type, effective_to);

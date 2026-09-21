-- PROMPT 37 Phase 1 - the cleanup deliberately left until the new code was deployed (it is: production serves
-- the bundle that reads fee_tier / auction_accounts). Removes the two Copart-shaped leftovers and adds the shape
-- checks that could not exist while the old app was still writing rows without the new columns.
--
--  * auction_fee_brackets.member_account (a person's or company's name used as a schedule key) is dropped; every
--    row already carries fee_tier (migration 053, no null). Its old lookup index goes with it; the tier index
--    from 053 replaces it.
--  * org_settings.copart_payment_tier is dropped: the payment tier is per account now (auction_accounts.payment_tier,
--    seeded from this very value in 052). The org_settings table itself stays for future org-wide settings.
--  * fee_tier becomes NOT NULL, and an auction_fee cost rate must carry auction_platform, fee_role and fee_applies.
-- No amount, date or source is touched. Each destructive step is guarded by a check that it would lose nothing.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.auction_fee_brackets WHERE fee_tier IS NULL) THEN
    RAISE EXCEPTION '057 aborted: some auction_fee_brackets rows have no fee_tier; dropping member_account would lose their key';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cost_rates WHERE cost_category = 'auction_fee' AND (auction_platform IS NULL OR fee_role IS NULL OR fee_applies IS NULL)) THEN
    RAISE EXCEPTION '057 aborted: an auction_fee cost rate is missing auction_platform / fee_role / fee_applies';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auction_accounts a WHERE a.auction_platform = 'copart' AND a.is_default AND a.payment_tier IS NULL) THEN
    RAISE EXCEPTION '057 aborted: the default Copart account has no payment tier; the org_settings value would be lost';
  END IF;
END $$;

ALTER TABLE public.auction_fee_brackets ALTER COLUMN fee_tier SET NOT NULL;
ALTER TABLE public.auction_fee_brackets DROP CONSTRAINT IF EXISTS auction_fee_brackets_tier_or_account;
ALTER TABLE public.auction_fee_brackets DROP COLUMN member_account;

ALTER TABLE public.cost_rates ADD CONSTRAINT cost_rates_auction_fee_shape CHECK (
  cost_category <> 'auction_fee' OR (auction_platform IS NOT NULL AND fee_role IS NOT NULL AND fee_applies IS NOT NULL)
);

ALTER TABLE public.org_settings DROP COLUMN copart_payment_tier;

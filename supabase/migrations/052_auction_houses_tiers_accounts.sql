-- PROMPT 37 Phase 1 - the auction house becomes a KEY, and accounts/tiers stop being Copart constants.
--
-- Before: the fee path was hardcoded to Copart (DEFAULT_MEMBER_ACCOUNT, the three 'Copart ... Fee'
-- labels, `platform !== 'copart'` gates, org_settings.copart_payment_tier). Adding IAAI meant editing
-- TypeScript. This migration creates the data those constants stood in for:
--
--   auction_houses      - one row per house (copart, iaai, manheim, adesa). location_prefixes replaces the
--                         hardcoded IAA-yard regex: a lot labelled house X whose location begins with a
--                         DIFFERENT house's prefix is contradictory and abstains.
--   auction_fee_tiers   - the house's own OFFICIAL fee tiers, named as the house publishes them (never after
--                         a person or company). A fee schedule (auction_fee_brackets) belongs to a tier.
--   auction_accounts    - a buying account Caplimo (or a broker acting for it) holds: which tier it is on,
--                         its payment tier (Secured/Unsecured, per account - replaces the single org-wide
--                         copart_payment_tier), the holder and member number as DESCRIPTIVE facts, and
--                         whether it is the org's default account for that house.
--
-- Tier names are taken from Copart's own U.S. fee pages (read 21 Sep 2026): "Copart U.S. Non-Licensed
-- Fees" and "Copart U.S. Licensed Fees", the latter split by two criteria paths. Copart labels those two
-- paths by their criteria rather than by a name, so "Low Volume" / "High Volume" is our shorthand and the
-- verbatim criteria are stored beside each tier.
-- Nothing is deleted or renamed here; org_settings.copart_payment_tier is left in place (dropped later,
-- after the code that replaces it is deployed).

CREATE TABLE IF NOT EXISTS public.auction_houses (
  auction_platform text PRIMARY KEY CHECK (auction_platform ~ '^[a-z][a-z0-9_]*$'),
  display_name text NOT NULL,
  location_prefixes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.auction_houses (auction_platform, display_name, location_prefixes) VALUES
  ('copart',  'Copart',        '{}'),
  ('iaai',    'IAA (IAAI)',    '{IAA,IAAI}'),
  ('manheim', 'Manheim',       '{}'),
  ('adesa',   'ADESA',         '{}')
ON CONFLICT (auction_platform) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.auction_fee_tiers (
  auction_platform text NOT NULL REFERENCES public.auction_houses (auction_platform),
  fee_tier text NOT NULL,
  eligibility text,
  source_url text,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auction_platform, fee_tier)
);

INSERT INTO public.auction_fee_tiers (auction_platform, fee_tier, eligibility, source_url, notes, sort_order) VALUES
  ('copart', 'Copart U.S. Non-Licensed',
   'Copart U.S. Non-Licensed Fees (no business licence).',
   'https://www.copart.com/content/us/en/member-fees-us-non-licensed',
   'Fee also depends on title (Clean / Non-Clean) and payment method (Secured / Unsecured).', 1),
  ('copart', 'Copart U.S. Licensed - Low Volume',
   'I buy fewer than 25 vehicles OR spend less than $75K in vehicle sales per year OR have 5 or more bidder accounts',
   'https://www.copart.com/content/us/en/member-fees-us-licensed-less',
   'Copart labels this path by its criteria, not a name; "Low Volume" is our shorthand. Its fee table was compared byte-for-byte with Non-Licensed on 8 Sep 2026 (debt #41) and was identical. No rows are loaded under this tier yet, so it abstains until a schedule is loaded.', 2),
  ('copart', 'Copart U.S. Licensed - High Volume',
   'I buy 25 or more vehicles AND spend $75K or more in vehicle sales per year AND have less than 5 bidder accounts',
   'https://www.copart.com/content/us/en/member-fees-us-licensed-more',
   'Purchase volume accumulates units from Copart.com, Copart.ca or CrashedToys.com (Copart''s wording). Only Non-Clean-title brackets are loaded (debt #37).', 3),
  ('iaai', 'IAA U.S. Public', NULL, NULL,
   'Named from the title of IAA''s published "Public Buyer Fees" document. Contents unreadable (bot protection); no schedule loaded.', 1),
  ('iaai', 'IAA U.S. Non-Licensed', NULL, NULL,
   'Named from the title of IAA''s published "Non-Licensed Buyer Fees" document. Contents unreadable; no schedule loaded.', 2),
  ('iaai', 'IAA U.S. Licensed', NULL, NULL,
   'Named from the title of IAA''s published "Licensed Buyer Fees" document. A broker reproduction describes Standard and High-Volume licensed schedules (25+ units, $75,000+ in 12 months, fewer than 5 bidder accounts); they are not split into separate tiers until IAA''s own wording is seen. No schedule loaded.', 3)
ON CONFLICT (auction_platform, fee_tier) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.auction_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  auction_platform text NOT NULL,
  fee_tier text NOT NULL,
  holder_name text NOT NULL,          -- descriptive: who holds the account
  member_number text,                 -- descriptive: the house's own member / bidder number
  payment_tier text CHECK (payment_tier IN ('secured', 'unsecured')),  -- NULL = the house has no such tiers
  is_default boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  FOREIGN KEY (auction_platform, fee_tier) REFERENCES public.auction_fee_tiers (auction_platform, fee_tier),
  UNIQUE (org_id, auction_platform, holder_name)
);
CREATE UNIQUE INDEX IF NOT EXISTS auction_accounts_one_default
  ON public.auction_accounts (org_id, auction_platform) WHERE is_default;

CREATE OR REPLACE FUNCTION public.auction_accounts_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS auction_accounts_touch_trg ON public.auction_accounts;
CREATE TRIGGER auction_accounts_touch_trg BEFORE UPDATE ON public.auction_accounts
  FOR EACH ROW EXECUTE FUNCTION public.auction_accounts_touch();

ALTER TABLE public.auction_houses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_fee_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auction_houses_select ON public.auction_houses;
CREATE POLICY auction_houses_select ON public.auction_houses FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS auction_fee_tiers_select ON public.auction_fee_tiers;
CREATE POLICY auction_fee_tiers_select ON public.auction_fee_tiers FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS auction_accounts_select ON public.auction_accounts;
CREATE POLICY auction_accounts_select ON public.auction_accounts FOR SELECT
  USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
DROP POLICY IF EXISTS auction_accounts_insert ON public.auction_accounts;
CREATE POLICY auction_accounts_insert ON public.auction_accounts FOR INSERT WITH CHECK (is_superadmin());
DROP POLICY IF EXISTS auction_accounts_update ON public.auction_accounts;
CREATE POLICY auction_accounts_update ON public.auction_accounts FOR UPDATE USING (is_superadmin()) WITH CHECK (is_superadmin());
REVOKE ALL ON public.auction_houses, public.auction_fee_tiers, public.auction_accounts FROM anon;
REVOKE TRUNCATE ON public.auction_houses, public.auction_fee_tiers, public.auction_accounts FROM authenticated, service_role;

-- Seed the two real Copart accounts from the data that already describes them (the existing brackets'
-- member_account text, scripts/generateAuctionFeeRates.mjs, SCHEMA.md 18). The org-wide payment tier
-- becomes each account's own tier. White Nexus is a historical middleman account, never the default;
-- its tier is Unsecured because that is what its verified invoice priced (Bashir, 21 Sep 2026: "defaults").
INSERT INTO public.auction_accounts (org_id, auction_platform, fee_tier, holder_name, member_number, payment_tier, is_default, notes)
SELECT s.org_id, 'copart', 'Copart U.S. Non-Licensed', 'Jamilu Danmusa Danmusa', '387085', s.copart_payment_tier, true,
       'Caplimo''s own Copart account (matches invoices 1 and 3). Formerly named "Jamilu Danmusa Danmusa (Copart Non-Licensed)".'
FROM public.org_settings s
ON CONFLICT (org_id, auction_platform, holder_name) DO NOTHING;

INSERT INTO public.auction_accounts (org_id, auction_platform, fee_tier, holder_name, member_number, payment_tier, is_default, notes)
SELECT s.org_id, 'copart', 'Copart U.S. Licensed - High Volume', 'White Nexus Ltd', '18732', 'unsecured', false,
       'A one-off middleman that bought one vehicle on Caplimo''s behalf; historical, never the default (debt #42). Kept so that invoice stays explicable (PROJECT_CHARTER 5.10). Formerly named "White Nexus Ltd (Copart High-Volume Licensed)".'
FROM public.org_settings s
ON CONFLICT (org_id, auction_platform, holder_name) DO NOTHING;

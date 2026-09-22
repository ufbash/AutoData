-- PROMPT 38 Phase A - what an invoice is printed with and taxed at, kept as DATA:
--   * org_billing_profile - the org's own name, address lines, logo, payment instructions and footer notes (a second
--     licensee invoices under its own name; nothing about Caplimo is in code).
--   * tax_codes           - DATED tax rates per org (VAT 7.5% today, EXEMPT 0%). The rate is never a constant in code
--                           (PROJECT_CHARTER 5.10): it is a dated row, closed and replaced when it changes.
--   * billing_defaults    - DATED per-org defaults the invoice builder pre-fills and staff may edit per invoice
--                           (today: the flat service fee and its tax code).
-- The two dated tables use the Phase 1 write guard (051): API roles may only close a live row, every write is logged.

-- ---------------------------------------------------------------- org billing profile
CREATE TABLE IF NOT EXISTS public.org_billing_profile (
  org_id uuid PRIMARY KEY REFERENCES public.organizations (id),
  legal_name text NOT NULL CHECK (btrim(legal_name) <> ''),
  header_lines text[] NOT NULL DEFAULT '{}',           -- printed under the name, as given (address, phone, email)
  logo_path text,                                      -- object path in the private won-vehicle-documents bucket
  payment_instructions text[],
  footer_notes text[] NOT NULL DEFAULT '{}',
  origin_footnotes boolean NOT NULL DEFAULT true,      -- print the per-line "computed / per document / staff figure" footnote
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id)
);
ALTER TABLE public.org_billing_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_billing_profile_select ON public.org_billing_profile FOR SELECT
  USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY org_billing_profile_insert ON public.org_billing_profile FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY org_billing_profile_update ON public.org_billing_profile FOR UPDATE USING (is_superadmin()) WITH CHECK (is_superadmin());
REVOKE ALL ON public.org_billing_profile FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.org_billing_profile TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.org_billing_profile TO service_role;

-- ---------------------------------------------------------------- dated tax codes
CREATE TABLE IF NOT EXISTS public.tax_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id),
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  label text NOT NULL CHECK (btrim(label) <> ''),
  rate_percent numeric(7, 4) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  effective_from date NOT NULL,
  effective_to date,
  source text NOT NULL CHECK (btrim(source) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  CONSTRAINT tax_codes_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_codes_one_live ON public.tax_codes (org_id, code) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS tax_codes_lookup ON public.tax_codes (org_id, code, effective_from);

CREATE TABLE IF NOT EXISTS public.billing_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id),
  code text NOT NULL CHECK (code IN ('service_fee')),
  label text NOT NULL CHECK (btrim(label) <> ''),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'NGN')),
  tax_code text,
  effective_from date NOT NULL,
  effective_to date,
  source text NOT NULL CHECK (btrim(source) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  CONSTRAINT billing_defaults_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_defaults_one_live ON public.billing_defaults (org_id, code) WHERE effective_to IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_codes', 'billing_defaults'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin())', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (is_superadmin())', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (is_superadmin()) WITH CHECK (is_superadmin())', t || '_update', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated, service_role', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.rate_table_guard()', t || '_guard_trg', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.rate_table_no_truncate()', t || '_no_truncate_trg', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- seed
-- Every org gets the two tax codes it can need. The rate and its source are stated; an accountant confirms them.
INSERT INTO public.tax_codes (org_id, code, label, rate_percent, effective_from, source)
SELECT o.id, 'VAT', 'Value added tax', 7.5, DATE '2020-02-01',
       'Nigeria VAT 7.5% (Finance Act 2019, in force 1 Feb 2020) - seeded 21 Sep 2026; confirm with the accountant'
  FROM public.organizations o
ON CONFLICT DO NOTHING;
INSERT INTO public.tax_codes (org_id, code, label, rate_percent, effective_from, source)
SELECT o.id, 'EXEMPT', 'VAT exempt', 0, DATE '2020-02-01', 'A line that is exempt from VAT (for example car detailing on a taxed invoice)'
  FROM public.organizations o
ON CONFLICT DO NOTHING;

-- Caplimo's own profile and service-fee default (Bashir, 21 Sep 2026: a flat $700 service fee plus VAT at 7.5%,
-- editable per invoice because discounts are routine). Header lines are as printed on Caplimo's real invoices.
INSERT INTO public.org_billing_profile (org_id, legal_name, header_lines)
SELECT o.id, 'Caplimo', ARRAY['CITEC VILLAS, 28 44 CRES,', 'GWARIMPA, FCT +(234) 916 0715 157', 'caplimoltd@gmail.com']
  FROM public.organizations o WHERE o.id = 'a93378ea-33ef-4c75-97c4-44c37f2e9002'
ON CONFLICT DO NOTHING;
INSERT INTO public.billing_defaults (org_id, code, label, amount, currency, tax_code, effective_from, source)
SELECT o.id, 'service_fee', 'Caplimo service fee', 700, 'USD', 'VAT', DATE '2026-09-21',
       'Bashir, 21 Sep 2026: flat $700 service fee plus VAT at 7.5%; editable per invoice. Supersedes the provisional 7/5/3% schedule with a $500 floor.'
  FROM public.organizations o WHERE o.id = 'a93378ea-33ef-4c75-97c4-44c37f2e9002'
ON CONFLICT DO NOTHING;

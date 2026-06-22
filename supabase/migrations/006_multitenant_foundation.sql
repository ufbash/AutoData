-- Step 4.1: Enums
CREATE TYPE org_role_enum AS ENUM ('superadmin', 'staff', 'client');
CREATE TYPE logged_via_enum AS ENUM ('manual_entry', 'extension_dom_capture', 'ai_vision', 'api_import');

-- Step 4.2: Core tenancy tables
CREATE TABLE IF NOT EXISTS public.organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Trigger to auto-update updated_at for organizations
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_organizations_updated_at ON public.organizations;
CREATE TRIGGER set_organizations_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role org_role_enum NOT NULL DEFAULT 'staff',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON public.memberships(user_id);
CREATE INDEX IF NOT EXISTS memberships_org_id_idx ON public.memberships(org_id);

-- Step 4.3: RLS helper functions
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT org_id FROM memberships WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = auth.uid() AND role = 'superadmin'
  );
$$;

-- Step 4.4: Add org_id + logged_via to existing ledger tables
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.sightings ADD COLUMN IF NOT EXISTS org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.research_runs ADD COLUMN IF NOT EXISTS org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.research_run_listings ADD COLUMN IF NOT EXISTS org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.sightings ADD COLUMN IF NOT EXISTS logged_via logged_via_enum NOT NULL DEFAULT 'extension_dom_capture';

CREATE INDEX IF NOT EXISTS assets_org_id_idx ON public.assets(org_id);
CREATE INDEX IF NOT EXISTS sightings_org_id_idx ON public.sightings(org_id);
CREATE INDEX IF NOT EXISTS research_runs_org_id_idx ON public.research_runs(org_id);
CREATE INDEX IF NOT EXISTS research_run_listings_org_id_idx ON public.research_run_listings(org_id);

-- Step 4.5: Enable RLS with policies
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sightings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_run_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- assets policies
CREATE POLICY assets_select ON public.assets FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY assets_insert ON public.assets FOR INSERT WITH CHECK (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY assets_update ON public.assets FOR UPDATE USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY assets_delete ON public.assets FOR DELETE USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());

-- sightings policies
CREATE POLICY sightings_select ON public.sightings FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY sightings_insert ON public.sightings FOR INSERT WITH CHECK (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY sightings_update ON public.sightings FOR UPDATE USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY sightings_delete ON public.sightings FOR DELETE USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());

-- research_runs policies
CREATE POLICY research_runs_select ON public.research_runs FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY research_runs_insert ON public.research_runs FOR INSERT WITH CHECK (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY research_runs_update ON public.research_runs FOR UPDATE USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY research_runs_delete ON public.research_runs FOR DELETE USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());

-- research_run_listings policies
CREATE POLICY research_run_listings_select ON public.research_run_listings FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY research_run_listings_insert ON public.research_run_listings FOR INSERT WITH CHECK (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY research_run_listings_update ON public.research_run_listings FOR UPDATE USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY research_run_listings_delete ON public.research_run_listings FOR DELETE USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());

-- organizations policies
CREATE POLICY organizations_select ON public.organizations FOR SELECT USING (id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY organizations_insert ON public.organizations FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY organizations_update ON public.organizations FOR UPDATE USING (is_superadmin());
CREATE POLICY organizations_delete ON public.organizations FOR DELETE USING (is_superadmin());

-- memberships policies
CREATE POLICY memberships_select ON public.memberships FOR SELECT USING (user_id = auth.uid() OR org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY memberships_insert ON public.memberships FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY memberships_update ON public.memberships FOR UPDATE USING (is_superadmin());
CREATE POLICY memberships_delete ON public.memberships FOR DELETE USING (is_superadmin());

-- Step 4.6: Seed the Caplimo organization
INSERT INTO public.organizations (name, slug)
VALUES ('Caplimo', 'caplimo')
ON CONFLICT (slug) DO NOTHING;

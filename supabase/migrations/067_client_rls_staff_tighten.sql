-- PROMPT 39 Stage 1 - RLS rewrite, part 2: tighten every existing org-wide policy so a client-role membership matches
-- NONE of them by default. This alone makes the whole "never visible to a client" list true (cost_rates, trucking_rates,
-- auction_fee_brackets, rate_change_log, email_log, asset-merge data, the numbering ledger, org_billing_profile,
-- tax_codes, billing_defaults, billing_files, won_vehicle_winning_bids, won_vehicle_destinations, and every write policy
-- anywhere) without writing a bespoke deny rule for each one - there is nothing to deny once nothing matches.
--
-- Mechanical, not table-by-table by hand: every policy in the database whose USING or WITH CHECK is the exact canonical
-- `org_id IN (SELECT user_org_ids()) OR is_superadmin()` (or WITH CHECK-only form) is rewritten in one pass to
-- `(org_id IN (SELECT user_org_ids()) AND user_is_staff(org_id)) OR is_superadmin()`. A hand-picked list risks missing
-- one; a generic sweep over pg_policies cannot. The four variant shapes below are handled explicitly because their
-- column differs (organizations.id itself is the org; won_vehicle_status_history has no org_id column; memberships lets
-- a user see their OWN row regardless of role).

DO $$
DECLARE
  r record;
  canonical text := '((org_id IN ( SELECT user_org_ids() AS user_org_ids)) OR is_superadmin())';
  new_expr text := '((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND user_is_staff(org_id)) OR is_superadmin()';
  n integer := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, (qual = canonical) AS has_using, (with_check = canonical) AS has_check
      FROM pg_policies
     WHERE schemaname = 'public' AND (qual = canonical OR with_check = canonical)
  LOOP
    IF r.has_using AND r.has_check THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)', r.policyname, r.tablename, new_expr, new_expr);
    ELSIF r.has_using THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', r.policyname, r.tablename, new_expr);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', r.policyname, r.tablename, new_expr);
    END IF;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'tightened % policies matching the canonical org-wide pattern', n;
END $$;

-- ---------------------------------------------------------------- the four variant shapes, by hand

-- organizations: `id` itself IS the org id (one row per org). A client legitimately belongs to their own org and the
-- row holds nothing sensitive (name only) - left AS-IS, org-wide, on purpose. No change.

-- memberships: a user may always see their OWN row (needed so the app can read its own role), but the org-wide arm
-- (every OTHER member's row - names, roles, the staff roster) is staff-only.
ALTER POLICY memberships_select ON public.memberships
  USING ((user_id = auth.uid()) OR ((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin());

-- won_vehicle_status_history has no org_id column; it joins through won_vehicles. (A client arm is added in 068 - this
-- is the staff-only tightening.)
ALTER POLICY won_vehicle_status_history_select ON public.won_vehicle_status_history
  USING ((won_vehicle_id IN (SELECT id FROM public.won_vehicles WHERE org_id IN (SELECT user_org_ids()) AND user_is_staff(won_vehicles.org_id))) OR is_superadmin());

-- ---------------------------------------------------------------- kill the unconditional "any authenticated user" policies
-- Four tables carry a SECOND, wide-open `SELECT ... USING (true) TO authenticated` policy alongside the org-scoped one -
-- ANY logged-in user, of any org, any role, can already read every row. Debt #76 named research_runs/listings; this sweep
-- found the identical hole on assets and sightings. Permissive policies OR together, so tightening the org-scoped policy
-- above does nothing while this one still matches everyone - it must be dropped, not tightened (nothing legitimately
-- needs "every authenticated user, unscoped" once the org-scoped staff policy already covers every real caller: the
-- public-run/won-vehicle-tracking Edge Functions use the service role and bypass RLS entirely, so they need no exception).
DROP POLICY IF EXISTS select_assets_auth ON public.assets;
DROP POLICY IF EXISTS select_sightings_auth ON public.sightings;
DROP POLICY IF EXISTS select_research_runs_auth ON public.research_runs;
DROP POLICY IF EXISTS select_research_run_listings_auth ON public.research_run_listings;

-- ---------------------------------------------------------------- storage: direct bucket access is staff-only
-- The won-vehicle-documents bucket's staff policy lets ANY member of the org list/download EVERY file in that org's
-- folder by path, independent of any row-level document_type or (Stage 2) client_visible flag - a client with the same
-- membership shape as staff would read every stored PDF directly through Storage, bypassing the flag entirely. Direct
-- bucket access stays staff-only; Stage 2 adds a client-safe signed-URL path through an Edge Function that checks
-- client_visible before ever generating a URL, the same pattern the billing function already uses for staff.
DROP POLICY IF EXISTS won_vehicle_documents_staff_select ON storage.objects;
CREATE POLICY won_vehicle_documents_staff_select ON storage.objects FOR SELECT
  USING (bucket_id = 'won-vehicle-documents'
         AND (((storage.foldername(name))[1]::uuid IN (SELECT user_org_ids()) AND user_is_staff((storage.foldername(name))[1]::uuid))
              OR is_superadmin()));

-- Prompt 33 Stages 1-2 follow-up - RLS policies for the three new tables. RLS was enabled by
-- default on creation (migrations 039/040) but no policies existed yet, meaning nothing but the
-- service-role key (used by the seed/decode Edge Functions) could read them - the frontend
-- brief-entry vocabulary picker (Stage 3) needs authenticated staff to read makes/models.
--
-- These are NOT org-scoped ledger tables (SCHEMA.md §12's org_id pattern doesn't apply) - they
-- are shared reference data (NHTSA's own public makes/models/VIN decodes), identical for every
-- org. Read-only for authenticated users; writes only ever happen server-side via the seed/decode
-- functions' service-role key, which bypasses RLS entirely - no INSERT/UPDATE/DELETE policy is
-- granted to any client role.

CREATE POLICY vehicle_reference_makes_select ON public.vehicle_reference_makes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY vehicle_reference_models_select ON public.vehicle_reference_models
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY vin_decodes_select ON public.vin_decodes
  FOR SELECT USING (auth.role() = 'authenticated');

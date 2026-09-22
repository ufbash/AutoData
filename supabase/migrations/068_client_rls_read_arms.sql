-- PROMPT 39 Stage 1 - RLS rewrite, part 3: what a client MAY read, added as SEPARATE policies (never merged into the
-- staff ones - Prompt 39's own instruction, and the only way to keep the staff and client shapes independently auditable
-- and independently changeable). Everything not named here stays invisible to a client after migration 067 - there is no
-- default-allow left to punch a hole in.
--
-- Column-level hiding (internal notes, internal linkage) is NOT something a row policy can do - RLS filters ROWS. Where
-- a table holds both client-safe and staff-only columns, the client reads a SECURITY INVOKER view instead of the table
-- directly: the view still runs under the client's own RLS (the row policy below still applies), it just projects fewer
-- columns.
--
-- won_vehicle_documents gets NO client arm here - it has no client_visible flag yet (Stage 2 adds the column and the
-- policy together, since a policy referencing a column that isn't safe yet would be worse than no policy at all).
-- won_vehicle_winning_bids and won_vehicle_destinations get NO client arm - deliberately: a client sees the OUTCOME
-- (the won vehicle's identity, status history, invoices), not the internal bid mechanics (amount, method, timing).

-- ---------------------------------------------------------------- clients: own row only, restricted columns via a view
CREATE POLICY clients_select_client ON public.clients FOR SELECT
  USING (id = current_client_id(org_id));

CREATE VIEW public.my_client_record WITH (security_invoker = true) AS
  SELECT id, org_id, full_name, email, phone, preferred_contact, created_at
    FROM public.clients
   WHERE id = current_client_id(org_id);   -- never notes, never assigned_agent
GRANT SELECT ON public.my_client_record TO authenticated;

-- ---------------------------------------------------------------- client_briefs: own rows
CREATE POLICY client_briefs_select_client ON public.client_briefs FOR SELECT
  USING (client_id = current_client_id(org_id));

-- ---------------------------------------------------------------- research_runs / listings: only runs genuinely
-- SHARED with that client (research_runs.client_id set to them directly), never every run under their brief.
CREATE POLICY research_runs_select_client ON public.research_runs FOR SELECT
  USING (client_id = current_client_id(org_id));

CREATE POLICY research_run_listings_select_client ON public.research_run_listings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.research_runs r
     WHERE r.id = research_run_listings.run_id AND r.client_id = current_client_id(research_run_listings.org_id)
  ));

-- ---------------------------------------------------------------- won_vehicles: own vehicles, internal linkage hidden via a view
CREATE POLICY won_vehicles_select_client ON public.won_vehicles FOR SELECT
  USING (client_id = current_client_id(org_id));

CREATE VIEW public.my_won_vehicles WITH (security_invoker = true) AS
  SELECT id, org_id, client_id, brief_id, won_snapshot, promoted_at
    FROM public.won_vehicles
   WHERE client_id = current_client_id(org_id) AND deleted_at IS NULL;
   -- never asset_id, research_run_listing_id, run_id, share_token (internal linkage / the staff share mechanism)
GRANT SELECT ON public.my_won_vehicles TO authenticated;

-- status history (the nine-stage ladder) for the client's own vehicles
CREATE POLICY won_vehicle_status_history_select_client ON public.won_vehicle_status_history FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.won_vehicles v
     WHERE v.id = won_vehicle_status_history.won_vehicle_id AND v.client_id = current_client_id(v.org_id)
  ));

-- ---------------------------------------------------------------- billing: own documents; hidden lines stay hidden
CREATE POLICY billing_documents_select_client ON public.billing_documents FOR SELECT
  USING (client_id = current_client_id(org_id));

-- the ONE place the retail-hides-cost-lines rule is enforced for a client read: client_visible = true, on a document
-- that resolves to them. A non-retail (brokerage/repair) invoice has every line client_visible = true already (enforced
-- by check_billing_document, migration 063), so this same clause is correct for every invoice kind without a special case.
CREATE POLICY billing_document_lines_select_client ON public.billing_document_lines FOR SELECT
  USING (client_visible = true AND EXISTS (
    SELECT 1 FROM public.billing_documents d
     WHERE d.id = billing_document_lines.document_id AND d.client_id = current_client_id(billing_document_lines.org_id)
  ));

CREATE POLICY billing_payments_select_client ON public.billing_payments FOR SELECT
  USING (client_id = current_client_id(org_id));

-- billing_applications has no client_id column: match through EITHER leg that's populated (a payment application sets
-- document_id + payment_id; a retainer credit sets document_id + source_document_id, both eventually owned by the client).
CREATE POLICY billing_applications_select_client ON public.billing_applications FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.billing_documents d WHERE d.id = billing_applications.document_id AND d.client_id = current_client_id(billing_applications.org_id))
    OR EXISTS (SELECT 1 FROM public.billing_payments p WHERE p.id = billing_applications.payment_id AND p.client_id = current_client_id(billing_applications.org_id))
  );

CREATE POLICY billing_receipts_select_client ON public.billing_receipts FOR SELECT
  USING (client_id = current_client_id(org_id));

-- Grants: RLS needs the underlying GRANT too (a policy is a filter, not a grant). All were already GRANTed SELECT to
-- `authenticated` in their own migrations (058-064); nothing new to grant on the base tables. The two views above are
-- the only new grantable objects.

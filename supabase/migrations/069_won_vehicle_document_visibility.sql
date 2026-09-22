-- PROMPT 39 Stage 2 - a client-visible flag on won_vehicle_documents, default false, set deliberately by staff, with a
-- database-enforced restriction: a COST document (the auction's own invoice/receipt - what Caplimo paid) can never be
-- flagged visible on a vehicle that has been invoiced RETAIL (all-inclusive price, margin undisclosed by design -
-- DECISIONS 18.4/19). This supersedes the reading of DECISIONS.md 14.2/14.3 as "staff-only, always": those were written
-- before any client login existed, and "behind auth" (PROJECT_CHARTER 7) means visible to the AUTHENTICATED client that
-- auth exists for - not invisible to everyone who isn't staff. See DECISIONS.md 20.x for the dated supersession note.

ALTER TABLE public.won_vehicle_documents
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_visible_by uuid REFERENCES auth.users (id),
  ADD COLUMN IF NOT EXISTS client_visible_at timestamptz;
ALTER TABLE public.won_vehicle_documents
  ADD CONSTRAINT won_vehicle_documents_visible_actor_pair CHECK (
    (client_visible = false AND client_visible_by IS NULL AND client_visible_at IS NULL)
    OR (client_visible = true AND client_visible_by IS NOT NULL AND client_visible_at IS NOT NULL)
  );

-- A "cost document" is the auction's own invoice or a payment receipt against it - the only won_vehicle_documents types
-- that state what Caplimo paid. shipping_document/bill_of_lading/title/assessment_notice/other reveal nothing about
-- cost and are never restricted. "Retail" means this vehicle has at least one non-voided billing_documents row with
-- invoice_kind='retail' - the all-inclusive-price hat whose whole point is that margin is undisclosed.
CREATE OR REPLACE FUNCTION public.won_vehicle_documents_visibility_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.client_visible AND NEW.document_type IN ('invoice', 'receipt') AND EXISTS (
       SELECT 1 FROM public.billing_documents d
        WHERE d.won_vehicle_id = NEW.won_vehicle_id AND d.invoice_kind = 'retail' AND d.voided_at IS NULL
     ) THEN
    RAISE EXCEPTION 'A cost document (%) cannot be shown to the client on a vehicle invoiced retail - the retail price is all-inclusive and the underlying cost is never disclosed', NEW.document_type;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS won_vehicle_documents_visibility_guard_trg ON public.won_vehicle_documents;
CREATE TRIGGER won_vehicle_documents_visibility_guard_trg BEFORE INSERT OR UPDATE OF client_visible ON public.won_vehicle_documents
  FOR EACH ROW EXECUTE FUNCTION public.won_vehicle_documents_visibility_guard();

-- The client's read arm, deferred from migration 068 until this column existed: own vehicle's documents, flagged only.
CREATE POLICY won_vehicle_documents_select_client ON public.won_vehicle_documents FOR SELECT
  USING (client_visible = true AND EXISTS (
    SELECT 1 FROM public.won_vehicles v
     WHERE v.id = won_vehicle_documents.won_vehicle_id AND v.client_id = current_client_id(v.org_id)
  ));

-- Staff flip the flag through a narrow RPC, never a blanket UPDATE grant (migration 047 gave this table no
-- authenticated UPDATE policy at all - service role only - and that stays true; this function is the one deliberate
-- exception, touching only the three visibility columns).
CREATE OR REPLACE FUNCTION public.set_document_client_visibility(p_document_id uuid, p_visible boolean, p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.won_vehicle_documents;
BEGIN
  SELECT * INTO d FROM public.won_vehicle_documents WHERE id = p_document_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF NOT (public.user_is_staff(d.org_id) OR public.is_superadmin()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.won_vehicle_documents
     SET client_visible = p_visible, client_visible_by = CASE WHEN p_visible THEN p_user END,
         client_visible_at = CASE WHEN p_visible THEN now() END
   WHERE id = p_document_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_document_client_visibility(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_client_visibility(uuid, boolean, uuid) TO authenticated, service_role;

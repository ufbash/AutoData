-- PROMPT 42 Stage 4 - found by the independent usability verifier, confirmed in the database as the client's own role:
-- the client portal told a client they still owed money on invoices that staff had marked paid in full
-- (INV-0064: staff view outstanding 0.00 / applied 37.34; the same view read as client A: outstanding 37.34 /
-- applied 0. RET-0001 likewise: 0.00 vs 500.00).
--
-- Cause (the same class as debt #95): billing_document_balances is `security_invoker`, so a client session runs its
-- sub-selects against billing_applications with the CLIENT's RLS - and migration 074 correctly dropped the client
-- SELECT policy on that table (it carries staff-only columns: applied_by, note, void_reason). Zero rows visible ->
-- coalesce(..., 0) -> a confident wrong "nothing paid". The view's own `outstanding` is derived, so the wrong figure
-- looked right.
--
-- Fix, deliberately NOT re-opening the table: the view stops depending on the caller's table-level RLS and states its
-- own access rule explicitly, exactly as migration 080 did for client_account_status. It exposes only sums and the
-- document's own identity columns - nothing from billing_applications' staff-only columns can leave it.
--   * staff of the document's org (and superadmins): every row, as before;
--   * a client: only rows for their OWN documents (client_id = current_client_id(org_id)).
-- Rows for any other client are unreachable whatever the base tables' policies say.
CREATE OR REPLACE VIEW public.billing_document_balances WITH (security_invoker = false) AS
SELECT d.id AS document_id, d.org_id, d.client_id, d.doc_type, d.number_text, d.currency, d.settlement_currency, d.fx_rate, d.total, d.voided_at,
       coalesce(pa.paid, 0) AS applied_payments,
       coalesce(rc.credited, 0) AS applied_retainer_credits,
       coalesce(cn.credited, 0) AS credit_notes,
       d.total - coalesce(pa.paid, 0) - coalesce(rc.credited, 0) - coalesce(cn.credited, 0) AS outstanding,
       CASE WHEN d.settlement_currency <> d.currency
            THEN round((d.total - coalesce(pa.paid, 0) - coalesce(rc.credited, 0) - coalesce(cn.credited, 0)) * d.fx_rate, 2) END AS outstanding_settlement
  FROM public.billing_documents d
  LEFT JOIN (SELECT document_id, sum(amount) AS paid FROM public.billing_applications WHERE voided_at IS NULL AND kind = 'payment' GROUP BY document_id) pa ON pa.document_id = d.id
  LEFT JOIN (SELECT document_id, sum(amount) AS credited FROM public.billing_applications WHERE voided_at IS NULL AND kind = 'retainer_credit' GROUP BY document_id) rc ON rc.document_id = d.id
  LEFT JOIN (SELECT credit_for_id, sum(total) AS credited FROM public.billing_documents WHERE voided_at IS NULL AND credit_for_id IS NOT NULL GROUP BY credit_for_id) cn ON cn.credit_for_id = d.id
 WHERE d.doc_type IN ('invoice', 'retainer')
   AND ( (d.org_id IN (SELECT public.user_org_ids()) AND public.user_is_staff(d.org_id))
         OR public.is_superadmin()
         OR d.client_id = public.current_client_id(d.org_id) );

REVOKE ALL ON public.billing_document_balances FROM anon;
GRANT SELECT ON public.billing_document_balances TO authenticated, service_role;

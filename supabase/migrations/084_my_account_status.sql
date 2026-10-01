-- PROMPT 43 Stage 4 - the client's amount owed MUST be the staff account status, not a second implementation of it.
-- (Prompt 41 Stage 4 built client_account_status; migration 080 made it staff-only because a view composed from several
-- tables inherits the weakest table's RLS - debt #95. A client dashboard needs the same figures.)
--
-- One definition, two doors:
--   client_account_status_base : the computation, unfiltered. Granted to NOBODY (not anon, not authenticated): only the
--                                two views below, which run with their owner's rights, can read it.
--   client_account_status      : staff of the org / superadmin only - exactly the rows migration 080 allowed.
--   my_account_status          : a client sees ONLY their own rows (client_id = current_client_id(org_id)).
-- Both doors state their own access rule explicitly, so neither depends on any base table's RLS (the bug class of #95
-- and #110). The figures cannot differ, because there is one SELECT.
CREATE OR REPLACE VIEW public.client_account_status_base AS
WITH inv_detail AS (
  SELECT d.id, d.org_id, d.client_id, d.currency, d.total, d.due_date,
    coalesce((SELECT sum(a.amount) FROM public.billing_applications a WHERE a.document_id = d.id AND a.kind = 'payment' AND a.voided_at IS NULL), 0) AS paid,
    coalesce((SELECT sum(a.amount) FROM public.billing_applications a WHERE a.document_id = d.id AND a.kind = 'retainer_credit' AND a.voided_at IS NULL), 0) AS credited_from_retainer,
    coalesce((SELECT sum(c.total) FROM public.billing_documents c WHERE c.credit_for_id = d.id AND c.voided_at IS NULL), 0) AS credited_by_note
  FROM public.billing_documents d
  WHERE d.doc_type = 'invoice' AND d.voided_at IS NULL
),
inv_agg AS (
  SELECT org_id, client_id, currency,
    sum(total) AS total_invoiced,
    sum(paid) AS total_paid,
    sum(credited_from_retainer + credited_by_note) AS total_credited,
    sum(greatest(total - paid - credited_from_retainer - credited_by_note, 0)) AS outstanding,
    sum(greatest(total - paid - credited_from_retainer - credited_by_note, 0)) FILTER (WHERE due_date IS NOT NULL AND due_date < current_date) AS overdue
  FROM inv_detail
  GROUP BY org_id, client_id, currency
),
retainer_agg AS (
  SELECT r.org_id, r.client_id, r.currency,
    sum(greatest(r.total - coalesce((SELECT sum(a.amount) FROM public.billing_applications a WHERE a.source_document_id = r.id AND a.kind = 'retainer_credit' AND a.voided_at IS NULL), 0), 0)) AS retainer_credit
  FROM public.billing_documents r
  WHERE r.doc_type = 'retainer' AND r.voided_at IS NULL
  GROUP BY r.org_id, r.client_id, r.currency
),
payment_agg AS (
  SELECT p.org_id, p.client_id, p.currency,
    sum(greatest(p.amount - coalesce((SELECT sum(a.source_amount) FROM public.billing_applications a WHERE a.payment_id = p.id AND a.voided_at IS NULL), 0), 0)) AS payment_credit
  FROM public.billing_payments p
  WHERE p.voided_at IS NULL
  GROUP BY p.org_id, p.client_id, p.currency
),
keys AS (
  SELECT org_id, client_id, currency FROM inv_agg
  UNION SELECT org_id, client_id, currency FROM retainer_agg
  UNION SELECT org_id, client_id, currency FROM payment_agg
)
SELECT k.org_id, k.client_id, k.currency,
  coalesce(ia.total_invoiced, 0) AS total_invoiced,
  coalesce(ia.total_paid, 0) AS total_paid,
  coalesce(ia.total_credited, 0) AS total_credited,
  coalesce(ia.outstanding, 0) AS outstanding,
  coalesce(ia.overdue, 0) AS overdue,
  coalesce(ra.retainer_credit, 0) + coalesce(pa.payment_credit, 0) AS unapplied_credit,
  CASE
    WHEN coalesce(ia.overdue, 0) > 0 THEN 'overdue'
    WHEN coalesce(ia.outstanding, 0) > 0 THEN 'outstanding'
    WHEN coalesce(ra.retainer_credit, 0) + coalesce(pa.payment_credit, 0) > 0 THEN 'in_credit'
    ELSE 'settled'
  END AS status
FROM keys k
LEFT JOIN inv_agg ia ON ia.org_id = k.org_id AND ia.client_id = k.client_id AND ia.currency = k.currency
LEFT JOIN retainer_agg ra ON ra.org_id = k.org_id AND ra.client_id = k.client_id AND ra.currency = k.currency
LEFT JOIN payment_agg pa ON pa.org_id = k.org_id AND pa.client_id = k.client_id AND pa.currency = k.currency
;

REVOKE ALL ON public.client_account_status_base FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.client_account_status WITH (security_invoker = false) AS
SELECT * FROM public.client_account_status_base b
 WHERE ((b.org_id IN (SELECT public.user_org_ids())) AND public.user_is_staff(b.org_id)) OR public.is_superadmin();

CREATE OR REPLACE VIEW public.my_account_status WITH (security_invoker = false) AS
SELECT * FROM public.client_account_status_base b
 WHERE b.client_id = public.current_client_id(b.org_id);

REVOKE ALL ON public.client_account_status FROM anon;
REVOKE ALL ON public.my_account_status FROM anon;
GRANT SELECT ON public.client_account_status TO authenticated, service_role;
GRANT SELECT ON public.my_account_status TO authenticated, service_role;

-- PROMPT 41 Stage 4 - the client's account position, derived (never stored) from the engine's own figures, per
-- currency (never a combined cross-currency total - that would need a conversion nobody agreed to). Built fresh
-- rather than reused from billing_document_balances: that view's "outstanding" is correct for an INVOICE but
-- meaningless for a RETAINER's own row (nothing is ever "applied to" a retainer the way a payment is applied to
-- an invoice - what matters for a retainer is how much of its credit has been drawn down via
-- billing_applications.source_document_id, which billing_document_balances never looks at).
-- security_invoker=true, same as every other view here - and in practice this is staff-only regardless, since
-- billing_applications carries no client RLS policy at all (migration 074, debt #84): a client session's own
-- subqueries against it return nothing, so this view would undercount for a client even if one queried it.
CREATE OR REPLACE VIEW public.client_account_status WITH (security_invoker = true) AS
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
LEFT JOIN payment_agg pa ON pa.org_id = k.org_id AND pa.client_id = k.client_id AND pa.currency = k.currency;

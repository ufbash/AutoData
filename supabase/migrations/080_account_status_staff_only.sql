-- PROMPT 41 Stage 6 - the hostile-client re-test found client_account_status reachable by a client session, and
-- worse than merely reachable: WRONG for them. The view is security_invoker and composes several tables - some
-- (billing_documents, billing_payments) DO have a client SELECT policy, one (billing_applications, debt #84) does
-- not. A client's own correlated subqueries against billing_applications silently returned zero rows, which the
-- view's coalesce() turned into a confident-looking $0 "total_paid" and understated "outstanding" - not a blocked
-- read, a WRONG one, which is worse: a client reading this would see a plausible but incorrect account position.
-- Fix: the view was always meant to be staff-viewing-a-client, never the client's own portal (Stage 1's own
-- framing: "On the client page ... the account position") - make that structural, not an accident of which
-- underlying tables RLS happens to expose, by filtering the view's own output to staff/superadmin explicitly.
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
LEFT JOIN payment_agg pa ON pa.org_id = k.org_id AND pa.client_id = k.client_id AND pa.currency = k.currency
-- the structural fix: explicit staff/superadmin filter on the view's own output, independent of which underlying
-- tables a session's RLS happens to expose
WHERE ((k.org_id IN (SELECT user_org_ids())) AND user_is_staff(k.org_id)) OR is_superadmin();

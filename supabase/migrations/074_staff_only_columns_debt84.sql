-- PROMPT 40 Stage 4 - debt #84. Bashir's rule: "a table a client can read must contain only columns a client may
-- see." Postgres cannot column-restrict a shared PostgREST role (staff and clients both connect as `authenticated`,
-- distinguished only by RLS row checks) - so the only structural fix is to physically remove a staff-only column
-- from a table any client-scoped RLS policy can return rows from, and put it in a table with NO client policy at
-- all. Scope of this migration (stated plainly, not everything flagged in the audit is moved - see the audit table
-- in the Stage 4 report for the full reasoning on what was deferred and why):
--   * clients.notes / clients.assigned_agent -> client_staff_notes            (Bashir's named example)
--   * research_runs.notes                    -> research_runs_staff_notes    (genuine staff commentary, editable in ResearchRunDetail)
--   * billing_documents.notes                -> billing_documents_staff_notes (write-only today, never rendered - moved anyway on principle)
--   * billing_payments.notes                 -> billing_payments_staff_notes  (write-only today, never rendered)
--   * billing_receipts.notes                 -> billing_receipts_staff_notes  (never populated - moved for consistency)
--   * research_run_listings, billing_applications: the client SELECT policy is dropped outright - grep confirms
--     NOTHING in the client-facing code (clientPortalService.ts, ClientDashboard.tsx) ever reads either table; the
--     policy existed with zero legitimate use and 100% of every column exposed by base-table bypass.
-- Deferred (documented, not moved this pass - see the Stage 4 report): internal staff-actor-id audit columns
-- (created_by/deleted_by/voided_by/issued_by/recorded_by/applied_by/uploaded_by/promoted_by/imported_by/changed_by),
-- soft-delete bookkeeping (deleted_at/deleted_by - deeply wired into .is('deleted_at', null) filtering across many
-- list functions), share_token/share_enabled (a real secret, but confined to the client's own record and used
-- pervasively in staff UI - high blast radius to move for a lower-severity exposure), and
-- billing_document_lines' origin/basis/source_ref/component/computed_inputs (the highest-severity deferred item -
-- computed_inputs can carry internal cost figures - but these columns are load-bearing for the append-only
-- honesty-sealing trigger/constraint (billing_lines_seal, billing_lines_origin_shape) and CHECK constraints cannot
-- reference another table; moving them means rewriting the sealing engine itself, which is too large a change to
-- make safely alongside everything else in this migration. Flagged as the top follow-up priority.

-- ---------------------------------------------------------------- client_staff_notes
CREATE TABLE public.client_staff_notes (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  assigned_agent text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.client_staff_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_staff_notes_staff_all ON public.client_staff_notes FOR ALL
  USING (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin())
  WITH CHECK (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin());

INSERT INTO public.client_staff_notes (client_id, org_id, assigned_agent, notes, updated_at)
  SELECT id, org_id, assigned_agent, notes, now() FROM public.clients;

ALTER TABLE public.clients DROP COLUMN assigned_agent, DROP COLUMN notes;

-- ---------------------------------------------------------------- research_runs_staff_notes
CREATE TABLE public.research_runs_staff_notes (
  run_id uuid PRIMARY KEY REFERENCES public.research_runs(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.research_runs_staff_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_runs_staff_notes_staff_all ON public.research_runs_staff_notes FOR ALL
  USING (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin())
  WITH CHECK (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin());

INSERT INTO public.research_runs_staff_notes (run_id, org_id, notes, updated_at)
  SELECT id, org_id, notes, now() FROM public.research_runs;

ALTER TABLE public.research_runs DROP COLUMN notes;

-- ---------------------------------------------------------------- billing_documents_staff_notes
CREATE TABLE public.billing_documents_staff_notes (
  document_id uuid PRIMARY KEY REFERENCES public.billing_documents(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.billing_documents_staff_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_documents_staff_notes_staff_all ON public.billing_documents_staff_notes FOR ALL
  USING (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin())
  WITH CHECK (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin());

INSERT INTO public.billing_documents_staff_notes (document_id, org_id, notes, updated_at)
  SELECT id, org_id, notes, now() FROM public.billing_documents WHERE notes IS NOT NULL;

ALTER TABLE public.billing_documents DROP COLUMN notes;

-- ---------------------------------------------------------------- billing_payments_staff_notes
CREATE TABLE public.billing_payments_staff_notes (
  payment_id uuid PRIMARY KEY REFERENCES public.billing_payments(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.billing_payments_staff_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_payments_staff_notes_staff_all ON public.billing_payments_staff_notes FOR ALL
  USING (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin())
  WITH CHECK (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin());

INSERT INTO public.billing_payments_staff_notes (payment_id, org_id, notes, updated_at)
  SELECT id, org_id, notes, now() FROM public.billing_payments WHERE notes IS NOT NULL;

ALTER TABLE public.billing_payments DROP COLUMN notes;

-- ---------------------------------------------------------------- billing_receipts_staff_notes
CREATE TABLE public.billing_receipts_staff_notes (
  receipt_id uuid PRIMARY KEY REFERENCES public.billing_receipts(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.billing_receipts_staff_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_receipts_staff_notes_staff_all ON public.billing_receipts_staff_notes FOR ALL
  USING (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin())
  WITH CHECK (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin());

INSERT INTO public.billing_receipts_staff_notes (receipt_id, org_id, notes, updated_at)
  SELECT id, org_id, notes, now() FROM public.billing_receipts WHERE notes IS NOT NULL;

ALTER TABLE public.billing_receipts DROP COLUMN notes;

-- ---------------------------------------------------------------- zero-legitimate-use client policies: drop
DROP POLICY IF EXISTS research_run_listings_select_client ON public.research_run_listings;
DROP POLICY IF EXISTS billing_applications_select_client ON public.billing_applications;

-- ---------------------------------------------------------------- writers updated: `notes` now lands in the
-- companion staff-only table instead of the (now-dropped) column. Nothing else about these functions changes.
CREATE OR REPLACE FUNCTION public.issue_billing_document(p_doc jsonb, p_lines jsonb, p_apply jsonb, p_user uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id uuid := gen_random_uuid();
  org uuid := (p_doc ->> 'org_id')::uuid;
  num public.document_numbers;
  calc jsonb;
  total numeric; applied numeric := 0; bal numeric;
  cur text := p_doc ->> 'currency';
  settle text := coalesce(p_doc ->> 'settlement_currency', p_doc ->> 'currency');
  fx numeric := nullif(p_doc ->> 'fx_rate', '')::numeric;
  now_ts timestamptz := now();
  a jsonb; doc_notes text := nullif(p_doc ->> 'notes', '');
BEGIN
  SELECT * INTO num FROM public.document_numbers WHERE id = (p_doc ->> 'number_id')::uuid FOR UPDATE;
  IF NOT FOUND OR num.org_id <> org OR num.kind <> (p_doc ->> 'doc_type') OR num.status <> 'allocated' THEN
    RAISE EXCEPTION 'The document number is not available to issue (must be an allocated % number of this org)', p_doc ->> 'doc_type';
  END IF;
  calc := public.billing_compute(jsonb_build_object('org_id', org, 'issue_date', p_doc ->> 'issue_date', 'lines', p_lines,
            'invoice_discount', coalesce(p_doc -> 'invoice_discount', '{"type":"none","value":0}'::jsonb),
            'adjustment', coalesce(nullif(p_doc ->> 'adjustment_amount', '')::numeric, 0)));
  total := (calc ->> 'total')::numeric;
  SELECT coalesce(sum((x ->> 'amount')::numeric), 0) INTO applied FROM jsonb_array_elements(coalesce(p_apply, '[]'::jsonb)) x;
  bal := total - applied;

  INSERT INTO public.billing_documents (
    id, org_id, doc_type, invoice_kind, number_id, number_seq, number_text, client_id, won_vehicle_id,
    external_plate, external_vin, external_description, reference, issue_date, due_date, currency, settlement_currency,
    fx_rate, fx_basis, fx_rate_date, fx_source, credit_for_id, scope_statement,
    subtotal, line_discount_total, invoice_discount_type, invoice_discount_value, invoice_discount_amount,
    adjustment_label, adjustment_amount, tax_total, tax_breakdown, total, applied_at_issue, balance_at_issue,
    settlement_balance_at_issue, org_snapshot, file_id, idempotency_key, request_hash, issued_by, issued_at, recorded_at)
  VALUES (
    new_id, org, p_doc ->> 'doc_type', nullif(p_doc ->> 'invoice_kind', ''), num.id, num.seq, num.number_text,
    (p_doc ->> 'client_id')::uuid, nullif(p_doc ->> 'won_vehicle_id', '')::uuid,
    nullif(p_doc ->> 'external_plate', ''), nullif(p_doc ->> 'external_vin', ''), nullif(p_doc ->> 'external_description', ''),
    nullif(p_doc ->> 'reference', ''), (p_doc ->> 'issue_date')::date, nullif(p_doc ->> 'due_date', '')::date, cur, settle,
    fx, nullif(p_doc ->> 'fx_basis', ''), nullif(p_doc ->> 'fx_rate_date', '')::date, nullif(p_doc ->> 'fx_source', ''),
    nullif(p_doc ->> 'credit_for_id', '')::uuid, nullif(p_doc ->> 'scope_statement', ''),
    (calc ->> 'subtotal')::numeric, (calc ->> 'line_discount_total')::numeric,
    coalesce(p_doc -> 'invoice_discount' ->> 'type', 'none'), coalesce((p_doc -> 'invoice_discount' ->> 'value')::numeric, 0),
    (calc ->> 'invoice_discount_amount')::numeric, nullif(p_doc ->> 'adjustment_label', ''),
    (calc ->> 'adjustment')::numeric, (calc ->> 'tax_total')::numeric, calc -> 'tax_breakdown', total, applied, bal,
    CASE WHEN settle <> cur THEN round(bal * fx, 2) END, p_doc -> 'org_snapshot', (p_doc ->> 'file_id')::uuid,
    nullif(p_doc ->> 'idempotency_key', ''), nullif(p_doc ->> 'request_hash', ''), p_user, now_ts, now_ts);

  IF doc_notes IS NOT NULL THEN
    INSERT INTO public.billing_documents_staff_notes (document_id, org_id, notes, updated_at, updated_by) VALUES (new_id, org, doc_notes, now_ts, p_user);
  END IF;

  INSERT INTO public.billing_document_lines (org_id, document_id, position, section, component, description, quantity, rate,
    discount_type, discount_value, gross_amount, discount_amount, net_amount, tax_code, tax_rate, client_visible, origin, basis,
    source_ref, source_document_id, computed_inputs)
  SELECT org, new_id, (l ->> 'position')::integer, coalesce(l ->> 'section', ''), nullif(l ->> 'component', ''), l ->> 'description',
         (l ->> 'quantity')::numeric, (l ->> 'rate')::numeric, coalesce(l ->> 'discount_type', 'none'),
         coalesce((l ->> 'discount_value')::numeric, 0), c.gross, c.disc, c.net, c.tc, c.tr,
         coalesce((l ->> 'client_visible')::boolean, true), l ->> 'origin', nullif(l ->> 'basis', ''), nullif(l ->> 'source_ref', ''),
         nullif(l ->> 'source_document_id', '')::uuid,
         CASE WHEN jsonb_typeof(l -> 'computed_inputs') IN ('object', 'array') THEN l -> 'computed_inputs' END
    FROM jsonb_array_elements(p_lines) AS t(l)
    JOIN LATERAL (SELECT (x ->> 'gross_amount')::numeric AS gross, (x ->> 'discount_amount')::numeric AS disc, (x ->> 'net_amount')::numeric AS net,
                         x ->> 'tax_code' AS tc, (x ->> 'tax_rate')::numeric AS tr
                    FROM jsonb_array_elements(calc -> 'lines') x WHERE (x ->> 'position')::integer = (l ->> 'position')::integer) c ON true;

  UPDATE public.document_numbers SET status = 'issued', ref_id = new_id, status_changed_at = now() WHERE id = num.id;

  FOR a IN SELECT x FROM jsonb_array_elements(coalesce(p_apply, '[]'::jsonb)) AS t(x) LOOP
    INSERT INTO public.billing_applications (org_id, kind, payment_id, source_document_id, document_id, amount, source_amount, applied_at, applied_by, note)
    VALUES (org, a ->> 'kind', CASE WHEN a ->> 'kind' = 'payment' THEN (a ->> 'source_id')::uuid END,
            CASE WHEN a ->> 'kind' = 'retainer_credit' THEN (a ->> 'source_id')::uuid END, new_id,
            (a ->> 'amount')::numeric, (a ->> 'source_amount')::numeric, now_ts, p_user, nullif(a ->> 'note', ''));
  END LOOP;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_billing_document(p_doc jsonb, p_lines jsonb, p_apply jsonb, p_user uuid, p_recorded_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id uuid := gen_random_uuid();
  org uuid := (p_doc ->> 'org_id')::uuid;
  num public.document_numbers;
  calc jsonb;
  total numeric; applied numeric := 0; bal numeric;
  cur text := p_doc ->> 'currency';
  settle text := coalesce(p_doc ->> 'settlement_currency', p_doc ->> 'currency');
  fx numeric := nullif(p_doc ->> 'fx_rate', '')::numeric;
  a jsonb; doc_notes text := nullif(p_doc ->> 'notes', '');
BEGIN
  SELECT * INTO num FROM public.document_numbers WHERE id = (p_doc ->> 'number_id')::uuid FOR UPDATE;
  IF NOT FOUND OR num.org_id <> org OR num.kind <> (p_doc ->> 'doc_type') OR num.status <> 'allocated' THEN
    RAISE EXCEPTION 'The document number is not available to import (must be an allocated % number of this org)', p_doc ->> 'doc_type';
  END IF;
  calc := public.billing_compute(jsonb_build_object('org_id', org, 'issue_date', p_doc ->> 'issue_date', 'lines', p_lines,
            'invoice_discount', coalesce(p_doc -> 'invoice_discount', '{"type":"none","value":0}'::jsonb),
            'adjustment', coalesce(nullif(p_doc ->> 'adjustment_amount', '')::numeric, 0)));
  total := (calc ->> 'total')::numeric;
  SELECT coalesce(sum((x ->> 'amount')::numeric), 0) INTO applied FROM jsonb_array_elements(coalesce(p_apply, '[]'::jsonb)) x;
  bal := total - applied;
  IF p_doc ? 'expected_total' AND round((p_doc ->> 'expected_total')::numeric, 2) <> round(total, 2) THEN
    RAISE EXCEPTION 'The lines compute to % but the import expected % - these must reconcile exactly', total, p_doc ->> 'expected_total';
  END IF;

  INSERT INTO public.billing_documents (
    id, org_id, doc_type, invoice_kind, number_id, number_seq, number_text, client_id, won_vehicle_id,
    external_plate, external_vin, external_description, reference, issue_date, due_date, currency, settlement_currency,
    fx_rate, fx_basis, fx_rate_date, fx_source, credit_for_id, scope_statement,
    subtotal, line_discount_total, invoice_discount_type, invoice_discount_value, invoice_discount_amount,
    adjustment_label, adjustment_amount, tax_total, tax_breakdown, total, applied_at_issue, balance_at_issue,
    settlement_balance_at_issue, org_snapshot, file_id, idempotency_key, request_hash, issued_by, issued_at, recorded_at,
    imported, imported_at, imported_by)
  VALUES (
    new_id, org, p_doc ->> 'doc_type', nullif(p_doc ->> 'invoice_kind', ''), num.id, num.seq, num.number_text,
    (p_doc ->> 'client_id')::uuid, nullif(p_doc ->> 'won_vehicle_id', '')::uuid,
    nullif(p_doc ->> 'external_plate', ''), nullif(p_doc ->> 'external_vin', ''), nullif(p_doc ->> 'external_description', ''),
    nullif(p_doc ->> 'reference', ''), (p_doc ->> 'issue_date')::date, nullif(p_doc ->> 'due_date', '')::date, cur, settle,
    fx, nullif(p_doc ->> 'fx_basis', ''), nullif(p_doc ->> 'fx_rate_date', '')::date, nullif(p_doc ->> 'fx_source', ''),
    nullif(p_doc ->> 'credit_for_id', '')::uuid, nullif(p_doc ->> 'scope_statement', ''),
    (calc ->> 'subtotal')::numeric, (calc ->> 'line_discount_total')::numeric,
    coalesce(p_doc -> 'invoice_discount' ->> 'type', 'none'), coalesce((p_doc -> 'invoice_discount' ->> 'value')::numeric, 0),
    (calc ->> 'invoice_discount_amount')::numeric, nullif(p_doc ->> 'adjustment_label', ''),
    (calc ->> 'adjustment')::numeric, (calc ->> 'tax_total')::numeric, calc -> 'tax_breakdown', total, applied, bal,
    CASE WHEN settle <> cur THEN round(bal * fx, 2) END, p_doc -> 'org_snapshot', (p_doc ->> 'file_id')::uuid,
    nullif(p_doc ->> 'idempotency_key', ''), nullif(p_doc ->> 'request_hash', ''), p_user, p_recorded_at, now(),
    true, now(), p_user);

  IF doc_notes IS NOT NULL THEN
    INSERT INTO public.billing_documents_staff_notes (document_id, org_id, notes, updated_at, updated_by) VALUES (new_id, org, doc_notes, now(), p_user);
  END IF;

  INSERT INTO public.billing_document_lines (org_id, document_id, position, section, component, description, quantity, rate,
    discount_type, discount_value, gross_amount, discount_amount, net_amount, tax_code, tax_rate, client_visible, origin, basis,
    source_ref, source_document_id, computed_inputs)
  SELECT org, new_id, (l ->> 'position')::integer, coalesce(l ->> 'section', ''), nullif(l ->> 'component', ''), l ->> 'description',
         (l ->> 'quantity')::numeric, (l ->> 'rate')::numeric, coalesce(l ->> 'discount_type', 'none'),
         coalesce((l ->> 'discount_value')::numeric, 0), c.gross, c.disc, c.net, c.tc, c.tr,
         coalesce((l ->> 'client_visible')::boolean, true), l ->> 'origin', nullif(l ->> 'basis', ''), nullif(l ->> 'source_ref', ''),
         nullif(l ->> 'source_document_id', '')::uuid,
         CASE WHEN jsonb_typeof(l -> 'computed_inputs') IN ('object', 'array') THEN l -> 'computed_inputs' END
    FROM jsonb_array_elements(p_lines) AS t(l)
    JOIN LATERAL (SELECT (x ->> 'gross_amount')::numeric AS gross, (x ->> 'discount_amount')::numeric AS disc, (x ->> 'net_amount')::numeric AS net,
                         x ->> 'tax_code' AS tc, (x ->> 'tax_rate')::numeric AS tr
                    FROM jsonb_array_elements(calc -> 'lines') x WHERE (x ->> 'position')::integer = (l ->> 'position')::integer) c ON true;

  UPDATE public.document_numbers SET status = 'issued', ref_id = new_id, status_changed_at = now() WHERE id = num.id;

  FOR a IN SELECT x FROM jsonb_array_elements(coalesce(p_apply, '[]'::jsonb)) AS t(x) LOOP
    INSERT INTO public.billing_applications (org_id, kind, payment_id, source_document_id, document_id, amount, source_amount, applied_at, applied_by, note)
    VALUES (org, a ->> 'kind', CASE WHEN a ->> 'kind' = 'payment' THEN (a ->> 'source_id')::uuid END,
            CASE WHEN a ->> 'kind' = 'retainer_credit' THEN (a ->> 'source_id')::uuid END, new_id,
            (a ->> 'amount')::numeric, (a ->> 'source_amount')::numeric, now(), p_user, nullif(a ->> 'note', ''));
  END LOOP;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_billing_receipt(p_org uuid, p_payment uuid, p_number_id uuid, p_file_id uuid, p_snapshot jsonb, p_user uuid, p_notes text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid := gen_random_uuid(); num public.document_numbers; pay public.billing_payments; rnotes text := nullif(p_notes, '');
BEGIN
  SELECT * INTO num FROM public.document_numbers WHERE id = p_number_id FOR UPDATE;
  IF NOT FOUND OR num.org_id <> p_org OR num.kind <> 'receipt' OR num.status <> 'allocated' THEN
    RAISE EXCEPTION 'The receipt number is not available to issue';
  END IF;
  SELECT * INTO pay FROM public.billing_payments WHERE id = p_payment;
  INSERT INTO public.billing_receipts (id, org_id, client_id, payment_id, file_id, number_id, receipt_number, number_seq, snapshot, issued_by)
  VALUES (rid, p_org, pay.client_id, p_payment, p_file_id, num.id, num.number_text, num.seq, p_snapshot, p_user);
  IF rnotes IS NOT NULL THEN
    INSERT INTO public.billing_receipts_staff_notes (receipt_id, org_id, notes, updated_by) VALUES (rid, p_org, rnotes, p_user);
  END IF;
  UPDATE public.document_numbers SET status = 'issued', ref_id = rid, status_changed_at = now() WHERE id = num.id;
  RETURN rid;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_billing_payment(p_org uuid, p_client uuid, p_vehicle uuid, p_amount numeric, p_currency text, p_paid_at date, p_method text, p_purpose text, p_reference text, p_notes text, p_user uuid, p_apply jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid := gen_random_uuid(); a jsonb; pnotes text := nullif(p_notes, '');
BEGIN
  INSERT INTO public.billing_payments (id, org_id, client_id, won_vehicle_id, amount, currency, paid_at, method, purpose, reference, recorded_by)
  VALUES (pid, p_org, p_client, p_vehicle, p_amount, p_currency, p_paid_at, p_method, coalesce(p_purpose, 'payment'), nullif(p_reference, ''), p_user);
  IF pnotes IS NOT NULL THEN
    INSERT INTO public.billing_payments_staff_notes (payment_id, org_id, notes, updated_by) VALUES (pid, p_org, pnotes, p_user);
  END IF;
  FOR a IN SELECT x FROM jsonb_array_elements(coalesce(p_apply, '[]'::jsonb)) AS t(x) LOOP
    INSERT INTO public.billing_applications (org_id, kind, payment_id, document_id, amount, source_amount, applied_by, note)
    VALUES (p_org, 'payment', pid, (a ->> 'document_id')::uuid, (a ->> 'amount')::numeric, (a ->> 'source_amount')::numeric, p_user, nullif(a ->> 'note', ''));
  END LOOP;
  RETURN pid;
END;
$$;

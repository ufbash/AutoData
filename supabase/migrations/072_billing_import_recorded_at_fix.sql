-- PROMPT 40 Stage 3 fix - the lines-seal trigger (billing_lines_seal) requires billing_documents.recorded_at to equal
-- the CURRENT transaction timestamp (now()) at the moment lines are inserted - it is what marks "these lines were
-- inserted in the same transaction that created the document", not a historical marker. import_billing_document
-- wrongly backdated recorded_at to the historical import date, which can never equal now() and so the very first
-- import attempt (INV-0025) was correctly refused by the seal. Fix: recorded_at is always the REAL time of the
-- import (now()); issued_at and issue_date carry the historical date, exactly as the (already correct) document
-- shows it printed.
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
  a jsonb;
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
    fx_rate, fx_basis, fx_rate_date, fx_source, credit_for_id, scope_statement, notes,
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
    nullif(p_doc ->> 'credit_for_id', '')::uuid, nullif(p_doc ->> 'scope_statement', ''), nullif(p_doc ->> 'notes', ''),
    (calc ->> 'subtotal')::numeric, (calc ->> 'line_discount_total')::numeric,
    coalesce(p_doc -> 'invoice_discount' ->> 'type', 'none'), coalesce((p_doc -> 'invoice_discount' ->> 'value')::numeric, 0),
    (calc ->> 'invoice_discount_amount')::numeric, nullif(p_doc ->> 'adjustment_label', ''),
    (calc ->> 'adjustment')::numeric, (calc ->> 'tax_total')::numeric, calc -> 'tax_breakdown', total, applied, bal,
    CASE WHEN settle <> cur THEN round(bal * fx, 2) END, p_doc -> 'org_snapshot', (p_doc ->> 'file_id')::uuid,
    nullif(p_doc ->> 'idempotency_key', ''), nullif(p_doc ->> 'request_hash', ''), p_user, p_recorded_at, now(),
    true, now(), p_user);

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

REVOKE EXECUTE ON FUNCTION public.import_billing_document(jsonb, jsonb, jsonb, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_billing_document(jsonb, jsonb, jsonb, uuid, timestamptz) TO service_role;

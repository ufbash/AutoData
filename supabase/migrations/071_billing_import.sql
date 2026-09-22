-- PROMPT 40 Stage 3 - importing Caplimo's pre-platform invoices as HISTORY, keeping their original numbers, without
-- moving the counter. The real org's counter already sits at 27 (last_seq=27, next INV-0028) - that number ALONE
-- already stops 1-27 ever being allocated again (allocate_document_number only ever increments), but nothing yet
-- says WHY those numbers are missing from the ledger, or lets anyone see INV-0025/0026/0027 as real documents.
-- This closes that: an import inserts the historical ledger rows directly (never through allocate_document_number,
-- which always takes the NEXT seq) and an issued document for each, going through the SAME arithmetic authority
-- (billing_compute / check_billing_document) as any live-issued invoice - an import whose lines don't reconcile
-- with its own recorded total is refused exactly like any other document.

ALTER TABLE public.billing_documents
  ADD COLUMN IF NOT EXISTS imported boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS imported_by uuid REFERENCES auth.users (id);
ALTER TABLE public.billing_documents
  ADD CONSTRAINT billing_documents_imported_pair CHECK ((imported = false) = (imported_at IS NULL AND imported_by IS NULL));

-- Inserts a HISTORICAL ledger row at a SPECIFIC seq (never the next-in-line one allocate_document_number would give),
-- refusing if that seq is already taken OR if it would collide with or exceed the live counter (an import can only
-- ever fill in the past - it can never reach into or past what the counter already considers current/future).
CREATE OR REPLACE FUNCTION public.import_document_number(p_org uuid, p_kind text, p_seq integer, p_number_text text, p_user uuid)
RETURNS public.document_numbers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur integer; r public.document_numbers;
BEGIN
  IF p_kind NOT IN ('invoice', 'retainer', 'credit_note', 'receipt') THEN RAISE EXCEPTION 'Unknown document kind %', p_kind; END IF;
  SELECT last_seq INTO cur FROM public.document_sequences WHERE org_id = p_org AND kind = p_kind;
  IF cur IS NULL OR p_seq >= cur + 1 THEN
    RAISE EXCEPTION 'An import can only fill a number strictly before the current counter (counter is at %, tried %)', coalesce(cur, 0), p_seq;
  END IF;
  INSERT INTO public.document_numbers (org_id, kind, seq, number_text, status, allocated_by)
  VALUES (p_org, p_kind, p_seq, p_number_text, 'allocated', p_user)
  RETURNING * INTO r;
  RETURN r;
END;
$$;

-- Same issuing path as a live document (billing_compute owns the arithmetic; check_billing_document refuses any
-- disagreement at commit), except: the number comes from import_document_number above (a past seq, not the next
-- one), issued_at/recorded_at are backdated to the REAL historical date, and the document is flagged imported.
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
  -- The recorded total must match what Bashir supplied on the import form - a wrong figure is refused HERE, before
  -- ever touching the ledger, not just by the deferred check after insert (which would still catch it, but this
  -- gives a clearer message for an import specifically).
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
    nullif(p_doc ->> 'idempotency_key', ''), nullif(p_doc ->> 'request_hash', ''), p_user, p_recorded_at, p_recorded_at,
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

  UPDATE public.document_numbers SET status = 'issued', ref_id = new_id, status_changed_at = p_recorded_at WHERE id = num.id;

  FOR a IN SELECT x FROM jsonb_array_elements(coalesce(p_apply, '[]'::jsonb)) AS t(x) LOOP
    INSERT INTO public.billing_applications (org_id, kind, payment_id, source_document_id, document_id, amount, source_amount, applied_at, applied_by, note)
    VALUES (org, a ->> 'kind', CASE WHEN a ->> 'kind' = 'payment' THEN (a ->> 'source_id')::uuid END,
            CASE WHEN a ->> 'kind' = 'retainer_credit' THEN (a ->> 'source_id')::uuid END, new_id,
            (a ->> 'amount')::numeric, (a ->> 'source_amount')::numeric, p_recorded_at, p_user, nullif(a ->> 'note', ''));
  END LOOP;
  RETURN new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_document_number(uuid, text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.import_billing_document(jsonb, jsonb, jsonb, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_document_number(uuid, text, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.import_billing_document(jsonb, jsonb, jsonb, uuid, timestamptz) TO service_role;

-- Voiding an IMPORTED document (e.g. INV-0026, superseded by INV-0027) must still go through the normal void
-- function (reason required, releases nothing, keeps the number as 'voided') - no special path needed; the existing
-- void_billing_record already handles any billing_documents row identically regardless of the imported flag.

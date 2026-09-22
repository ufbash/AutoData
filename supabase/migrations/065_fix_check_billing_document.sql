-- PROMPT 38 Phase A - fix found by the first live issue (22 Sep 2026): check_billing_document() is shared by the documents and the lines
-- triggers, and read NEW.document_id even when fired from billing_documents, which has no such column ("record new has no field
-- document_id"). The id is now read through to_jsonb(NEW), so one function serves both tables. No table, data or rule changes.
CREATE OR REPLACE FUNCTION public.check_billing_document()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  doc_id uuid := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'billing_documents' THEN 'id' ELSE 'document_id' END)::uuid;
  d public.billing_documents;
  lines jsonb;
  calc jsonb;
  cl jsonb;
  sl record;
  n_lines integer;
  n_visible integer;
  n_hidden integer;
  n_allin integer;
  num public.document_numbers;
BEGIN
  SELECT * INTO d FROM public.billing_documents WHERE id = doc_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*), count(*) FILTER (WHERE client_visible), count(*) FILTER (WHERE NOT client_visible),
         count(*) FILTER (WHERE client_visible AND component = 'all_inclusive_price')
    INTO n_lines, n_visible, n_hidden, n_allin FROM public.billing_document_lines WHERE document_id = doc_id;
  IF n_lines = 0 THEN RAISE EXCEPTION 'A document needs at least one line'; END IF;

  SELECT jsonb_agg(jsonb_build_object('position', position, 'section', section, 'quantity', quantity, 'rate', rate,
                                      'discount_type', discount_type, 'discount_value', discount_value, 'tax_code', tax_code,
                                      'client_visible', client_visible)
                   ORDER BY position)
    INTO lines FROM public.billing_document_lines WHERE document_id = doc_id;
  calc := public.billing_compute(jsonb_build_object('org_id', d.org_id, 'issue_date', d.issue_date, 'lines', lines,
            'invoice_discount', jsonb_build_object('type', d.invoice_discount_type, 'value', d.invoice_discount_value),
            'adjustment', d.adjustment_amount));

  FOR sl IN SELECT * FROM public.billing_document_lines WHERE document_id = doc_id ORDER BY position LOOP
    SELECT x INTO cl FROM jsonb_array_elements(calc -> 'lines') AS t(x) WHERE (x ->> 'position')::integer = sl.position;
    IF (cl ->> 'gross_amount')::numeric <> sl.gross_amount OR (cl ->> 'discount_amount')::numeric <> sl.discount_amount
       OR (cl ->> 'net_amount')::numeric <> sl.net_amount OR (cl ->> 'tax_rate')::numeric <> sl.tax_rate THEN
      RAISE EXCEPTION 'Line % does not match the figure the rules produce (stored net %, computed %)', sl.position, sl.net_amount, cl ->> 'net_amount';
    END IF;
  END LOOP;
  IF (calc ->> 'subtotal')::numeric <> d.subtotal OR (calc ->> 'line_discount_total')::numeric <> d.line_discount_total
     OR (calc ->> 'invoice_discount_amount')::numeric <> d.invoice_discount_amount OR (calc ->> 'tax_total')::numeric <> d.tax_total
     OR (calc ->> 'total')::numeric <> d.total OR (calc -> 'tax_breakdown') IS DISTINCT FROM d.tax_breakdown THEN
    RAISE EXCEPTION 'The document totals do not match the figures the rules produce (stored total %, computed %)', d.total, calc ->> 'total';
  END IF;
  IF d.settlement_currency <> d.currency AND d.settlement_balance_at_issue <> round(d.balance_at_issue * d.fx_rate, 2) THEN
    RAISE EXCEPTION 'The settlement balance must be the balance at the frozen rate';
  END IF;

  -- the kind rules (charter 4): brokerage-style and repair invoices disclose every line; a retail invoice shows one
  -- all-inclusive price and keeps its cost lines internal (client_visible = false)
  IF d.doc_type = 'invoice' AND d.invoice_kind = 'retail' THEN
    IF n_visible <> 1 OR n_allin <> 1 THEN
      RAISE EXCEPTION 'A retail invoice shows exactly one client-visible line, the all-inclusive price; cost and margin lines stay internal';
    END IF;
  ELSE
    IF n_hidden > 0 THEN RAISE EXCEPTION 'Only a retail invoice may have internal (hidden) lines; every line here is disclosed'; END IF;
    IF n_allin > 0 THEN RAISE EXCEPTION 'An all-inclusive price line belongs to a retail invoice only'; END IF;
  END IF;
  -- a purchase or retail invoice must say what it covers and what will be invoiced separately (replaces the six-component banner)
  IF d.doc_type = 'invoice' AND d.invoice_kind IN ('vehicle_purchase', 'retail') AND btrim(coalesce(d.scope_statement, '')) = '' THEN
    RAISE EXCEPTION 'A % invoice must carry a scope statement: what it covers and what will be invoiced separately', d.invoice_kind;
  END IF;

  SELECT * INTO num FROM public.document_numbers WHERE id = d.number_id;
  IF num.status NOT IN ('issued', 'voided') OR num.ref_id IS DISTINCT FROM d.id THEN
    RAISE EXCEPTION 'The ledger number must be marked issued by this document';
  END IF;
  RETURN NULL;
END;
$$;

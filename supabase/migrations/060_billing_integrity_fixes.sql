-- PROMPT 37 Phase 2 - fixes for what the independent verifier found in migrations 058-059. Additive and tightening:
-- nothing here changes an existing amount, date, source or number.
--
--  1. THE FAILURE, closed at the database. 059 said "the database refuses to hold" an invoice presented as complete
--     while a component is missing, but a $0.00 line (staff-entered with a basis of "n/a", or computed) still got through
--     at the database - the zero rule lived only in the JavaScript. Now: a zero amount is refused on every line except a
--     WAIVED BROKERAGE FEE (staff-entered, with its basis); a component that costs nothing is excluded with a reason, not
--     zeroed; and a computed line must carry the source it was computed from.
--  2. An issued invoice's lines are sealed: a line can only be inserted in the SAME transaction that inserts its invoice.
--  3. A generated invoice or a receipt must use a number that really came from the ledger (right org, kind, seq, text,
--     status), and a receipt's org and vehicle must match its payment.
--  4. A document referenced by a live invoice or receipt cannot be soft-deleted (the "You do not have access" dead end).
--  5. TRUNCATE is refused on every new table (only document_numbers had it).
--  6. request_hash: the same idempotency key with DIFFERENT content is a conflict, not a silent return of the old invoice.

ALTER TABLE public.won_vehicle_invoice_issuances ADD COLUMN IF NOT EXISTS request_hash text;

-- guard: freeze request_hash too
CREATE OR REPLACE FUNCTION public.won_vehicle_invoice_issuances_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An invoice issuance is never deleted - void it with a reason instead';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'A voided invoice issuance cannot be changed';
  END IF;
  IF (NEW.id, NEW.org_id, NEW.won_vehicle_id, NEW.document_id, NEW.invoice_number, NEW.amount, NEW.currency,
      NEW.channel, NEW.recipient, NEW.issued_at, NEW.issued_by, NEW.recorded_at, NEW.notes,
      NEW.generated, NEW.number_seq, NEW.hat, NEW.scope, NEW.excluded_components, NEW.amount_usd,
      NEW.fx_rate, NEW.fx_rate_date, NEW.fx_source, NEW.idempotency_key, NEW.request_hash)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.won_vehicle_id, OLD.document_id, OLD.invoice_number, OLD.amount, OLD.currency,
      OLD.channel, OLD.recipient, OLD.issued_at, OLD.issued_by, OLD.recorded_at, OLD.notes,
      OLD.generated, OLD.number_seq, OLD.hat, OLD.scope, OLD.excluded_components, OLD.amount_usd,
      OLD.fx_rate, OLD.fx_rate_date, OLD.fx_source, OLD.idempotency_key, OLD.request_hash) THEN
    RAISE EXCEPTION 'An invoice issuance is never edited - void it and record a new one';
  END IF;
  IF NEW.voided_at IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.won_vehicle_payments p WHERE p.issuance_id = OLD.id AND p.voided_at IS NULL) THEN
    RAISE EXCEPTION 'This invoice has live payments recorded against it - void the payments (each with a reason) before voiding the invoice';
  END IF;
  RETURN NEW;
END;
$$;

-- (1) the zero rule and the computed-source rule, added to the shape check that runs at commit
CREATE OR REPLACE FUNCTION public.check_generated_invoice(p_issuance uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  inv public.won_vehicle_invoice_issuances;
  n integer;
  vis_sum numeric;
  usd_sum numeric;
  bad integer;
  required text[] := ARRAY['vehicle_price', 'auction_fees', 'inland_trucking', 'ocean_freight', 'duty', 'brokerage_fee'];
  visible_kinds text[];
  excluded_kinds text[];
  k text;
BEGIN
  SELECT * INTO inv FROM public.won_vehicle_invoice_issuances WHERE id = p_issuance;
  IF NOT FOUND OR NOT inv.generated THEN RETURN; END IF;

  SELECT count(*) INTO n FROM public.won_vehicle_invoice_lines WHERE issuance_id = p_issuance;
  IF n = 0 THEN RAISE EXCEPTION 'A generated invoice needs at least one line'; END IF;

  -- A zero is what a silently zeroed, abstaining component looks like: only a waived brokerage fee may be zero.
  SELECT count(*) INTO bad FROM public.won_vehicle_invoice_lines
   WHERE issuance_id = p_issuance AND amount_usd = 0 AND NOT (kind = 'brokerage_fee' AND origin = 'staff_entered');
  IF bad > 0 THEN
    RAISE EXCEPTION '% invoice line(s) have a zero amount - a component with no real figure is excluded with a reason, not zeroed (only a waived brokerage fee may be zero)', bad;
  END IF;
  SELECT count(*) INTO bad FROM public.won_vehicle_invoice_lines
   WHERE issuance_id = p_issuance AND origin = 'computed' AND btrim(coalesce(source_ref, '')) = '';
  IF bad > 0 THEN RAISE EXCEPTION '% computed invoice line(s) do not say what they were computed from', bad; END IF;

  SELECT COALESCE(sum(amount), 0), COALESCE(sum(amount_usd), 0) INTO vis_sum, usd_sum
    FROM public.won_vehicle_invoice_lines WHERE issuance_id = p_issuance AND client_visible;
  IF vis_sum <> inv.amount OR usd_sum <> inv.amount_usd THEN
    RAISE EXCEPTION 'Invoice total (% / % USD) does not equal the sum of its client-visible lines (% / % USD)', inv.amount, inv.amount_usd, vis_sum, usd_sum;
  END IF;

  IF inv.currency = 'USD' THEN
    SELECT count(*) INTO bad FROM public.won_vehicle_invoice_lines WHERE issuance_id = p_issuance AND amount <> amount_usd;
  ELSE
    SELECT count(*) INTO bad FROM public.won_vehicle_invoice_lines WHERE issuance_id = p_issuance AND amount <> round(amount_usd * inv.fx_rate, 2);
  END IF;
  IF bad > 0 THEN RAISE EXCEPTION '% invoice line(s) do not match the frozen exchange rate', bad; END IF;

  SELECT COALESCE(array_agg(DISTINCT kind), ARRAY[]::text[]) INTO visible_kinds FROM public.won_vehicle_invoice_lines WHERE issuance_id = p_issuance AND client_visible;

  IF inv.hat = 'retail' THEN
    IF (SELECT count(*) FROM public.won_vehicle_invoice_lines WHERE issuance_id = p_issuance AND client_visible) <> 1
       OR visible_kinds <> ARRAY['all_inclusive_price'] THEN
      RAISE EXCEPTION 'A retail invoice shows exactly one client-visible line, the all-inclusive price - cost and margin lines stay internal';
    END IF;
    IF inv.scope <> 'complete' OR jsonb_array_length(inv.excluded_components) <> 0 THEN
      RAISE EXCEPTION 'A retail invoice states a price, not a cost total: scope is complete with no excluded components';
    END IF;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.won_vehicle_invoice_lines WHERE issuance_id = p_issuance AND (NOT client_visible OR kind = 'all_inclusive_price')) THEN
    RAISE EXCEPTION 'A brokerage invoice discloses every line: no hidden lines and no all-inclusive price';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT (e ->> 'kind')), ARRAY[]::text[]) INTO excluded_kinds FROM jsonb_array_elements(inv.excluded_components) e;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(inv.excluded_components) e
              WHERE NOT (e ? 'kind') OR NOT (e ->> 'kind' = ANY (required)) OR btrim(coalesce(e ->> 'reason', '')) = '') THEN
    RAISE EXCEPTION 'Every excluded component needs a valid kind and a stated reason';
  END IF;
  IF excluded_kinds && visible_kinds THEN
    RAISE EXCEPTION 'A component cannot be both a line and excluded';
  END IF;

  IF inv.scope = 'complete' THEN
    IF jsonb_array_length(inv.excluded_components) <> 0 THEN RAISE EXCEPTION 'A complete invoice excludes nothing'; END IF;
    FOREACH k IN ARRAY required LOOP
      IF NOT (k = ANY (visible_kinds)) THEN
        RAISE EXCEPTION 'A complete invoice needs a line for every cost component; missing: % - issue it as partial and state why', k;
      END IF;
    END LOOP;
  ELSE
    IF jsonb_array_length(inv.excluded_components) = 0 THEN
      RAISE EXCEPTION 'A partial invoice must list what it excludes';
    END IF;
    FOREACH k IN ARRAY required LOOP
      IF NOT (k = ANY (visible_kinds)) AND NOT (k = ANY (excluded_kinds)) THEN
        RAISE EXCEPTION 'The invoice is silent about %: it must be a line or listed as excluded with a reason', k;
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- (2) lines are sealed: a line may only be inserted in the transaction that inserted its invoice (recorded_at = now())
CREATE OR REPLACE FUNCTION public.won_vehicle_invoice_lines_seal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.won_vehicle_invoice_issuances i WHERE i.id = NEW.issuance_id AND i.recorded_at = now()) THEN
    RAISE EXCEPTION 'An issued invoice''s lines are sealed: a line can only be added in the transaction that issues the invoice';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER won_vehicle_invoice_lines_seal_trg BEFORE INSERT ON public.won_vehicle_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.won_vehicle_invoice_lines_seal();

-- (3) a generated invoice must use a real ledger number
CREATE OR REPLACE FUNCTION public.won_vehicle_invoice_issuances_ledger_check()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.generated AND NOT EXISTS (
       SELECT 1 FROM public.document_numbers d
        WHERE d.org_id = NEW.org_id AND d.kind = 'invoice' AND d.seq = NEW.number_seq AND d.number_text = NEW.invoice_number
          AND d.status = 'allocated') THEN
    RAISE EXCEPTION 'A generated invoice must use an allocated invoice number from the ledger of its own org';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER won_vehicle_invoice_issuances_ledger_trg BEFORE INSERT ON public.won_vehicle_invoice_issuances
  FOR EACH ROW EXECUTE FUNCTION public.won_vehicle_invoice_issuances_ledger_check();

-- receipts: same org and vehicle as the payment, and a real ledger number
CREATE OR REPLACE FUNCTION public.won_vehicle_receipts_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pay public.won_vehicle_payments;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A receipt is never deleted - void it with a reason instead';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO pay FROM public.won_vehicle_payments WHERE id = NEW.payment_id FOR UPDATE;
    IF pay.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A receipt cannot be issued for a voided payment'; END IF;
    IF pay.org_id <> NEW.org_id OR pay.won_vehicle_id <> NEW.won_vehicle_id THEN
      RAISE EXCEPTION 'A receipt must belong to the same organisation and vehicle as its payment';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.document_numbers d
                    WHERE d.org_id = NEW.org_id AND d.kind = 'receipt' AND d.seq = NEW.number_seq AND d.number_text = NEW.receipt_number AND d.status = 'allocated') THEN
      RAISE EXCEPTION 'A receipt must use an allocated receipt number from the ledger of its own org';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A voided receipt cannot be changed'; END IF;
  IF (NEW.id, NEW.org_id, NEW.won_vehicle_id, NEW.payment_id, NEW.document_id, NEW.receipt_number, NEW.number_seq, NEW.issued_at, NEW.issued_by, NEW.notes)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.won_vehicle_id, OLD.payment_id, OLD.document_id, OLD.receipt_number, OLD.number_seq, OLD.issued_at, OLD.issued_by, OLD.notes) THEN
    RAISE EXCEPTION 'A receipt is never edited - void it and issue a new one';
  END IF;
  RETURN NEW;
END;
$$;

-- (4) a document that a live invoice or receipt points at cannot be soft-deleted
CREATE OR REPLACE FUNCTION public.won_vehicle_documents_referenced_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.won_vehicle_invoice_issuances i WHERE i.document_id = OLD.id AND i.voided_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.won_vehicle_receipts r WHERE r.document_id = OLD.id AND r.voided_at IS NULL)) THEN
    RAISE EXCEPTION 'This document belongs to a live invoice or receipt - void that first';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER won_vehicle_documents_referenced_guard_trg BEFORE UPDATE ON public.won_vehicle_documents
  FOR EACH ROW EXECUTE FUNCTION public.won_vehicle_documents_referenced_guard();

-- (5) TRUNCATE refused on every new table
CREATE OR REPLACE FUNCTION public.billing_no_truncate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is never truncated', TG_TABLE_NAME; END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['won_vehicle_invoice_lines', 'won_vehicle_payments', 'won_vehicle_receipts', 'won_vehicle_invoice_issuances', 'document_sequences'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_truncate_trg', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.billing_no_truncate()', t || '_no_truncate_trg', t);
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon, authenticated, service_role', t);
  END LOOP;
END $$;

-- (6) issue_generated_invoice carries the request hash (the old 17-argument signature is dropped and replaced)
DROP FUNCTION IF EXISTS public.issue_generated_invoice(uuid, uuid, uuid, uuid, text, text, jsonb, text, numeric, date, text, text, text, text, text, uuid, jsonb);
CREATE OR REPLACE FUNCTION public.issue_generated_invoice(
  p_org uuid, p_vehicle uuid, p_document uuid, p_number_id uuid, p_hat text, p_scope text, p_excluded jsonb,
  p_currency text, p_fx_rate numeric, p_fx_date date, p_fx_source text, p_recipient text, p_channel text,
  p_notes text, p_idem text, p_user uuid, p_lines jsonb, p_hash text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  num public.document_numbers;
  new_id uuid := gen_random_uuid();
  total numeric;
  total_usd numeric;
  i integer := 0;
  l jsonb;
  conv jsonb;
BEGIN
  SELECT * INTO num FROM public.document_numbers WHERE id = p_number_id FOR UPDATE;
  IF NOT FOUND OR num.kind <> 'invoice' OR num.org_id <> p_org OR num.status <> 'allocated' THEN
    RAISE EXCEPTION 'The invoice number is not available to issue (must be an allocated invoice number of this org)';
  END IF;
  conv := public.convert_invoice_lines(p_lines, p_currency, p_fx_rate);
  SELECT COALESCE(sum((x ->> 'amount')::numeric) FILTER (WHERE (x ->> 'client_visible')::boolean), 0),
         COALESCE(sum((x ->> 'amount_usd')::numeric) FILTER (WHERE (x ->> 'client_visible')::boolean), 0)
    INTO total, total_usd FROM jsonb_array_elements(conv) x;

  INSERT INTO public.won_vehicle_invoice_issuances
    (id, org_id, won_vehicle_id, document_id, invoice_number, amount, currency, channel, recipient, issued_at, issued_by, notes,
     generated, number_seq, hat, scope, excluded_components, amount_usd, fx_rate, fx_rate_date, fx_source, idempotency_key, request_hash)
  VALUES (new_id, p_org, p_vehicle, p_document, num.number_text, total, p_currency, p_channel, p_recipient, now(), p_user, p_notes,
          true, num.seq, p_hat, p_scope, COALESCE(p_excluded, '[]'::jsonb), total_usd, p_fx_rate, p_fx_date, p_fx_source, p_idem, p_hash);

  FOR l IN SELECT * FROM jsonb_array_elements(conv) LOOP
    i := i + 1;
    INSERT INTO public.won_vehicle_invoice_lines (org_id, issuance_id, position, kind, description, amount, amount_usd, client_visible, origin, basis, source_ref)
    VALUES (p_org, new_id, i, l ->> 'kind', l ->> 'description', (l ->> 'amount')::numeric, (l ->> 'amount_usd')::numeric,
            (l ->> 'client_visible')::boolean, l ->> 'origin', l ->> 'basis', l ->> 'source_ref');
  END LOOP;

  UPDATE public.document_numbers SET status = 'issued', ref_id = new_id, status_changed_at = now() WHERE id = p_number_id;
  RETURN new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.issue_generated_invoice(uuid, uuid, uuid, uuid, text, text, jsonb, text, numeric, date, text, text, text, text, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_generated_invoice(uuid, uuid, uuid, uuid, text, text, jsonb, text, numeric, date, text, text, text, text, text, uuid, jsonb, text) TO service_role;

-- PROMPT 38 Phase A - the document engine, part 2: money. Payments, applications, receipts, credit notes, the balance
-- view and the issue/void functions. Everything is append-only with void-with-reason (Phase 2's pattern), and the
-- balance is DERIVED, never stored.
--
-- The model (approved 21 Sep 2026):
--   * A PAYMENT is money received from a client. It is client-anchored (a deposit exists before any invoice does).
--   * An APPLICATION puts some of a payment against a document: "Less: Deposit Received -$800" on INV-0027 is a payment
--     applied to that invoice - never a negative line. A RETAINER (deposit invoice) that has been paid can have its paid
--     amount credited against the final invoice (kind = retainer_credit); the retainer stays paid.
--   * A CREDIT NOTE is the only way to reduce an ISSUED invoice (issued documents are sealed).
--   * outstanding = total - applied payments - retainer credits - live credit notes.
--   * A payment in the settlement currency applies to a document at that document's FROZEN rate; any other currency
--     mismatch is refused (no conversion path).
-- Locks are always taken in the same order (target document, then payment/retainer) so two concurrent applications
-- queue instead of deadlocking or both passing the balance check.

-- ---------------------------------------------------------------- payments
CREATE TABLE IF NOT EXISTS public.billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id),
  client_id uuid NOT NULL,
  won_vehicle_id uuid,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'NGN')),
  paid_at date NOT NULL,
  method text NOT NULL CHECK (method IN ('bank_transfer', 'cash', 'card', 'cheque', 'other')),
  purpose text NOT NULL DEFAULT 'payment' CHECK (purpose IN ('deposit', 'payment')),   -- prints "Deposit Received" vs "Payment Received"
  reference text,
  notes text,
  recorded_by uuid NOT NULL REFERENCES auth.users (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users (id),
  void_reason text,
  UNIQUE (id, org_id),
  FOREIGN KEY (client_id, org_id) REFERENCES public.clients (id, org_id),
  FOREIGN KEY (won_vehicle_id, org_id) REFERENCES public.won_vehicles (id, org_id),
  CONSTRAINT billing_payments_void_shape CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(coalesce(void_reason, '')) <> '')
  )
);
CREATE INDEX IF NOT EXISTS billing_payments_client_idx ON public.billing_payments (client_id, paid_at DESC);

-- ---------------------------------------------------------------- applications
CREATE TABLE IF NOT EXISTS public.billing_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('payment', 'retainer_credit')),
  payment_id uuid,
  source_document_id uuid,                              -- the retainer whose paid amount is credited
  document_id uuid NOT NULL,                            -- the document being paid down
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),    -- in the TARGET document's currency
  source_amount numeric(14, 2) NOT NULL CHECK (source_amount > 0),   -- in the payment's / retainer's own currency
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid NOT NULL REFERENCES auth.users (id),
  note text,
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users (id),
  void_reason text,
  FOREIGN KEY (payment_id, org_id) REFERENCES public.billing_payments (id, org_id),
  FOREIGN KEY (source_document_id, org_id) REFERENCES public.billing_documents (id, org_id),
  FOREIGN KEY (document_id, org_id) REFERENCES public.billing_documents (id, org_id),
  CONSTRAINT billing_applications_kind_shape CHECK (
    (kind = 'payment' AND payment_id IS NOT NULL AND source_document_id IS NULL)
    OR (kind = 'retainer_credit' AND source_document_id IS NOT NULL AND payment_id IS NULL AND source_document_id <> document_id AND amount = source_amount)
  ),
  CONSTRAINT billing_applications_void_shape CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(coalesce(void_reason, '')) <> '')
  )
);
CREATE INDEX IF NOT EXISTS billing_applications_doc_idx ON public.billing_applications (document_id);
CREATE INDEX IF NOT EXISTS billing_applications_payment_idx ON public.billing_applications (payment_id);
CREATE INDEX IF NOT EXISTS billing_applications_source_idx ON public.billing_applications (source_document_id);

-- ---------------------------------------------------------------- receipts
CREATE TABLE IF NOT EXISTS public.billing_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  client_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  file_id uuid NOT NULL,
  number_id uuid NOT NULL UNIQUE REFERENCES public.document_numbers (id),
  receipt_number text NOT NULL,
  number_seq integer NOT NULL,
  snapshot jsonb NOT NULL,                              -- what the receipt printed (invoice, totals, paid to date), frozen
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid NOT NULL REFERENCES auth.users (id),
  notes text,
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users (id),
  void_reason text,
  UNIQUE (org_id, receipt_number),
  FOREIGN KEY (payment_id, org_id) REFERENCES public.billing_payments (id, org_id),
  FOREIGN KEY (file_id, org_id) REFERENCES public.billing_files (id, org_id),
  FOREIGN KEY (client_id, org_id) REFERENCES public.clients (id, org_id),
  CONSTRAINT billing_receipts_void_shape CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(coalesce(void_reason, '')) <> '')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_receipts_one_live_per_payment ON public.billing_receipts (payment_id) WHERE voided_at IS NULL;

ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_payments_select ON public.billing_payments FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY billing_applications_select ON public.billing_applications FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY billing_receipts_select ON public.billing_receipts FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
REVOKE ALL ON public.billing_payments, public.billing_applications, public.billing_receipts FROM anon, authenticated, service_role;
GRANT SELECT ON public.billing_payments, public.billing_applications, public.billing_receipts TO authenticated, service_role;

-- ---------------------------------------------------------------- derived figures (never stored)
CREATE OR REPLACE FUNCTION public.billing_doc_balance(p_doc uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT d.total
       - coalesce((SELECT sum(a.amount) FROM public.billing_applications a WHERE a.document_id = d.id AND a.voided_at IS NULL), 0)
       - coalesce((SELECT sum(c.total) FROM public.billing_documents c WHERE c.credit_for_id = d.id AND c.voided_at IS NULL), 0)
    FROM public.billing_documents d WHERE d.id = p_doc
$$;

-- what a PAID retainer still has available to credit against a final invoice
CREATE OR REPLACE FUNCTION public.billing_retainer_available(p_doc uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT sum(a.amount) FROM public.billing_applications a WHERE a.document_id = p_doc AND a.kind = 'payment' AND a.voided_at IS NULL), 0)
       - coalesce((SELECT sum(a.amount) FROM public.billing_applications a WHERE a.source_document_id = p_doc AND a.kind = 'retainer_credit' AND a.voided_at IS NULL), 0)
$$;

CREATE OR REPLACE VIEW public.billing_document_balances WITH (security_invoker = true) AS
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
 WHERE d.doc_type IN ('invoice', 'retainer');
REVOKE ALL ON public.billing_document_balances FROM anon;
GRANT SELECT ON public.billing_document_balances TO authenticated, service_role;

CREATE OR REPLACE VIEW public.billing_payment_remaining WITH (security_invoker = true) AS
SELECT p.id AS payment_id, p.org_id, p.client_id, p.currency, p.amount, p.voided_at,
       p.amount - coalesce((SELECT sum(a.source_amount) FROM public.billing_applications a WHERE a.payment_id = p.id AND a.voided_at IS NULL), 0) AS unapplied
  FROM public.billing_payments p;
REVOKE ALL ON public.billing_payment_remaining FROM anon;
GRANT SELECT ON public.billing_payment_remaining TO authenticated, service_role;

-- ---------------------------------------------------------------- guards
CREATE OR REPLACE FUNCTION public.billing_payments_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A payment is never deleted - void it with a reason'; END IF;
  IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A voided payment cannot be changed'; END IF;
  IF (to_jsonb(NEW) - 'voided_at' - 'voided_by' - 'void_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at' - 'voided_by' - 'void_reason') THEN
    RAISE EXCEPTION 'A payment is never edited - void it and record a new one';
  END IF;
  IF NEW.voided_at IS NULL THEN RAISE EXCEPTION 'A payment can only change by being voided'; END IF;
  IF EXISTS (SELECT 1 FROM public.billing_applications a WHERE a.payment_id = OLD.id AND a.voided_at IS NULL) THEN
    RAISE EXCEPTION 'This payment is applied to a document - void that application first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.billing_receipts r WHERE r.payment_id = OLD.id AND r.voided_at IS NULL) THEN
    RAISE EXCEPTION 'A receipt has been issued for this payment - void the receipt first';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_payments_guard_trg BEFORE UPDATE OR DELETE ON public.billing_payments
  FOR EACH ROW EXECUTE FUNCTION public.billing_payments_guard();

CREATE OR REPLACE FUNCTION public.billing_payments_insert_check()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE veh_client uuid;
BEGIN
  IF NEW.won_vehicle_id IS NOT NULL THEN
    SELECT client_id INTO veh_client FROM public.won_vehicles WHERE id = NEW.won_vehicle_id;
    IF veh_client IS DISTINCT FROM NEW.client_id THEN RAISE EXCEPTION 'The won vehicle does not belong to this client'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_payments_insert_check_trg BEFORE INSERT ON public.billing_payments
  FOR EACH ROW EXECUTE FUNCTION public.billing_payments_insert_check();

CREATE OR REPLACE FUNCTION public.billing_applications_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tgt public.billing_documents; pay public.billing_payments; src public.billing_documents;
  used numeric; avail numeric; bal numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An application is never deleted - void it with a reason'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A voided application cannot be changed'; END IF;
    IF (to_jsonb(NEW) - 'voided_at' - 'voided_by' - 'void_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at' - 'voided_by' - 'void_reason') THEN
      RAISE EXCEPTION 'An application is never edited - void it and apply again';
    END IF;
    IF NEW.voided_at IS NULL THEN RAISE EXCEPTION 'An application can only change by being voided'; END IF;
    -- voiding a payment applied to a RETAINER must not leave more credited out of it than is now paid into it
    IF OLD.kind = 'payment' THEN
      SELECT * INTO src FROM public.billing_documents WHERE id = OLD.document_id FOR UPDATE;
      IF src.doc_type = 'retainer' AND public.billing_retainer_available(src.id) - OLD.amount < 0 THEN
        RAISE EXCEPTION 'Part of this retainer has been credited to an invoice - void that credit first';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO tgt FROM public.billing_documents WHERE id = NEW.document_id FOR UPDATE;
  IF NOT FOUND OR tgt.org_id <> NEW.org_id THEN RAISE EXCEPTION 'The document is not in this org'; END IF;
  IF tgt.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Nothing can be applied to a voided document'; END IF;
  IF tgt.doc_type NOT IN ('invoice', 'retainer') THEN RAISE EXCEPTION 'Nothing is applied to a credit note (it reduces its invoice directly)'; END IF;

  IF NEW.kind = 'payment' THEN
    SELECT * INTO pay FROM public.billing_payments WHERE id = NEW.payment_id FOR UPDATE;
    IF NOT FOUND OR pay.org_id <> NEW.org_id OR pay.client_id <> tgt.client_id THEN RAISE EXCEPTION 'The payment and the document must belong to the same client'; END IF;
    IF pay.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A voided payment cannot be applied'; END IF;
    IF pay.currency = tgt.currency THEN
      IF NEW.amount <> NEW.source_amount THEN RAISE EXCEPTION 'Same-currency application: the amounts must be equal'; END IF;
    ELSIF pay.currency = tgt.settlement_currency AND tgt.fx_rate IS NOT NULL THEN
      IF NEW.amount <> round(NEW.source_amount / tgt.fx_rate, 2) THEN
        RAISE EXCEPTION 'A % payment applies to this % document at its frozen rate (%): expected %', pay.currency, tgt.currency, tgt.fx_rate, round(NEW.source_amount / tgt.fx_rate, 2);
      END IF;
    ELSE
      RAISE EXCEPTION 'No conversion path: a % payment cannot be applied to a % document settled in %', pay.currency, tgt.currency, tgt.settlement_currency;
    END IF;
    SELECT coalesce(sum(source_amount), 0) INTO used FROM public.billing_applications WHERE payment_id = pay.id AND voided_at IS NULL;
    IF used + NEW.source_amount > pay.amount THEN RAISE EXCEPTION 'The payment has only % left to apply', pay.amount - used; END IF;
  ELSE
    IF tgt.doc_type <> 'invoice' THEN RAISE EXCEPTION 'A retainer is credited against an invoice, not against another retainer'; END IF;
    SELECT * INTO src FROM public.billing_documents WHERE id = NEW.source_document_id FOR UPDATE;
    IF NOT FOUND OR src.org_id <> NEW.org_id OR src.client_id <> tgt.client_id THEN RAISE EXCEPTION 'The retainer and the invoice must belong to the same client'; END IF;
    IF src.doc_type <> 'retainer' OR src.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Only a live retainer can be credited'; END IF;
    IF src.currency <> tgt.currency THEN RAISE EXCEPTION 'A retainer credits an invoice in the same currency'; END IF;
    avail := public.billing_retainer_available(src.id);
    IF NEW.amount > avail THEN RAISE EXCEPTION 'The retainer has only % paid and not yet credited', avail; END IF;
  END IF;

  bal := public.billing_doc_balance(tgt.id);
  IF NEW.amount > bal THEN RAISE EXCEPTION 'The application (%) exceeds the outstanding balance (%)', NEW.amount, bal; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_applications_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.billing_applications
  FOR EACH ROW EXECUTE FUNCTION public.billing_applications_guard();

-- a credit note: names an invoice of the same client and currency, and may not exceed what is still outstanding on it
CREATE OR REPLACE FUNCTION public.billing_credit_note_check()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv public.billing_documents; bal numeric;
BEGIN
  IF NEW.doc_type <> 'credit_note' THEN RETURN NEW; END IF;
  SELECT * INTO inv FROM public.billing_documents WHERE id = NEW.credit_for_id FOR UPDATE;
  IF NOT FOUND OR inv.org_id <> NEW.org_id OR inv.client_id <> NEW.client_id THEN RAISE EXCEPTION 'A credit note must name an invoice of the same client'; END IF;
  IF inv.doc_type <> 'invoice' THEN RAISE EXCEPTION 'A credit note reduces an invoice'; END IF;
  IF inv.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A credit note cannot reduce a voided invoice'; END IF;
  IF inv.currency <> NEW.currency THEN RAISE EXCEPTION 'A credit note is in the currency of its invoice'; END IF;
  bal := public.billing_doc_balance(inv.id);
  IF NEW.total > bal THEN RAISE EXCEPTION 'The credit note (%) is larger than what is outstanding on the invoice (%)', NEW.total, bal; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_documents_credit_note_trg BEFORE INSERT ON public.billing_documents
  FOR EACH ROW EXECUTE FUNCTION public.billing_credit_note_check();

-- voiding a document requires that nothing live depends on it
CREATE OR REPLACE FUNCTION public.billing_documents_void_check()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.billing_applications a WHERE a.voided_at IS NULL AND (a.document_id = OLD.id OR a.source_document_id = OLD.id)) THEN
      RAISE EXCEPTION 'A payment or retainer credit is applied to this document - void that first (an invoice with money against it is reduced by a credit note)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.billing_documents c WHERE c.credit_for_id = OLD.id AND c.voided_at IS NULL) THEN
      RAISE EXCEPTION 'A credit note reduces this invoice - void the credit note first';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_documents_void_check_trg BEFORE UPDATE ON public.billing_documents
  FOR EACH ROW EXECUTE FUNCTION public.billing_documents_void_check();

-- the applied-at-issue figure printed on a document must equal the applications made in the issuing transaction
CREATE OR REPLACE FUNCTION public.check_billing_applied_at_issue()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE applied numeric;
BEGIN
  SELECT coalesce(sum(amount), 0) INTO applied FROM public.billing_applications
   WHERE document_id = NEW.id AND applied_at = NEW.recorded_at AND voided_at IS NULL;
  IF applied <> NEW.applied_at_issue THEN
    RAISE EXCEPTION 'The applied figure on the document (%) does not match the payments applied when it was issued (%)', NEW.applied_at_issue, applied;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER billing_documents_applied_check_trg AFTER INSERT ON public.billing_documents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_billing_applied_at_issue();

-- receipts: for a live payment of the same org and client, on an allocated receipt number; never edited
CREATE OR REPLACE FUNCTION public.billing_receipts_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pay public.billing_payments; num public.document_numbers;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A receipt is never deleted - void it with a reason'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO pay FROM public.billing_payments WHERE id = NEW.payment_id FOR UPDATE;
    IF NOT FOUND OR pay.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A receipt cannot be issued for a voided payment'; END IF;
    IF pay.org_id <> NEW.org_id OR pay.client_id <> NEW.client_id THEN RAISE EXCEPTION 'A receipt must belong to the same org and client as its payment'; END IF;
    SELECT * INTO num FROM public.document_numbers WHERE id = NEW.number_id FOR UPDATE;
    IF NOT FOUND OR num.org_id <> NEW.org_id OR num.kind <> 'receipt' OR num.seq <> NEW.number_seq OR num.number_text <> NEW.receipt_number OR num.status <> 'allocated' THEN
      RAISE EXCEPTION 'A receipt must use an allocated receipt number from the ledger of its own org';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A voided receipt cannot be changed'; END IF;
  IF (to_jsonb(NEW) - 'voided_at' - 'voided_by' - 'void_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at' - 'voided_by' - 'void_reason') THEN
    RAISE EXCEPTION 'A receipt is never edited - void it and issue a new one';
  END IF;
  IF NEW.voided_at IS NULL THEN RAISE EXCEPTION 'A receipt can only change by being voided'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_receipts_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.billing_receipts
  FOR EACH ROW EXECUTE FUNCTION public.billing_receipts_guard();

CREATE OR REPLACE FUNCTION public.billing_receipts_number_void()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL THEN
    UPDATE public.document_numbers SET status = 'voided', status_changed_at = now(), note = coalesce(note, '') || 'voided: ' || NEW.void_reason
     WHERE id = NEW.number_id AND status = 'issued';
    IF NOT FOUND THEN RAISE EXCEPTION 'The ledger number of this receipt is not in the issued state'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_receipts_number_void_trg AFTER UPDATE ON public.billing_receipts
  FOR EACH ROW EXECUTE FUNCTION public.billing_receipts_number_void();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_payments', 'billing_applications', 'billing_receipts'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.billing_no_truncate_v2()', t || '_no_truncate_trg', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- the issue and record functions (service role only)
-- p_doc  = header fields (see below); p_lines = [{position, section, component, description, quantity, rate, discount_type,
--          discount_value, tax_code, client_visible, origin, basis, source_ref, source_document_id, computed_inputs}];
-- p_apply = [{kind, source_id, amount, source_amount, note}] applied in the same transaction (deposits already received).
-- Every figure is computed HERE by billing_compute(); the caller's figures are not trusted or even accepted.
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
  a jsonb;
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
    fx_rate, fx_basis, fx_rate_date, fx_source, credit_for_id, scope_statement, notes,
    subtotal, line_discount_total, invoice_discount_type, invoice_discount_value, invoice_discount_amount,
    adjustment_label, adjustment_amount, tax_total, tax_breakdown, total, applied_at_issue, balance_at_issue,
    settlement_balance_at_issue, org_snapshot, file_id, idempotency_key, request_hash, issued_by, issued_at, recorded_at)
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
    nullif(p_doc ->> 'idempotency_key', ''), nullif(p_doc ->> 'request_hash', ''), p_user, now_ts, now_ts);

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

-- one payment, optionally applied to documents in the same transaction
CREATE OR REPLACE FUNCTION public.record_billing_payment(
  p_org uuid, p_client uuid, p_vehicle uuid, p_amount numeric, p_currency text, p_paid_at date, p_method text, p_purpose text,
  p_reference text, p_notes text, p_user uuid, p_apply jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid := gen_random_uuid(); a jsonb;
BEGIN
  INSERT INTO public.billing_payments (id, org_id, client_id, won_vehicle_id, amount, currency, paid_at, method, purpose, reference, notes, recorded_by)
  VALUES (pid, p_org, p_client, p_vehicle, p_amount, p_currency, p_paid_at, p_method, coalesce(p_purpose, 'payment'), nullif(p_reference, ''), nullif(p_notes, ''), p_user);
  FOR a IN SELECT x FROM jsonb_array_elements(coalesce(p_apply, '[]'::jsonb)) AS t(x) LOOP
    INSERT INTO public.billing_applications (org_id, kind, payment_id, document_id, amount, source_amount, applied_by, note)
    VALUES (p_org, 'payment', pid, (a ->> 'document_id')::uuid, (a ->> 'amount')::numeric, (a ->> 'source_amount')::numeric, p_user, nullif(a ->> 'note', ''));
  END LOOP;
  RETURN pid;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_billing_credit(
  p_org uuid, p_kind text, p_source uuid, p_document uuid, p_amount numeric, p_source_amount numeric, p_user uuid, p_note text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE aid uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.billing_applications (id, org_id, kind, payment_id, source_document_id, document_id, amount, source_amount, applied_by, note)
  VALUES (aid, p_org, p_kind, CASE WHEN p_kind = 'payment' THEN p_source END, CASE WHEN p_kind = 'retainer_credit' THEN p_source END,
          p_document, p_amount, p_source_amount, p_user, nullif(p_note, ''));
  RETURN aid;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_billing_receipt(
  p_org uuid, p_payment uuid, p_number_id uuid, p_file_id uuid, p_snapshot jsonb, p_user uuid, p_notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid := gen_random_uuid(); num public.document_numbers; pay public.billing_payments;
BEGIN
  SELECT * INTO num FROM public.document_numbers WHERE id = p_number_id FOR UPDATE;
  IF NOT FOUND OR num.org_id <> p_org OR num.kind <> 'receipt' OR num.status <> 'allocated' THEN
    RAISE EXCEPTION 'The receipt number is not available to issue';
  END IF;
  SELECT * INTO pay FROM public.billing_payments WHERE id = p_payment;
  INSERT INTO public.billing_receipts (id, org_id, client_id, payment_id, file_id, number_id, receipt_number, number_seq, snapshot, issued_by, notes)
  VALUES (rid, p_org, pay.client_id, p_payment, p_file_id, num.id, num.number_text, num.seq, p_snapshot, p_user, nullif(p_notes, ''));
  UPDATE public.document_numbers SET status = 'issued', ref_id = rid, status_changed_at = now() WHERE id = num.id;
  RETURN rid;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_billing_record(p_kind text, p_id uuid, p_user uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF btrim(coalesce(p_reason, '')) = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF p_kind = 'document' THEN
    UPDATE public.billing_documents SET voided_at = now(), voided_by = p_user, void_reason = p_reason WHERE id = p_id AND voided_at IS NULL;
  ELSIF p_kind = 'payment' THEN
    UPDATE public.billing_payments SET voided_at = now(), voided_by = p_user, void_reason = p_reason WHERE id = p_id AND voided_at IS NULL;
  ELSIF p_kind = 'application' THEN
    UPDATE public.billing_applications SET voided_at = now(), voided_by = p_user, void_reason = p_reason WHERE id = p_id AND voided_at IS NULL;
  ELSIF p_kind = 'receipt' THEN
    UPDATE public.billing_receipts SET voided_at = now(), voided_by = p_user, void_reason = p_reason WHERE id = p_id AND voided_at IS NULL;
  ELSE
    RAISE EXCEPTION 'Unknown record kind %', p_kind;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Already voided or not found'; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.issue_billing_document(jsonb, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_billing_payment(uuid, uuid, uuid, numeric, text, date, text, text, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_billing_credit(uuid, text, uuid, uuid, numeric, numeric, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_billing_receipt(uuid, uuid, uuid, uuid, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.void_billing_record(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_billing_document(jsonb, jsonb, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_billing_payment(uuid, uuid, uuid, numeric, text, date, text, text, text, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_billing_credit(uuid, text, uuid, uuid, numeric, numeric, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_billing_receipt(uuid, uuid, uuid, uuid, jsonb, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_billing_record(text, uuid, uuid, text) TO service_role;

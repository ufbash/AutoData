-- PROMPT 37 Phase 2 - line-item invoices, payments and receipts, built ON the Prompt 34 machinery.
--
-- An invoice is the EXISTING won_vehicle_invoice_issuances record (append-only, void-with-reason, tied to a stored
-- won_vehicle_documents PDF) - extended, not paralleled. A generated invoice adds: a per-org number, the hat it is
-- issued under, its scope, the currency and the FX rate frozen at issuance, and line items. Nothing is derived at
-- read time and nothing is editable afterwards.
--
-- THE FAILURE THIS PHASE MUST NOT COMMIT: an invoice total presented as complete while a cost component is missing.
-- The database therefore refuses to hold one. A brokerage invoice must, for each of six cost components (vehicle
-- price, auction fees, inland trucking, ocean freight, duty, brokerage fee), EITHER carry a line for it OR list it in
-- excluded_components with a reason, and then it is scope 'partial' and says so. A 'complete' invoice needs all six as
-- lines. Shipping and duty therefore appear only when a real figure exists, and are otherwise stated as excluded.
--
-- Two hats (PROJECT_CHARTER 4), recorded on the invoice and never blurred:
--   brokerage - every line client-visible: a disclosed fee on transparent costs.
--   retail    - one client-visible all-inclusive price line; cost/margin lines are stored client_visible = false and are
--               never rendered.
-- Currency: an invoice is USD or NGN. An NGN invoice freezes fx_rate (NGN per USD), its date and source once; each
-- line's dollar figure is authoritative and its NGN figure is round(usd * fx_rate, 2), stored, never recomputed.

-- ---------------------------------------------------------------- issuances: extend, do not duplicate
ALTER TABLE public.won_vehicle_invoice_issuances
  ADD COLUMN IF NOT EXISTS generated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS number_seq integer,
  ADD COLUMN IF NOT EXISTS hat text CHECK (hat IN ('brokerage', 'retail')),
  ADD COLUMN IF NOT EXISTS scope text CHECK (scope IN ('complete', 'partial')),
  ADD COLUMN IF NOT EXISTS excluded_components jsonb,
  ADD COLUMN IF NOT EXISTS amount_usd numeric(14, 2),
  ADD COLUMN IF NOT EXISTS fx_rate numeric(18, 8),
  ADD COLUMN IF NOT EXISTS fx_rate_date date,
  ADD COLUMN IF NOT EXISTS fx_source text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.won_vehicle_invoice_issuances
  ADD CONSTRAINT won_vehicle_invoice_issuances_id_org_uniq UNIQUE (id, org_id),
  ADD CONSTRAINT won_vehicle_invoice_issuances_id_vehicle_uniq UNIQUE (id, won_vehicle_id),
  ADD CONSTRAINT won_vehicle_invoice_issuances_generated_shape CHECK (
    NOT generated OR (
      number_seq IS NOT NULL AND invoice_number IS NOT NULL AND hat IS NOT NULL AND scope IS NOT NULL
      AND excluded_components IS NOT NULL AND jsonb_typeof(excluded_components) = 'array'
      AND amount_usd IS NOT NULL AND amount_usd > 0
      AND ((currency = 'USD' AND fx_rate IS NULL AND fx_rate_date IS NULL AND fx_source IS NULL AND amount_usd = amount)
        OR (currency = 'NGN' AND fx_rate IS NOT NULL AND fx_rate > 0 AND fx_rate_date IS NOT NULL AND btrim(coalesce(fx_source, '')) <> ''))
    )
  );
-- One generated invoice per number, per org (a legacy hand-typed invoice_number stays free text).
CREATE UNIQUE INDEX IF NOT EXISTS won_vehicle_invoice_issuances_generated_number
  ON public.won_vehicle_invoice_issuances (org_id, invoice_number) WHERE generated;
-- The same request issued twice (a double click, a retry, a race) is refused by the database.
CREATE UNIQUE INDEX IF NOT EXISTS won_vehicle_invoice_issuances_idempotency
  ON public.won_vehicle_invoice_issuances (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------- lines
CREATE TABLE IF NOT EXISTS public.won_vehicle_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  issuance_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 1),
  kind text NOT NULL CHECK (kind IN ('vehicle_price', 'auction_fees', 'inland_trucking', 'ocean_freight', 'duty',
                                     'brokerage_fee', 'all_inclusive_price', 'other')),
  description text NOT NULL CHECK (btrim(description) <> ''),
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),         -- in the invoice's currency
  amount_usd numeric(14, 2) NOT NULL CHECK (amount_usd >= 0), -- authoritative
  client_visible boolean NOT NULL DEFAULT true,
  origin text NOT NULL CHECK (origin IN ('computed', 'staff_entered')),
  basis text,       -- what a staff-entered figure rests on (a quote, an agreement); required when staff-entered
  source_ref text,  -- e.g. the winning-bid id or the rate a computed line came from
  UNIQUE (issuance_id, position),
  FOREIGN KEY (issuance_id, org_id) REFERENCES public.won_vehicle_invoice_issuances (id, org_id),
  CONSTRAINT won_vehicle_invoice_lines_basis CHECK (origin = 'computed' OR btrim(coalesce(basis, '')) <> '')
);
CREATE INDEX IF NOT EXISTS won_vehicle_invoice_lines_issuance_idx ON public.won_vehicle_invoice_lines (issuance_id);

-- ---------------------------------------------------------------- payments (append-only, void with a reason)
CREATE TABLE IF NOT EXISTS public.won_vehicle_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  won_vehicle_id uuid NOT NULL,
  issuance_id uuid NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'NGN')),
  paid_at date NOT NULL,
  method text NOT NULL CHECK (method IN ('bank_transfer', 'cash', 'card', 'cheque', 'other')),
  reference text,
  notes text,
  recorded_by uuid NOT NULL REFERENCES auth.users (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users (id),
  void_reason text,
  UNIQUE (id, won_vehicle_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (issuance_id, won_vehicle_id) REFERENCES public.won_vehicle_invoice_issuances (id, won_vehicle_id),
  FOREIGN KEY (issuance_id, org_id) REFERENCES public.won_vehicle_invoice_issuances (id, org_id),
  CONSTRAINT won_vehicle_payments_void_shape CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(coalesce(void_reason, '')) <> '')
  )
);
CREATE INDEX IF NOT EXISTS won_vehicle_payments_issuance_idx ON public.won_vehicle_payments (issuance_id);

-- ---------------------------------------------------------------- receipts (issued against a payment)
CREATE TABLE IF NOT EXISTS public.won_vehicle_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  won_vehicle_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  document_id uuid NOT NULL,
  receipt_number text NOT NULL,
  number_seq integer NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid NOT NULL REFERENCES auth.users (id),
  notes text,
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users (id),
  void_reason text,
  UNIQUE (org_id, receipt_number),
  FOREIGN KEY (payment_id, won_vehicle_id) REFERENCES public.won_vehicle_payments (id, won_vehicle_id),
  FOREIGN KEY (document_id, won_vehicle_id) REFERENCES public.won_vehicle_documents (id, won_vehicle_id),
  CONSTRAINT won_vehicle_receipts_void_shape CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(coalesce(void_reason, '')) <> '')
  )
);
-- One LIVE receipt per payment; a voided one frees the payment for a replacement (with a NEW number).
CREATE UNIQUE INDEX IF NOT EXISTS won_vehicle_receipts_one_live_per_payment ON public.won_vehicle_receipts (payment_id) WHERE voided_at IS NULL;

-- ---------------------------------------------------------------- RLS: staff read only; the billing Edge Function is the only writer
ALTER TABLE public.won_vehicle_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.won_vehicle_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.won_vehicle_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY won_vehicle_invoice_lines_select ON public.won_vehicle_invoice_lines FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY won_vehicle_payments_select ON public.won_vehicle_payments FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY won_vehicle_receipts_select ON public.won_vehicle_receipts FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
REVOKE ALL ON public.won_vehicle_invoice_lines, public.won_vehicle_payments, public.won_vehicle_receipts FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.won_vehicle_invoice_lines, public.won_vehicle_payments, public.won_vehicle_receipts FROM authenticated;

-- ---------------------------------------------------------------- append-only guards
CREATE OR REPLACE FUNCTION public.won_vehicle_invoice_lines_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'An invoice line is never edited or deleted - void the invoice and issue a new one';
END;
$$;
CREATE TRIGGER won_vehicle_invoice_lines_guard_trg BEFORE UPDATE OR DELETE ON public.won_vehicle_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.won_vehicle_invoice_lines_guard();

-- The issuance guard, extended: every column added above is frozen too, and an invoice with live payments cannot be
-- voided (money is recorded against it - void the payments first, each with a reason).
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
      NEW.fx_rate, NEW.fx_rate_date, NEW.fx_source, NEW.idempotency_key)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.won_vehicle_id, OLD.document_id, OLD.invoice_number, OLD.amount, OLD.currency,
      OLD.channel, OLD.recipient, OLD.issued_at, OLD.issued_by, OLD.recorded_at, OLD.notes,
      OLD.generated, OLD.number_seq, OLD.hat, OLD.scope, OLD.excluded_components, OLD.amount_usd,
      OLD.fx_rate, OLD.fx_rate_date, OLD.fx_source, OLD.idempotency_key) THEN
    RAISE EXCEPTION 'An invoice issuance is never edited - void it and record a new one';
  END IF;
  IF NEW.voided_at IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.won_vehicle_payments p WHERE p.issuance_id = OLD.id AND p.voided_at IS NULL) THEN
    RAISE EXCEPTION 'This invoice has live payments recorded against it - void the payments (each with a reason) before voiding the invoice';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.won_vehicle_payments_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  inv public.won_vehicle_invoice_issuances;
  paid numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A payment is never deleted - void it with a reason instead';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Lock the invoice row so two concurrent payments cannot both pass the balance check.
    SELECT * INTO inv FROM public.won_vehicle_invoice_issuances WHERE id = NEW.issuance_id FOR UPDATE;
    IF inv.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A payment cannot be recorded against a voided invoice'; END IF;
    IF NOT inv.generated THEN RAISE EXCEPTION 'Payments are recorded against generated (numbered) invoices only'; END IF;
    IF NEW.currency <> inv.currency THEN
      RAISE EXCEPTION 'A payment is recorded in the invoice''s own currency (% invoice, % payment)', inv.currency, NEW.currency;
    END IF;
    SELECT COALESCE(sum(amount), 0) INTO paid FROM public.won_vehicle_payments WHERE issuance_id = NEW.issuance_id AND voided_at IS NULL;
    IF paid + NEW.amount > inv.amount THEN
      RAISE EXCEPTION 'This payment (%) exceeds the outstanding balance (%) of the invoice', NEW.amount, inv.amount - paid;
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: the only permitted change is voiding a live payment - and never one that still has a live receipt.
  IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A voided payment cannot be changed'; END IF;
  IF (NEW.id, NEW.org_id, NEW.won_vehicle_id, NEW.issuance_id, NEW.amount, NEW.currency, NEW.paid_at, NEW.method, NEW.reference, NEW.notes, NEW.recorded_by, NEW.recorded_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.won_vehicle_id, OLD.issuance_id, OLD.amount, OLD.currency, OLD.paid_at, OLD.method, OLD.reference, OLD.notes, OLD.recorded_by, OLD.recorded_at) THEN
    RAISE EXCEPTION 'A payment is never edited - void it and record a new one';
  END IF;
  IF NEW.voided_at IS NOT NULL AND EXISTS (SELECT 1 FROM public.won_vehicle_receipts r WHERE r.payment_id = OLD.id AND r.voided_at IS NULL) THEN
    RAISE EXCEPTION 'This payment has a live receipt - void the receipt first';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER won_vehicle_payments_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.won_vehicle_payments
  FOR EACH ROW EXECUTE FUNCTION public.won_vehicle_payments_guard();

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
CREATE TRIGGER won_vehicle_receipts_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.won_vehicle_receipts
  FOR EACH ROW EXECUTE FUNCTION public.won_vehicle_receipts_guard();

-- Voiding a numbered document is recorded on its number, so a gap is always explicable.
CREATE OR REPLACE FUNCTION public.mark_number_voided_from_issuance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL AND NEW.generated THEN
    UPDATE public.document_numbers SET status = 'voided', status_changed_at = now(), note = COALESCE(note, '') || ' voided: ' || NEW.void_reason
     WHERE org_id = NEW.org_id AND kind = 'invoice' AND seq = NEW.number_seq;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER won_vehicle_invoice_issuances_number_void_trg AFTER UPDATE ON public.won_vehicle_invoice_issuances
  FOR EACH ROW EXECUTE FUNCTION public.mark_number_voided_from_issuance();

CREATE OR REPLACE FUNCTION public.mark_number_voided_from_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN
    UPDATE public.document_numbers SET status = 'voided', status_changed_at = now(), note = COALESCE(note, '') || ' voided: ' || NEW.void_reason
     WHERE org_id = NEW.org_id AND kind = 'receipt' AND seq = NEW.number_seq;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER won_vehicle_receipts_number_void_trg AFTER UPDATE ON public.won_vehicle_receipts
  FOR EACH ROW EXECUTE FUNCTION public.mark_number_voided_from_receipt();

-- ---------------------------------------------------------------- the invoice shape rules, enforced at COMMIT
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

  SELECT COALESCE(sum(amount), 0), COALESCE(sum(amount_usd), 0) INTO vis_sum, usd_sum
    FROM public.won_vehicle_invoice_lines WHERE issuance_id = p_issuance AND client_visible;
  IF vis_sum <> inv.amount OR usd_sum <> inv.amount_usd THEN
    RAISE EXCEPTION 'Invoice total (% / % USD) does not equal the sum of its client-visible lines (% / % USD)', inv.amount, inv.amount_usd, vis_sum, usd_sum;
  END IF;

  -- The currency is frozen per line: USD lines carry the same figure; NGN lines are round(usd * fx_rate, 2).
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

  -- brokerage: transparent - every line is visible, none is the all-inclusive price
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
    -- every required component is accounted for: a line or an explicit exclusion - never silently absent
    FOREACH k IN ARRAY required LOOP
      IF NOT (k = ANY (visible_kinds)) AND NOT (k = ANY (excluded_kinds)) THEN
        RAISE EXCEPTION 'The invoice is silent about %: it must be a line or listed as excluded with a reason', k;
      END IF;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_generated_invoice_trg()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'won_vehicle_invoice_lines' THEN
    PERFORM public.check_generated_invoice(NEW.issuance_id);
  ELSE
    PERFORM public.check_generated_invoice(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER won_vehicle_invoice_lines_shape_trg AFTER INSERT ON public.won_vehicle_invoice_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_generated_invoice_trg();
CREATE CONSTRAINT TRIGGER won_vehicle_invoice_issuances_shape_trg AFTER INSERT ON public.won_vehicle_invoice_issuances
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_generated_invoice_trg();

-- ---------------------------------------------------------------- the DATABASE converts, once
-- Each line is authored in USD (every cost in the system is USD). For an NGN invoice the line's NGN figure is
-- round(usd * fx_rate, 2) computed HERE, by the same expression the shape check verifies, so a JavaScript float and
-- a SQL decimal can never disagree by a cent. The Edge Function calls this to get the figures it prints on the PDF and
-- issue_generated_invoice() recomputes them identically when it stores the invoice.
CREATE OR REPLACE FUNCTION public.convert_invoice_lines(p_lines jsonb, p_currency text, p_fx numeric)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(
           x || jsonb_build_object('amount',
             CASE WHEN p_currency = 'USD' THEN round((x ->> 'amount_usd')::numeric, 2)
                  ELSE round(round((x ->> 'amount_usd')::numeric, 2) * p_fx, 2) END,
             'amount_usd', round((x ->> 'amount_usd')::numeric, 2))
           ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(x, ord);
$$;

-- ---------------------------------------------------------------- one atomic issue: number, invoice and lines together
CREATE OR REPLACE FUNCTION public.issue_generated_invoice(
  p_org uuid, p_vehicle uuid, p_document uuid, p_number_id uuid, p_hat text, p_scope text, p_excluded jsonb,
  p_currency text, p_fx_rate numeric, p_fx_date date, p_fx_source text, p_recipient text, p_channel text,
  p_notes text, p_idem text, p_user uuid, p_lines jsonb
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
     generated, number_seq, hat, scope, excluded_components, amount_usd, fx_rate, fx_rate_date, fx_source, idempotency_key)
  VALUES (new_id, p_org, p_vehicle, p_document, num.number_text, total, p_currency, p_channel, p_recipient, now(), p_user, p_notes,
          true, num.seq, p_hat, p_scope, COALESCE(p_excluded, '[]'::jsonb), total_usd, p_fx_rate, p_fx_date, p_fx_source, p_idem);

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

CREATE OR REPLACE FUNCTION public.issue_receipt_record(
  p_org uuid, p_vehicle uuid, p_payment uuid, p_document uuid, p_number_id uuid, p_notes text, p_user uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  num public.document_numbers;
  new_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO num FROM public.document_numbers WHERE id = p_number_id FOR UPDATE;
  IF NOT FOUND OR num.kind <> 'receipt' OR num.org_id <> p_org OR num.status <> 'allocated' THEN
    RAISE EXCEPTION 'The receipt number is not available to issue (must be an allocated receipt number of this org)';
  END IF;
  INSERT INTO public.won_vehicle_receipts (id, org_id, won_vehicle_id, payment_id, document_id, receipt_number, number_seq, issued_by, notes)
  VALUES (new_id, p_org, p_vehicle, p_payment, p_document, num.number_text, num.seq, p_user, p_notes);
  UPDATE public.document_numbers SET status = 'issued', ref_id = new_id, status_changed_at = now() WHERE id = p_number_id;
  RETURN new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.issue_generated_invoice(uuid, uuid, uuid, uuid, text, text, jsonb, text, numeric, date, text, text, text, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.convert_invoice_lines(jsonb, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_invoice_lines(jsonb, text, numeric) TO service_role;
REVOKE EXECUTE ON FUNCTION public.issue_receipt_record(uuid, uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_generated_invoice(uuid, uuid, uuid, uuid, text, text, jsonb, text, numeric, date, text, text, text, text, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_receipt_record(uuid, uuid, uuid, uuid, uuid, text, uuid) TO service_role;

-- ---------------------------------------------------------------- the balance is DERIVED, never stored
CREATE OR REPLACE VIEW public.won_vehicle_invoice_balances WITH (security_invoker = true) AS
SELECT i.id AS issuance_id, i.org_id, i.won_vehicle_id, i.invoice_number, i.currency, i.amount AS invoice_amount,
       COALESCE(sum(p.amount) FILTER (WHERE p.voided_at IS NULL), 0)::numeric(14, 2) AS paid,
       (i.amount - COALESCE(sum(p.amount) FILTER (WHERE p.voided_at IS NULL), 0))::numeric(14, 2) AS outstanding,
       i.voided_at
  FROM public.won_vehicle_invoice_issuances i
  LEFT JOIN public.won_vehicle_payments p ON p.issuance_id = i.id
 WHERE i.generated
 GROUP BY i.id;
GRANT SELECT ON public.won_vehicle_invoice_balances TO authenticated;

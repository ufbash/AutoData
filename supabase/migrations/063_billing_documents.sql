-- PROMPT 38 Phase A - the document engine, part 1: documents, lines, the compute function and the guards.
--
-- Why new tables (Bashir's design approved 21 Sep 2026; this is the implementation): the Phase 2 issuance tables are
-- welded to won vehicles by six separate rules (won_vehicle_id NOT NULL, composite FKs, a freeze whitelist, a shape
-- check that demands hat/scope/exclusions/amount_usd, a ledger trigger, the payment and receipt guards). Real invoices
-- are not like that: INV-0025 is a repair on a car that was never bought at auction. So a document belongs to a CLIENT;
-- its vehicle is optional and may be external. The Phase 2 tables are left exactly as they are (legacy, read-only in
-- practice); the ledger, the bucket, the append-only pattern and the function pattern are reused.
--
-- What the DATABASE owns (PROJECT_CHARTER 5.10, DECISIONS 17.6: a rule that lives only in the app is a habit):
--   * every figure: billing_compute() computes line amounts, discounts, tax and totals; a deferred constraint trigger
--     recomputes the stored figures at commit and refuses any disagreement (so a caller cannot store a figure the
--     rules would not produce);
--   * a discount is a TYPED thing (none | percent | fixed) stored beside the amount it produced - there is no such thing
--     as a negative line, and no stored "informational" discount that could be subtracted twice: the printed
--     "Discount Applied" is derived from the line discounts at render time;
--   * discounts reduce the taxable base; tax is per tax code from a DATED rate (tax_codes, migration 062).
--
-- Money arithmetic: numeric, round() half away from zero (the shared TypeScript core mirrors it in integer cents).

-- clients need a composite key so a document can only ever point at a client OF THE SAME ORG
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_id_org_uniq') THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_id_org_uniq UNIQUE (id, org_id);
  END IF;
END $$;

-- ---------------------------------------------------------------- generated files (PDFs)
CREATE TABLE IF NOT EXISTS public.billing_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id),
  client_id uuid NOT NULL,
  storage_path text NOT NULL UNIQUE,
  filename text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/pdf' CHECK (mime_type = 'application/pdf'),
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users (id),
  UNIQUE (id, org_id),
  FOREIGN KEY (client_id, org_id) REFERENCES public.clients (id, org_id),
  CONSTRAINT billing_files_delete_pair CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);

-- ---------------------------------------------------------------- documents: invoice | retainer | credit note
CREATE TABLE IF NOT EXISTS public.billing_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id),
  doc_type text NOT NULL CHECK (doc_type IN ('invoice', 'retainer', 'credit_note')),
  invoice_kind text CHECK (invoice_kind IN ('vehicle_purchase', 'retail', 'repair')),
  number_id uuid NOT NULL UNIQUE REFERENCES public.document_numbers (id),
  number_seq integer NOT NULL,
  number_text text NOT NULL,
  client_id uuid NOT NULL,
  won_vehicle_id uuid,                                  -- optional: a car this org bought at auction
  external_plate text, external_vin text, external_description text,   -- optional: a car that never was a won vehicle
  reference text,                                       -- e.g. "Luftreiber Jobcard 2968 (22/08/2026)"
  issue_date date NOT NULL,
  due_date date,
  currency text NOT NULL CHECK (currency IN ('USD', 'NGN')),             -- the currency of the lines
  settlement_currency text NOT NULL CHECK (settlement_currency IN ('USD', 'NGN')),   -- what the client pays in
  fx_rate numeric(18, 8),                               -- settlement units per 1 unit of document currency (1390 = NGN per USD)
  fx_basis text CHECK (fx_basis IN ('agreed', 'live')),
  fx_rate_date date,
  fx_source text,
  credit_for_id uuid,                                   -- a credit note names the invoice it reduces
  scope_statement text,
  notes text,
  subtotal numeric(14, 2) NOT NULL CHECK (subtotal >= 0),
  line_discount_total numeric(14, 2) NOT NULL DEFAULT 0 CHECK (line_discount_total >= 0),
  invoice_discount_type text NOT NULL DEFAULT 'none' CHECK (invoice_discount_type IN ('none', 'percent', 'fixed')),
  invoice_discount_value numeric(14, 4) NOT NULL DEFAULT 0 CHECK (invoice_discount_value >= 0),
  invoice_discount_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (invoice_discount_amount >= 0),
  adjustment_label text,
  adjustment_amount numeric(14, 2) NOT NULL DEFAULT 0,  -- signed, labelled (rounding)
  tax_total numeric(14, 2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  tax_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric(14, 2) NOT NULL CHECK (total > 0),
  applied_at_issue numeric(14, 2) NOT NULL DEFAULT 0 CHECK (applied_at_issue >= 0),   -- deposits/credits applied when issued
  balance_at_issue numeric(14, 2) NOT NULL CHECK (balance_at_issue >= 0),
  settlement_balance_at_issue numeric(14, 2),           -- balance_at_issue x fx_rate, frozen with the rate
  org_snapshot jsonb NOT NULL,                          -- the branding this document was printed with, frozen
  file_id uuid NOT NULL,
  idempotency_key text,
  request_hash text,
  issued_by uuid NOT NULL REFERENCES auth.users (id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),       -- the seal: lines may only be added in this same transaction
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users (id),
  void_reason text,
  UNIQUE (id, org_id),
  UNIQUE (org_id, doc_type, number_text),
  FOREIGN KEY (client_id, org_id) REFERENCES public.clients (id, org_id),
  FOREIGN KEY (won_vehicle_id, org_id) REFERENCES public.won_vehicles (id, org_id),
  FOREIGN KEY (file_id, org_id) REFERENCES public.billing_files (id, org_id),
  FOREIGN KEY (credit_for_id, org_id) REFERENCES public.billing_documents (id, org_id),
  CONSTRAINT billing_documents_kind_shape CHECK (
    (doc_type = 'invoice' AND invoice_kind IS NOT NULL) OR (doc_type <> 'invoice')
  ),
  CONSTRAINT billing_documents_credit_shape CHECK ((doc_type = 'credit_note') = (credit_for_id IS NOT NULL)),
  CONSTRAINT billing_documents_vehicle_exclusive CHECK (
    won_vehicle_id IS NULL OR (external_plate IS NULL AND external_vin IS NULL AND external_description IS NULL)
  ),
  CONSTRAINT billing_documents_fx_shape CHECK (
    (settlement_currency = currency AND fx_rate IS NULL AND fx_basis IS NULL AND fx_rate_date IS NULL AND fx_source IS NULL
       AND settlement_balance_at_issue IS NULL)
    OR (settlement_currency <> currency AND fx_rate IS NOT NULL AND fx_rate > 0 AND fx_basis IS NOT NULL
       AND fx_rate_date IS NOT NULL AND btrim(coalesce(fx_source, '')) <> '' AND settlement_balance_at_issue IS NOT NULL)
  ),
  CONSTRAINT billing_documents_dates CHECK (due_date IS NULL OR due_date >= issue_date),
  CONSTRAINT billing_documents_balance CHECK (applied_at_issue <= total AND balance_at_issue = total - applied_at_issue),
  CONSTRAINT billing_documents_adjustment_label CHECK (adjustment_amount = 0 OR btrim(coalesce(adjustment_label, '')) <> ''),
  CONSTRAINT billing_documents_void_shape CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(coalesce(void_reason, '')) <> '')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_documents_idempotency ON public.billing_documents (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_documents_client_idx ON public.billing_documents (client_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS billing_documents_vehicle_idx ON public.billing_documents (won_vehicle_id) WHERE won_vehicle_id IS NOT NULL;

-- ---------------------------------------------------------------- lines
CREATE TABLE IF NOT EXISTS public.billing_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  document_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 1),
  section text NOT NULL DEFAULT '',
  component text CHECK (component IN ('vehicle_price', 'auction_fees', 'inland_trucking', 'ocean_freight', 'duty',
                                      'brokerage_fee', 'service_fee', 'all_inclusive_price', 'parts', 'labour', 'other')),
  description text NOT NULL CHECK (btrim(description) <> ''),
  quantity numeric(14, 4) NOT NULL CHECK (quantity > 0),
  rate numeric(14, 2) NOT NULL CHECK (rate > 0),
  discount_type text NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none', 'percent', 'fixed')),
  discount_value numeric(14, 4) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  gross_amount numeric(14, 2) NOT NULL CHECK (gross_amount > 0),
  discount_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  net_amount numeric(14, 2) NOT NULL CHECK (net_amount >= 0),
  tax_code text,
  tax_rate numeric(7, 4) NOT NULL DEFAULT 0,             -- frozen from the dated rate at issue
  client_visible boolean NOT NULL DEFAULT true,
  origin text NOT NULL CHECK (origin IN ('computed', 'document_backed', 'staff_entered')),
  basis text,                                            -- what a staff-entered figure rests on
  source_ref text,                                       -- what a computed figure was computed from
  source_document_id uuid REFERENCES public.won_vehicle_documents (id),   -- the uploaded document a document-backed figure comes from
  computed_inputs jsonb,                                 -- the rows/inputs the server recomputed from, frozen
  UNIQUE (document_id, position),
  FOREIGN KEY (document_id, org_id) REFERENCES public.billing_documents (id, org_id),
  CONSTRAINT billing_lines_discount_shape CHECK (
    (discount_type = 'none' AND discount_value = 0 AND discount_amount = 0) OR (discount_type <> 'none' AND discount_amount >= 0)
  ),
  CONSTRAINT billing_lines_net CHECK (net_amount = gross_amount - discount_amount),
  CONSTRAINT billing_lines_origin_shape CHECK (
    (origin = 'staff_entered' AND btrim(coalesce(basis, '')) <> '')
    OR (origin = 'document_backed' AND source_document_id IS NOT NULL)
    OR (origin = 'computed' AND btrim(coalesce(source_ref, '')) <> '' AND computed_inputs IS NOT NULL
        AND component IN ('vehicle_price', 'auction_fees', 'inland_trucking'))
  )
);
CREATE INDEX IF NOT EXISTS billing_document_lines_doc_idx ON public.billing_document_lines (document_id);

-- ---------------------------------------------------------------- RLS: staff read; the billing function is the only writer
ALTER TABLE public.billing_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_document_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_files_select ON public.billing_files FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY billing_documents_select ON public.billing_documents FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY billing_document_lines_select ON public.billing_document_lines FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
REVOKE ALL ON public.billing_files, public.billing_documents, public.billing_document_lines FROM anon, authenticated, service_role;
GRANT SELECT ON public.billing_files, public.billing_documents, public.billing_document_lines TO authenticated, service_role;
GRANT INSERT, UPDATE ON public.billing_files TO service_role;

-- ---------------------------------------------------------------- the compute function: the DATABASE owns every figure
-- Input  p = { org_id, issue_date, lines: [{position, section, quantity, rate, discount_type, discount_value, tax_code, client_visible}],
--              invoice_discount: {type, value}, adjustment }
-- Output = { lines: [{position, gross_amount, discount_amount, net_amount, tax_code, tax_rate}], sections: [{title, subtotal}],
--            subtotal, line_discount_total, invoice_discount_amount, tax_breakdown: [{code, rate, base, amount}],
--            tax_total, adjustment, total }
-- Semantics (the ones the real invoices need):
--   line gross    = round(quantity x rate, 2)
--   line discount = percent: round(gross x value / 100, 2); fixed: the stated amount (never above gross); none: 0
--   line net      = gross - discount             (a discount reduces the line's own amount; it is never a separate negative line)
--   invoice discount reduces the TAXABLE base: for each tax code, base = sum(net of its lines) - round(discount x that net / subtotal, 2)
--   tax per code  = round(base x rate / 100, 2), rate looked up from tax_codes AS OF issue_date (exactly one dated row)
--   total         = subtotal - invoice discount + tax + adjustment
--   a line with client_visible = false is INTERNAL (a retail invoice's cost line): computed, stored, never charged or taxed
CREATE OR REPLACE FUNCTION public.billing_compute(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  org uuid := (p ->> 'org_id')::uuid;
  d date := (p ->> 'issue_date')::date;
  l jsonb;
  out_lines jsonb := '[]'::jsonb;
  groups jsonb := '{}'::jsonb;
  breakdown jsonb := '[]'::jsonb;
  sec_titles text[] := '{}';
  sec_sums numeric[] := '{}';
  sections jsonb := '[]'::jsonb;
  qty numeric; rt numeric; gross numeric; dt text; dv numeric; disc numeric; net numeric;
  tc text; trate numeric; n integer; idx integer; sec text; vis boolean;
  subtotal numeric := 0; line_disc numeric := 0;
  idt text := coalesce(p -> 'invoice_discount' ->> 'type', 'none');
  idv numeric := coalesce((p -> 'invoice_discount' ->> 'value')::numeric, 0);
  idamt numeric := 0;
  adj numeric := coalesce((p ->> 'adjustment')::numeric, 0);
  k text; v jsonb; gnet numeric; grate numeric; share numeric; base numeric; amt numeric; tax_total numeric := 0;
  total numeric;
BEGIN
  IF jsonb_typeof(p -> 'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'lines') = 0 THEN
    RAISE EXCEPTION 'A document needs at least one line';
  END IF;
  FOR l IN SELECT x FROM jsonb_array_elements(p -> 'lines') AS t(x) ORDER BY (x ->> 'position')::integer LOOP
    qty := (l ->> 'quantity')::numeric; rt := (l ->> 'rate')::numeric;
    IF qty IS NULL OR qty <= 0 THEN RAISE EXCEPTION 'Line %: quantity must be above zero', l ->> 'position'; END IF;
    IF rt IS NULL OR rt <= 0 THEN RAISE EXCEPTION 'Line %: rate must be above zero (a negative or zero figure is not a line)', l ->> 'position'; END IF;
    gross := round(qty * rt, 2);
    dt := coalesce(l ->> 'discount_type', 'none'); dv := coalesce((l ->> 'discount_value')::numeric, 0);
    IF dt = 'none' THEN
      IF dv <> 0 THEN RAISE EXCEPTION 'Line %: a discount value needs a discount type', l ->> 'position'; END IF;
      disc := 0;
    ELSIF dt = 'percent' THEN
      IF dv <= 0 OR dv > 100 THEN RAISE EXCEPTION 'Line %: a percent discount must be above 0 and at most 100', l ->> 'position'; END IF;
      disc := round(gross * dv / 100, 2);
    ELSIF dt = 'fixed' THEN
      IF dv <= 0 OR dv <> round(dv, 2) THEN RAISE EXCEPTION 'Line %: a fixed discount must be a positive amount in whole cents', l ->> 'position'; END IF;
      IF dv > gross THEN RAISE EXCEPTION 'Line %: the discount exceeds the line', l ->> 'position'; END IF;
      disc := dv;
    ELSE
      RAISE EXCEPTION 'Line %: unknown discount type %', l ->> 'position', dt;
    END IF;
    net := gross - disc;
    vis := coalesce((l ->> 'client_visible')::boolean, true);
    -- an internal (hidden) line is computed but is never part of what the client is charged: no tax, no subtotal
    tc := CASE WHEN vis THEN nullif(btrim(coalesce(l ->> 'tax_code', '')), '') END;
    IF tc IS NULL THEN
      trate := 0;
    ELSE
      SELECT count(*), max(rate_percent) INTO n, trate FROM public.tax_codes
       WHERE org_id = org AND code = tc AND effective_from <= d AND (effective_to IS NULL OR effective_to >= d);
      IF n <> 1 THEN RAISE EXCEPTION 'Tax code % has % dated rates on % (exactly one is required)', tc, n, d; END IF;
      IF NOT (groups ? tc) THEN groups := jsonb_set(groups, ARRAY[tc], jsonb_build_object('rate', trate, 'net', 0)); END IF;
      groups := jsonb_set(groups, ARRAY[tc, 'net'], to_jsonb(((groups -> tc ->> 'net')::numeric) + net));
    END IF;
    IF vis THEN
      subtotal := subtotal + net; line_disc := line_disc + disc;
      sec := coalesce(l ->> 'section', '');
      idx := array_position(sec_titles, sec);
      IF idx IS NULL THEN sec_titles := sec_titles || sec; sec_sums := sec_sums || net; ELSE sec_sums[idx] := sec_sums[idx] + net; END IF;
    END IF;
    out_lines := out_lines || jsonb_build_object('position', (l ->> 'position')::integer, 'gross_amount', gross, 'discount_amount', disc,
                                                 'net_amount', net, 'tax_code', tc, 'tax_rate', trate);
  END LOOP;

  IF idt = 'percent' THEN
    IF idv <= 0 OR idv > 100 THEN RAISE EXCEPTION 'The invoice discount percent must be above 0 and at most 100'; END IF;
    idamt := round(subtotal * idv / 100, 2);
  ELSIF idt = 'fixed' THEN
    IF idv <= 0 OR idv <> round(idv, 2) THEN RAISE EXCEPTION 'The invoice discount must be a positive amount in whole cents'; END IF;
    IF idv > subtotal THEN RAISE EXCEPTION 'The invoice discount exceeds the subtotal'; END IF;
    idamt := idv;
  ELSIF idt = 'none' THEN
    IF idv <> 0 THEN RAISE EXCEPTION 'An invoice discount value needs a discount type'; END IF;
  ELSE
    RAISE EXCEPTION 'Unknown invoice discount type %', idt;
  END IF;
  IF adj <> round(adj, 2) THEN RAISE EXCEPTION 'The adjustment must be in whole cents'; END IF;

  FOR k, v IN SELECT key, value FROM jsonb_each(groups) ORDER BY key LOOP
    gnet := (v ->> 'net')::numeric; grate := (v ->> 'rate')::numeric;
    share := CASE WHEN subtotal = 0 THEN 0 ELSE round(idamt * gnet / subtotal, 2) END;
    base := gnet - share;
    amt := round(base * grate / 100, 2);
    breakdown := breakdown || jsonb_build_object('code', k, 'rate', grate, 'base', base, 'amount', amt);
    tax_total := tax_total + amt;
  END LOOP;

  total := subtotal - idamt + tax_total + adj;
  FOR idx IN 1 .. coalesce(array_length(sec_titles, 1), 0) LOOP
    sections := sections || jsonb_build_object('title', sec_titles[idx], 'subtotal', sec_sums[idx]);
  END LOOP;
  RETURN jsonb_build_object('lines', out_lines, 'sections', sections, 'subtotal', subtotal, 'line_discount_total', line_disc,
                            'invoice_discount_amount', idamt, 'tax_breakdown', breakdown, 'tax_total', tax_total,
                            'adjustment', adj, 'total', total);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.billing_compute(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_compute(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------- guards: a document is never edited; only voided
CREATE OR REPLACE FUNCTION public.billing_documents_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A billing document is never deleted - void it (a credit note reduces an issued invoice)'; END IF;
  IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A voided document cannot be changed'; END IF;
  IF (to_jsonb(NEW) - 'voided_at' - 'voided_by' - 'void_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at' - 'voided_by' - 'void_reason') THEN
    RAISE EXCEPTION 'An issued document is never edited - void it, or issue a credit note';
  END IF;
  IF NEW.voided_at IS NULL THEN RAISE EXCEPTION 'An issued document can only change by being voided'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_documents_guard_trg BEFORE UPDATE OR DELETE ON public.billing_documents
  FOR EACH ROW EXECUTE FUNCTION public.billing_documents_guard();

CREATE OR REPLACE FUNCTION public.billing_lines_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'A document line is never edited or deleted'; END;
$$;
CREATE TRIGGER billing_document_lines_guard_trg BEFORE UPDATE OR DELETE ON public.billing_document_lines
  FOR EACH ROW EXECUTE FUNCTION public.billing_lines_guard();

-- A line may only be added in the transaction that issues its document.
CREATE OR REPLACE FUNCTION public.billing_lines_seal()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_at timestamptz; parent_vehicle uuid; parent_org uuid; sdoc_org uuid; sdoc_vehicle uuid;
BEGIN
  SELECT recorded_at, won_vehicle_id, org_id INTO parent_at, parent_vehicle, parent_org FROM public.billing_documents WHERE id = NEW.document_id;
  IF NOT FOUND OR parent_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'An issued document''s lines are sealed: a line can only be added in the transaction that issues the document';
  END IF;
  IF NEW.origin = 'computed' AND parent_vehicle IS NULL THEN
    RAISE EXCEPTION 'A computed line needs a won vehicle: an external vehicle has nothing to compute from';
  END IF;
  IF NEW.source_document_id IS NOT NULL THEN
    SELECT org_id, won_vehicle_id INTO sdoc_org, sdoc_vehicle FROM public.won_vehicle_documents WHERE id = NEW.source_document_id;
    IF sdoc_org IS DISTINCT FROM parent_org OR (parent_vehicle IS NOT NULL AND sdoc_vehicle IS DISTINCT FROM parent_vehicle) THEN
      RAISE EXCEPTION 'A document-backed line must point at an uploaded document of the same org and vehicle';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_document_lines_seal_trg BEFORE INSERT ON public.billing_document_lines
  FOR EACH ROW EXECUTE FUNCTION public.billing_lines_seal();

-- A document must use an ALLOCATED number of its own org and kind, and a linked vehicle must belong to the same client.
CREATE OR REPLACE FUNCTION public.billing_documents_insert_check()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE num public.document_numbers; veh_client uuid;
BEGIN
  SELECT * INTO num FROM public.document_numbers WHERE id = NEW.number_id FOR UPDATE;
  IF NOT FOUND OR num.org_id <> NEW.org_id OR num.kind <> NEW.doc_type OR num.seq <> NEW.number_seq OR num.number_text <> NEW.number_text
     OR num.status <> 'allocated' THEN
    RAISE EXCEPTION 'A document must use an allocated % number of its own org from the ledger', NEW.doc_type;
  END IF;
  IF NEW.won_vehicle_id IS NOT NULL THEN
    SELECT client_id INTO veh_client FROM public.won_vehicles WHERE id = NEW.won_vehicle_id;
    IF veh_client IS DISTINCT FROM NEW.client_id THEN RAISE EXCEPTION 'The won vehicle does not belong to this client'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_documents_insert_check_trg BEFORE INSERT ON public.billing_documents
  FOR EACH ROW EXECUTE FUNCTION public.billing_documents_insert_check();

-- Voiding a document marks its ledger number 'voided' (the number is kept, never reused).
CREATE OR REPLACE FUNCTION public.billing_documents_number_void()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL THEN
    UPDATE public.document_numbers SET status = 'voided', status_changed_at = now(), note = coalesce(note, '') || 'voided: ' || NEW.void_reason
     WHERE id = NEW.number_id AND status = 'issued';
    IF NOT FOUND THEN RAISE EXCEPTION 'The ledger number of this document is not in the issued state'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_documents_number_void_trg AFTER UPDATE ON public.billing_documents
  FOR EACH ROW EXECUTE FUNCTION public.billing_documents_number_void();

-- ---------------------------------------------------------------- the deferred check: recompute at commit and refuse any disagreement
CREATE OR REPLACE FUNCTION public.check_billing_document()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  doc_id uuid := CASE TG_TABLE_NAME WHEN 'billing_documents' THEN NEW.id ELSE NEW.document_id END;
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
CREATE CONSTRAINT TRIGGER billing_documents_check_trg AFTER INSERT ON public.billing_documents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_billing_document();
CREATE CONSTRAINT TRIGGER billing_document_lines_check_trg AFTER INSERT ON public.billing_document_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_billing_document();

-- a file a live document points at cannot be retired
CREATE OR REPLACE FUNCTION public.billing_files_referenced_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A billing file is never deleted - retire it (soft delete) only if nothing live points at it'; END IF;
  IF (to_jsonb(NEW) - 'deleted_at' - 'deleted_by') IS DISTINCT FROM (to_jsonb(OLD) - 'deleted_at' - 'deleted_by') THEN
    RAISE EXCEPTION 'A billing file is never edited';
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.billing_documents d WHERE d.file_id = OLD.id AND d.voided_at IS NULL) THEN
    RAISE EXCEPTION 'This file belongs to a live document - void the document first';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_files_guard_trg BEFORE UPDATE OR DELETE ON public.billing_files
  FOR EACH ROW EXECUTE FUNCTION public.billing_files_referenced_guard();

CREATE OR REPLACE FUNCTION public.billing_no_truncate_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is never truncated', TG_TABLE_NAME; END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_files', 'billing_documents', 'billing_document_lines'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.billing_no_truncate_v2()', t || '_no_truncate_trg', t);
  END LOOP;
END $$;

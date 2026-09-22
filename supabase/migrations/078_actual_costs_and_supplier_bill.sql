-- PROMPT 41 Stage 2 - estimate vs actual cost per component, following the winning-bid ledger pattern exactly
-- (won_vehicle_winning_bids): append-only, staff-entered, optionally backed by an uploaded document, supersede by
-- inserting a new row (the latest non-voided row per component wins), void-with-reason for a correction, never an
-- UPDATE or DELETE of the figure itself. Currency follows the established C1d shape (SCHEMA.md "Currency
-- (migration 033, Prompt 28 Stage 2/C1d)"): original currency kept, amount_usd/fx_rate/fx_rate_date frozen at
-- entry, the same all-or-nothing CHECK shape as cost_rates/trucking_rates/auction_fee_brackets.
CREATE TABLE public.won_vehicle_actual_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  won_vehicle_id uuid NOT NULL,
  component text NOT NULL CHECK (component IN ('auction_fees','inland_trucking','ocean_freight','duty','other')),
  component_label text,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'usd',
  amount_usd numeric,
  fx_rate numeric,
  fx_rate_date date,
  evidence_document_id uuid,
  note text,
  offered_to_rates boolean NOT NULL DEFAULT false,
  offered_to_rates_at timestamptz,
  offered_to_rates_by uuid REFERENCES auth.users(id),
  recorded_by uuid NOT NULL REFERENCES auth.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id),
  void_reason text,
  CONSTRAINT won_vehicle_actual_costs_component_label CHECK ((component = 'other') = (btrim(coalesce(component_label, '')) <> '')),
  CONSTRAINT won_vehicle_actual_costs_currency_shape CHECK (
    (currency = 'usd' AND amount_usd IS NULL AND fx_rate IS NULL AND fx_rate_date IS NULL)
    OR (currency <> 'usd' AND amount_usd IS NOT NULL AND fx_rate IS NOT NULL AND fx_rate_date IS NOT NULL)
  ),
  CONSTRAINT won_vehicle_actual_costs_void_shape CHECK (
    ((voided_at IS NULL) AND (voided_by IS NULL) AND (void_reason IS NULL))
    OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL) AND (btrim(coalesce(void_reason, '')) <> ''))
  ),
  CONSTRAINT won_vehicle_actual_costs_offered_shape CHECK ((offered_to_rates = false) = (offered_to_rates_at IS NULL AND offered_to_rates_by IS NULL)),
  FOREIGN KEY (won_vehicle_id, org_id) REFERENCES public.won_vehicles(id, org_id),
  FOREIGN KEY (evidence_document_id, won_vehicle_id) REFERENCES public.won_vehicle_documents(id, won_vehicle_id)
);

CREATE INDEX won_vehicle_actual_costs_lookup ON public.won_vehicle_actual_costs(won_vehicle_id, component, recorded_at DESC) WHERE voided_at IS NULL;

ALTER TABLE public.won_vehicle_actual_costs ENABLE ROW LEVEL SECURITY;
-- Staff-only, no client policy at all: the actual figures are Caplimo's real internal costs, the same reasoning
-- that keeps a retail invoice's cost lines hidden and that closed debt #89 for computed_inputs.
CREATE POLICY won_vehicle_actual_costs_staff_select ON public.won_vehicle_actual_costs FOR SELECT
  USING (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin());
CREATE POLICY won_vehicle_actual_costs_staff_insert ON public.won_vehicle_actual_costs FOR INSERT
  WITH CHECK (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin());
-- Append-only: no UPDATE policy for the figure itself; a narrow one below allows only the void columns and the
-- offered-to-rates flag to change, mirroring billing_documents_guard's "only void columns" shape.
CREATE POLICY won_vehicle_actual_costs_staff_void ON public.won_vehicle_actual_costs FOR UPDATE
  USING (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin())
  WITH CHECK (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin());

CREATE OR REPLACE FUNCTION public.won_vehicle_actual_costs_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An actual cost is never deleted - void it with a reason instead'; END IF;
  IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A voided actual cannot be changed'; END IF;
  IF (to_jsonb(NEW) - 'voided_at' - 'voided_by' - 'void_reason' - 'offered_to_rates' - 'offered_to_rates_at' - 'offered_to_rates_by')
     IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at' - 'voided_by' - 'void_reason' - 'offered_to_rates' - 'offered_to_rates_at' - 'offered_to_rates_by') THEN
    RAISE EXCEPTION 'An actual cost figure is never edited - void it and record a new one';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER won_vehicle_actual_costs_guard BEFORE UPDATE OR DELETE ON public.won_vehicle_actual_costs
  FOR EACH ROW EXECUTE FUNCTION public.won_vehicle_actual_costs_guard();

-- The latest non-voided actual per (won_vehicle_id, component) - what "the actual" means, read once, not
-- recomputed ad hoc in every query the way the winning-bid ledger's "current" is today.
CREATE VIEW public.won_vehicle_actual_costs_current WITH (security_invoker = true) AS
SELECT DISTINCT ON (won_vehicle_id, component) *
FROM public.won_vehicle_actual_costs
WHERE voided_at IS NULL
ORDER BY won_vehicle_id, component, recorded_at DESC, id DESC;

-- ---------------------------------------------------------------------------------------------------------
-- PROMPT 41 Stage 3 - the "receipt" document category collided with the client-facing billing_receipts Caplimo
-- issues (the IAAI invoice was filed as a won_vehicle_documents "receipt", a different thing entirely from a
-- receipt for a client's payment). Renamed to "supplier_bill", migrating the 4 existing rows in that category;
-- no other value touched.
ALTER TABLE public.won_vehicle_documents DROP CONSTRAINT won_vehicle_documents_document_type_check;
UPDATE public.won_vehicle_documents SET document_type = 'supplier_bill' WHERE document_type = 'receipt';
ALTER TABLE public.won_vehicle_documents ADD CONSTRAINT won_vehicle_documents_document_type_check
  CHECK (document_type = ANY (ARRAY['invoice','supplier_bill','shipping_document','bill_of_lading','title','assessment_notice','other']));

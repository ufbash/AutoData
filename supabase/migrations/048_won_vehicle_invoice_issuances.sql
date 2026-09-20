-- Prompt 34 Stage 5 - the record of an invoice being issued to a client.
--
-- Approach (Bashir, 20 Sep 2026): for now an invoice is a PDF Caplimo produces elsewhere and
-- uploads into the won vehicle's document store (Stage 4, document_type 'invoice'); this table
-- records that it was ISSUED - what, to whom, when, by whom, over which channel. "An invoice
-- nobody can prove was sent is not evidence." Generating an invoice from cost data is deliberately
-- NOT built: its inputs do not exist yet (no recorded winning bid, no duty, no freight rates, no
-- brokerage-fee definition), and a generated invoice with silent holes would look complete. It is
-- planned as part of a later CRM; this table's shape does not prevent it (a generated invoice would
-- still be stored as a won_vehicle_documents row and issued through here).
--
-- The amount and currency are STAFF-ENTERED, never derived. Behind auth always; never on the
-- tracking page (PROJECT_CHARTER.md section 7). Append-only: an issuance is never edited or
-- deleted, only VOIDED with a reason, and a correction is a new issuance.

-- So an issuance can only reference a document of the SAME won vehicle, enforced by the database.
ALTER TABLE won_vehicle_documents ADD CONSTRAINT won_vehicle_documents_id_vehicle_uniq UNIQUE (id, won_vehicle_id);

CREATE TABLE won_vehicle_invoice_issuances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  won_vehicle_id uuid NOT NULL,
  document_id uuid NOT NULL,
  invoice_number text,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'NGN', 'EUR', 'GBP')),
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'imessage', 'other')),
  recipient text NOT NULL CHECK (btrim(recipient) <> ''),
  issued_at timestamptz NOT NULL,
  issued_by uuid NOT NULL REFERENCES auth.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id),
  void_reason text,
  FOREIGN KEY (won_vehicle_id, org_id) REFERENCES won_vehicles (id, org_id),
  FOREIGN KEY (document_id, won_vehicle_id) REFERENCES won_vehicle_documents (id, won_vehicle_id),
  CONSTRAINT won_vehicle_invoice_issuances_void_shape CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(coalesce(void_reason, '')) <> '')
  )
);

CREATE INDEX idx_won_vehicle_invoice_issuances_vehicle ON won_vehicle_invoice_issuances (won_vehicle_id);

ALTER TABLE won_vehicle_invoice_issuances ENABLE ROW LEVEL SECURITY;

-- SCHEMA.md section 12's pattern, SELECT only; the only writer is the won-vehicle-invoices
-- Edge Function (service role).
CREATE POLICY won_vehicle_invoice_issuances_select ON won_vehicle_invoice_issuances
  FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());

-- Defence in depth for "never edited, never deleted", holding even for the service role: the only
-- permitted change is voiding a not-yet-voided issuance.
CREATE OR REPLACE FUNCTION won_vehicle_invoice_issuances_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An invoice issuance is never deleted - void it with a reason instead';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'A voided invoice issuance cannot be changed';
  END IF;
  IF (NEW.id, NEW.org_id, NEW.won_vehicle_id, NEW.document_id, NEW.invoice_number, NEW.amount, NEW.currency,
      NEW.channel, NEW.recipient, NEW.issued_at, NEW.issued_by, NEW.recorded_at, NEW.notes)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.won_vehicle_id, OLD.document_id, OLD.invoice_number, OLD.amount, OLD.currency,
      OLD.channel, OLD.recipient, OLD.issued_at, OLD.issued_by, OLD.recorded_at, OLD.notes) THEN
    RAISE EXCEPTION 'An invoice issuance is never edited - void it and record a new one';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER won_vehicle_invoice_issuances_guard_trg
  BEFORE UPDATE OR DELETE ON won_vehicle_invoice_issuances
  FOR EACH ROW EXECUTE FUNCTION won_vehicle_invoice_issuances_guard();

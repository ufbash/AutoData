-- Debt #60 - the real winning bid on a won vehicle.
--
-- won_vehicles.won_snapshot freezes what the client APPROVED (display_price, is_bid). The price the
-- lot actually hammered at is a different, later fact that only a person can supply, so it is
-- recorded here as its own append-only ledger and never written into the snapshot. Until one exists
-- the bought-car view prices auction fees at the approved price and says so; once one exists, fees
-- are computed at it.
--
-- Amount is USD: Copart, IAAI and bid.cars all bid in USD, and the fee schedules are USD. It is
-- staff-entered, never derived (not copied from the sighting's price, which can drift on re-capture).
-- Who/when/against-what-evidence are recorded; an optional link points at an uploaded document of the
-- SAME vehicle (composite FK). Append-only: a new entry supersedes the earlier one (the earlier stays
-- visible as history), and any entry can be voided with a reason. Never edited, never deleted - not
-- even by the service role. The current winning bid is the latest non-voided entry.

CREATE TABLE won_vehicle_winning_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  won_vehicle_id uuid NOT NULL,
  amount_usd numeric(14, 2) NOT NULL CHECK (amount_usd > 0 AND amount_usd <= 1000000),
  -- How the bid was placed. NULL = not known (the fee then stays a range across both methods).
  bid_method text CHECK (bid_method IS NULL OR bid_method IN ('proxy', 'live')),
  note text,
  evidence_document_id uuid,
  recorded_by uuid NOT NULL REFERENCES auth.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id),
  void_reason text,
  FOREIGN KEY (won_vehicle_id, org_id) REFERENCES won_vehicles (id, org_id),
  -- MATCH SIMPLE: skipped when evidence_document_id is NULL, enforced when set.
  FOREIGN KEY (evidence_document_id, won_vehicle_id) REFERENCES won_vehicle_documents (id, won_vehicle_id),
  CONSTRAINT won_vehicle_winning_bids_void_shape CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(coalesce(void_reason, '')) <> '')
  )
);

CREATE INDEX idx_won_vehicle_winning_bids_vehicle ON won_vehicle_winning_bids (won_vehicle_id, recorded_at DESC);

ALTER TABLE won_vehicle_winning_bids ENABLE ROW LEVEL SECURITY;

-- SCHEMA.md section 12's pattern, SELECT only; the only writer is the won-vehicle-winning-bid
-- Edge Function (service role).
CREATE POLICY won_vehicle_winning_bids_select ON won_vehicle_winning_bids
  FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());

CREATE OR REPLACE FUNCTION won_vehicle_winning_bids_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A winning-bid record is never deleted - void it with a reason instead';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'A voided winning-bid record cannot be changed';
  END IF;
  IF (NEW.id, NEW.org_id, NEW.won_vehicle_id, NEW.amount_usd, NEW.bid_method, NEW.note, NEW.evidence_document_id, NEW.recorded_by, NEW.recorded_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.won_vehicle_id, OLD.amount_usd, OLD.bid_method, OLD.note, OLD.evidence_document_id, OLD.recorded_by, OLD.recorded_at) THEN
    RAISE EXCEPTION 'A winning-bid record is never edited - record a new one, or void it with a reason';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER won_vehicle_winning_bids_guard_trg
  BEFORE UPDATE OR DELETE ON won_vehicle_winning_bids
  FOR EACH ROW EXECUTE FUNCTION won_vehicle_winning_bids_guard();

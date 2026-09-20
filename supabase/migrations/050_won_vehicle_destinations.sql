-- Persist the destination port (and shipping method) on a won vehicle.
--
-- Until now the bought-car view made the user pick a port every time and never saved it, so trucking
-- and shipping abstained until someone re-chose it. Nothing else held a destination (no column on
-- client_briefs, research_runs or the intake form), so the won vehicle is the first place it lives.
--
-- A destination is an operational choice that legitimately CHANGES (a client reroutes) and drives a
-- cost, so it is an append-only history rather than an overwritten column: who chose which port, when,
-- and what it was before. The current destination is the latest non-voided entry. A wrong entry is
-- voided with a reason (or simply replaced by a new one). Never edited, never deleted - not even by
-- the service role.
--
-- destination_port holds trucking_rates.destination_port_normalized EXACTLY as stored, because that is
-- the string the trucking lookup matches on. NOTE: that column still carries vendor typos (BATIMORE,
-- PROVDIENCE, WILLMINGTON, MD-BALTIMORE, GA-RINCON, MIAMI vs MIAMI PORT) - an importer normalisation
-- gap, logged as a debt, not corrected here. destination_options() therefore reports a rate count per
-- option so the real ports lead and the typo variants are visible as the minor entries they are.

CREATE TABLE won_vehicle_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  won_vehicle_id uuid NOT NULL,
  destination_port text NOT NULL CHECK (btrim(destination_port) <> ''),
  shipping_method text NOT NULL CHECK (shipping_method IN ('container', 'roro')),
  note text,
  set_by uuid NOT NULL REFERENCES auth.users(id),
  set_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id),
  void_reason text,
  FOREIGN KEY (won_vehicle_id, org_id) REFERENCES won_vehicles (id, org_id),
  CONSTRAINT won_vehicle_destinations_void_shape CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(coalesce(void_reason, '')) <> '')
  )
);

CREATE INDEX idx_won_vehicle_destinations_vehicle ON won_vehicle_destinations (won_vehicle_id, set_at DESC);

ALTER TABLE won_vehicle_destinations ENABLE ROW LEVEL SECURITY;

-- SCHEMA.md section 12's pattern, SELECT only; the only writer is the won-vehicle-destination Edge Function.
CREATE POLICY won_vehicle_destinations_select ON won_vehicle_destinations
  FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());

CREATE OR REPLACE FUNCTION won_vehicle_destinations_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A destination record is never deleted - void it with a reason instead';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'A voided destination record cannot be changed';
  END IF;
  IF (NEW.id, NEW.org_id, NEW.won_vehicle_id, NEW.destination_port, NEW.shipping_method, NEW.note, NEW.set_by, NEW.set_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.won_vehicle_id, OLD.destination_port, OLD.shipping_method, OLD.note, OLD.set_by, OLD.set_at) THEN
    RAISE EXCEPTION 'A destination record is never edited - set a new one, or void it with a reason';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER won_vehicle_destinations_guard_trg
  BEFORE UPDATE OR DELETE ON won_vehicle_destinations
  FOR EACH ROW EXECUTE FUNCTION won_vehicle_destinations_guard();

-- Every (port, method) the rate data can quote today, with how much evidence backs it. SECURITY
-- INVOKER, so the caller's own RLS scopes it to their org.
CREATE OR REPLACE FUNCTION destination_options()
RETURNS TABLE (destination_port text, shipping_method text, rate_count bigint, yard_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT destination_port_normalized, shipping_method, count(*), count(DISTINCT yard_state || '|' || yard_city)
  FROM trucking_rates
  WHERE effective_to IS NULL
  GROUP BY destination_port_normalized, shipping_method
  ORDER BY count(*) DESC, destination_port_normalized;
$$;

GRANT EXECUTE ON FUNCTION destination_options() TO authenticated;

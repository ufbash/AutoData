-- Prompt 34 Stage 2 - the won vehicle: a first-class record under a brief, alongside research
-- runs rather than inside one. The asset is not client-specific (the same asset can legitimately
-- appear in two different clients' runs, especially post-Prompt-32's merge work); the won vehicle
-- is. Every document, status, invoice and notification hangs off the won vehicle, never the
-- asset directly - anchoring to the asset would leak one client's documents onto another
-- client's car.

CREATE TABLE IF NOT EXISTS won_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id),
  brief_id uuid NOT NULL REFERENCES client_briefs(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  research_run_listing_id uuid NOT NULL UNIQUE REFERENCES research_run_listings(id),
  run_id uuid NOT NULL REFERENCES research_runs(id),
  -- Frozen at promotion, never recomputed - same discipline as approved_snapshot, the FX rate
  -- frozen at confirmation, and price_usd frozen at capture. The source sighting keeps changing
  -- (re-captures, status drift, the lot page eventually disappearing); none of that may alter
  -- the historical record of what was actually won.
  won_snapshot jsonb NOT NULL,
  promoted_by uuid NOT NULL REFERENCES auth.users(id),
  promoted_at timestamptz NOT NULL DEFAULT now(),
  -- Tracking page token - same shape as research_runs.share_token/share_enabled (revocation
  -- pattern already proven: leave the token value in place, flip share_enabled to false).
  share_token text UNIQUE,
  share_enabled boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_won_vehicles_brief_id ON won_vehicles(brief_id);
CREATE INDEX IF NOT EXISTS idx_won_vehicles_asset_id ON won_vehicles(asset_id);
CREATE INDEX IF NOT EXISTS idx_won_vehicles_org_id ON won_vehicles(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_won_vehicles_share_token ON won_vehicles(share_token) WHERE share_token IS NOT NULL;

-- The source listing gains a won marker and a link - it is never deleted, moved, or rewritten.
-- The run remains a complete account of what was offered and what the client approved.
ALTER TABLE research_run_listings ADD COLUMN IF NOT EXISTS won_vehicle_id uuid REFERENCES won_vehicles(id);
ALTER TABLE research_run_listings ADD COLUMN IF NOT EXISTS won_at timestamptz;

-- Prompt 34 Stage 1 pre-flight finding: the existing "one approved listing per run" rule was
-- enforced only at the app level (check-then-guarded-update in recordStaffApproval) - the exact
-- race-condition shape this stage was told not to repeat for promotion. Fixed here with a real
-- database constraint, per Bashir's explicit instruction not to leave two different standards
-- for the same class of guarantee in the same codebase.
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_run_listings_one_approved_per_run
  ON research_run_listings(run_id) WHERE approved_at IS NOT NULL;

-- The nine-stage shipping lifecycle, strictly sequential (Bashir's real process, not invented):
-- won -> auction paid -> title received -> picked up from yard -> at origin port -> sailed ->
-- arrived (destination port) -> customs cleared -> delivered.
CREATE TYPE won_vehicle_status_enum AS ENUM (
  'won', 'auction_paid', 'title_received', 'picked_up', 'at_origin_port',
  'sailed', 'arrived', 'customs_cleared', 'delivered'
);

-- Status HISTORY, not a single mutable column - "when did it clear customs" is the question
-- this exists to answer, and a single column can't answer it. A correction is a NEW row
-- recording the reversal, never an edit or deletion of the original - "was this car actually at
-- the port on the 14th, or did someone mis-click" must remain answerable after the fact.
CREATE TABLE IF NOT EXISTS won_vehicle_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  won_vehicle_id uuid NOT NULL REFERENCES won_vehicles(id),
  status won_vehicle_status_enum NOT NULL,
  changed_by uuid NOT NULL REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  -- Forward transitions: any staff member, exactly current+1, never skipping. Corrections:
  -- superadmin-only, any target status (fixing a mistake may mean moving backward, or further
  -- than one step), always with a stated reason.
  is_correction boolean NOT NULL DEFAULT false,
  correction_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (is_correction = false AND correction_reason IS NULL)
    OR (is_correction = true AND correction_reason IS NOT NULL AND length(trim(correction_reason)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_won_vehicle_status_history_vehicle ON won_vehicle_status_history(won_vehicle_id, created_at);

-- The only path that actually promotes a listing. Atomic (one Postgres function), and the
-- exactly-once guarantee comes from won_vehicles.research_run_listing_id's own UNIQUE
-- constraint, not an application check - a concurrent double-click cannot produce two won
-- vehicles for the same bid.
CREATE OR REPLACE FUNCTION promote_listing_to_won_vehicle(p_listing_id uuid, p_promoted_by uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_listing research_run_listings;
  v_run research_runs;
  v_won_vehicle_id uuid;
BEGIN
  SELECT * INTO v_listing FROM research_run_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing % not found', p_listing_id;
  END IF;
  IF v_listing.won_vehicle_id IS NOT NULL THEN
    RAISE EXCEPTION 'Listing % has already been promoted to won vehicle %', p_listing_id, v_listing.won_vehicle_id;
  END IF;
  IF v_listing.approved_at IS NULL THEN
    RAISE EXCEPTION 'Listing % has not been approved and cannot be promoted', p_listing_id;
  END IF;
  IF v_listing.sighting_id IS NULL THEN
    RAISE EXCEPTION 'Listing % has no sighting, cannot resolve an asset', p_listing_id;
  END IF;

  SELECT * INTO v_run FROM research_runs WHERE id = v_listing.run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % not found for listing %', v_listing.run_id, p_listing_id;
  END IF;
  IF v_run.client_id IS NULL OR v_run.client_brief_id IS NULL THEN
    RAISE EXCEPTION 'Run % has no client/brief - a won vehicle must live under a brief', v_run.id;
  END IF;

  INSERT INTO won_vehicles (org_id, client_id, brief_id, asset_id, research_run_listing_id, run_id, won_snapshot, promoted_by)
  SELECT
    v_listing.org_id,
    v_run.client_id,
    v_run.client_brief_id,
    s.asset_id,
    v_listing.id,
    v_run.id,
    v_listing.approved_snapshot,
    p_promoted_by
  FROM sightings s
  WHERE s.id = v_listing.sighting_id AND s.asset_id IS NOT NULL
  RETURNING id INTO v_won_vehicle_id;

  IF v_won_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Listing % has a sighting with no resolved asset, cannot promote', p_listing_id;
  END IF;

  UPDATE research_run_listings
  SET won_vehicle_id = v_won_vehicle_id, won_at = now()
  WHERE id = p_listing_id;

  INSERT INTO won_vehicle_status_history (won_vehicle_id, status, changed_by, is_correction)
  VALUES (v_won_vehicle_id, 'won', p_promoted_by, false);

  RETURN v_won_vehicle_id;
END;
$$;

-- Forward-only advance: exactly current+1, never a skip. Any staff member.
CREATE OR REPLACE FUNCTION advance_won_vehicle_status(p_won_vehicle_id uuid, p_new_status won_vehicle_status_enum, p_changed_by uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_sequence won_vehicle_status_enum[] := ARRAY['won','auction_paid','title_received','picked_up','at_origin_port','sailed','arrived','customs_cleared','delivered']::won_vehicle_status_enum[];
  v_current won_vehicle_status_enum;
  v_current_pos int;
  v_new_pos int;
  v_history_id uuid;
BEGIN
  PERFORM 1 FROM won_vehicles WHERE id = p_won_vehicle_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Won vehicle % not found', p_won_vehicle_id;
  END IF;

  SELECT status INTO v_current FROM won_vehicle_status_history
  WHERE won_vehicle_id = p_won_vehicle_id
  ORDER BY created_at DESC, id DESC LIMIT 1;

  v_current_pos := array_position(v_sequence, v_current);
  v_new_pos := array_position(v_sequence, p_new_status);

  IF v_new_pos != v_current_pos + 1 THEN
    RAISE EXCEPTION 'Invalid transition: % (position %) -> % (position %). Forward transitions must advance by exactly one step.', v_current, v_current_pos, p_new_status, v_new_pos;
  END IF;

  INSERT INTO won_vehicle_status_history (won_vehicle_id, status, changed_by, is_correction)
  VALUES (p_won_vehicle_id, p_new_status, p_changed_by, false)
  RETURNING id INTO v_history_id;

  RETURN v_history_id;
END;
$$;

-- Correction: superadmin-only (enforced by the calling Edge Function, same pattern as
-- merge_assets not re-checking role itself), any target status, reason required by the CHECK
-- constraint on the table itself.
CREATE OR REPLACE FUNCTION correct_won_vehicle_status(p_won_vehicle_id uuid, p_new_status won_vehicle_status_enum, p_changed_by uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_history_id uuid;
BEGIN
  PERFORM 1 FROM won_vehicles WHERE id = p_won_vehicle_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Won vehicle % not found', p_won_vehicle_id;
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A correction requires a stated reason';
  END IF;

  INSERT INTO won_vehicle_status_history (won_vehicle_id, status, changed_by, is_correction, correction_reason)
  VALUES (p_won_vehicle_id, p_new_status, p_changed_by, true, p_reason)
  RETURNING id INTO v_history_id;

  RETURN v_history_id;
END;
$$;

ALTER TABLE won_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE won_vehicle_status_history ENABLE ROW LEVEL SECURITY;

-- SCHEMA.md §12's exact pattern.
CREATE POLICY won_vehicles_select ON public.won_vehicles
  FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY won_vehicles_insert ON public.won_vehicles
  FOR INSERT WITH CHECK (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY won_vehicles_update ON public.won_vehicles
  FOR UPDATE USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());

CREATE POLICY won_vehicle_status_history_select ON public.won_vehicle_status_history
  FOR SELECT USING (
    won_vehicle_id IN (SELECT id FROM won_vehicles WHERE org_id IN (SELECT user_org_ids())) OR is_superadmin()
  );

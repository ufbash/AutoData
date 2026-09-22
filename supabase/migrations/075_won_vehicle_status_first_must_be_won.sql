-- PROMPT 40 Stage 5 - debt #83. advance_won_vehicle_status's sequence check computes v_current_pos via
-- array_position(v_sequence, v_current), and when there is no history row yet v_current is NULL - and
-- array_position(anything, NULL) is always NULL in Postgres, regardless of the array's contents. The guard
-- `IF v_new_pos != v_current_pos + 1 THEN RAISE EXCEPTION` then evaluates `v_new_pos != NULL`, which is NULL, and
-- PL/pgSQL treats a NULL IF condition as false - so the RAISE never fires, and the very first status a vehicle
-- ever receives can silently be ANYTHING, not just 'won'. Fix: handle "no history yet" explicitly, before the
-- general off-by-one check, and require it to be exactly 'won'.
CREATE OR REPLACE FUNCTION public.advance_won_vehicle_status(p_won_vehicle_id uuid, p_new_status won_vehicle_status_enum, p_changed_by uuid)
RETURNS uuid
LANGUAGE plpgsql AS $function$
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

  IF v_current IS NULL THEN
    IF p_new_status <> 'won' THEN
      RAISE EXCEPTION 'A vehicle''s first status must be won, not %', p_new_status;
    END IF;
    INSERT INTO won_vehicle_status_history (won_vehicle_id, status, changed_by, is_correction)
    VALUES (p_won_vehicle_id, p_new_status, p_changed_by, false)
    RETURNING id INTO v_history_id;
    RETURN v_history_id;
  END IF;

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
$function$;

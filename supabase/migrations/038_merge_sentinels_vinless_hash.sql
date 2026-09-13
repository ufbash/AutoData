-- Prompt 32 Stage 3 follow-up (debt #46) - Bashir's review of Stage 2/3 caught a second
-- instance of the exact revival bug the fingerprint_hash sentinel already fixed: Stage 3's new
-- vinless_identity_hash column gives a soft-retired orphan a second live key a fresh VIN-less
-- capture could still match on, silently reattaching to the dead row instead of the survivor.
-- Preferred over relying on `merged_into_asset_id IS NULL` filters at every future call site
-- (a filter has to be remembered every time; a sentinel only has to be right once, here).

CREATE OR REPLACE FUNCTION merge_assets(p_survivor_id uuid, p_orphan_id uuid, p_confirmed_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_survivor assets;
  v_orphan assets;
  v_sightings_moved int;
  v_history_moved int;
  v_docs_moved int;
  v_new_orphan_hash text;
  v_new_orphan_vinless_hash text;
BEGIN
  IF p_survivor_id = p_orphan_id THEN
    RAISE EXCEPTION 'Cannot merge an asset into itself';
  END IF;

  SELECT * INTO v_survivor FROM assets WHERE id = p_survivor_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Survivor asset % not found', p_survivor_id;
  END IF;
  IF v_survivor.merged_into_asset_id IS NOT NULL THEN
    RAISE EXCEPTION 'Survivor asset % is itself already merged into %', p_survivor_id, v_survivor.merged_into_asset_id;
  END IF;

  SELECT * INTO v_orphan FROM assets WHERE id = p_orphan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orphan asset % not found', p_orphan_id;
  END IF;
  IF v_orphan.merged_into_asset_id IS NOT NULL THEN
    RAISE EXCEPTION 'Orphan asset % is already merged into %', p_orphan_id, v_orphan.merged_into_asset_id;
  END IF;
  IF v_orphan.org_id != v_survivor.org_id THEN
    RAISE EXCEPTION 'Cannot merge assets across different orgs (% vs %)', v_orphan.org_id, v_survivor.org_id;
  END IF;

  UPDATE sightings SET asset_id = p_survivor_id WHERE asset_id = p_orphan_id;
  GET DIAGNOSTICS v_sightings_moved = ROW_COUNT;

  UPDATE auction_history SET asset_id = p_survivor_id WHERE asset_id = p_orphan_id;
  GET DIAGNOSTICS v_history_moved = ROW_COUNT;

  -- asset_paired_by/asset_paired_at are deliberately NOT touched here - they record a human's
  -- decision to pair a document to this asset, at the time they made it. Only the pointer moves
  -- to the survivor; the provenance of that past decision does not get rewritten onto whoever
  -- happens to be confirming this unrelated merge.
  UPDATE cost_document_extractions SET asset_id = p_survivor_id WHERE asset_id = p_orphan_id;
  GET DIAGNOSTICS v_docs_moved = ROW_COUNT;

  -- Mutate the orphan's own fingerprint_hash AND vinless_identity_hash so neither can ever again
  -- be produced by a fresh capture and silently resolve a new sighting back onto the dead
  -- orphan. fingerprint_hash guards research-capture's exact-hash lookup and the Prompt 29
  -- VIN-discovery upgrade probe; vinless_identity_hash guards Stage 3's new symmetric-attach
  -- lookup - without sentinelling both, a soft-retired orphan still carries a live matching key
  -- on whichever one is left untouched. Both are derived identity values, not raw captured
  -- fields (make/model/trim/etc, all untouched above) - mutating them does not violate
  -- PROJECT_CHARTER.md §5.8. Both originals are preserved inside the new values and in this
  -- function's return, so neither is ever actually lost.
  v_new_orphan_hash := 'merged:' || v_orphan.fingerprint_hash || ':' || v_orphan.id::text;
  v_new_orphan_vinless_hash := CASE
    WHEN v_orphan.vinless_identity_hash IS NULL THEN NULL
    ELSE 'merged:' || v_orphan.vinless_identity_hash || ':' || v_orphan.id::text
  END;

  UPDATE assets
  SET merged_into_asset_id = p_survivor_id,
      merged_at = now(),
      merged_by = p_confirmed_by,
      fingerprint_hash = v_new_orphan_hash,
      vinless_identity_hash = v_new_orphan_vinless_hash,
      updated_at = now()
  WHERE id = p_orphan_id;

  RETURN jsonb_build_object(
    'survivor_id', p_survivor_id,
    'orphan_id', p_orphan_id,
    'sightings_moved', v_sightings_moved,
    'auction_history_moved', v_history_moved,
    'cost_document_extractions_moved', v_docs_moved,
    'orphan_original_fingerprint_hash', v_orphan.fingerprint_hash,
    'orphan_original_vinless_identity_hash', v_orphan.vinless_identity_hash,
    'merged_at', now()
  );
END;
$$;

-- Retroactively sentinel the two orphans already merged before this column/fix existed
-- (71afaf80.../92aacfdf...) - they currently have vinless_identity_hash = NULL (the column
-- didn't exist at merge time), and the backfill about to populate every asset's own value would
-- otherwise give them a live, matching key again. Only touches rows that are ALREADY
-- merged_into_asset_id IS NOT NULL - a one-time correction for the two rows this fix arrived
-- too late for, not a general-purpose bulk operation.
UPDATE assets
SET vinless_identity_hash = 'merged:pending-backfill:' || id::text
WHERE merged_into_asset_id IS NOT NULL AND vinless_identity_hash IS NULL;

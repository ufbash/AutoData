-- Prompt 32 Stage 2 (debt #46) - reviewed asset merge.
--
-- Soft-retirement, matching the existing deleted_at/deleted_by pattern from migration 023
-- (clients/client_briefs), pointed at a survivor instead of "deleted". Nothing is ever deleted:
-- the orphan keeps every raw field it held (PROJECT_CHARTER.md §5.8) and remains queryable
-- directly, which is itself the audit record of "what the orphan held" - no separate table
-- needed. Reversing a wrong merge means clearing these three columns back to null; the FK
-- repoint and fingerprint mutation below are the only state that would need manual undoing.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS merged_into_asset_id uuid REFERENCES assets(id);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS merged_at timestamptz;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS merged_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_assets_merged_into_asset_id ON assets(merged_into_asset_id);

-- Every asset_id FK, re-verified against the live schema at build time (Prompt 32 Stage 2
-- pre-flight): sightings, auction_history, cost_document_extractions. If a future migration
-- adds a fourth table with an asset_id FK, this function must be updated to repoint it too -
-- see SCHEMA.md's "Asset merge" section, which exists specifically so the next person adding
-- such a table finds this obligation before shipping, not after.
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

  -- Mutate the orphan's own fingerprint_hash so it can never again be produced by a fresh
  -- capture and silently resolve a new sighting back onto the dead orphan - research-capture's
  -- exact-hash lookup (`.eq('fingerprint_hash', fingerprintHash).maybeSingle()`) would otherwise
  -- find this row again before Stage 3's symmetric-attach logic ever runs, quietly reviving the
  -- exact split this merge just fixed. fingerprint_hash is a derived identity value, not a raw
  -- captured field (make/model/trim/etc, all untouched above) - mutating it does not violate
  -- PROJECT_CHARTER.md §5.8. Preserved inside the new value and in this function's return, so
  -- it is never actually lost.
  v_new_orphan_hash := 'merged:' || v_orphan.fingerprint_hash || ':' || v_orphan.id::text;

  UPDATE assets
  SET merged_into_asset_id = p_survivor_id,
      merged_at = now(),
      merged_by = p_confirmed_by,
      fingerprint_hash = v_new_orphan_hash,
      updated_at = now()
  WHERE id = p_orphan_id;

  RETURN jsonb_build_object(
    'survivor_id', p_survivor_id,
    'orphan_id', p_orphan_id,
    'sightings_moved', v_sightings_moved,
    'auction_history_moved', v_history_moved,
    'cost_document_extractions_moved', v_docs_moved,
    'orphan_original_fingerprint_hash', v_orphan.fingerprint_hash,
    'merged_at', now()
  );
END;
$$;

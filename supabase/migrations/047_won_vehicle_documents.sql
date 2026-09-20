-- Prompt 34 Stage 4 - documents anchored to the won vehicle, plus one fix found in its pre-flight.
--
-- The anchor is the WON VEHICLE, not the asset: won vehicles are client-specific, and a document
-- (an invoice with a client's name and amounts, a title, a bill of lading) belongs to one client's
-- purchase. The same physical car won for two different clients must never show one client's
-- paperwork against the other's record - so there is deliberately no asset_id on this table.
--
-- Not merged with cost_document_extractions, and not fused: that table stages documents for RATE
-- EXTRACTION behind a human review gate; this one stores documents for a CLIENT'S VEHICLE. One real
-- invoice can legitimately be both. The seam is the asset: a document already paired to an asset
-- through cost_document_extractions.asset_id (Prompt 29 Stage 6) is read through that existing
-- pairing, not through a second link here (see SCHEMA.md).
--
-- Writes happen only in the won-vehicle-documents Edge Function (service role): there is no
-- INSERT/UPDATE/DELETE policy for any client role, so a hard delete is impossible from the app and
-- the row's type/path cannot be rewritten by a staff member's browser session. Soft delete only
-- (migration 023's pair); the stored file is always retained.

-- A composite key so a document can only ever point at a won vehicle OF THE SAME ORG.
ALTER TABLE won_vehicles ADD CONSTRAINT won_vehicles_id_org_uniq UNIQUE (id, org_id);

CREATE TABLE won_vehicle_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  won_vehicle_id uuid NOT NULL,
  document_type text NOT NULL
    CHECK (document_type IN ('invoice', 'receipt', 'shipping_document', 'bill_of_lading', 'title', 'assessment_notice', 'other')),
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id),
  FOREIGN KEY (won_vehicle_id, org_id) REFERENCES won_vehicles (id, org_id),
  CONSTRAINT won_vehicle_documents_delete_pair CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);

CREATE INDEX idx_won_vehicle_documents_vehicle ON won_vehicle_documents (won_vehicle_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_won_vehicle_documents_org ON won_vehicle_documents (org_id);

ALTER TABLE won_vehicle_documents ENABLE ROW LEVEL SECURITY;

-- SCHEMA.md section 12's pattern, SELECT only.
CREATE POLICY won_vehicle_documents_select ON won_vehicle_documents
  FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());

-- Private bucket. Path convention: <org_id>/<won_vehicle_id>/<uuid>/<filename>, so the FIRST folder
-- is the org and storage policy can scope on it. Bucket-level size/type limits are defence in depth
-- behind the Edge Function's own checks.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('won-vehicle-documents', 'won-vehicle-documents', false, 10485760,
        ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "won_vehicle_documents_service_role" ON storage.objects;
CREATE POLICY "won_vehicle_documents_service_role" ON storage.objects
  FOR ALL
  USING (bucket_id = 'won-vehicle-documents' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'won-vehicle-documents' AND auth.role() = 'service_role');

-- Staff read: a member of the org named by the path's first folder, or a superadmin. No client
-- write policy exists, so nothing can be uploaded, replaced or deleted from a browser session.
DROP POLICY IF EXISTS "won_vehicle_documents_staff_select" ON storage.objects;
CREATE POLICY "won_vehicle_documents_staff_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'won-vehicle-documents'
    AND ((storage.foldername(name))[1] IN (SELECT user_org_ids()::text) OR is_superadmin())
  );

-- merge_assets(): add the won_vehicles repoint (see the comment inside).
CREATE OR REPLACE FUNCTION public.merge_assets(p_survivor_id uuid, p_orphan_id uuid, p_confirmed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_survivor assets;
  v_orphan assets;
  v_sightings_moved int;
  v_history_moved int;
  v_docs_moved int;
  v_won_moved int;
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

  -- Prompt 34 Stage 2 created won_vehicles.asset_id but never joined this list (found during
  -- Prompt 34 Stage 4 pre-flight): after a merge, a won vehicle would still point at the retired
  -- orphan. Only the pointer moves - promoted_by/promoted_at and the frozen won_snapshot are
  -- provenance and stay exactly as recorded (the snapshot is what the client saw, not what the
  -- asset row says today). won_vehicle_documents anchors to the won vehicle, not the asset, so it
  -- has no asset_id to repoint.
  UPDATE won_vehicles SET asset_id = p_survivor_id WHERE asset_id = p_orphan_id;
  GET DIAGNOSTICS v_won_moved = ROW_COUNT;

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
    'won_vehicles_moved', v_won_moved,
    'orphan_original_fingerprint_hash', v_orphan.fingerprint_hash,
    'orphan_original_vinless_identity_hash', v_orphan.vinless_identity_hash,
    'merged_at', now()
  );
END;
$function$;

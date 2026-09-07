-- PROMPT 19 Phase 2 — the client approval record.
--
-- Approval lives on research_run_listings, not research_runs: the client is choosing between
-- vehicles within a shared run, and public-run.ts already maps listings individually onto the
-- public page (never the run as a single priced/dated object). See PROMPT_19 Checkpoint 1.
--
-- approved_via distinguishes a client-made approval (self-service, unauthenticated, via the
-- share token) from a staff-recorded one (the client approved by phone/WhatsApp and a staff
-- member is relaying it). This distinction is the entire evidentiary value of the feature and
-- must never collapse into one field - the CHECK constraint below makes the two shapes the
-- only valid non-null states, rather than relying on application code to keep them apart.
--
-- approved_snapshot captures identifying details, the price shown, and the auction date shown
-- at approval time - not just a foreign key to the listing/sighting. Live lots get overwritten
-- on re-capture (SCHEMA.md S1), so a snapshot-free record could point at a sighting whose price
-- or date no longer matches what the client actually saw and approved.
ALTER TABLE public.research_run_listings
  ADD COLUMN approved_at timestamptz DEFAULT NULL,
  ADD COLUMN approved_via text DEFAULT NULL
    CHECK (approved_via IS NULL OR approved_via IN ('client', 'staff_relayed')),
  ADD COLUMN approved_by uuid REFERENCES auth.users(id) DEFAULT NULL,
  ADD COLUMN approved_snapshot jsonb DEFAULT NULL;

-- Never derive approval, never leave it in a half-recorded state: either none of these four
-- fields are set, or exactly the shape matching how it was recorded.
ALTER TABLE public.research_run_listings
  ADD CONSTRAINT research_run_listings_approval_shape CHECK (
    (approved_at IS NULL AND approved_via IS NULL AND approved_by IS NULL AND approved_snapshot IS NULL)
    OR (approved_via = 'client' AND approved_at IS NOT NULL AND approved_by IS NULL AND approved_snapshot IS NOT NULL)
    OR (approved_via = 'staff_relayed' AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND approved_snapshot IS NOT NULL)
  );

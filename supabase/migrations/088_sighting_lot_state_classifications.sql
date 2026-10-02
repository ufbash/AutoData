-- PROMPT 44 (adversarial verifier #1, Bashir's condition, charter 5.8: store what the source said, derive at read).
-- A hand-entered or screenshot comp is captured with no lot_state, so under the strict rule it sits in no average. Staff can say
-- what it is - but that is a staff judgement, NOT what the source recorded. It is therefore its own attributed, append-only
-- fact (who, when, what they chose) and NEVER written into sightings.lot_state. Readers derive the effective state:
-- the captured lot_state when it is known (active/finished), else the latest classification, else unknown.
CREATE TABLE public.sighting_lot_state_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id),
  sighting_id uuid NOT NULL REFERENCES public.sightings (id),
  lot_state public.lot_state_enum NOT NULL CHECK (lot_state IN ('active', 'finished')),
  classified_by uuid NOT NULL,
  classified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sighting_lot_state_classifications_sighting_idx ON public.sighting_lot_state_classifications (sighting_id, classified_at DESC);
ALTER TABLE public.sighting_lot_state_classifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sighting_lot_state_classifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.sighting_lot_state_classifications TO authenticated;
GRANT SELECT, INSERT ON public.sighting_lot_state_classifications TO service_role;
-- staff only; append-only (no UPDATE or DELETE policy); the classifier is always the caller
CREATE POLICY slsc_staff_select ON public.sighting_lot_state_classifications FOR SELECT
  USING (((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin());
CREATE POLICY slsc_staff_insert ON public.sighting_lot_state_classifications FOR INSERT
  WITH CHECK ((((org_id IN (SELECT user_org_ids())) AND user_is_staff(org_id)) OR is_superadmin()) AND classified_by = auth.uid());

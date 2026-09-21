-- PROMPT 37 Phase 1 - Asset Merges gets the missing half of its review pattern: a recorded NEGATIVE
-- decision. Document Extraction can confirm or reject and remembers who and when; Asset Merges could only
-- merge, so a candidate pair that is genuinely two different cars reappeared on every scan forever.
--
-- An append-only ledger (SCHEMA.md section 12's pattern, as winning bids and destinations): rows are never
-- edited or deleted, a mistaken dismissal is VOIDED with a reason, and the only writer is the
-- asset-merge-dismiss Edge Function (service role). The candidates scan skips a pair with a live dismissal.

CREATE TABLE IF NOT EXISTS public.asset_merge_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  survivor_asset_id uuid NOT NULL REFERENCES public.assets (id),
  orphan_asset_id uuid NOT NULL REFERENCES public.assets (id),
  decision text NOT NULL CHECK (decision = 'dismissed'),
  reason text,
  decided_by uuid NOT NULL REFERENCES auth.users (id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users (id),
  void_reason text,
  CHECK (survivor_asset_id <> orphan_asset_id),
  CONSTRAINT asset_merge_decisions_void_shape CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(coalesce(void_reason, '')) <> '')
  )
);
-- One live dismissal per unordered pair.
CREATE UNIQUE INDEX IF NOT EXISTS asset_merge_decisions_live_pair ON public.asset_merge_decisions
  (LEAST(survivor_asset_id, orphan_asset_id), GREATEST(survivor_asset_id, orphan_asset_id)) WHERE voided_at IS NULL;

ALTER TABLE public.asset_merge_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_merge_decisions_select ON public.asset_merge_decisions
  FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
REVOKE ALL ON public.asset_merge_decisions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.asset_merge_decisions FROM authenticated;

CREATE OR REPLACE FUNCTION public.asset_merge_decisions_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A merge decision is never deleted - void it with a reason instead';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'A voided merge decision cannot be changed';
  END IF;
  IF (NEW.id, NEW.org_id, NEW.survivor_asset_id, NEW.orphan_asset_id, NEW.decision, NEW.reason, NEW.decided_by, NEW.decided_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.survivor_asset_id, OLD.orphan_asset_id, OLD.decision, OLD.reason, OLD.decided_by, OLD.decided_at) THEN
    RAISE EXCEPTION 'A merge decision is never edited - record a new one, or void it with a reason';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER asset_merge_decisions_guard_trg BEFORE UPDATE OR DELETE ON public.asset_merge_decisions
  FOR EACH ROW EXECUTE FUNCTION public.asset_merge_decisions_guard();

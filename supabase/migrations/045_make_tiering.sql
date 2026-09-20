-- Prompt 35 Stage 3 - rank the make vocabulary by evidence; never curate it by hand.
--
-- 406 makes were seeded from NHTSA (Prompt 33). Some are defunct or not car brands, and the brief
-- form's make picker is cluttered with options nobody will pick. A hand-maintained whitelist is
-- unmaintainable and arbitrary, and `Avatr` already proved this vocabulary cannot be
-- authoritative - so nothing here removes or blocks a make. Everything stays selectable; this
-- only stores the EVIDENCE the tiering is computed from.
--
-- Stored vs derived, and why:
--   * STORED  probe evidence (which probed model years returned any car/truck/MPV model). It costs
--             external NHTSA calls to obtain, so it is fetched once and kept, like the models
--             cache. Re-runnable: vehicle-reference-make-probe skips fresh rows unless forced.
--   * STORED  the staff demote flag - a human decision, reversible, never a delete.
--   * DERIVED "traded" counts (assets + briefs) - they change with every capture, so they are
--             read live via traded_make_counts(), never cached into a column that goes stale.
--   * DERIVED the tier itself - one pure function in the frontend (tierMakes) applies the rule
--             to the stored evidence + live counts. No tier column exists to drift.

ALTER TABLE vehicle_reference_makes
  ADD COLUMN IF NOT EXISTS probed_at timestamptz,
  ADD COLUMN IF NOT EXISTS probe_years_checked integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS car_model_years integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS probe_failed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS demoted_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS demoted_reason text;

-- Live demand evidence: how often each make appears in captured assets (excluding assets merged
-- away, Prompt 32) and non-deleted briefs. SECURITY INVOKER so the caller's own RLS scopes the
-- counts to their org.
CREATE OR REPLACE FUNCTION traded_make_counts()
RETURNS TABLE (make_lower text, n bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT lower(btrim(make)) AS make_lower, count(*) AS n
  FROM (
    SELECT make FROM assets WHERE merged_into_asset_id IS NULL AND make IS NOT NULL AND btrim(make) <> ''
    UNION ALL
    SELECT make FROM client_briefs WHERE deleted_at IS NULL AND make IS NOT NULL AND btrim(make) <> ''
  ) m
  GROUP BY 1;
$$;

-- Staff demote/restore. The reference tables are shared, non-org-scoped data with no client write
-- policy (migration 041), so this is the one narrow, audited write path. Any signed-in staff
-- member may use it; it only ever sets or clears the flag - it cannot delete or edit a make.
CREATE OR REPLACE FUNCTION set_make_demoted(p_make_id uuid, p_demoted boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only signed-in staff can demote or restore a make';
  END IF;
  IF p_demoted THEN
    UPDATE vehicle_reference_makes
    SET demoted_at = now(), demoted_by = auth.uid(), demoted_reason = NULLIF(btrim(coalesce(p_reason, '')), '')
    WHERE id = p_make_id;
  ELSE
    UPDATE vehicle_reference_makes
    SET demoted_at = NULL, demoted_by = NULL, demoted_reason = NULL
    WHERE id = p_make_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Make % not found', p_make_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION set_make_demoted(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_make_demoted(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION traded_make_counts() TO authenticated;

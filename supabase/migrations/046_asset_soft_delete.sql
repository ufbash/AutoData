-- Prompt 35 follow-up - soft-delete for assets (migration 023's pattern: deleted_at/deleted_by,
-- never a hard delete). Needed because the E2E walkthrough left two fake-VIN Toyota Camry assets
-- in production; assets had no soft-delete column, only the merge sentinel (merged_into_asset_id),
-- which means "merged into another asset" and is the wrong statement for a test row.
--
-- A soft-deleted asset keeps its row, its sightings and its fingerprint (so a real capture that
-- ever matched it would not collide on the unique fingerprint_hash). Reads that offer assets or
-- their sightings to a human - the capture picker, VIN lookup, the cost-document asset search,
-- merge candidates, traded make counts - filter deleted_at IS NULL.

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_assets_deleted_at ON assets(deleted_at);

CREATE OR REPLACE FUNCTION traded_make_counts()
RETURNS TABLE (make_lower text, n bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT lower(btrim(make)) AS make_lower, count(*) AS n
  FROM (
    SELECT make FROM assets WHERE merged_into_asset_id IS NULL AND deleted_at IS NULL AND make IS NOT NULL AND btrim(make) <> ''
    UNION ALL
    SELECT make FROM client_briefs WHERE deleted_at IS NULL AND make IS NOT NULL AND btrim(make) <> ''
  ) m
  GROUP BY 1;
$$;

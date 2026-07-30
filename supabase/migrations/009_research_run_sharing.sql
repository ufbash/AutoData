-- Unguessable share token, generated automatically for every run
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS share_token text UNIQUE
  DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

-- Sharing is OFF until staff explicitly enable it
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS share_enabled boolean NOT NULL DEFAULT false;

-- Curation: which captured listings appear in the client-facing view
ALTER TABLE research_run_listings ADD COLUMN IF NOT EXISTS included boolean NOT NULL DEFAULT true;

-- Backfill tokens for any existing rows that predate the default
UPDATE research_runs 
SET share_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') 
WHERE share_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_research_runs_share_token ON research_runs(share_token);

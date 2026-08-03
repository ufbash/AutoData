ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_research_runs_deleted_at ON research_runs(deleted_at);

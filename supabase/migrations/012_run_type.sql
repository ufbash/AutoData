CREATE TYPE run_type_enum AS ENUM ('sold_comps', 'active_listings', 'mixed');
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS run_type run_type_enum NOT NULL DEFAULT 'active_listings';

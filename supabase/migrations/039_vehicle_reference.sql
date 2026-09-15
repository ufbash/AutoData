-- Prompt 33 Stage 1 - the vehicle reference database.
--
-- Every one of these is a missing vocabulary, patched case by case: a brief with make "I",
-- model "Don't", trim "Know"; Copart/bid.cars folding trim into model differently for the same
-- car; "350" vs "E350" needing a one-off class-letter patch (AGENTS.md §4.16); nine briefs with
-- no make/model at all. This builds the vocabulary itself, from NHTSA vPIC (US government, free,
-- no key, no documented rate limit) - not another case-by-case patch.
--
-- Models are year-scoped deliberately (GetModelsForMakeYear, not GetModelsForMake) - a model's
-- real-world name can differ by year, and flattening loses that. Source and fetch date are
-- recorded on both tables - this is external data with a provenance, like cost_rates.

CREATE TABLE IF NOT EXISTS vehicle_reference_makes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nhtsa_make_id integer NOT NULL UNIQUE,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'NHTSA vPIC',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle_reference_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make_id uuid NOT NULL REFERENCES vehicle_reference_makes(id) ON DELETE CASCADE,
  nhtsa_model_id integer NOT NULL,
  model_year integer NOT NULL,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'NHTSA vPIC',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (make_id, model_year, nhtsa_model_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_reference_makes_name ON vehicle_reference_makes(lower(name));
CREATE INDEX IF NOT EXISTS idx_vehicle_reference_models_make_year ON vehicle_reference_models(make_id, model_year);
CREATE INDEX IF NOT EXISTS idx_vehicle_reference_models_name ON vehicle_reference_models(lower(name));

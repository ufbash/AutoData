ALTER TABLE assets ADD COLUMN IF NOT EXISTS horsepower integer;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS estimated_cost_low_usd numeric;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS estimated_cost_high_usd numeric;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS seller_type text;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS source_auction_platform text;

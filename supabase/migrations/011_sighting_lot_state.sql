CREATE TYPE lot_state_enum AS ENUM ('active', 'finished', 'unknown');
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS lot_state lot_state_enum;
CREATE INDEX IF NOT EXISTS idx_sightings_lot_state ON sightings(lot_state);

UPDATE sightings SET lot_state = 'active'
WHERE lot_state IS NULL AND current_bid_usd IS NOT NULL;

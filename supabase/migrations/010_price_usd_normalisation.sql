ALTER TABLE sightings ADD COLUMN IF NOT EXISTS price_usd numeric;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS exchange_rate numeric;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS exchange_rate_date timestamptz;

CREATE INDEX IF NOT EXISTS idx_sightings_price_usd ON sightings(price_usd);

UPDATE sightings
SET price_usd = COALESCE(current_bid_usd, listed_price),
    exchange_rate = 1,
    exchange_rate_date = captured_at
WHERE price_usd IS NULL
  AND (listed_currency IS NULL OR listed_currency = 'USD')
  AND COALESCE(current_bid_usd, listed_price) IS NOT NULL;

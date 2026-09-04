CREATE TABLE IF NOT EXISTS auction_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  sighting_id uuid REFERENCES sightings(id) ON DELETE SET NULL,
  auction_platform text,
  auction_date date,
  lot_number text,
  bid_amount_usd numeric,
  odometer_miles integer,
  status text,
  seller_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, auction_date, lot_number, bid_amount_usd)
);
CREATE INDEX IF NOT EXISTS idx_auction_history_asset ON auction_history(asset_id);
CREATE INDEX IF NOT EXISTS idx_auction_history_date ON auction_history(auction_date);

ALTER TABLE sightings ADD COLUMN IF NOT EXISTS sale_confirmed boolean;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS auction_appearance_count integer;

ALTER TABLE auction_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY auction_history_select ON auction_history FOR SELECT
  USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY auction_history_write ON auction_history FOR ALL
  USING (org_id IN (SELECT user_org_ids()) OR is_superadmin())
  WITH CHECK (org_id IN (SELECT user_org_ids()) OR is_superadmin());

DELETE FROM auction_history;
ALTER TABLE auction_history 
  DROP CONSTRAINT IF EXISTS auction_history_sighting_id_fkey;

ALTER TABLE auction_history
  ADD CONSTRAINT auction_history_sighting_id_fkey 
  FOREIGN KEY (sighting_id) 
  REFERENCES sightings(id) 
  ON DELETE CASCADE;

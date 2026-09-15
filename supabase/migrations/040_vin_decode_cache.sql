-- Prompt 33 Stage 2 - VIN decode, cached and asynchronous.
--
-- Three constraints drive this shape:
-- 1. Never in the capture path - this table and its writer are fully decoupled from
--    research-capture/app-ingest; nothing in either capture function calls NHTSA. Decode happens
--    against already-stored data, by construction, never blocking or risking a capture.
-- 2. Cache by VIN, never decode the same VIN twice - vin is the primary key; a decode is a
--    cache-first operation.
-- 3. Abstention discipline - vPIC never HTTP-errors on a malformed/non-US VIN, it returns
--    ErrorCode/ErrorText with blank Make/Model instead (confirmed live: a garbage VIN returns
--    ErrorCode '1,7', HTTP 200). decode_status/error_code/error_text record that distinction
--    explicitly rather than storing a fabricated "successful" decode with empty fields.
--
-- Raw captured values (assets/sightings) are never touched by this table or its writer -
-- decoded_data sits alongside them, never overwriting (PROJECT_CHARTER.md §5.8).

CREATE TABLE IF NOT EXISTS vin_decodes (
  vin text PRIMARY KEY,
  decode_status text NOT NULL CHECK (decode_status IN ('success', 'failed')),
  error_code text,
  error_text text,
  decoded_data jsonb,
  source text NOT NULL DEFAULT 'NHTSA vPIC',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vin_decodes_status ON vin_decodes(decode_status);

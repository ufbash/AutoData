-- Prompt 32 Stage 3 (debt #46) - stop new splits forming, in both directions.
--
-- research-capture's existing probe (Prompt 29 Stage 1) only ever runs `!existingAsset &&
-- hasUsableVin` - a VIN-bearing capture may find and upgrade a VIN-less sibling. A VIN-less
-- capture arriving AFTER a VIN-bearing asset already exists has no equivalent path: its own
-- exact fingerprint_hash lookup can only ever match another VIN-less asset (VIN-bearing assets
-- hash on the VIN itself, a completely different value), so it falls straight through to
-- inserting a second asset - reproducing the exact split Stage 2 just cleaned up.
--
-- Closing this needs a fast, indexed way to ask "does any asset - VIN-bearing or not - already
-- carry this car's VIN-less canonical identity?" without recomputing canonicalizeForFingerprint
-- (a Deno/TS function, not reproducible in SQL without the divergent-normaliser risk this
-- project has already been burned by once) against every row on every capture.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS vinless_identity_hash text;
CREATE INDEX IF NOT EXISTS idx_assets_vinless_identity_hash ON assets(vinless_identity_hash);

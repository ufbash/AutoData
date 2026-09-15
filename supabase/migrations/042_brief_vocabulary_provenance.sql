-- Prompt 33 Stage 3 - "record when a value came from the vocabulary versus was typed."
--
-- Nullable, additive - existing briefs (the nine empty ones, the "I Don't Know" one) get NULL
-- here, meaning "predates this distinction," not "was free text." No retroactive rewrite of
-- existing rows (explicitly out of scope) - this only affects new/edited briefs going forward.

ALTER TABLE client_briefs ADD COLUMN IF NOT EXISTS make_is_vocabulary boolean;
ALTER TABLE client_briefs ADD COLUMN IF NOT EXISTS model_is_vocabulary boolean;

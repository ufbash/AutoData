-- Mirrors research_runs' own share_token/share_enabled columns exactly (same names, same
-- shape, same UNIQUE constraint) so the pattern is recognisable - reusing the existing
-- generation (crypto.getRandomValues, 24 bytes, hex) and public-run-style validation, not a
-- second scheme. Nullable: most briefs will never have one. share_enabled defaults false,
-- matching research_runs.share_enabled precisely - a staff/system operational flag, not a
-- client-answered field, so this default does not imply an answer to anything the client was
-- asked.
ALTER TABLE public.client_briefs
  ADD COLUMN share_token text DEFAULT NULL,
  ADD COLUMN share_enabled boolean DEFAULT false;

ALTER TABLE public.client_briefs
  ADD CONSTRAINT client_briefs_share_token_key UNIQUE (share_token);

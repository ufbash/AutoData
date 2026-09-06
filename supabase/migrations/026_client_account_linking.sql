-- Links a Supabase Auth account to an existing client record by email or phone, at signup
-- time, without requiring login to complete a brief (DECISIONS.md §6 stays locked: no login to
-- submit). Mirrors the existing plain-uuid-reference convention (created_by,
-- deposit_recorded_by, deleted_by).
ALTER TABLE public.clients
  ADD COLUMN user_id uuid REFERENCES auth.users(id) DEFAULT NULL;

-- One auth account maps to at most one client. Multiple NULLs remain allowed under a plain
-- UNIQUE constraint (Postgres does not treat NULL = NULL), so unlinked clients are unaffected.
ALTER TABLE public.clients
  ADD CONSTRAINT clients_user_id_key UNIQUE (user_id);

-- Nigerian numbers appear as +234..., 234..., and 0... for the same person. Canonical form:
-- digits only, leading 0 replaced with 234, a bare 10-digit local number gets 234 prepended.
-- Immutable and side-effect-free so it can be used directly in the trigger's WHERE clause.
CREATE OR REPLACE FUNCTION public.normalize_ng_phone(raw text) RETURNS text AS $$
DECLARE
  digits text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  digits := regexp_replace(raw, '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN NULL; END IF;
  IF left(digits, 1) = '0' THEN
    digits := '234' || substring(digits from 2);
  ELSIF left(digits, 3) != '234' AND length(digits) = 10 THEN
    digits := '234' || digits;
  END IF;
  RETURN digits;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Fires once, on account creation only (not on later updates - a client who later adds a phone
-- to an existing Google account does not get retroactively re-matched by this build). Runs as
-- the database owner (SECURITY DEFINER) because a freshly signed-up account has no org
-- membership yet and would be correctly blocked by RLS from writing to clients otherwise.
--
-- Matching is deliberately conservative: exactly one match links; zero matches leaves the
-- account linked to nothing (never creates a client row - nobody self-registers into the
-- client list, DECISIONS.md §6); more than one match links to none and leaves it for a human,
-- since clients.email carries no unique constraint and guessing would merge two people's
-- records. Only clients with no existing user_id are considered, so an already-linked client
-- is never silently reassigned.
CREATE OR REPLACE FUNCTION public.link_new_auth_user_to_client() RETURNS trigger AS $$
DECLARE
  matched_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO matched_ids
  FROM public.clients
  WHERE user_id IS NULL
    AND (
      (NEW.email IS NOT NULL AND email IS NOT NULL AND lower(trim(email)) = lower(trim(NEW.email)))
      OR (NEW.phone IS NOT NULL AND phone IS NOT NULL AND public.normalize_ng_phone(phone) = public.normalize_ng_phone(NEW.phone))
    );

  IF array_length(matched_ids, 1) = 1 THEN
    UPDATE public.clients SET user_id = NEW.id WHERE id = matched_ids[1];
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created_link_client ON auth.users;
CREATE TRIGGER on_auth_user_created_link_client
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.link_new_auth_user_to_client();

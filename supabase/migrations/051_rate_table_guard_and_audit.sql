-- PROMPT 37 Stage 0 / Phase 1 - close the unattributed-write gap on the three rate tables.
--
-- Prompt 36 Stage 4: a confirmed UPDATE on trucking_rates matched 0 rows because something had already
-- applied it, and nothing could say what. Investigation (PLAN_TRACKER 4.33): the write ran once as the
-- database admin role, and the three rate tables had (a) permissive RLS letting ANY org member UPDATE or
-- DELETE any row, (b) no triggers, (c) no updated_at, so no write could be attributed afterwards. The
-- append-only ledgers built in Prompt 34+ (winning bids, invoice issuances, destinations) already refuse
-- edits at the database; the rate tables did not, although PROJECT_CHARTER 5.10 says rates are never
-- edited in place - that rule lived only in application code.
--
-- What this does, for cost_rates, trucking_rates and auction_fee_brackets:
--   1. API roles (authenticated, service_role, anon) may only CLOSE a live row: set effective_to once,
--      to a date on or after effective_from. No other column may change, and no row may be deleted.
--   2. The database admin role (a direct SQL session - a migration, the CLI, the dashboard editor) is
--      still allowed, because that is the human-confirmed path - but every write is now recorded.
--   3. Every INSERT / UPDATE / DELETE on the three tables is written to rate_change_log with the session
--      user, the effective role, auth.uid(), the application name, and the old and new row.
--   4. INSERT and UPDATE policies tighten to superadmin (the restriction was application-only before);
--      DELETE policies are dropped; TRUNCATE and all anon privileges are revoked.
-- Nothing here changes any rate row. Additive for the deployed app: it only ever inserts new rows and
-- closes old ones (costRatesService.supersedeCostRate), both still permitted.

CREATE TABLE IF NOT EXISTS public.rate_change_log (
  id bigserial PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  op text NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  caller_role text NOT NULL,    -- the role the statement ran as (authenticated / service_role / postgres ...)
  session_user_name text NOT NULL,
  auth_uid uuid,                -- null for a direct SQL session
  application_name text,
  old_row jsonb,
  new_row jsonb
);
CREATE INDEX IF NOT EXISTS rate_change_log_row_idx ON public.rate_change_log (table_name, row_id);

ALTER TABLE public.rate_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rate_change_log_select ON public.rate_change_log;
CREATE POLICY rate_change_log_select ON public.rate_change_log FOR SELECT USING (is_superadmin());
REVOKE ALL ON public.rate_change_log FROM anon, authenticated, service_role;
GRANT SELECT ON public.rate_change_log TO authenticated;

-- One function: guard first, then record. SECURITY DEFINER so the log insert works for any caller;
-- the caller's identity is read from the role setting (PostgREST does SET LOCAL ROLE; a direct session
-- leaves it 'none', in which case the session user is the caller).
CREATE OR REPLACE FUNCTION public.rate_table_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller text := CASE WHEN current_setting('role', true) IN ('none', '') OR current_setting('role', true) IS NULL
                      THEN session_user ELSE current_setting('role', true) END;
  is_admin boolean := caller IN ('postgres', 'supabase_admin');
  o jsonb;
  n jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT is_admin THEN
    IF NOT (OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL AND NEW.effective_to >= OLD.effective_from
            AND (to_jsonb(NEW) - 'effective_to') = (to_jsonb(OLD) - 'effective_to')) THEN
      RAISE EXCEPTION '% rows are never edited in place (PROJECT_CHARTER 5.10): only closing a live row (setting effective_to once) is allowed; insert a new dated row instead', TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_OP = 'DELETE' AND NOT is_admin THEN
    RAISE EXCEPTION '% rows are never deleted through the API (PROJECT_CHARTER 5.10): close the row with effective_to instead', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP <> 'INSERT' THEN o := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN n := to_jsonb(NEW); END IF;
  INSERT INTO public.rate_change_log (table_name, row_id, op, caller_role, session_user_name, auth_uid, application_name, old_row, new_row)
  VALUES (TG_TABLE_NAME, COALESCE((n ->> 'id'), (o ->> 'id'))::uuid, TG_OP, caller, session_user, auth.uid(),
          current_setting('application_name', true), o, n);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rate_table_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'TRUNCATE of % is not permitted', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cost_rates', 'trucking_rates', 'auction_fee_brackets'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_guard_trg', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.rate_table_guard()', t || '_guard_trg', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_truncate_trg', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.rate_table_no_truncate()', t || '_no_truncate_trg', t);

    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM authenticated, service_role', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (is_superadmin())', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (is_superadmin()) WITH CHECK (is_superadmin())', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
  END LOOP;
END $$;

-- PROMPT 37 Phase 1 (independent-verifier finding) - an account's payment tier silently changes every fee that
-- is recomputed under it, including won-vehicle figures, and auction_accounts kept only updated_at/updated_by:
-- no history of what the tier WAS. Accounts must stay editable (a tier changes when the house says so, debt
-- #43), so there is no write guard here - only a record. Every INSERT / UPDATE / DELETE on auction_accounts is
-- written to rate_change_log beside the rate tables' own rows, with who and what changed.
CREATE OR REPLACE FUNCTION public.auction_accounts_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller text := CASE WHEN current_setting('role', true) IN ('none', '') OR current_setting('role', true) IS NULL
                      THEN session_user ELSE current_setting('role', true) END;
BEGIN
  INSERT INTO public.rate_change_log (table_name, row_id, op, caller_role, session_user_name, auth_uid, application_name, old_row, new_row)
  VALUES ('auction_accounts', COALESCE(NEW.id, OLD.id), TG_OP, caller, session_user, auth.uid(),
          current_setting('application_name', true),
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS auction_accounts_log_trg ON public.auction_accounts;
CREATE TRIGGER auction_accounts_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.auction_accounts
  FOR EACH ROW EXECUTE FUNCTION public.auction_accounts_log();

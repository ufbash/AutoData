-- PROMPT 41 Stage 0 - the cause of Mohammed's failed login, confirmed from evidence before writing anything:
-- his real auth.users row (claymerchants@gmail.com) was created 2026-08-01; the auto-link trigger
-- (on_auth_user_created_link_client) was written in migration 070, ~22 Sep 2026, as an AFTER INSERT trigger
-- on auth.users. It only ever fires on a brand-new row, so it was never evaluated against an account that
-- already existed 52 days earlier. His `clients` row (org a93378ea) has the exact matching email and a NULL
-- user_id - the trigger's own match condition would have linked him correctly had it ever run. This is a real
-- gap in the ORIGINAL flow (new signup), not a bug in it - the trigger does exactly what it says. The gap is
-- that no path existed for a client whose auth account predates their provisioning.
--
-- This function is that path: staff provisions by EMAIL, not by an auth.users id they would have no way to
-- know. If an account with that email already exists, it links immediately (closing exactly Mohammed's case).
-- If it doesn't exist yet, it keeps the client record's own email in sync with what staff entered (so a LATER
-- fresh signup with that email still gets caught by the existing, unmodified, still-working AFTER INSERT
-- trigger) and says so plainly, rather than silently doing nothing.
CREATE OR REPLACE FUNCTION public.provision_client_account_by_email(p_client_id uuid, p_email text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clients; uid uuid; mid uuid; em text := btrim(coalesce(p_email, ''));
BEGIN
  IF em = '' THEN RAISE EXCEPTION 'An email is required'; END IF;
  SELECT * INTO c FROM public.clients WHERE id = p_client_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  IF NOT (public.user_is_staff(c.org_id) OR public.is_superadmin()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF c.user_id IS NOT NULL THEN RAISE EXCEPTION 'This client is already linked to an account'; END IF;

  IF c.email IS DISTINCT FROM em THEN
    UPDATE public.clients SET email = em WHERE id = p_client_id;
  END IF;

  SELECT id INTO uid FROM auth.users WHERE lower(trim(email)) = lower(em) LIMIT 1;
  IF uid IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'no_account_yet');
  END IF;

  IF EXISTS (SELECT 1 FROM public.clients WHERE user_id = uid AND id <> p_client_id) THEN
    RAISE EXCEPTION 'That email is already linked to a different client record';
  END IF;

  UPDATE public.clients SET user_id = uid WHERE id = p_client_id;
  INSERT INTO public.memberships (user_id, org_id, role) VALUES (uid, c.org_id, 'client')
    ON CONFLICT (user_id, org_id) DO UPDATE SET revoked_at = NULL, revoked_by = NULL
    RETURNING id INTO mid;
  RETURN jsonb_build_object('linked', true, 'membershipId', mid, 'userId', uid);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_client_account_by_email(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_client_account_by_email(uuid, text, uuid) TO authenticated, service_role;

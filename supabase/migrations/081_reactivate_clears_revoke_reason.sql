-- PROMPT 42 Stage 3 - found live while resetting a Playwright test fixture: reactivating a revoked membership
-- (either provisioning function, via ON CONFLICT DO UPDATE SET revoked_at = NULL, revoked_by = NULL) left
-- revoke_reason holding the OLD reason from the revocation it just undid. Currently invisible to any screen
-- (ClientAccountStatus only ever reads revokeReason in its "revoked" branch, never the active one) - a
-- data-hygiene gap, not a live-visible bug, but a real one: a reactivated membership's row does not honestly
-- describe its own state (an active membership should carry no reason for being revoked, because it isn't).
CREATE OR REPLACE FUNCTION public.provision_client_account(p_client_id uuid, p_user_id uuid, p_actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clients; mid uuid;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = p_client_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  IF NOT (public.user_is_staff(c.org_id) OR public.is_superadmin()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF c.user_id IS NOT NULL AND c.user_id <> p_user_id THEN
    RAISE EXCEPTION 'This client record is already linked to a different account';
  END IF;
  UPDATE public.clients SET user_id = p_user_id WHERE id = p_client_id;
  INSERT INTO public.memberships (user_id, org_id, role) VALUES (p_user_id, c.org_id, 'client')
    ON CONFLICT (user_id, org_id) DO UPDATE SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL
    RETURNING id INTO mid;
  RETURN mid;
END;
$$;

CREATE OR REPLACE FUNCTION public.provision_client_account_by_email(p_client_id uuid, p_email text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clients; uid uuid; mid uuid; em text := btrim(coalesce(p_email, ''));
BEGIN
  IF em = '' THEN RAISE EXCEPTION 'An email is required'; END IF;
  SELECT * INTO c FROM public.clients WHERE id = p_client_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  IF NOT (public.user_is_staff(c.org_id) OR public.is_superadmin()) THEN RAISE EXCEPTION 'Not allowed'; END IF;

  IF c.email IS DISTINCT FROM em THEN
    UPDATE public.clients SET email = em WHERE id = p_client_id;
  END IF;

  SELECT id INTO uid FROM auth.users WHERE lower(trim(email)) = lower(em) LIMIT 1;
  IF uid IS NULL THEN
    IF c.user_id IS NOT NULL THEN RAISE EXCEPTION 'This client is linked to an account with a different email - unlink is not offered, contact support'; END IF;
    RETURN jsonb_build_object('linked', false, 'reason', 'no_account_yet');
  END IF;

  IF c.user_id IS NOT NULL AND c.user_id <> uid THEN
    RAISE EXCEPTION 'This client is already linked to a different account';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clients WHERE user_id = uid AND id <> p_client_id) THEN
    RAISE EXCEPTION 'That email is already linked to a different client record';
  END IF;

  UPDATE public.clients SET user_id = uid WHERE id = p_client_id;
  INSERT INTO public.memberships (user_id, org_id, role) VALUES (uid, c.org_id, 'client')
    ON CONFLICT (user_id, org_id) DO UPDATE SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL
    RETURNING id INTO mid;
  RETURN jsonb_build_object('linked', true, 'membershipId', mid, 'userId', uid);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_client_account_by_email(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_client_account_by_email(uuid, text, uuid) TO authenticated, service_role;

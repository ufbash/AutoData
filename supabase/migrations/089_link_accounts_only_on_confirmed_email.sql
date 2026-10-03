-- PROMPT 45 - M0 / debt #134: a client account links to a client record ONLY when the identity it matches on is CONFIRMED.
--
-- The defect: three paths attached an auth user to a client record (and gave it a client membership) by matching email, and none
-- checked that the email was confirmed. An auth user exists from the moment of signup, so someone who typed a client's address
-- into a signup form - never owning the inbox - was linked to that client's record, and the real client was then locked out
-- because the record was already taken:
--   1. on_auth_user_created_link_client      (AFTER INSERT on auth.users; migrations 026/070)
--   2. provision_client_account_by_email     (staff provisions by email; 076/077/081)
--   3. provision_client_account              (staff provisions by auth user id, called by the client-provisioning Edge Function,
--                                              which links an EXISTING user found by email - confirmed or not - or an invited one)
-- The trigger also matched on PHONE with no check that the phone was confirmed; the same rule is applied to it.
--
-- The rule: link only when email_confirmed_at (for an email match) or phone_confirmed_at (for a phone match) is set. Google
-- sign-ins arrive confirmed, so the normal client path is unaffected. An unconfirmed account is NOT linked; the client record
-- keeps the staff-entered email, and a NEW trigger links the account the moment it is confirmed.
--
-- One linking function does the work for all three paths. A client record that already has a user_id is NEVER overwritten.
-- Nothing here changes any existing link.

-- ---------------------------------------------------------------- the one linking function
-- p_client_id NULL  : automatic path - link the single unlinked record whose PROVEN identity matches; anything else is a no-op.
-- p_client_id given : staff chose this record; it must still match the user's proven identity.
-- p_reactivate      : staff-initiated paths may reactivate a revoked membership of the SAME account; automatic paths never do.
-- Returns {linked, reason, membershipId?}. It never raises for "not linked" outcomes, so a trigger can never block a signup.
CREATE OR REPLACE FUNCTION public.link_confirmed_auth_user_to_client(p_user_id uuid, p_client_id uuid DEFAULT NULL, p_reactivate boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u auth.users%ROWTYPE;
  c public.clients%ROWTYPE;
  proven_email text; proven_phone text;
  matched uuid[]; cid uuid; mid uuid;
BEGIN
  SELECT * INTO u FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('linked', false, 'reason', 'no_such_user'); END IF;

  -- only identities the account has PROVEN count
  proven_email := CASE WHEN u.email_confirmed_at IS NOT NULL AND u.email IS NOT NULL THEN lower(btrim(u.email)) END;
  proven_phone := CASE WHEN u.phone_confirmed_at IS NOT NULL AND u.phone IS NOT NULL THEN u.phone END;
  IF proven_email IS NULL AND proven_phone IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'unconfirmed');
  END IF;

  IF p_client_id IS NULL THEN
    SELECT array_agg(id) INTO matched
    FROM public.clients
    WHERE user_id IS NULL AND deleted_at IS NULL
      AND (
        (proven_email IS NOT NULL AND email IS NOT NULL AND lower(btrim(email)) = proven_email)
        OR (proven_phone IS NOT NULL AND phone IS NOT NULL AND public.normalize_ng_phone(phone) = public.normalize_ng_phone(proven_phone))
      );
    IF coalesce(array_length(matched, 1), 0) <> 1 THEN
      RETURN jsonb_build_object('linked', false, 'reason', 'no_unique_match');
    END IF;
    cid := matched[1];
  ELSE
    cid := p_client_id;
  END IF;

  SELECT * INTO c FROM public.clients WHERE id = cid AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('linked', false, 'reason', 'client_not_found'); END IF;

  -- the proven identity must be the one on the record (a staff-chosen record is not exempt)
  IF NOT (
    (proven_email IS NOT NULL AND c.email IS NOT NULL AND lower(btrim(c.email)) = proven_email)
    OR (proven_phone IS NOT NULL AND c.phone IS NOT NULL AND public.normalize_ng_phone(c.phone) = public.normalize_ng_phone(proven_phone))
  ) THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'identity_mismatch');
  END IF;

  -- NEVER re-link: an already-linked record is only ever left as it is (or, for the same account on a staff-initiated path,
  -- have its membership reactivated - that is not a change of link)
  IF c.user_id IS NOT NULL THEN
    IF c.user_id = p_user_id THEN
      IF p_reactivate THEN
        UPDATE public.memberships SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL
          WHERE user_id = p_user_id AND org_id = c.org_id RETURNING id INTO mid;
        IF mid IS NULL THEN
          INSERT INTO public.memberships (user_id, org_id, role) VALUES (p_user_id, c.org_id, 'client') RETURNING id INTO mid;
        END IF;
      ELSE
        SELECT id INTO mid FROM public.memberships WHERE user_id = p_user_id AND org_id = c.org_id;
      END IF;
      RETURN jsonb_build_object('linked', true, 'reason', 'already_linked', 'membershipId', mid, 'userId', p_user_id);
    END IF;
    RETURN jsonb_build_object('linked', false, 'reason', 'record_already_linked');
  END IF;

  IF EXISTS (SELECT 1 FROM public.clients WHERE user_id = p_user_id AND id <> cid) THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'user_linked_elsewhere');
  END IF;

  UPDATE public.clients SET user_id = p_user_id WHERE id = cid AND user_id IS NULL;
  IF p_reactivate THEN
    INSERT INTO public.memberships (user_id, org_id, role) VALUES (p_user_id, c.org_id, 'client')
      ON CONFLICT (user_id, org_id) DO UPDATE SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL
      RETURNING id INTO mid;
  ELSE
    INSERT INTO public.memberships (user_id, org_id, role) VALUES (p_user_id, c.org_id, 'client')
      ON CONFLICT (user_id, org_id) DO NOTHING;
    SELECT id INTO mid FROM public.memberships WHERE user_id = p_user_id AND org_id = c.org_id;
  END IF;
  RETURN jsonb_build_object('linked', true, 'reason', 'linked', 'membershipId', mid, 'userId', p_user_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.link_confirmed_auth_user_to_client(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- path 1: the auth.users triggers
-- Fails CLOSED and never blocks an auth write: any unexpected error means "not linked", with a warning in the log.
CREATE OR REPLACE FUNCTION public.link_new_auth_user_to_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.link_confirmed_auth_user_to_client(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'link_new_auth_user_to_client: not linked (%)', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
-- on_auth_user_created_link_client (AFTER INSERT) already points at this function: now it links only a user that arrives
-- already confirmed (the Google case) and does nothing for an unconfirmed email/password signup.

-- NEW: the same linking, run when an email or phone becomes confirmed
DROP TRIGGER IF EXISTS on_auth_user_confirmed_link_client ON auth.users;
CREATE TRIGGER on_auth_user_confirmed_link_client
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (
    (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
    OR (OLD.phone_confirmed_at IS NULL AND NEW.phone_confirmed_at IS NOT NULL)
  )
  EXECUTE FUNCTION public.link_new_auth_user_to_client();

-- ---------------------------------------------------------------- path 2: staff provisions by email
CREATE OR REPLACE FUNCTION public.provision_client_account_by_email(p_client_id uuid, p_email text, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clients; uid uuid; uconfirmed timestamptz; r jsonb; em text := btrim(coalesce(p_email, ''));
BEGIN
  IF em = '' THEN RAISE EXCEPTION 'An email is required'; END IF;
  SELECT * INTO c FROM public.clients WHERE id = p_client_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  IF NOT (public.user_is_staff(c.org_id) OR public.is_superadmin()) THEN RAISE EXCEPTION 'Not allowed'; END IF;

  -- a record that is already linked keeps its link: its email is not rewritten here either
  IF c.user_id IS NULL AND c.email IS DISTINCT FROM em THEN
    UPDATE public.clients SET email = em WHERE id = p_client_id;
  END IF;

  SELECT id, email_confirmed_at INTO uid, uconfirmed FROM auth.users WHERE lower(btrim(email)) = lower(em) LIMIT 1;
  IF uid IS NULL THEN
    IF c.user_id IS NOT NULL THEN RAISE EXCEPTION 'This client is linked to an account with a different email - unlink is not offered, contact support'; END IF;
    RETURN jsonb_build_object('linked', false, 'reason', 'no_account_yet');
  END IF;
  IF c.user_id IS NOT NULL AND c.user_id <> uid THEN
    RAISE EXCEPTION 'This client is already linked to a different account';
  END IF;
  IF uconfirmed IS NULL THEN
    -- an account exists for this address but its owner has not confirmed it: never link it. It links itself on confirmation.
    RETURN jsonb_build_object('linked', false, 'reason', 'awaiting_confirmation');
  END IF;

  r := public.link_confirmed_auth_user_to_client(uid, p_client_id, true);
  IF r->>'reason' = 'user_linked_elsewhere' THEN RAISE EXCEPTION 'That email is already linked to a different client record'; END IF;
  IF r->>'reason' = 'record_already_linked' THEN RAISE EXCEPTION 'This client is already linked to a different account'; END IF;
  IF NOT (r->>'linked')::boolean THEN RETURN jsonb_build_object('linked', false, 'reason', r->>'reason'); END IF;
  RETURN jsonb_build_object('linked', true, 'membershipId', r->'membershipId', 'userId', uid);
END;
$$;

-- ---------------------------------------------------------------- path 3: staff provisions a specific auth user (Edge Function)
-- Returns the membership id, or NULL when the account is not yet confirmed (the record then carries the account's email and the
-- confirmation trigger links it once the owner confirms - an invited user confirms by accepting the invitation).
CREATE OR REPLACE FUNCTION public.provision_client_account(p_client_id uuid, p_user_id uuid, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clients; u auth.users%ROWTYPE; r jsonb;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = p_client_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  IF NOT (public.user_is_staff(c.org_id) OR public.is_superadmin()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF c.user_id IS NOT NULL AND c.user_id <> p_user_id THEN
    RAISE EXCEPTION 'This client record is already linked to a different account';
  END IF;
  SELECT * INTO u FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;

  IF c.user_id IS NULL AND u.email IS NOT NULL AND c.email IS DISTINCT FROM u.email THEN
    UPDATE public.clients SET email = u.email WHERE id = p_client_id;   -- staff chose this account for this record
  END IF;
  IF u.email_confirmed_at IS NULL AND u.phone_confirmed_at IS NULL THEN
    RETURN NULL;   -- awaiting confirmation: no link, no membership
  END IF;

  r := public.link_confirmed_auth_user_to_client(p_user_id, p_client_id, true);
  IF r->>'reason' = 'user_linked_elsewhere' THEN RAISE EXCEPTION 'That account is already linked to a different client record'; END IF;
  IF NOT (r->>'linked')::boolean THEN RAISE EXCEPTION 'Could not link this account (%)', r->>'reason'; END IF;
  RETURN (r->>'membershipId')::uuid;
END;
$$;

-- ---------------------------------------------------------------- what the staff page shows: linked / awaiting confirmation / not provisioned
CREATE OR REPLACE FUNCTION public.client_account_state(p_client_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clients;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = p_client_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT (public.user_is_staff(c.org_id) OR public.is_superadmin()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF c.user_id IS NOT NULL THEN RETURN 'linked'; END IF;
  IF c.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.users WHERE lower(btrim(email)) = lower(btrim(c.email)) AND email_confirmed_at IS NULL
  ) THEN RETURN 'awaiting_confirmation'; END IF;
  RETURN 'not_provisioned';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.client_account_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_account_state(uuid) TO authenticated, service_role;

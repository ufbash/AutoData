-- PROMPT 39 Stage 3 - provisioning. Charter §7: the client record exists first; the account is staff-provisioned and
-- pre-populated; nobody self-registers. The pre-flight (Prompt 38 Stage B.1) found the existing Google-link trigger
-- (migration 026) connects clients.user_id but creates no membership, so a linked client had zero RLS access - a broken
-- shell, not a client view. This closes that gap for BOTH paths into the account:
--   * staff-provisioned (explicit): staff names the client record and an email; an Edge Function invites that email
--     via the Auth Admin API, then calls provision_client_account() with the new auth user's id.
--   * self-service (the existing Google button on the intake form): the trigger below now also creates the membership,
--     using the SAME match it already used to link the identity - nothing new to match on, just one more INSERT.
-- Both paths converge on exactly one client-role membership per (user, org) - enforced by the existing UNIQUE(user_id,
-- org_id) on memberships, so calling either path twice is a no-op, not a duplicate.

-- The reason column 066 didn't add: revoked_at/revoked_by exist from 066, but revocation needs a stated reason too.
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS revoke_reason text;

CREATE OR REPLACE FUNCTION public.link_new_auth_user_to_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  matched_ids uuid[];
  cid uuid; corg uuid;
BEGIN
  SELECT array_agg(id) INTO matched_ids
  FROM public.clients
  WHERE user_id IS NULL
    AND (
      (NEW.email IS NOT NULL AND email IS NOT NULL AND lower(trim(email)) = lower(trim(NEW.email)))
      OR (NEW.phone IS NOT NULL AND phone IS NOT NULL AND public.normalize_ng_phone(phone) = public.normalize_ng_phone(NEW.phone))
    );

  IF array_length(matched_ids, 1) = 1 THEN
    cid := matched_ids[1];
    UPDATE public.clients SET user_id = NEW.id WHERE id = cid;
    SELECT org_id INTO corg FROM public.clients WHERE id = cid;
    INSERT INTO public.memberships (user_id, org_id, role) VALUES (NEW.id, corg, 'client')
      ON CONFLICT (user_id, org_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------- explicit staff provisioning (by client record, not by chance email match)
-- Called by an Edge Function AFTER it has successfully invited p_email via the Auth Admin API and has the new auth
-- user's id back. Deliberately does NOT rely on the auto-match trigger above (staff is choosing a SPECIFIC client
-- record; the invite email might differ from what's currently stored on it) - sets user_id explicitly and refuses if
-- the record is already provisioned, so this can never silently re-point an already-linked client to a new identity.
CREATE OR REPLACE FUNCTION public.provision_client_account(p_client_id uuid, p_user_id uuid, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    ON CONFLICT (user_id, org_id) DO UPDATE SET revoked_at = NULL, revoked_by = NULL   -- re-provisioning after a revoke reactivates, never duplicates
    RETURNING id INTO mid;
  RETURN mid;
END;
$$;

-- Staff can disable a client's access; the client record and every billing/status row stay exactly as they are - only
-- future reads through the membership stop (user_org_ids()/current_client_id() both already filter revoked_at).
CREATE OR REPLACE FUNCTION public.revoke_client_access(p_client_id uuid, p_actor uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clients;
BEGIN
  IF btrim(coalesce(p_reason, '')) = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO c FROM public.clients WHERE id = p_client_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  IF NOT (public.user_is_staff(c.org_id) OR public.is_superadmin()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF c.user_id IS NULL THEN RAISE EXCEPTION 'This client has no account to revoke'; END IF;
  UPDATE public.memberships SET revoked_at = now(), revoked_by = p_actor, revoke_reason = p_reason
   WHERE user_id = c.user_id AND org_id = c.org_id AND role = 'client' AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'This client''s access is already revoked'; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_client_account(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_client_access(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_client_account(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_client_access(uuid, uuid, text) TO authenticated, service_role;

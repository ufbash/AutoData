-- PROMPT 39 Stage 1 - RLS rewrite, part 1: the helpers and the revocation column everything else builds on.
--
-- Why this comes first (debts #80/#81): every existing policy is `org_id IN (SELECT user_org_ids()) OR is_superadmin()`,
-- and `user_org_ids()` is role-agnostic - it returns an org for ANY membership row, staff or client. A client-role
-- membership (none exist yet) would therefore get the SAME org-wide read as any staff member on every table using that
-- pattern, including billing_document_lines, which has no client_visible check at all. Building the dashboard on top of
-- that would be building the exploit.
--
-- The fix is not "add a client policy alongside the staff one" - Postgres OR's permissive policies of the same command
-- together, so an unchanged org-wide staff policy would still fire for a client's own org regardless of how narrow a new
-- client policy is. The staff policies THEMSELVES have to stop matching a client role. "Staff access does not change"
-- (Prompt 39) is read as a RESULT guarantee (identical rows visible to staff, before and after - proved in Stage 1
-- verification #7), not as "the policy text must be untouched" - the text has to change for the result to hold once a
-- client role exists at all.

-- Revocation: staff can disable a client's (or, generically, anyone's) access; the membership row and its history stay,
-- only future reads stop. Applies uniformly so `user_org_ids()`/`is_superadmin()` need only one extra clause.
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users (id);
ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_revoke_pair CHECK ((revoked_at IS NULL) = (revoked_by IS NULL));

-- Both existing functions gain "AND revoked_at IS NULL". Every row today has revoked_at NULL, so this is a no-op until
-- the first revocation - staff behaviour is unchanged (proved live in Stage 1 verification #7).
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM memberships WHERE user_id = auth.uid() AND revoked_at IS NULL;
$$;
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid() AND role = 'superadmin' AND revoked_at IS NULL);
$$;

-- Whether the current session holds a LIVE staff or superadmin membership in a SPECIFIC org (parameterised, not global -
-- a person who is staff in one org and, hypothetically, a client in another must not get staff-shaped access to the
-- second just because they are staff somewhere).
CREATE OR REPLACE FUNCTION public.user_is_staff(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
     WHERE user_id = auth.uid() AND org_id = p_org_id AND role IN ('staff', 'superadmin') AND revoked_at IS NULL
  );
$$;

-- The client record the current session is allowed to act as, in a given org - resolved through BOTH the identity link
-- (clients.user_id, set by the Google-link trigger or by provisioning) AND a live, unrevoked client membership (so
-- revoking access, or never provisioning one, makes this return NULL and every client policy below returns no rows).
CREATE OR REPLACE FUNCTION public.current_client_id(p_org_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.clients c
   WHERE c.org_id = p_org_id AND c.user_id = auth.uid() AND c.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.memberships m
        WHERE m.user_id = auth.uid() AND m.org_id = p_org_id AND m.role = 'client' AND m.revoked_at IS NULL
     )
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.user_is_staff(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_client_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_is_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_client_id(uuid) TO authenticated, service_role;

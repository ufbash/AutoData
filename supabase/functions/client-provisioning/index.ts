import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// PROMPT 39 Stage 3 - the only writer of client accounts. Staff-only, behind auth, never reachable by a client token
// (a client calling this gets refused the same way any other staff function refuses them - see the six won-vehicle-*
// functions and billing/index.ts, all of which now exclude role='client' from their org-access check).
//
//   provision  staff names an existing client record and an email; invites that email via the Auth Admin API (a real
//              email - never called against a real client during testing, per Prompt 39's own out-of-scope list); on
//              success, calls provision_client_account() so the record and exactly one client-role membership exist.
//              If the email already has an auth user (re-invite, or the Google-link path got there first), that
//              existing user is used instead of erroring - re-provisioning is idempotent, never a second identity.
//   revoke     staff disables a client's access; the record and every billing/status row are untouched.
//
// Nothing here computes a cost or touches a document - it only ever writes to auth.users and memberships/clients.user_id.

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
class Refuse extends Error { constructor(msg: string, public status = 400) { super(msg); } }

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new Refuse("Method not allowed", 405);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: "Unauthorized: Missing token" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !key) throw new Error("Missing Supabase configuration");
    const db = createClient(supabaseUrl, key);
    const { data: { user }, error: authError } = await db.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) return json({ error: "Unauthorized: Invalid token" }, 401);

    // Staff-only, exactly like every other org-scoped function - a client token gets the same refusal here as anywhere else.
    const { data: memberships, error: memError } = await db.from('memberships').select('org_id, role').eq('user_id', user.id);
    if (memError) throw memError;
    const staff = (memberships ?? []).filter((m: { role: string }) => m.role !== 'client');
    const isSuperadmin = staff.some((m: { role: string }) => m.role === 'superadmin');
    const canAccessOrg = (orgId: string) => isSuperadmin || staff.some((m: { org_id: string }) => m.org_id === orgId);

    const payload = await req.json().catch(() => null);
    const mode = payload?.mode;

    if (mode === 'provision') {
      const clientId = payload?.clientId as string | undefined;
      const email = (payload?.email as string | undefined)?.trim().toLowerCase();
      if (!clientId) throw new Refuse('Choose a client record');
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Refuse('Enter a valid email address');

      const { data: client, error: cErr } = await db.from('clients').select('id, org_id, full_name, user_id, deleted_at').eq('id', clientId).maybeSingle();
      if (cErr) throw cErr;
      if (!client || client.deleted_at || !canAccessOrg(client.org_id)) throw new Refuse('Client not found', 404);

      // Find or invite the auth user for this email - never a second identity for one address.
      let targetUserId: string;
      const { data: existingUsers, error: listErr } = await db.auth.admin.listUsers();
      if (listErr) throw listErr;
      const already = existingUsers.users.find((u: { email?: string }) => u.email?.toLowerCase() === email);
      if (already) {
        targetUserId = already.id;
      } else {
        const { data: invited, error: inviteErr } = await db.auth.admin.inviteUserByEmail(email);
        if (inviteErr || !invited?.user) throw new Error(`Could not invite ${email}: ${inviteErr?.message ?? 'unknown error'}`);
        targetUserId = invited.user.id;
      }

      const { data: membershipId, error: provErr } = await db.rpc('provision_client_account', { p_client_id: clientId, p_user_id: targetUserId, p_actor: user.id });
      if (provErr) throw new Refuse(provErr.message, 400);
      return json({ success: true, clientId, userId: targetUserId, membershipId, invited: !already });
    }

    if (mode === 'revoke') {
      const clientId = payload?.clientId as string | undefined;
      const reason = (payload?.reason as string | undefined)?.trim();
      if (!clientId) throw new Refuse('Choose a client record');
      if (!reason) throw new Refuse('A reason is required');
      const { data: client, error: cErr } = await db.from('clients').select('id, org_id, deleted_at').eq('id', clientId).maybeSingle();
      if (cErr) throw cErr;
      if (!client || client.deleted_at || !canAccessOrg(client.org_id)) throw new Refuse('Client not found', 404);
      const { error: revErr } = await db.rpc('revoke_client_access', { p_client_id: clientId, p_actor: user.id, p_reason: reason });
      if (revErr) throw new Refuse(revErr.message, 400);
      return json({ success: true });
    }

    throw new Refuse('Unknown mode');
  } catch (e) {
    if (e instanceof Refuse) return json({ error: e.message }, e.status);
    const msg = (e as { message?: string })?.message ?? String(e);
    console.error('client-provisioning error', msg);
    return json({ error: msg }, 500);
  }
});

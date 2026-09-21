import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// PROMPT 37 Phase 1 - the missing negative half of the asset-merge review: a human says "these two are NOT the
// same car" and the pair stops reappearing. The ONLY writer of asset_merge_decisions (append-only ledger,
// migration 055; SELECT-only RLS). A mistaken dismissal is voided with a reason, never edited or deleted.
//   mode 'dismiss' { survivorId, orphanId, reason? }
//   mode 'restore' { decisionId, reason }   (voids the dismissal so the pair is offered again)
// Superadmin only, like asset-merge-confirm.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new Error("Method not allowed");
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: "Unauthorized: Missing token" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Missing Supabase configuration");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) return json({ error: "Unauthorized: Invalid token" }, 401);
    const { data: memberships, error: memError } = await supabase.from('memberships').select('role').eq('user_id', user.id);
    if (memError) throw memError;
    if (!memberships?.some((m: { role: string }) => m.role === 'superadmin')) {
      return json({ error: "Merge decisions are restricted to administrators." }, 403);
    }

    const payload = await req.json().catch(() => ({}));
    if (payload?.mode === 'restore') {
      const { decisionId, reason } = payload;
      if (typeof decisionId !== 'string' || typeof reason !== 'string' || reason.trim() === '') {
        return json({ error: "decisionId and a reason are required to restore a pair" }, 400);
      }
      const { data, error } = await supabase.from('asset_merge_decisions')
        .update({ voided_at: new Date().toISOString(), voided_by: user.id, void_reason: reason.trim() })
        .eq('id', decisionId).is('voided_at', null).select('id').maybeSingle();
      if (error) return json({ error: error.message }, 400);
      if (!data) return json({ error: "That dismissal does not exist or is already restored" }, 404);
      return json({ success: true });
    }

    const { survivorId, orphanId, reason } = payload;
    if (typeof survivorId !== 'string' || typeof orphanId !== 'string' || survivorId === orphanId) {
      return json({ error: "survivorId and orphanId (two different assets) are required" }, 400);
    }
    const { data: assets, error: assetsError } = await supabase.from('assets').select('id, org_id').in('id', [survivorId, orphanId]);
    if (assetsError) throw assetsError;
    if (!assets || assets.length !== 2 || assets[0].org_id !== assets[1].org_id) {
      return json({ error: "Both assets must exist and belong to the same organisation" }, 400);
    }
    const { data, error } = await supabase.from('asset_merge_decisions').insert({
      org_id: assets[0].org_id, survivor_asset_id: survivorId, orphan_asset_id: orphanId, decision: 'dismissed',
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null, decided_by: user.id,
    }).select('id').single();
    if (error) {
      // 23505 = this pair already has a live dismissal: idempotent, not an error.
      if ((error as { code?: string }).code === '23505') return json({ success: true, alreadyDismissed: true });
      return json({ error: error.message }, 400);
    }
    return json({ success: true, decisionId: data.id });
  } catch (error) {
    console.error("asset-merge-dismiss failed:", error);
    return json({ error: (error as Error).message }, 500);
  }
});

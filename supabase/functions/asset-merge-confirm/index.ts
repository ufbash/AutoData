import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// PROMPT 32 Stage 2 (debt #46) - the ONLY path that actually merges two assets. Nothing else in
// this codebase calls merge_assets(). Nothing merges automatically - this function exists
// specifically to require a human, authenticated, superadmin request naming both sides
// explicitly; see DECISIONS.md for why this stays true even as detection gets better.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") throw new Error("Method not allowed");

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized: Missing token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Missing Supabase configuration");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: memberships, error: memError } = await supabase
      .from('memberships').select('role').eq('user_id', user.id);
    if (memError) throw memError;
    const hasAccess = memberships?.some((m: { role: string }) => m.role === 'superadmin');
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Asset merge is restricted to administrators." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const payload = await req.json();
    const survivorId = payload?.survivorId;
    const orphanId = payload?.orphanId;
    if (typeof survivorId !== 'string' || typeof orphanId !== 'string') {
      return new Response(JSON.stringify({ error: "survivorId and orphanId are both required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data, error } = await supabase.rpc('merge_assets', {
      p_survivor_id: survivorId,
      p_orphan_id: orphanId,
      p_confirmed_by: user.id,
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ success: true, result: data }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("asset-merge-confirm failed:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

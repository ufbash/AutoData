import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { vehicleHeadingFromBrief, briefReference } from "../_shared/vehicleHeading.ts";

// Auth and CORS copied verbatim from research-capture/index.ts - same static-secret
// mechanism, same header shape. Do not diverge; a mismatched CORS header set here would
// surface as a browser CORS error, not an auth error (AGENTS.md 4.3).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-research-secret",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "GET") {
      throw new Error("Method not allowed");
    }

    // NOTE: Access control for the Chrome extension relies entirely on possession of the
    // static x-research-secret. It does not use a user JWT, so role-based checks (e.g.
    // requiring 'superadmin') cannot be enforced here. Same shape as research-capture.
    const researchSecret = req.headers.get("x-research-secret");
    if (!researchSecret || researchSecret !== Deno.env.get("RESEARCH_CAPTURE_SECRET")) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid Secret" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const defaultOrgId = Deno.env.get("DEFAULT_ORG_ID");
    if (!supabaseUrl || !supabaseServiceKey || !defaultOrgId) {
      throw new Error("Missing Supabase configuration or DEFAULT_ORG_ID");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Org-scoped by DEFAULT_ORG_ID, identical mechanism to research-capture - a
    // static-secret endpoint that lists data is a wider door than one that only writes,
    // so it must not return runs beyond the org the secret implies.
    const { data, error } = await supabase
      .from('research_runs')
      .select('id, client_name, run_type, created_at, client:clients(full_name), client_brief:client_briefs(year_min, year_max, make, model)')
      .eq('org_id', defaultOrgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    // Flatten: `name` is the run's own display label (stored, confusingly, in the
    // client_name column); `client_name` here is the actual linked client's name, from
    // the clients relation - two different things, both useful for picking a run.
    // PROMPT 35 - `vehicle_heading` and `brief_reference` are finished strings from the shared
    // vehicleHeading module (the website's own definition), so the extension never rebuilds them.
    // Both are null for a run with no brief; vehicle_heading is also null for a brief with no
    // year/make/model - the extension falls back to `name` in that case, as the website does.
    const runs = (data || []).map((row: any) => ({
      id: row.id,
      name: row.client_name,
      run_type: row.run_type,
      client_name: row.client?.full_name ?? null,
      vehicle_heading: vehicleHeadingFromBrief(row.client_brief),
      brief_reference: row.client_brief ? briefReference(row.client_brief) : null,
      created_at: row.created_at,
    }));

    return new Response(JSON.stringify({ runs }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("list-active-runs error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

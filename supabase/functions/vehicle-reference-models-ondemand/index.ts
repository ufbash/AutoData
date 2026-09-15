import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// PROMPT 34 Stage 0A - fixes Prompt 33's wrong population. vehicle_reference_models was seeded
// only for (make, year) pairs already present in `assets` - the right population for VERIFYING
// coverage, the wrong one for the brief form, which describes a car the client WANTS, not one
// already captured. A 2020 Lexus RX brief with no 2020 Lexus asset got an empty dropdown and fell
// to free text for a vehicle vPIC covers completely.
//
// Cache-on-miss, same shape as vin_decodes (already proven, Prompt 33 Stage 2): any authenticated
// staff member can trigger this (brief entry is NOT superadmin-gated, unlike the bulk admin
// seeder `vehicle-reference-seed`), a cache hit never touches NHTSA, and a fetch failure falls
// through to free text rather than blocking the form - a client waiting on a brief is not the
// place to surface an NHTSA outage.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";
const VEHICLE_TYPES = ["car", "truck", "multipurpose passenger vehicle (mpv)"];

interface NhtsaModelResult {
  Model_ID: number;
  Model_Name: string;
}

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
    // Any authenticated user - brief entry is open to any staff member, not just superadmin.
    // vehicle_reference_models is shared, non-org-scoped reference data (SCHEMA.md §17-adjacent
    // note in migration 041) - no org/role check beyond "is a real logged-in user" is meaningful
    // here.
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const payload = await req.json();
    const make: string = payload?.make;
    const year: number = payload?.year;
    if (!make || !year) {
      return new Response(JSON.stringify({ error: "make and year are both required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: refMake, error: refMakeError } = await supabase
      .from('vehicle_reference_makes')
      .select('id')
      .ilike('name', make)
      .maybeSingle();
    if (refMakeError) throw refMakeError;
    if (!refMake) {
      // Make itself isn't in the reference vocabulary at all (an Avatr-class gap) - nothing to
      // seed; the frontend falls to free text.
      return new Response(JSON.stringify({ seeded: false, reason: 'make_not_in_vocabulary', models: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Cache-on-miss: do NOT re-fetch a pair already cached (same discipline as vin_decodes).
    const { data: existing, error: existingError } = await supabase
      .from('vehicle_reference_models')
      .select('id, name, fetched_at')
      .eq('make_id', refMake.id)
      .eq('model_year', year);
    if (existingError) throw existingError;
    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({
        seeded: false,
        cache_hit: true,
        fetched_at: existing[0].fetched_at,
        models: existing.map((m: { id: string; name: string }) => ({ id: m.id, name: m.name })),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Vehicle-type-filtered, merged across types, deduped by Model_ID - the exact Prompt 33
    // Stage 1 fix (raw GetModelsForMakeYear leaks motorcycles/ATVs, badly for Honda/BMW).
    const dedup = new Map<number, string>();
    let fetchFailed = false;
    let fetchError: string | null = null;
    for (const vt of VEHICLE_TYPES) {
      try {
        const res = await fetch(`${VPIC_BASE}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}/vehicletype/${encodeURIComponent(vt)}?format=json`);
        if (!res.ok) { fetchFailed = true; fetchError = `HTTP ${res.status}`; continue; }
        const data = await res.json();
        for (const r of (data.Results ?? []) as NhtsaModelResult[]) {
          dedup.set(r.Model_ID, r.Model_Name);
        }
      } catch (e) {
        fetchFailed = true;
        fetchError = (e as Error).message;
      }
    }

    if (dedup.size === 0) {
      // Either a real NHTSA gap (the 1974 VW case - vPIC has nothing for this make/year) or a
      // transient fetch failure. Either way: fall through to free text, record which. A client
      // waiting on the form must never be blocked by this.
      return new Response(JSON.stringify({
        seeded: false,
        reason: fetchFailed ? 'fetch_failed' : 'no_models_for_year',
        error: fetchError,
        models: [],
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rows = Array.from(dedup.entries()).map(([nhtsa_model_id, name]) => ({
      make_id: refMake.id,
      nhtsa_model_id,
      model_year: year,
      name,
      source: 'NHTSA vPIC',
      fetched_at: new Date().toISOString(),
    }));

    const { data: inserted, error: insertError } = await supabase
      .from('vehicle_reference_models')
      .upsert(rows, { onConflict: 'make_id,model_year,nhtsa_model_id' })
      .select('id, name');
    if (insertError) throw insertError;

    return new Response(JSON.stringify({
      seeded: true,
      cache_hit: false,
      models: (inserted || []).map((m: { id: string; name: string }) => ({ id: m.id, name: m.name })),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("vehicle-reference-models-ondemand failed:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

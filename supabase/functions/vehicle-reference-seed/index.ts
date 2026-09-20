import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { VPIC_BASE, VEHICLE_TYPES, fetchModelsForMakeYear } from "../_shared/nhtsa.ts";

// PROMPT 33 Stage 1 - the vehicle reference database's seeder. Deliberately its own callable
// operation (re-runnable, admin-triggered), not a migration side effect - a migration runs once
// and is never re-run; this needs to be re-run as NHTSA's own data changes or as new
// make/year pairs enter production.
//
// Idempotent by construction: every upsert is keyed on NHTSA's own stable id
// (nhtsa_make_id / (make_id, model_year, nhtsa_model_id)) with ON CONFLICT DO UPDATE, so running
// this again updates fetched_at and any renamed values rather than duplicating rows.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// PROMPT 33 Stage 1 pre-flight - GetAllMakes returns 12,363 rows, dominated by custom/trailer/
// equipment manufacturers with no passenger relevance (e.g. "#1 ALPINE CUSTOMS", "102 IRONWORKS,
// INC."). Filtered to the union of NHTSA's own "Passenger Car" / "Truck" / "Multipurpose
// Passenger Vehicle (MPV)" vehicle-type categories (195 + 207 + 111 makes respectively, with
// overlap) - reversible (just re-run against GetAllMakes with a different/no filter) and stated
// here rather than silently applied. A missing make is a worse failure than an extra one, so this
// errs toward the wider of NHTSA's own categories rather than a hand-picked list.
interface NhtsaMakeResult {
  MakeId: number;
  MakeName: string;
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
      return new Response(JSON.stringify({ error: "Vehicle reference seeding is restricted to administrators." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const payload = await req.json();
    const mode = payload?.mode;

    if (mode === 'makes') {
      const seenMakeIds = new Map<number, string>();
      for (const vt of VEHICLE_TYPES) {
        const res = await fetch(`${VPIC_BASE}/GetMakesForVehicleType/${encodeURIComponent(vt)}?format=json`);
        if (!res.ok) throw new Error(`NHTSA GetMakesForVehicleType(${vt}) failed: HTTP ${res.status}`);
        const data = await res.json();
        for (const r of (data.Results ?? []) as NhtsaMakeResult[]) {
          seenMakeIds.set(r.MakeId, r.MakeName);
        }
      }

      const rows = Array.from(seenMakeIds.entries()).map(([nhtsa_make_id, name]) => ({
        nhtsa_make_id, name, source: 'NHTSA vPIC', fetched_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabase
        .from('vehicle_reference_makes')
        .upsert(rows, { onConflict: 'nhtsa_make_id' });
      if (upsertError) throw upsertError;

      return new Response(JSON.stringify({
        mode: 'makes',
        vehicle_types_queried: VEHICLE_TYPES,
        distinct_makes_seeded: rows.length,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (mode === 'models') {
      const pairs: { make: string; year: number }[] = payload?.pairs ?? [];
      if (!Array.isArray(pairs) || pairs.length === 0) {
        return new Response(JSON.stringify({ error: "pairs (array of {make, year}) is required for mode 'models'" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const unmatchedMakes: string[] = [];
      let totalModelsSeeded = 0;
      const perPairCounts: Record<string, number> = {};

      for (const { make, year } of pairs) {
        const { data: refMake, error: refMakeError } = await supabase
          .from('vehicle_reference_makes')
          .select('id')
          .ilike('name', make)
          .maybeSingle();
        if (refMakeError) throw refMakeError;
        if (!refMake) {
          unmatchedMakes.push(make);
          continue;
        }

        // vehicletype-scoped, one call per vehicle type, merged and deduped by Model_ID.
        // GetModelsForMakeYear with NO vehicletype segment returns every model regardless of
        // type - for a manufacturer that also builds motorcycles/ATVs (Honda: CRF, FourTrax,
        // Gold Wing, Rebel, ~50+ non-car entries; BMW: R1200GS, K1600GT, etc.), that pollutes
        // the vocabulary with vehicles a car-import brief dropdown must never offer. Scoping to
        // the same VEHICLE_TYPES used for the makes filter keeps both layers consistent.
        //
        // Separately: NHTSA returns one row per body-style variant sharing the same Model_ID
        // (confirmed live: Mercedes-Benz Sprinter appeared 4 times for one 2019 query) - not a
        // one-off quirk, so deduping by Model_ID belongs in the seeder permanently, not as a
        // one-time cleanup step.
        // PROMPT 35 - the vehicle-type-scoped, Model_ID-deduped fetch now lives in
        // _shared/nhtsa.ts (one definition shared with the on-demand and probe functions). The
        // seeder keeps its fail-loud behaviour: any failed vehicle-type call aborts the run.
        const fetched = await fetchModelsForMakeYear(make, year);
        if (fetched.failed) throw new Error(`NHTSA GetModelsForMakeYear(${make}, ${year}) failed: ${fetched.error}`);
        const dedup = fetched.models;

        const rows = Array.from(dedup.entries()).map(([nhtsa_model_id, name]) => ({
          make_id: refMake.id,
          nhtsa_model_id,
          model_year: year,
          name,
          source: 'NHTSA vPIC',
          fetched_at: new Date().toISOString(),
        }));

        if (rows.length > 0) {
          const { error: upsertError } = await supabase
            .from('vehicle_reference_models')
            .upsert(rows, { onConflict: 'make_id,model_year,nhtsa_model_id' });
          if (upsertError) throw upsertError;
        }

        perPairCounts[`${make} ${year}`] = rows.length;
        totalModelsSeeded += rows.length;
      }

      return new Response(JSON.stringify({
        mode: 'models',
        pairs_requested: pairs.length,
        unmatched_makes: unmatchedMakes,
        total_models_seeded: totalModelsSeeded,
        per_pair_counts: perPairCounts,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "mode must be 'makes' or 'models'" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("vehicle-reference-seed failed:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

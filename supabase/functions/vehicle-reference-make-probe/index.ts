import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { fetchModelsForMakeYear } from "../_shared/nhtsa.ts";

// PROMPT 35 Stage 3 - gathers the EVIDENCE the make tiering is computed from. For each seeded
// make it asks NHTSA (vehicle-type-scoped, the same fetch as the model seed) whether the make has
// any car/truck/MPV model in a few probe years, and stores which years answered. A make with no
// model in any probe year is either defunct or not a car brand - AC Propulsion and any surviving
// motorcycle maker fall out by the same evidence, computed rather than curated.
//
// Nothing here deletes or hides a make. It only writes probe_* columns; the tier itself is derived
// on read (src/services/vehicleReferenceService.ts tierMakes). Re-runnable and safe: by default it
// only probes makes never probed or whose last probe hit a fetch failure. To refresh everything,
// pass `reprobe_before` (an ISO timestamp, fixed for the whole refresh): makes probed earlier than
// that are re-probed too, and because each probe moves probed_at past it, the loop advances and
// `remaining` stays exact. Batched and resumable - the caller loops until `remaining` is 0.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CONCURRENCY = 6;

// Recent years first: a hit there settles "current" and ends the probe for that make. Older years
// are only tried when the recent ones are empty, to tell "older only" from "no models at all".
const probeYears = (thisYear: number) => ({
  recent: [thisYear, thisYear - 2],
  older: [thisYear - 6, thisYear - 11, thisYear - 16],
});

async function probeMake(nhtsaMakeId: number, thisYear: number) {
  const { recent, older } = probeYears(thisYear);
  const checked: number[] = [];
  const hits: number[] = [];
  let anyFailed = false;
  for (const year of [...recent, ...older]) {
    const r = await fetchModelsForMakeYear(nhtsaMakeId, year, true);
    checked.push(year);
    if (r.models.size > 0) { hits.push(year); break; }
    if (r.failed) anyFailed = true;
  }
  // A failure only makes the probe inconclusive when nothing was found; a hit is a hit.
  return { checked, hits, failed: hits.length === 0 && anyFailed };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
    if (!memberships?.some((m: { role: string }) => m.role === 'superadmin')) {
      return new Response(JSON.stringify({ error: "Make probing is restricted to administrators." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const payload = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(parseInt(payload?.batch_size ?? 30, 10) || 30, 1), 60);
    const reprobeBefore: string | null = typeof payload?.reprobe_before === 'string' ? payload.reprobe_before : null;
    if (reprobeBefore && Number.isNaN(Date.parse(reprobeBefore))) {
      return new Response(JSON.stringify({ error: "reprobe_before must be an ISO timestamp" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const pendingFilter = reprobeBefore
      ? `probed_at.is.null,probe_failed.eq.true,probed_at.lt.${reprobeBefore}`
      : 'probed_at.is.null,probe_failed.eq.true';
    const thisYear = new Date().getUTCFullYear();

    const { data: makes, error: makesError } = await supabase
      .from('vehicle_reference_makes').select('id, name, nhtsa_make_id').or(pendingFilter)
      // Never-probed first, then retries: otherwise a make that keeps failing is re-picked every
      // batch and starves the rest of the list.
      .order('probed_at', { ascending: true, nullsFirst: true }).order('name').limit(batchSize);
    if (makesError) throw makesError;

    const results: { name: string; car_model_years: number[]; failed: boolean }[] = [];
    const list = makes ?? [];
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const chunk = list.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (m: { id: string; name: string; nhtsa_make_id: number }) => {
        const p = await probeMake(m.nhtsa_make_id, thisYear);
        const { error: updateError } = await supabase
          .from('vehicle_reference_makes')
          .update({
            probed_at: new Date().toISOString(),
            probe_years_checked: p.checked,
            car_model_years: p.hits,
            probe_failed: p.failed,
          })
          .eq('id', m.id);
        if (updateError) throw updateError;
        results.push({ name: m.name, car_model_years: p.hits, failed: p.failed });
      }));
    }

    const { count: remaining, error: remError } = await supabase
      .from('vehicle_reference_makes')
      .select('id', { count: 'exact', head: true })
      .or(pendingFilter);
    if (remError) throw remError;

    return new Response(JSON.stringify({
      processed: results.length,
      remaining: remaining ?? 0,
      probe_year_basis: probeYears(thisYear),
      results,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("vehicle-reference-make-probe failed:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

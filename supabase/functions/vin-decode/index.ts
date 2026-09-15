import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// PROMPT 33 Stage 2 - VIN decode, cached and asynchronous. Deliberately NOT called from
// research-capture or app-ingest - this function only ever runs against already-stored VINs, so
// a slow or down NHTSA can never make a capture fail. Admin-triggered for now (batch backfill and
// any future incremental catch-up both go through the same `mode: 'batch'` path); a cron trigger
// can be added later without changing this function's shape.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";

async function decodeOneVin(vin: string): Promise<{
  decode_status: 'success' | 'failed';
  error_code: string | null;
  error_text: string | null;
  decoded_data: Record<string, unknown> | null;
}> {
  const res = await fetch(`${VPIC_BASE}/DecodeVinValues/${encodeURIComponent(vin)}?format=json`);
  if (!res.ok) {
    return { decode_status: 'failed', error_code: `HTTP_${res.status}`, error_text: `NHTSA request failed with HTTP ${res.status}`, decoded_data: null };
  }
  const data = await res.json();
  const result = data?.Results?.[0];
  if (!result) {
    return { decode_status: 'failed', error_code: 'NO_RESULT', error_text: 'NHTSA returned no Results entry', decoded_data: null };
  }

  // vPIC never HTTP-errors on a bad VIN - it returns ErrorCode/ErrorText instead (confirmed
  // live: a garbage VIN returns HTTP 200, ErrorCode '1,7', blank Make/Model). '0' is the only
  // clean code; anything else is recorded as a failure, not a fabricated partial success.
  const errorCode = String(result.ErrorCode ?? '');
  if (errorCode !== '0') {
    return {
      decode_status: 'failed',
      error_code: errorCode || 'UNKNOWN',
      error_text: result.ErrorText ?? null,
      decoded_data: null,
    };
  }

  return { decode_status: 'success', error_code: '0', error_text: result.ErrorText ?? null, decoded_data: result };
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
      return new Response(JSON.stringify({ error: "VIN decode is restricted to administrators." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const payload = await req.json();
    const vins: string[] = Array.isArray(payload?.vins) ? payload.vins : [];
    const force = payload?.force === true;
    if (vins.length === 0) {
      return new Response(JSON.stringify({ error: "vins (array of VIN strings) is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const uniqueVins = Array.from(new Set(vins.map((v) => v.trim().toUpperCase())));

    let cacheHits = 0;
    let newlyDecoded = 0;
    let failed = 0;
    const details: Record<string, string> = {};

    for (const vin of uniqueVins) {
      if (!force) {
        const { data: cached, error: cacheError } = await supabase
          .from('vin_decodes')
          .select('vin, decode_status')
          .eq('vin', vin)
          .maybeSingle();
        if (cacheError) throw cacheError;
        if (cached) {
          cacheHits++;
          details[vin] = `cached:${cached.decode_status}`;
          continue;
        }
      }

      const result = await decodeOneVin(vin);
      const { error: upsertError } = await supabase
        .from('vin_decodes')
        .upsert({
          vin,
          decode_status: result.decode_status,
          error_code: result.error_code,
          error_text: result.error_text,
          decoded_data: result.decoded_data,
          source: 'NHTSA vPIC',
          fetched_at: new Date().toISOString(),
        }, { onConflict: 'vin' });
      if (upsertError) throw upsertError;

      if (result.decode_status === 'success') {
        newlyDecoded++;
        details[vin] = 'decoded';
      } else {
        failed++;
        details[vin] = `failed:${result.error_code}`;
      }
    }

    return new Response(JSON.stringify({
      vins_requested: uniqueVins.length,
      cache_hits: cacheHits,
      newly_decoded: newlyDecoded,
      failed,
      details,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("vin-decode failed:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

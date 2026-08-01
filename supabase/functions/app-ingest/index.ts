import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AppIngestPayload {
  entry_method: 'manual_entry' | 'ai_vision';
  record_type: 'INVENTORY' | 'MARKET_DATA';
  org_id?: string;
  vehicles: Array<{
    vin?: string;
    make: string;
    model: string;
    trim?: string;
    year?: number;
    exterior_color?: string;
    mileage_miles?: number;
    dealer?: string;
    sale_price?: number | null;
    sale_date?: string;
    listed_price?: number | null;
    date_listed?: string;
    listed_currency?: string;
  }>;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      throw new Error("Method not allowed");
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized: missing token" }), { 
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error("Missing Supabase configuration");
    }

    // Client 1: ANON key + the caller's JWT — used ONLY to verify identity
    const supabaseAuth = createClient(
      supabaseUrl,
      supabaseAnonKey,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );
    
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(jwt);
    
    if (userErr || !userData?.user) {
      console.error("getUser failed:", userErr?.message);
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid token" }), { 
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
    const user = userData.user;

    const payloadText = await req.text();
    let payload: AppIngestPayload;
    try {
      payload = JSON.parse(payloadText);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON format" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Client 2: SERVICE ROLE — used for the membership lookup and all DB writes
    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey
    );

    // Derive org_id
    const { data: memberships, error: memError } = await supabase
      .from('memberships')
      .select('org_id, role')
      .eq('user_id', user.id);

    if (memError) throw memError;

    const memCount = memberships ? memberships.length : 0;
    console.log(`Resolved user_id: ${user.id}, membership count: ${memCount}`);

    let targetOrgId = payload.org_id;
    if (!targetOrgId) {
      if (memCount === 0) {
        return new Response(JSON.stringify({ error: "No organization membership found for this account." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else if (memCount === 1) {
        targetOrgId = memberships[0].org_id;
      } else {
        return new Response(JSON.stringify({ error: "Multiple org memberships; org_id required." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else {
      const isMember = memberships?.some(m => m.org_id === targetOrgId);
      if (!isMember) {
        return new Response(JSON.stringify({ error: "Unauthorized: Not a member of the requested org" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const membership = memberships?.find(m => m.org_id === targetOrgId);
    if (!membership || membership.role !== 'superadmin') {
      return new Response(JSON.stringify({ error: "Vehicle logging is restricted to administrators." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let rates: Record<string, number> | null = null;
    let rateFetchError = false;
    try {
      const r = await fetch("https://open.er-api.com/v6/latest/USD");
      const j = await r.json();
      if (j && j.rates && typeof j.rates === "object") rates = j.rates;
      else rateFetchError = true;
    } catch (_e) {
      rateFetchError = true;
    }

    const results = [];
    const errors = [];

    for (const v of payload.vehicles || []) {
      try {
        const { data: fingerprintHash, error: rpcError } = await supabase.rpc("generate_fingerprint", {
          p_vin: v.vin ?? null,
          p_make: v.make ?? null,
          p_model: v.model ?? null,
          p_year: v.year ?? null,
          p_trim: v.trim ?? null,
          p_exterior_color: v.exterior_color ?? null,
          p_interior_color: null,
          p_origin_status: null
        });

        if (rpcError) throw new Error(`generate_fingerprint failed: ${rpcError.message}`);

        let assetId;
        let wasDuplicate = false;
        
        const { data: existingAsset, error: findError } = await supabase
          .from('assets')
          .select('id, exterior_color')
          .eq('fingerprint_hash', fingerprintHash)
          .maybeSingle();

        if (findError) throw findError;

        if (existingAsset) {
          assetId = existingAsset.id;
          wasDuplicate = true;
          const updates: any = {};
          if (existingAsset.exterior_color === null && v.exterior_color) updates.exterior_color = v.exterior_color;
          if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            await supabase.from('assets').update(updates).eq('id', assetId);
          }
        } else {
          const { data: newAsset, error: insertError } = await supabase
            .from('assets')
            .insert({
              org_id: targetOrgId,
              fingerprint_hash: fingerprintHash,
              vin: v.vin ?? null,
              make: v.make,
              model: v.model,
              trim: v.trim ?? null,
              year: v.year ?? null,
              exterior_color: v.exterior_color ?? null,
              origin_status: 'Unknown',
              status: 'ACTIVE'
            })
            .select('id')
            .single();
          
          if (insertError) throw insertError;
          assetId = newAsset.id;
        }

        const cur = (v.listed_currency || "USD").toUpperCase();
        const rawPrice = v.listed_price ?? null;

        let price_usd: number | null = null;
        let exchange_rate: number | null = null;
        let exchange_rate_date: string | null = null;
        let conversionFailed = false;

        // @ts-ignore
        if (v.current_bid_usd != null) {
          // @ts-ignore
          price_usd = v.current_bid_usd;
          exchange_rate = 1;
          exchange_rate_date = new Date().toISOString();
        } else if (rawPrice != null && (cur === "USD")) {
          price_usd = rawPrice;
          exchange_rate = 1;
          exchange_rate_date = new Date().toISOString();
        } else if (rawPrice != null) {
          const rate = rates ? rates[cur] : undefined;
          if (typeof rate === "number" && rate > 0) {
            price_usd = Math.round((rawPrice / rate) * 100) / 100;
            exchange_rate = rate;
            exchange_rate_date = new Date().toISOString();
          } else {
            conversionFailed = true;
          }
        }

        console.log(`Conversion: cur=${cur}, rawPrice=${rawPrice}, rate=${exchange_rate}, price_usd=${price_usd}`);
        
        const rawPayloadToSave: any = { ...v, record_type: payload.record_type, date_listed: v.date_listed };
        if (conversionFailed) {
          rawPayloadToSave.price_usd_conversion_failed = true;
          rawPayloadToSave.attempted_currency = cur;
          rawPayloadToSave.rate_fetch_error = rateFetchError;
        }

        const { data: newSighting, error: sightingError } = await supabase
          .from('sightings')
          .insert({
            org_id: targetOrgId,
            asset_id: assetId,
            source_platform: 'manual',
            source_type: 'manual_entry',
            logged_via: payload.entry_method,
            created_by: user.id,
            dealer_source: v.dealer ?? null,
            listed_price: rawPrice,
            listed_currency: cur,
            price_usd: price_usd,
            exchange_rate: exchange_rate,
            exchange_rate_date: exchange_rate_date,
            sale_date: v.sale_date ?? null,
            mileage_miles: v.mileage_miles ?? null,
            raw_payload: rawPayloadToSave
          })
          .select('id')
          .single();

        if (sightingError) throw sightingError;

        results.push({
          asset_id: assetId,
          sighting_id: newSighting.id,
          fingerprint: fingerprintHash,
          was_duplicate: wasDuplicate
        });
      } catch (err: any) {
        errors.push({ vehicle: v, error: err.message });
      }
    }

    return new Response(JSON.stringify({ success: true, results, errors }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("app-ingest error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});

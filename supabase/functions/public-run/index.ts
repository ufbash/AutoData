import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // 1. CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 2. Read token
    const url = new URL(req.url);
    let token = url.searchParams.get('token');
    
    if (!token && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      token = body.token;
    }

    // 3. Validate token format (32-128 hex/alphanumeric)
    if (!token || typeof token !== 'string' || !/^[A-Za-z0-9]{32,128}$/.test(token)) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Initialize Service Role Client (Bypasses RLS)
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // 4. Look up the run
    const { data: run, error: runError } = await supabaseClient
      .from('research_runs')
      .select('id, client_name, notes, created_at')
      .eq('share_token', token)
      .eq('share_enabled', true)
      .single();

    if (runError || !run) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 5. Fetch listings
    const { data: listingsData, error: listingsError } = await supabaseClient
      .from('research_run_listings')
      .select(`
        notes,
        position,
        sighting:sightings (
          mileage_miles,
          odometer_brand,
          damage_type,
          secondary_damage,
          title_type,
          location,
          has_key,
          runs_and_drives,
          engine_starts,
          transmission_engages,
          highlights,
          current_bid_usd,
          listed_price,
          listed_currency,
          estimated_retail_value_usd,
          image_urls,
          source_platform,
          asset:assets (
            year,
            make,
            model,
            trim,
            body_style,
            engine_type,
            cylinders,
            horsepower,
            transmission,
            drivetrain,
            fuel,
            exterior_color,
            vin
          )
        )
      `)
      .eq('run_id', run.id)
      .eq('included', true)
      .order('position', { ascending: true, nullsFirst: false });

    if (listingsError) {
      throw listingsError;
    }

    // 6. Explicitly map allow-list of fields
    const publicRun = {
      client_name: run.client_name,
      notes: run.notes,
      created_at: run.created_at,
    };

    const publicListings = (listingsData || []).map((row: any) => {
      const sighting = row.sighting || {};
      const asset = sighting.asset || {};
      
      return {
        // Curation
        notes: row.notes,
        
        // Asset
        year: asset.year,
        make: asset.make,
        model: asset.model,
        trim: asset.trim,
        body_style: asset.body_style,
        engine_type: asset.engine_type,
        cylinders: asset.cylinders,
        horsepower: asset.horsepower,
        transmission: asset.transmission,
        drivetrain: asset.drivetrain,
        fuel: asset.fuel,
        exterior_color: asset.exterior_color,
        vin: asset.vin,
        
        // Sighting
        mileage_miles: sighting.mileage_miles,
        odometer_brand: sighting.odometer_brand,
        damage_type: sighting.damage_type,
        secondary_damage: sighting.secondary_damage,
        title_type: sighting.title_type,
        location: sighting.location,
        has_key: sighting.has_key,
        runs_and_drives: sighting.runs_and_drives,
        engine_starts: sighting.engine_starts,
        transmission_engages: sighting.transmission_engages,
        highlights: sighting.highlights,
        current_bid_usd: sighting.current_bid_usd,
        listed_price: sighting.listed_price,
        listed_currency: sighting.listed_currency,
        estimated_retail_value_usd: sighting.estimated_retail_value_usd,
        image_urls: sighting.image_urls,
        source_platform: sighting.source_platform
      };
    });

    const responseBody = {
      run: publicRun,
      listings: publicListings
    };

    // 7. Cache-Control header
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60"
      }
    });

  } catch (error: any) {
    console.error("Public run error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

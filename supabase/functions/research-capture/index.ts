import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-research-secret",
};

interface ResearchCapturePayload {
  source_platform: 'copart' | 'iaai' | 'bidcars' | 'bidfax';
  source_url: string;
  research_run_id?: string;
  captured_fields: {
    vin?: string | null;
    year?: number | null;
    make: string | null;
    model: string | null;
    trim?: string | null;
    mileage_miles?: number | null;
    title_type?: string | null;
    damage_type?: string | null;
    location?: string | null;
    lot_number?: string | null;
    exterior_color?: string | null;
    interior_color?: string | null;
    
    body_style?: string | null;
    cylinders?: number | null;
    engine_type?: string | null;
    transmission?: string | null;
    fuel?: string | null;
    drivetrain?: string | null;
    
    estimated_retail_value_usd?: number | null;
    current_bid_usd?: number | null;
    seller?: string | null;
    sale_date?: string | null;
    has_key?: string | null;
    runs_and_drives?: boolean | null;
    engine_starts?: boolean | null;
    transmission_engages?: boolean | null;
    highlights?: string | null;
    secondary_damage?: string | null;
    odometer_brand?: string | null;
    horsepower?: number | null;
    estimated_cost_low_usd?: number | null;
    estimated_cost_high_usd?: number | null;
    seller_type?: string | null;
    source_auction_platform?: string | null;
  };
  image_urls: string[];
  raw_dom_snapshot?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      throw new Error("Method not allowed");
    }

    const researchSecret = req.headers.get("x-research-secret");
    if (!researchSecret || researchSecret !== Deno.env.get("RESEARCH_CAPTURE_SECRET")) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid Secret" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const payloadText = await req.text();
    let payload: ResearchCapturePayload;
    try {
      payload = JSON.parse(payloadText);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON format" }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    if (!payload.source_platform || !payload.source_url || !payload.captured_fields || !payload.captured_fields.make || !payload.captured_fields.model) {
      return new Response(JSON.stringify({ error: "Missing required fields (source_platform, source_url, make, model)" }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const cf = payload.captured_fields;

    // Call generate_fingerprint RPC
    const { data: fingerprintHash, error: rpcError } = await supabase.rpc("generate_fingerprint", {
      p_vin: cf.vin ?? null,
      p_make: cf.make ?? null,
      p_model: cf.model ?? null,
      p_year: cf.year ?? null,
      p_trim: cf.trim ?? null,
      p_exterior_color: cf.exterior_color ?? null,
      p_interior_color: cf.interior_color ?? null,
      p_origin_status: null
    });

    if (rpcError) {
      throw new Error(`RPC generate_fingerprint failed: ${rpcError.message}`);
    }

    // Upsert into assets
    let assetId;
    let wasDuplicate = false;
    const { data: existingAsset, error: findError } = await supabase
      .from('assets')
      .select('id, body_style, cylinders, engine_type, transmission, fuel, drivetrain, exterior_color, trim, interior_color, horsepower')
      .eq('fingerprint_hash', fingerprintHash)
      .maybeSingle();

    if (findError) throw findError;

    if (existingAsset) {
      assetId = existingAsset.id;
      wasDuplicate = true;
      
      // Compute diff for backfill
      const updates: any = {};
      if (existingAsset.body_style === null && cf.body_style) updates.body_style = cf.body_style;
      if (existingAsset.cylinders === null && cf.cylinders) updates.cylinders = cf.cylinders;
      if (existingAsset.engine_type === null && cf.engine_type) updates.engine_type = cf.engine_type;
      if (existingAsset.transmission === null && cf.transmission) updates.transmission = cf.transmission;
      if (existingAsset.fuel === null && cf.fuel) updates.fuel = cf.fuel;
      if (existingAsset.drivetrain === null && cf.drivetrain) updates.drivetrain = cf.drivetrain;
      if (existingAsset.exterior_color === null && cf.exterior_color) updates.exterior_color = cf.exterior_color;
      if (existingAsset.trim === null && cf.trim) updates.trim = cf.trim;
      if (existingAsset.interior_color === null && cf.interior_color) updates.interior_color = cf.interior_color;
      if (existingAsset.horsepower === null && cf.horsepower) updates.horsepower = cf.horsepower;

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        await supabase.from('assets').update(updates).eq('id', assetId);
      }
    } else {
      const { data: newAsset, error: insertError } = await supabase
        .from('assets')
        .insert({
          fingerprint_hash: fingerprintHash,
          vin: cf.vin ?? null,
          make: cf.make ?? null,
          model: cf.model ?? null,
          year: cf.year ?? null,
          trim: cf.trim ?? null,
          exterior_color: cf.exterior_color ?? null,
          interior_color: cf.interior_color ?? null,
          body_style: cf.body_style ?? null,
          cylinders: cf.cylinders ?? null,
          engine_type: cf.engine_type ?? null,
          transmission: cf.transmission ?? null,
          fuel: cf.fuel ?? null,
          drivetrain: cf.drivetrain ?? null,
          horsepower: cf.horsepower ?? null,
          origin_status: 'Unknown',
          status: 'ACTIVE'
        })
        .select('id')
        .single();
      
      if (insertError) throw insertError;
      assetId = newAsset.id;
    }

    // Insert into sightings
    const { data: newSighting, error: sightingError } = await supabase
      .from('sightings')
      .insert({
        asset_id: assetId,
        source_platform: payload.source_platform ?? null,
        source_type: 'research_capture',
        source_url: payload.source_url ?? null,
        lot_number: cf.lot_number ?? null,
        listed_price: null,
        listed_currency: 'USD',
        mileage_miles: cf.mileage_miles ?? null,
        damage_type: cf.damage_type ?? null,
        title_type: cf.title_type ?? null,
        location: cf.location ?? null,
        image_urls: payload.image_urls || [],
        raw_payload: payload,
        
        estimated_retail_value_usd: cf.estimated_retail_value_usd ?? null,
        current_bid_usd: cf.current_bid_usd ?? null,
        seller: cf.seller ?? null,
        sale_date: cf.sale_date ?? null,
        has_key: cf.has_key ?? null,
        runs_and_drives: cf.runs_and_drives ?? null,
        engine_starts: cf.engine_starts ?? null,
        transmission_engages: cf.transmission_engages ?? null,
        highlights: cf.highlights ?? null,
        secondary_damage: cf.secondary_damage ?? null,
        odometer_brand: cf.odometer_brand ?? null,
        estimated_cost_low_usd: cf.estimated_cost_low_usd ?? null,
        estimated_cost_high_usd: cf.estimated_cost_high_usd ?? null,
        seller_type: cf.seller_type ?? null,
        source_auction_platform: cf.source_auction_platform ?? null
      })
      .select('id')
      .single();

    if (sightingError) throw sightingError;

    // Optional research_run insertion
    let runListingId = undefined;
    if (payload.research_run_id) {
       // get max position
       const { data: listings, error: lsError } = await supabase
         .from('research_run_listings')
         .select('position')
         .eq('run_id', payload.research_run_id)
         .order('position', { ascending: false })
         .limit(1);
       if (lsError) throw lsError;

       const maxPos = (listings && listings.length > 0) ? listings[0].position : 0;

       const { data: runListing, error: rlErr } = await supabase
         .from('research_run_listings')
         .insert({
            run_id: payload.research_run_id,
            sighting_id: newSighting.id,
            position: maxPos + 1
         })
         .select('id')
         .single();
       if (rlErr) throw rlErr;
       runListingId = runListing.id;
    }

    return new Response(JSON.stringify({
      success: true,
      asset_id: assetId,
      sighting_id: newSighting.id,
      fingerprint: fingerprintHash,
      run_listing_id: runListingId,
      was_duplicate: wasDuplicate
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("research-capture error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});

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
    listed_price?: number | null;
    listed_currency?: string | null;
    
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
    sale_confirmed?: boolean | null;
    auction_appearance_count?: number | null;
  };
  image_urls: string[];
  lot_state?: string;
  raw_dom_snapshot?: string;
  auction_history?: any[];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      throw new Error("Method not allowed");
    }

    // NOTE: Access control for the Chrome extension relies entirely on possession of the static x-research-secret.
    // It does not use a user JWT, so role-based checks (e.g. requiring 'superadmin') cannot be enforced here.
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
    const defaultOrgId = Deno.env.get("DEFAULT_ORG_ID");
    if (!supabaseUrl || !supabaseServiceKey || !defaultOrgId) {
      throw new Error("Missing Supabase configuration or DEFAULT_ORG_ID");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let rates: Record<string, number> | null = null;
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      if (res.ok) {
        const data = await res.json();
        rates = data.rates;
      } else {
        console.error(`Rate fetch failed with status ${res.status}`);
      }
    } catch (err) {
      console.error("Rate fetch network error:", err);
    }

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
          org_id: defaultOrgId,
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

    let priceUsd: number | null = null;
    let exchangeRate: number | null = null;
    let exchangeRateDate: string | null = null;
    let conversionFailed = false;

    const listedPriceToSave = (cf.current_bid_usd !== null && cf.current_bid_usd !== undefined) ? null : (cf.listed_price ?? null);
    const listedCurrency = cf.listed_currency ?? 'USD';

    if (cf.current_bid_usd !== null && cf.current_bid_usd !== undefined) {
      priceUsd = cf.current_bid_usd;
      exchangeRate = 1;
      exchangeRateDate = new Date().toISOString();
    } else if (listedPriceToSave !== null) {
      if (listedCurrency === 'USD') {
        priceUsd = listedPriceToSave;
        exchangeRate = 1;
        exchangeRateDate = new Date().toISOString();
      } else {
        if (rates && rates[listedCurrency]) {
          exchangeRate = rates[listedCurrency];
          priceUsd = listedPriceToSave / exchangeRate;
          exchangeRateDate = new Date().toISOString();
        } else {
          conversionFailed = true;
        }
      }
    }

    const rawPayloadToSave: any = { ...payload };
    if (conversionFailed) {
      rawPayloadToSave.price_usd_conversion_failed = true;
      rawPayloadToSave.attempted_currency = listedCurrency;
    }

    // Sighting Data
    const sightingData = {
        org_id: defaultOrgId,
        logged_via: 'extension_dom_capture',
        asset_id: assetId,
        source_platform: payload.source_platform ?? null,
        source_type: 'research_capture',
        source_url: payload.source_url ?? null,
        lot_number: cf.lot_number ?? null,
        listed_price: listedPriceToSave,
        listed_currency: listedCurrency,
        price_usd: priceUsd,
        exchange_rate: exchangeRate,
        exchange_rate_date: exchangeRateDate,
        mileage_miles: cf.mileage_miles ?? null,
        damage_type: cf.damage_type ?? null,
        title_type: cf.title_type ?? null,
        location: cf.location ?? null,
        image_urls: payload.image_urls || [],
        raw_payload: rawPayloadToSave,
        lot_state: payload.lot_state ?? null,
        
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
        source_auction_platform: cf.source_auction_platform ?? null,
        sale_confirmed: cf.sale_confirmed ?? null,
        auction_appearance_count: cf.auction_appearance_count ?? null
    };

    let newSightingId: string;
    
    // Check existing
    let existingQuery = supabase
        .from('sightings')
        .select('id, lot_state')
        .eq('asset_id', assetId)
        .eq('source_platform', payload.source_platform)
        .eq('lot_number', cf.lot_number);

    if (payload.lot_state === 'finished') {
        existingQuery = existingQuery.eq('lot_state', 'finished');
    } else {
        existingQuery = existingQuery.neq('lot_state', 'finished');
    }

    const { data: existingSightings, error: checkError } = await existingQuery.limit(1);
    if (checkError) throw checkError;

    if (existingSightings && existingSightings.length > 0) {
        newSightingId = existingSightings[0].id;
        if (payload.lot_state !== 'finished') {
            // Update active sighting
            const { error: updateError } = await supabase
                .from('sightings')
                .update({ ...sightingData, captured_at: new Date().toISOString() })
                .eq('id', newSightingId);
            if (updateError) throw updateError;
        }
    } else {
        // Insert new
        const { data: inserted, error: insertSightingError } = await supabase
            .from('sightings')
            .insert(sightingData)
            .select('id')
            .single();
        if (insertSightingError) throw insertSightingError;
        newSightingId = inserted.id;
    }

    if (payload.auction_history && payload.auction_history.length > 0) {
      try {
        const historyRecords = payload.auction_history.map((h: any) => ({
          org_id: defaultOrgId,
          asset_id: assetId,
          sighting_id: newSightingId,
          auction_platform: h.auction_platform ?? null,
          auction_date: h.auction_date ?? null,
          lot_number: h.lot_number ?? null,
          bid_amount_usd: h.bid_amount_usd ?? null,
          odometer_miles: h.odometer_miles ?? null,
          status: h.status ?? null,
          seller_type: h.seller_type ?? null
        }));

        const { error: historyError } = await supabase
          .from('auction_history')
          .upsert(historyRecords, { 
            onConflict: 'asset_id,auction_date,lot_number,bid_amount_usd',
            ignoreDuplicates: true 
          });

        if (historyError) {
          console.error("Failed to insert auction_history (non-fatal):", historyError);
        }
      } catch (err) {
        console.error("Failed to process auction_history (non-fatal):", err);
      }
    }

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
            org_id: defaultOrgId,
            run_id: payload.research_run_id,
            sighting_id: newSightingId,
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
      sighting_id: newSightingId,
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

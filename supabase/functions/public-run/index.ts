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

    // Parsed whenever the method is POST, not only when the token is missing from the
    // query string - the approval action (PROMPT 19 Phase 3) needs body.listing_id
    // regardless of where the token itself came from.
    let body: any = {};
    if (req.method === 'POST') {
      body = await req.json().catch(() => ({}));
      if (!token) token = body.token;
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
      .select('id, client_name, notes, created_at, run_type')
      .eq('share_token', token)
      .eq('share_enabled', true)
      .is('deleted_at', null)
      .single();

    if (runError || !run) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // PROMPT 19 Phase 3 - client approval. A blocked run cannot be approved: this reuses
    // the exact share_enabled/deleted_at gate the `run` lookup above already enforces -
    // there is no other server-side or stored representation of "blocked" to check
    // (PLAN_TRACKER.md #31). Routed only when the POST body carries listing_id, so a
    // plain token-only POST keeps behaving exactly as the read path always has.
    if (req.method === 'POST' && typeof body.listing_id === 'string') {
      const listingId = body.listing_id;

      // Once any listing on this run is approved, no further approvals through this
      // endpoint - approving a different vehicle needs staff involvement, a real
      // conversation, not a second POST. This also catches a stale-tab re-POST of the
      // SAME listing as a rejection rather than a silent no-op success.
      const { data: existingApproval, error: existingApprovalError } = await supabaseClient
        .from('research_run_listings')
        .select('id')
        .eq('run_id', run.id)
        .not('approved_at', 'is', null)
        .limit(1)
        .maybeSingle();

      if (existingApprovalError) throw existingApprovalError;

      if (existingApproval) {
        return new Response(JSON.stringify({ error: "A vehicle has already been approved for this request. Contact Caplimo to change your selection." }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Re-fetch the target listing fresh and server-side, joined the same way the
      // public page renders it - never trust a client-supplied price/date/vehicle
      // description for the approval snapshot. Sightings on live lots get overwritten
      // on re-capture (SCHEMA.md S1), so what matters is what THIS query returns right
      // now, at the moment of approval - not anything the POST body might claim.
      const { data: targetRow, error: targetError } = await supabaseClient
        .from('research_run_listings')
        .select(`
          id,
          sighting:sightings (
            current_bid_usd,
            listed_price,
            listed_currency,
            price_usd,
            sale_date,
            source_platform,
            captured_at,
            asset:assets ( year, make, model, trim, vin )
          )
        `)
        .eq('id', listingId)
        .eq('run_id', run.id)
        .eq('included', true)
        .single();

      if (targetError || !targetRow) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const targetSighting: any = (targetRow as any).sighting || {};
      const targetAsset = targetSighting.asset || {};
      const currentBid = typeof targetSighting.current_bid_usd === 'number' ? targetSighting.current_bid_usd : null;
      const listedPrice = typeof targetSighting.listed_price === 'number' ? targetSighting.listed_price : null;
      const displayPrice = targetSighting.price_usd !== null && targetSighting.price_usd !== undefined
        ? targetSighting.price_usd
        : (currentBid ?? listedPrice);

      // Identifying details, the price shown, and the auction date shown - not a
      // foreign key to a listing/sighting whose data can change out from under it.
      const approvedSnapshot = {
        year: targetAsset.year ?? null,
        make: targetAsset.make ?? null,
        model: targetAsset.model ?? null,
        trim: targetAsset.trim ?? null,
        vin: targetAsset.vin ?? null,
        display_price: displayPrice,
        is_bid: currentBid !== null,
        listed_currency: targetSighting.listed_currency ?? null,
        sale_date: targetSighting.sale_date ?? null,
        source_platform: targetSighting.source_platform ?? null,
        captured_at: targetSighting.captured_at ?? null
      };

      // `.is('approved_at', null)` in the WHERE clause makes this update itself the
      // race guard, not just the pre-check above: two concurrent POSTs can both pass
      // the check, but only one update actually matches a row - the loser gets back
      // zero rows and is rejected below, rather than silently overwriting the winner.
      const { data: updatedRow, error: updateError } = await supabaseClient
        .from('research_run_listings')
        .update({
          approved_at: new Date().toISOString(),
          approved_via: 'client',
          approved_by: null,
          approved_snapshot: approvedSnapshot
        })
        .eq('id', listingId)
        .eq('run_id', run.id)
        .is('approved_at', null)
        .select('id, approved_at')
        .maybeSingle();

      if (updateError) throw updateError;

      if (!updatedRow) {
        return new Response(JSON.stringify({ error: "A vehicle has already been approved for this request. Contact Caplimo to change your selection." }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ success: true, approved_at: updatedRow.approved_at }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 5. Fetch listings
    const { data: listingsData, error: listingsError } = await supabaseClient
      .from('research_run_listings')
      .select(`
        id,
        notes,
        position,
        approved_at,
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
          price_usd,
          estimated_retail_value_usd,
          image_urls,
          stored_image_urls,
          image_store_status,
          source_platform,
          lot_state,
          captured_at,
          sale_date,
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
      run_type: run.run_type
    };

    // Gather paths to sign
    const pathsToSignSet = new Set<string>();
    (listingsData || []).forEach((row: any) => {
      const sighting = row.sighting || {};
      if (Array.isArray(sighting.stored_image_urls)) {
        sighting.stored_image_urls.forEach((p: string) => pathsToSignSet.add(p));
      }
    });

    const pathsToSign = Array.from(pathsToSignSet);
    const signedUrlMap = new Map<string, string>();

    if (pathsToSign.length > 0) {
      // Sign in batches of 100 to avoid length limits
      for (let i = 0; i < pathsToSign.length; i += 100) {
        const batch = pathsToSign.slice(i, i + 100);
        const { data: signedUrls, error: signError } = await supabaseClient
          .storage
          .from('vehicle-images')
          .createSignedUrls(batch, 7 * 24 * 3600);
        
        if (!signError && signedUrls) {
          signedUrls.forEach(su => {
            if (!su.error && su.signedUrl && su.path) {
              signedUrlMap.set(su.path, su.signedUrl);
            }
          });
        }
      }
    }

    const publicListings = (listingsData || []).map((row: any) => {
      const sighting = row.sighting || {};
      const asset = sighting.asset || {};
      
      const mapped: any = {
        // PROMPT 19 Phase 3 - deliberate, minimal widening (PROJECT_CHARTER.md S5.9):
        // `id` is the opaque listing identifier the client needs to reference when
        // approving a specific vehicle; `approved_at` lets the page show approved
        // state and disable the action, without ever exposing approved_by (an
        // internal staff user id) or approved_snapshot (staff/dispute-evidence only).
        id: row.id,
        approved_at: row.approved_at ?? null,

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
        price_usd: sighting.price_usd,
        estimated_retail_value_usd: sighting.estimated_retail_value_usd,
        image_urls: (() => {
          if (Array.isArray(sighting.stored_image_urls) && sighting.stored_image_urls.length > 0) {
            const signed = sighting.stored_image_urls.map((p: string) => signedUrlMap.get(p)).filter(Boolean);
            if (signed.length > 0) return signed;
          }
          return sighting.image_urls;
        })(),
        source_platform: sighting.source_platform,
        captured_at: sighting.captured_at,
        sale_date: sighting.sale_date
      };

      if (sighting.lot_state === 'finished') {
        mapped.sale_date = sighting.sale_date;
      }
      return mapped;
    });

    let stats = null;
    if (run.run_type === 'sold_comps' || run.run_type === 'mixed') {
      let tP = 0, pC = 0, minP = Infinity, maxP = -Infinity, tM = 0, mC = 0;
      
      const soldListings = run.run_type === 'mixed' 
        ? publicListings.filter((l: any) => l.current_bid_usd === null) 
        : publicListings;

      soldListings.forEach((l: any) => {
        if (typeof l.price_usd === 'number') {
          tP += l.price_usd;
          pC++;
          if (l.price_usd < minP) minP = l.price_usd;
          if (l.price_usd > maxP) maxP = l.price_usd;
        }
        if (typeof l.mileage_miles === 'number') {
          tM += l.mileage_miles;
          mC++;
        }
      });

      stats = {
        avg_price_usd: pC > 0 ? tP / pC : null,
        min_price_usd: pC > 0 ? minP : null,
        max_price_usd: pC > 0 ? maxP : null,
        priced_count: pC,
        total_count: soldListings.length,
        avg_mileage: mC > 0 ? tM / mC : null
      };
    }

    const responseBody: any = {
      run: publicRun,
      listings: publicListings
    };
    if (stats) responseBody.stats = stats;

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

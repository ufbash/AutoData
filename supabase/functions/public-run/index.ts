import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
// PROMPT 29 Stage 2 - the single definition of the sold population, shared literally with the
// staff dashboard (src/components/ResearchRunDetail.tsx imports this same file). Closes the
// divergence that caused the Prompt 25 client-facing bug: there is no second copy to drift.
import { isInSoldPopulation, countsTowardSoldAverage, SoldGroupListing, RunType } from "../_shared/soldGroup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The nested sighting row this function selects, reduced to the shape the shared rules read.
// Explicit rather than a cast, so a future select-list change that drops one of these fields
// is a type error here instead of a silently-null rule (the AGENTS.md §4 failure mode).
const soldGroupShape = (sighting: any): SoldGroupListing => ({
  lot_state: sighting.lot_state ?? null,
  current_bid_usd: sighting.current_bid_usd ?? null,
  price_usd: sighting.price_usd ?? null,
  sale_confirmed: sighting.sale_confirmed ?? null,
  logged_via: sighting.logged_via ?? null,
  source_platform: sighting.source_platform ?? null,
});

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
      .select('id, client_name, notes, created_at, run_type, client_brief:client_briefs(year_min, year_max)')
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

    // PROMPT 28 Stage 1 - fetched only to compute a derived per-listing/aggregate range
    // disclosure below. year_min/year_max themselves are never added to `publicRun` (the
    // hand-built allow-list a few lines down) - server-side use only, per S5.9.
    const briefForRange = Array.isArray((run as any).client_brief) ? (run as any).client_brief[0] : (run as any).client_brief;
    const briefYearMin: number | null = briefForRange?.year_min ?? null;
    const briefYearMax: number | null = briefForRange?.year_max ?? null;
    const rangeStated = briefYearMin != null || briefYearMax != null;

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
          sale_confirmed,
          logged_via,
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

    // PROMPT 29 Stage 2 - keyed off the real, raw sighting (which carries lot_state) rather
    // than the mapped public object (which deliberately never exposes lot_state at all - see
    // the allow-list below). This is the exact same "which listings are the sold population"
    // question the stats block used to answer with a narrower, fourth copy of the predicate
    // (`current_bid_usd === null` alone, missing the `lot_state !== 'active'` clause a real
    // mixed run needs) - found auditing this file for Stage 2, not reported by any prompt.
    const inSoldPopulationById = new Map<string, boolean>();
    (listingsData || []).forEach((row: any) => {
      inSoldPopulationById.set(row.id, isInSoldPopulation(soldGroupShape(row.sighting || {}), run.run_type));
    });

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
        sale_date: sighting.sale_date,

        // PROMPT 25 - a derived flag, not raw sale_confirmed/logged_via (S5.9: deliberate,
        // minimal widening). Mirrors ResearchRunDetail.tsx's getStats exclusion rule exactly
        // (same predicate, same manual_entry/ai_vision carve-out) rather than inventing a
        // second standard. Only meaningful within the sold population for this run's type -
        // false for every active listing, which has no "confirmed sale" concept at all.
        // PROMPT 29 Stage 2 - the predicate that used to be re-derived here now comes from the
        // shared definition (../_shared/soldGroup.ts), imported literally by this function AND
        // by ResearchRunDetail.tsx. This exact re-derivation is what silently diverged for
        // months and produced the Prompt 25 bug; there is now nothing left to diverge FROM.
        sale_unconfirmed: (() => {
          if (!isInSoldPopulation(soldGroupShape(sighting), run.run_type)) return false;
          return !countsTowardSoldAverage(soldGroupShape(sighting));
        })(),

        // PROMPT 28 Stage 1 - disclosure, not a spec flag (PROJECT_CHARTER.md S5.1: widen
        // bands and say so, never silently). 'out_of_range' only within the sold population,
        // only when the brief actually states a range, and only when the year itself is known -
        // an unknown year is not a violation (S4.1), it is unclassifiable, and stays null.
        // Never excludes the listing from anything; purely informational.
        range_status: (() => {
          if (!isInSoldPopulation(soldGroupShape(sighting), run.run_type) || !rangeStated || asset.year == null) return null;
          const belowMin = briefYearMin != null && asset.year < briefYearMin;
          const aboveMax = briefYearMax != null && asset.year > briefYearMax;
          return (belowMin || aboveMax) ? 'out_of_range' : 'in_range';
        })()
      };

      if (sighting.lot_state === 'finished') {
        mapped.sale_date = sighting.sale_date;
      }
      return mapped;
    });

    let stats = null;
    if (run.run_type === 'sold_comps' || run.run_type === 'mixed') {
      let tP = 0, pC = 0, minP = Infinity, maxP = -Infinity, tM = 0, mC = 0;
      let rangeInCount = 0, rangeOutCount = 0, rangeUnknownCount = 0;

      // PROMPT 29 Stage 2 - now the same shared predicate as everywhere else, keyed by id
      // against the raw-sighting-derived map above (this mapped object has no lot_state to
      // check directly - see the allow-list note where `mapped` is built).
      const soldListings = publicListings.filter((l: any) => inSoldPopulationById.get(l.id) === true);

      soldListings.forEach((l: any) => {
        // PROMPT 25 - matches getStats' exact rule (ResearchRunDetail.tsx): an unconfirmed
        // sale is excluded from the price average and its sample size, but mileage is not
        // gated by this at all in the rule being mirrored - preserved here rather than
        // "improved," since silently diverging from the target rule would defeat the point
        // of matching it.
        if (typeof l.price_usd === 'number' && !l.sale_unconfirmed) {
          tP += l.price_usd;
          pC++;
          if (l.price_usd < minP) minP = l.price_usd;
          if (l.price_usd > maxP) maxP = l.price_usd;
          // PROMPT 28 Stage 1 - composition of the exact set just counted into the average
          // above, never a separate definition of it.
          if (rangeStated) {
            if (l.range_status === 'out_of_range') rangeOutCount++;
            else if (l.range_status === 'in_range') rangeInCount++;
            else rangeUnknownCount++;
          }
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
        avg_mileage: mC > 0 ? tM / mC : null,
        range_stated: rangeStated,
        range_in_count: rangeStated ? rangeInCount : null,
        range_out_count: rangeStated ? rangeOutCount : null,
        range_unknown_count: rangeStated ? rangeUnknownCount : null,
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

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { canonicalizeForFingerprint } from "../_shared/specVocabulary.ts";
import { auctionHouseFromBidcarsSnapshot } from "../_shared/bidcarsLot.ts";

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

    // PROMPT 30 Stage 2 (debt #46) - canonical model/trim for IDENTITY (fingerprint) purposes
    // only. Two platforms can disagree on how trim/submodel information is folded into the
    // model string for the exact same physical car (Copart "E 250 Bluetec" vs bid.cars
    // "E-class"/"250 BLUETEC"; Copart "Yaris IA BASE" vs bid.cars "Yaris"/"BASE") - the
    // fingerprint formula itself is correct, the inputs disagree. This NEVER touches the raw
    // cf.model/cf.trim values written to assets/sightings below (PROJECT_CHARTER.md §5.8) - it
    // only changes what generate_fingerprint's p_model/p_trim receive. When a VIN is present the
    // SQL function ignores p_model/p_trim entirely, so canonicalizing unconditionally here is a
    // no-op for VIN-bearing captures and the real fix for VIN-less ones. See
    // supabase/functions/_shared/specVocabulary.ts for the canonicalization itself.
    const identity = canonicalizeForFingerprint(cf.model, cf.trim);

    // Call generate_fingerprint RPC
    const { data: fingerprintHash, error: rpcError } = await supabase.rpc("generate_fingerprint", {
      p_vin: cf.vin ?? null,
      p_make: cf.make ?? null,
      p_model: identity.canonicalModel,
      p_year: cf.year ?? null,
      p_trim: identity.canonicalTrim,
      p_exterior_color: cf.exterior_color ?? null,
      p_interior_color: cf.interior_color ?? null,
      p_origin_status: null
    });

    if (rpcError) {
      throw new Error(`RPC generate_fingerprint failed: ${rpcError.message}`);
    }

    // PROMPT 32 Stage 3 (debt #46) - every capture's OWN VIN-less canonical identity, computed
    // unconditionally regardless of whether this capture itself has a VIN. Stored on the asset
    // (migration 037's vinless_identity_hash) so a future VIN-less capture of a VIN-bearing car
    // can find it via one indexed lookup, without recomputing canonicalizeForFingerprint against
    // every asset on every capture. For a VIN-less capture this is identical to fingerprintHash
    // above; computed separately here so the VIN-bearing branch gets it too, for free.
    const { data: vinlessHash, error: vinlessHashError } = await supabase.rpc("generate_fingerprint", {
      p_vin: null,
      p_make: cf.make ?? null,
      p_model: identity.canonicalModel,
      p_year: cf.year ?? null,
      p_trim: identity.canonicalTrim,
      p_exterior_color: cf.exterior_color ?? null,
      p_interior_color: cf.interior_color ?? null,
      p_origin_status: null
    });
    if (vinlessHashError) throw new Error(`RPC generate_fingerprint (vinless identity) failed: ${vinlessHashError.message}`);

    // Upsert into assets
    let assetId;
    let wasDuplicate = false;
    // PROMPT 29 Stage 1 (debt #46) - set when this capture upgraded an existing VIN-less asset
    // in place, or declined to. Reported in the response and stamped on the sighting's
    // raw_payload, so the decision is auditable after the fact rather than invisible.
    let fingerprintOutcome: Record<string, unknown> | null = null;
    const { data: existingAsset, error: findError } = await supabase
      .from('assets')
      .select('id, body_style, cylinders, engine_type, transmission, fuel, drivetrain, exterior_color, trim, interior_color, horsepower')
      .eq('fingerprint_hash', fingerprintHash)
      .maybeSingle();

    if (findError) throw findError;

    // PROMPT 29 Stage 1 (debt #46) - fingerprint revision on VIN discovery.
    //
    // The bug: a capture with no VIN fingerprints on make/model/year/trim/colour; a later
    // capture of the SAME physical car WITH a VIN fingerprints on the VIN instead, so the car
    // splits into two permanent assets and the first is orphaned - no future capture can ever
    // reattach to it. IAAI reproduces this on demand: it masks the VIN logged-out and reveals
    // it logged-in (PLAN_TRACKER.md B1).
    //
    // A VIN is strictly better evidence than the VIN-less formula, so the upgrade runs in one
    // direction only: a VIN-bearing capture may claim an existing VIN-less asset. A VIN-less
    // capture never merges into a VIN-bearing asset - it simply takes the VIN-less path below,
    // exactly as before, because weaker evidence must never collapse two records.
    //
    // Deliberately NOT implemented: a "more than one candidate asset" ambiguity branch.
    // assets.fingerprint_hash is `text unique not null` (migration 002:14, verified enforced in
    // production), so a lookup by VIN-less fingerprint returns at most one row and that branch
    // could never fire. Shipping it would repeat the structurally-unreachable guard already
    // documented in docs/SOLVED.md topic 16. The reachable abstention is a CONFLICT: the
    // VIN-less fingerprint matches an asset that already carries a DIFFERENT VIN, which means
    // these are two different cars that happen to share make/model/year/trim/colour. That
    // abstains - a wrong merge fuses two real cars' histories and is far harder to detect
    // afterwards than a split.
    const hasUsableVin = typeof cf.vin === 'string' && cf.vin.length >= 11;
    if (!existingAsset && hasUsableVin) {
      const { data: vinlessCandidate, error: vinlessFindError } = await supabase
        .from('assets')
        .select('id, vin')
        .eq('fingerprint_hash', vinlessHash)
        .maybeSingle();
      if (vinlessFindError) throw vinlessFindError;

      if (vinlessCandidate && vinlessCandidate.vin === null) {
        // Upgrade in place: the same row acquires the VIN and the VIN-based fingerprint, so
        // every sighting and auction_history row already pointing at it follows automatically -
        // nothing is repointed, nothing is orphaned, because no second asset is ever created.
        const { error: upgradeError } = await supabase
          .from('assets')
          .update({ vin: cf.vin, fingerprint_hash: fingerprintHash, vinless_identity_hash: vinlessHash, updated_at: new Date().toISOString() })
          .eq('id', vinlessCandidate.id)
          .is('vin', null); // race guard: only upgrade while it is still VIN-less
        if (upgradeError) throw upgradeError;

        assetId = vinlessCandidate.id;
        wasDuplicate = true;
        fingerprintOutcome = {
          action: 'upgraded_vinless_asset',
          asset_id: vinlessCandidate.id,
          acquired_vin: cf.vin,
        };
      } else if (vinlessCandidate && vinlessCandidate.vin !== null && vinlessCandidate.vin !== cf.vin) {
        fingerprintOutcome = {
          action: 'abstained_vin_conflict',
          candidate_asset_id: vinlessCandidate.id,
          candidate_vin: vinlessCandidate.vin,
          incoming_vin: cf.vin,
          note: 'VIN-less fingerprint matched an asset carrying a different VIN - two different cars sharing make/model/year/trim/colour. Created a separate asset rather than fusing their histories.',
        };
      }
    }

    // PROMPT 32 Stage 3 (debt #46) - the missing direction. A VIN-less capture arriving after a
    // VIN-bearing asset already exists for the same car: its exact fingerprint_hash lookup
    // (existingAsset, above) can only ever match another VIN-less asset - VIN-bearing assets
    // hash on the VIN, not the vinless-canonical formula - so without this it falls straight
    // through to creating a second asset, the exact split Stage 2 exists to clean up.
    //
    // Attaching is not merging (per the master prompt): this only decides which asset a fresh
    // sighting belongs to at capture time, cheap and reversible, and does not touch any
    // already-accumulated history the way Stage 2's merge does - so it does not go through that
    // review gate. But the same abstention applies: more than one VIN-bearing asset sharing this
    // exact vinless identity is a genuine ambiguity (two real cars with identical
    // make/model/year/trim/colour), not something to pick between - create a new asset and let
    // Stage 2's review catch it later if it turns out to be a real split.
    if (!existingAsset && !assetId && !hasUsableVin) {
      const { data: vinBearingMatches, error: vinBearingFindError } = await supabase
        .from('assets')
        .select('id, vin')
        .eq('vinless_identity_hash', vinlessHash)
        .not('vin', 'is', null)
        .is('merged_into_asset_id', null);
      if (vinBearingFindError) throw vinBearingFindError;

      if (vinBearingMatches && vinBearingMatches.length === 1) {
        // Attach only - the VIN-bearing asset's own identity fields are untouched. This
        // sighting simply belongs to a car that already has stronger (VIN) evidence elsewhere.
        assetId = vinBearingMatches[0].id;
        wasDuplicate = true;
        fingerprintOutcome = {
          action: 'attached_vinless_to_vin_bearing_asset',
          asset_id: assetId,
        };
      } else if (vinBearingMatches && vinBearingMatches.length > 1) {
        fingerprintOutcome = {
          action: 'abstained_ambiguous_vin_bearing_match',
          candidate_asset_ids: vinBearingMatches.map((m: { id: string }) => m.id),
          note: `${vinBearingMatches.length} different VIN-bearing assets share this VIN-less capture's exact identity - genuinely ambiguous which one (if any) this sighting belongs to. Created a separate asset rather than guessing.`,
        };
      }
    }

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
    } else if (assetId) {
      // Already resolved above - either the VIN-discovery upgrade (that row IS this car and now
      // carries the VIN) or Stage 3's symmetric attach (this VIN-less sighting belongs to an
      // existing VIN-bearing asset). Creating anything here is exactly the split this stage
      // exists to prevent.
    } else {
      const { data: newAsset, error: insertError } = await supabase
        .from('assets')
        .insert({
          org_id: defaultOrgId,
          fingerprint_hash: fingerprintHash,
          vinless_identity_hash: vinlessHash,
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

    // PROMPT 30 Stage 1 (debt #55) - canonical FLAT shape, see
    // supabase/functions/_shared/rawPayload.ts for the full rationale. Was `{ ...payload }`,
    // spreading the whole request envelope and leaving every real value nested under
    // `captured_fields` - the root cause behind four separate reader bugs (Prompt 26 follow-up,
    // Prompt 29 Stage 3). Flattened to match app-ingest's own flat-spread convention exactly, so
    // there is one canonical raw_payload shape system-wide, not two. Historical rows written
    // under the old nested shape are untouched; readRawPayloadField/requireRawPayloadField
    // handle both transparently.
    const rawPayloadToSave: any = {
      source_platform: payload.source_platform,
      source_url: payload.source_url,
      lot_state: payload.lot_state ?? null,
      research_run_id: payload.research_run_id ?? null,
      raw_dom_snapshot: payload.raw_dom_snapshot ?? null,
      auction_history: payload.auction_history ?? null,
      image_urls: payload.image_urls ?? [],
      ...cf,
    };
    // DEBT #61 - for a bid.cars capture the real auction house is derived HERE, from the lot prefix in
    // the captured page text, by the one shared definition (_shared/bidcarsLot.ts). Whatever the
    // extension sent as source_auction_platform is NOT trusted: an older extension mapped prefix 0 to
    // copart (backwards), and a stale copy in someone's browser must not be able to reintroduce that.
    // The value the extension sent stays untouched in raw_payload (spread from cf above, per
    // PROJECT_CHARTER.md section 5.8); the derivation is stamped beside it.
    let sourceAuctionPlatform: string | null = cf.source_auction_platform ?? null;
    if (payload.source_platform === 'bidcars') {
      const derived = auctionHouseFromBidcarsSnapshot(payload.raw_dom_snapshot);
      sourceAuctionPlatform = derived.house;
      rawPayloadToSave.source_auction_platform_derivation = { lot_prefix: derived.prefix, house: derived.house };
    }
    if (conversionFailed) {
      rawPayloadToSave.price_usd_conversion_failed = true;
      rawPayloadToSave.attempted_currency = listedCurrency;
    }
    // PROMPT 29 Stage 1 - same stamping pattern as the conversion failure above: a
    // fingerprint upgrade or a declined merge is recorded on the sighting that caused it, so
    // it is queryable later rather than existing only in this function's response.
    if (fingerprintOutcome) {
      rawPayloadToSave.asset_fingerprint_outcome = fingerprintOutcome;
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
        source_auction_platform: sourceAuctionPlatform,
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
       // A re-capture of the same lot into the same run should not create a duplicate
       // attachment or reorder it - (run_id, sighting_id) is unique. Check first.
       const { data: existing, error: existErr } = await supabase
         .from('research_run_listings')
         .select('id')
         .eq('run_id', payload.research_run_id)
         .eq('sighting_id', newSightingId)
         .maybeSingle();
       if (existErr) throw existErr;

       if (existing) {
         runListingId = existing.id;
       } else {
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
    }

    return new Response(JSON.stringify({
      success: true,
      asset_id: assetId,
      sighting_id: newSightingId,
      fingerprint: fingerprintHash,
      run_listing_id: runListingId,
      was_duplicate: wasDuplicate,
      fingerprint_outcome: fingerprintOutcome
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

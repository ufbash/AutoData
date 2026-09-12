import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sniper-secret",
};

serve(async (req: Request) => {
  // 1. Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 2. Authorization checking
    // PROMPT 31 Stage 2 (debt #56) - was a hardcoded literal in source (in git history since
    // ccac489, 21 Jun 2026). Moved to env config, matching the exact pattern every other
    // secret-header-authenticated function in this codebase already uses (research-capture,
    // upload-images: RESEARCH_CAPTURE_SECRET; monthly-backup: BACKUP_SECRET) - no new mechanism.
    // Rotating the value itself is Bashir's action: he must set SNIPER_SECRET in the Supabase
    // project's Edge Function secrets before this deploys, or every real call starts failing.
    const sniperSecret = req.headers.get("x-sniper-secret");
    const expectedSecret = Deno.env.get("SNIPER_SECRET");
    if (!expectedSecret || !sniperSecret || sniperSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid Secret" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. Parse JSON body (expecting { images: string[], mimeType: string })
    const bodyText = await req.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON body payload" }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const { images, mimeType } = body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: "Missing or invalid images array in payload" }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    console.log(`Processing payload containing ${images.length} images...`);

    // PROMPT 31 Stage 2 (debt #56) - this function no longer writes to the database (see the
    // removed `sales` insert below), so it no longer needs the service-role key at all. Dropping
    // it entirely is a real reduction in blast radius, not just tidying: a function with no DB
    // client can't be repurposed later to write somewhere it shouldn't with elevated privileges.

    // 5. Initialize Gemini
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      throw new Error("Missing GEMINI_API_KEY in environment variables");
    }

    const promptText = `
Identify and extract car sales data from the following images. 
- **Sold Date:** Look at the VERY TOP of Image 1 (the Story/Highlight). It usually shows a date like '14 February'. Assume the year is 2026 unless the year is specifically shown. 
- **List Date:** Look at the VERY BOTTOM of Image 2 (the Post). It shows when the post was made, e.g., '9 February'. Assume the year is 2026 unless the year is specifically shown. 
- **Dealer:** Look at the profile name at the top left of either image (e.g., 'abujacar') or in the actual post, right before the cars details. It'll usually be in bold. 
- **Specs:** Extract make, model, year, price, and mileage from the post description. 
- **Trim:** Look closely at the post description for trim levels, performance variants, or packages (e.g., AMG, M-Sport, XSE, Limited, Longitude). If found, put this in the 'trim' field. If the description just says 'BMW 330i', the trim is '330i'.

CRITICAL TAXONOMY RULE: Never combine Year, Make, Model, or Trim. 
You MUST strictly follow these brand-specific taxonomy rules for Make, Model, and Trim: 
1. **BMW:** 'Model' MUST be the Series or X-line (e.g., '3 Series', '5 Series', 'X5', 'X6'). 'Trim' is the specific badge and drivetrain (e.g., '330i xDrive', 'M50i', 'Competition'). Do NOT use '330i' as the Model. 
2. **Mercedes-Benz:** 'Model' MUST be the Class or SUV line (e.g., 'C-Class', 'E-Class', 'G-Class', 'GLE', 'S-Class'). 'Trim' is the engine/badge (e.g., 'C 43 AMG', 'G 63', 'E 350'). Do NOT use 'C43' as the Model. 
3. **Land Rover:** 'Model' is the core family (e.g., 'Range Rover', 'Range Rover Sport', 'Defender'). 'Trim' is the spec (e.g., 'Autobiography', 'HSE', 'V8 Carpathian'). 
4. **General Rule:** 'Model' is the broad family. 'Trim' is the specific performance, package, or engine variant. If a trim is unknown, use 'Base', but never put a trim level into the Model field. 
- 'Year' is ONLY the 4-digit number. 
- 'Make' is the brand (e.g., 'Mercedes-Benz', 'Toyota'). 
If a dealer posts '2024 Mercedes C43', you must return { year: '2024', make: 'Mercedes-Benz', model: 'C-Class', trim: 'C 43 AMG' }.

Return as a clean JSON object with keys: { make, model, trim, year, price, originalCurrency, dateListed, dateSold, mileage, dealer }.
For 'originalCurrency': only return one of 'NGN', 'USD', 'EUR', 'GBP' if the images themselves make
the currency clear (an explicit symbol or code). If it is not stated or is ambiguous, return the
literal string "NOT_VISIBLE" instead - do NOT guess a default. Do not use outside knowledge (e.g.
assuming Naira because the post looks Nigerian) to fill this in.
Format dates as YYYY-MM-DD.
If a field is missing, use null.
Return ONLY the JSON object, no markdown formatting, no conversational text.
`;

    // 6. Build Gemini request contents
    const imageParts = images.map((base64String: string) => ({
      inlineData: {
        data: base64String.replace(/^data:image\/\w+;base64,/, ''), // Ensure prefix is removed if present
        mimeType: mimeType || "image/png"
      }
    }));

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
    
    console.log("Calling Gemini API...");
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: promptText }, ...imageParts]
        }]
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini Error:", errText);
      throw new Error(`Gemini API failed with status ${geminiRes.status}: ${errText}`);
    }

    const geminiData = await geminiRes.json();
    const candidateText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!candidateText) {
      throw new Error("No structured text returned from Gemini API");
    }

    console.log("Raw Gemini Output:", candidateText);

    // 7. Parse the extracted JSON
    const jsonMatch = candidateText.match(/\{[\s\S]*\}/);
    const cleanJson = jsonMatch ? jsonMatch[0] : candidateText;
    
    let extractedRecord: any;
    try {
      extractedRecord = JSON.parse(cleanJson);
    } catch (e) {
      throw new Error("Failed to parse Gemini output as JSON: " + cleanJson);
    }

    console.log("Parsed Record:", extractedRecord);

    // PROMPT 31 Stage 2 (debt #56) - an abstained currency (null or "NOT_VISIBLE") must never be
    // treated as NGN, here or anywhere downstream: not for a live-rate lookup, not for a
    // fallback rate, not in the final response. Every prior version of this block defaulted to
    // 'NGN' three separate times, which would have silently mispriced computedPriceUSD for any
    // ambiguous-currency post.
    const hasLegibleCurrency = typeof extractedRecord.originalCurrency === 'string'
      && extractedRecord.originalCurrency !== 'NOT_VISIBLE';
    const legibleCurrency: string | null = hasLegibleCurrency ? extractedRecord.originalCurrency : null;

    // 8. Fetch Exchange Rates to calculate priceUSD - skipped entirely when the currency itself
    // is not legible, since there is nothing honest to convert from.
    let usdRate: number | null = null;
    const fallbackRates: Record<string, number> = { 'USD': 1, 'NGN': 1500, 'EUR': 0.92, 'GBP': 0.79 };

    if (legibleCurrency) {
      try {
        console.log("Fetching live exchange rates...");
        const rateRes = await fetch('https://open.er-api.com/v6/latest/USD');
        if (rateRes.ok) {
          const rateData = await rateRes.json();
          usdRate = rateData.rates[legibleCurrency] || fallbackRates[legibleCurrency] || null;
        } else {
          throw new Error("Rate API not returning 200 OK");
        }
      } catch (e) {
        console.warn("Using fallback exchange rates:", e);
        usdRate = fallbackRates[legibleCurrency] || null;
      }
    }

    // 9. Standardize Values (price, priceUSD, daysToSell)
    let cleanPrice: number | null = null;
    let computedPriceUSD: number | null = null;

    if (extractedRecord.price !== undefined && extractedRecord.price !== null) {
      const stripped = String(extractedRecord.price).replace(/[^0-9.]/g, '');
      const num = Number(stripped);
      if (num > 0 && !isNaN(num)) {
        cleanPrice = num;
        if (legibleCurrency === 'USD') {
          computedPriceUSD = cleanPrice;
        } else if (legibleCurrency && usdRate) {
          computedPriceUSD = cleanPrice / usdRate;
        }
        // else: currency not legible, or no rate resolved - priceUSD stays null rather than a
        // silently-wrong conversion computed against an assumed currency.
      }
    }

    let diffDays: number | null = null;
    if (extractedRecord.dateListed && extractedRecord.dateSold) {
      const listedMs = Date.parse(extractedRecord.dateListed);
      const soldMs = Date.parse(extractedRecord.dateSold);
      if (Number.isFinite(listedMs) && Number.isFinite(soldMs)) {
        diffDays = Math.ceil(Math.abs(soldMs - listedMs) / (1000 * 60 * 60 * 24));
      }
    }

    const payload = {
      id: crypto.randomUUID(),
      make: extractedRecord.make || "Unknown",
      model: extractedRecord.model || "Unknown",
      trim: extractedRecord.trim || "Base",
      year: extractedRecord.year || "Unknown",
      price: cleanPrice,
      // Never coerced to "NGN" - null (absent) or the literal "NOT_VISIBLE" (present but
      // unreadable/ambiguous) both survive as-is, so whatever reviews this response can see the
      // abstention instead of a confident-looking wrong currency.
      originalCurrency: legibleCurrency,
      priceUSD: computedPriceUSD,
      exchangeRate: usdRate,
      dateListed: extractedRecord.dateListed || null,
      dateSold: extractedRecord.dateSold || new Date().toISOString().split("T")[0],
      daysToSell: diffDays,
      mileage: extractedRecord.mileage || null,
      dealer: extractedRecord.dealer || "Unknown",
      tags: [],
      recordType: "MARKET_DATA" // Set explicitly for Daily Sniper
    };

    // PROMPT 31 Stage 2 (debt #56) - this used to insert directly into the deprecated `sales`
    // table (SCHEMA.md §11: DEPRECATED, RLS-locked, do not read or write it), reachable only
    // because this function holds the service-role key. Confirmed by repo-wide grep: nothing
    // ever reads what this wrote - the write was pure risk with no benefit, and it happened with
    // no human review step of any kind. Removed. This function now only extracts and returns the
    // data (mirroring extract-vehicle-vision's own extract-and-return shape) - persisting it
    // anywhere is a separate, real feature (a proper sightings/assets write path with a review
    // step) that this security-remediation stage deliberately does not build.
    console.log("Extraction complete, returning payload (no longer persisted - debt #56):", payload);

    return new Response(JSON.stringify({
      success: true,
      message: "Vehicle extracted (not persisted - see debt #56 in PLAN_TRACKER.md).",
      data: payload
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("Edge Function Error:", error);
    return new Response(JSON.stringify({ 
      error: "Internal Server Error", 
      details: error.message || String(error) 
    }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});

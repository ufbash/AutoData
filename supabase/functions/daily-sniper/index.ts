import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

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
    const sniperSecret = req.headers.get("x-sniper-secret");
    if (sniperSecret !== "MobileSniper2026!") {
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

    // 4. Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing SUPABASE env vars.");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
For 'originalCurrency', strictly use one of: 'NGN', 'USD', 'EUR', 'GBP'. Default to 'NGN' if ambiguous.
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

    // 8. Fetch Exchange Rates to calculate priceUSD
    let usdRate = 1;
    const fallbackRates: Record<string, number> = { 'USD': 1, 'NGN': 1500, 'EUR': 0.92, 'GBP': 0.79 };
    
    try {
      console.log("Fetching live exchange rates...");
      const rateRes = await fetch('https://open.er-api.com/v6/latest/USD');
      if (rateRes.ok) {
        const rateData = await rateRes.json();
        const currency = extractedRecord.originalCurrency || 'NGN';
        usdRate = rateData.rates[currency] || fallbackRates[currency] || 1;
      } else {
        throw new Error("Rate API not returning 200 OK");
      }
    } catch (e) {
      console.warn("Using fallback exchange rates:", e);
      const currency = extractedRecord.originalCurrency || 'NGN';
      usdRate = fallbackRates[currency] || 1;
    }

    // 9. Standardize Values (price, priceUSD, daysToSell)
    let cleanPrice: number | null = null;
    let computedPriceUSD: number | null = null;
    
    if (extractedRecord.price !== undefined && extractedRecord.price !== null) {
      const stripped = String(extractedRecord.price).replace(/[^0-9.]/g, '');
      const num = Number(stripped);
      if (num > 0 && !isNaN(num)) {
        cleanPrice = num;
        if (extractedRecord.originalCurrency === 'USD') {
          computedPriceUSD = cleanPrice;
        } else {
          computedPriceUSD = cleanPrice / usdRate;
        }
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
      originalCurrency: extractedRecord.originalCurrency || "NGN",
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

    console.log("Inserting finalized payload into Supabase:", payload);

    const { data: insertedData, error: dbError } = await supabase
      .from('sales')
      .insert(payload)
      .select();

    if (dbError) {
      console.error("Database Insert Error:", dbError);
      throw dbError;
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Vehicle extracted and logged successfully.",
      data: insertedData?.[0] || payload
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

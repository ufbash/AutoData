import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { GoogleGenAI } from "npm:@google/genai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      throw new Error("Method not allowed");
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized: Missing token" }), { 
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    // Client for auth check
    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid token" }), { 
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Role gate: Check if user is staff or superadmin in any org
    const { data: memberships, error: memError } = await supabaseAuth
      .from('memberships')
      .select('role')
      .eq('user_id', user.id);

    if (memError) throw memError;

    const hasAccess = memberships?.some(m => m.role === 'superadmin');
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Vehicle logging is restricted to administrators." }), { 
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const payloadText = await req.text();
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON format" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Server configuration error: Gemini API key missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1' } });
    const modelName = "gemini-3.1-flash-lite";

    const parts = [
      {
        text: `Identify and extract car sales data from two images.
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

        ABSTENTION RULE (applies to every field, especially 'originalCurrency'):
        Only report what is visibly and legibly present in the images. Do not use outside knowledge
        - your own assumptions about a dealer's country, a typical price for the make/model, a
        typical currency for the region, or any other fact not shown in the images - to fill in a
        field. For each field, choose exactly one of these three outcomes:
        1. The value, if it is clearly and legibly shown in the images.
        2. null, if the field's information is simply absent from the post (e.g. no trim is
           mentioned anywhere, so there is nothing to read).
        3. The literal string "NOT_VISIBLE", if the field's information is present but you cannot
           confidently read it (blurry text, cropped/obscured text, a currency or amount you cannot
           determine with confidence, or a genuinely ambiguous case - e.g. a price shown as a bare
           number with no currency symbol, unit, or contextual text anywhere in the images that
           identifies which currency it is in).
        Never guess a default value for outcome 3, for any field. In particular, do NOT default
        'originalCurrency' to 'NGN' or any other currency when it is ambiguous - if you cannot
        determine the currency with confidence from what is actually shown, return "NOT_VISIBLE"
        for that field so a human reviewer resolves it. When 'originalCurrency' IS legible, it
        must still be one of: 'NGN', 'USD', 'EUR', 'GBP'.

        Return as a clean JSON object with keys: { make, model, trim, year, exterior_color, price, originalCurrency, dateListed, dateSold, mileage, dealer }.
        Format dates as YYYY-MM-DD.
        Return ONLY the JSON object, no markdown formatting, no conversational text.`
      }
    ] as any[];
    // Single-pass extraction with explicit per-field abstention (NOT_VISIBLE / null), rather than a
    // second reconciliation pass: a dual-pass approach (asking Gemini twice and diffing the answers)
    // would catch fields where the model is inconsistent across runs, but every field extracted here
    // already goes through a full human-review step before it is saved (BulkImport.tsx's review
    // table), which is a stronger check than a second model call agreeing with itself. Dual-pass was
    // considered and rejected for that reason, plus the added latency/cost of a second Gemini call
    // per image pair; it is not built here. If BulkImport.tsx's review step is ever removed or
    // bypassed, this decision should be revisited.

    if (payload.image1Base64 && payload.image1MimeType) {
      parts.push({
        inlineData: {
          data: payload.image1Base64,
          mimeType: payload.image1MimeType
        }
      });
    }

    if (payload.image2Base64 && payload.image2MimeType) {
      parts.push({
        inlineData: {
          data: payload.image2Base64,
          mimeType: payload.image2MimeType
        }
      });
    }

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts }]
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const cleanJson = jsonMatch ? jsonMatch[0] : text;
    const result = JSON.parse(cleanJson);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("extract-vehicle-vision error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});

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

        Return as a clean JSON object with keys: { make, model, trim, year, exterior_color, price, originalCurrency, dateListed, dateSold, mileage, dealer }. 
        For 'originalCurrency', strictly use one of: 'NGN', 'USD', 'EUR', 'GBP'. Default to 'NGN' if ambiguous.
        Format dates as YYYY-MM-DD.
        If a field is missing, use null.
        Return ONLY the JSON object, no markdown formatting, no conversational text.`
      }
    ] as any[];

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

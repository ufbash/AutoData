import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { decode } from "https://deno.land/std@0.177.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-research-secret",
};

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
    
    // Check Content-Length for 25MB cap
    const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
    if (contentLength > 25 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "Payload Too Large: Max 25MB allowed" }), { 
        status: 413, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const body = await req.json();
    const { sighting_id, images } = body;

    if (!sighting_id || !Array.isArray(images)) {
      return new Response(JSON.stringify({ error: "Bad Request: sighting_id and images array required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Validate sighting_id exists; read its org_id.
    const { data: sighting, error: sightingError } = await supabase
      .from('sightings')
      .select('org_id, image_urls')
      .eq('id', sighting_id)
      .single();

    if (sightingError || !sighting) {
      return new Response(JSON.stringify({ error: "Sighting not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let uploaded = 0;
    let failed = 0;
    const storedUrls: string[] = [];

    // We sort images by index to maintain index-order from the client
    images.sort((a, b) => a.index - b.index);

    // 2. For each image: decode base64 to bytes, upload
    for (const img of images) {
      if (typeof img.index !== 'number' || typeof img.data_base64 !== 'string') {
        failed++;
        continue;
      }

      try {
        const bytes = decode(img.data_base64);
        const padIndex = img.index.toString().padStart(2, '0');
        const path = `${sighting.org_id}/${sighting_id}/${padIndex}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(path, bytes, {
            contentType: 'image/jpeg',
            upsert: true
          });

        if (uploadError) {
          console.error(`Upload failed for index ${img.index}:`, uploadError);
          failed++;
        } else {
          storedUrls.push(path);
          uploaded++;
        }
      } catch (err) {
        console.error(`Decode/Upload exception for index ${img.index}:`, err);
        failed++;
      }
    }

    // 3. Update the sighting
    const expectedCount = Math.min(sighting.image_urls?.length || 0, 12);
    let newStatus = 'failed';
    if (uploaded > 0) {
      newStatus = (uploaded === expectedCount || uploaded === images.length) ? 'complete' : 'partial';
    }

    const updatePayload: any = {
      image_store_status: newStatus,
      images_stored_at: new Date().toISOString()
    };
    
    if (storedUrls.length > 0) {
      updatePayload.stored_image_urls = storedUrls;
    }

    await supabase
      .from('sightings')
      .update(updatePayload)
      .eq('id', sighting_id);

    return new Response(JSON.stringify({ uploaded, failed }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("upload-images error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

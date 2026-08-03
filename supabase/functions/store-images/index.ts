import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function refererFor(url: string): string {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return "https://www.google.com/"; }
  if (host.endsWith("copart.com")) return "https://www.copart.com/";
  if (host.endsWith("bid.cars") || host.endsWith("bid.car")) return "https://bid.cars/";
  if (host.endsWith("iaai.com")) return "https://www.iaai.com/";
  return "https://www.google.com/";
}

function originFor(url: string): string | null {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (host.endsWith("bid.cars") || host.endsWith("bid.car")) return "https://bid.cars";
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized: Missing token" }), { 
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const token = authHeader.replace("Bearer ", "");
    
    // Auth client
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false }
    });

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid token" }), { 
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Service Role Client
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Check membership role
    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership || membership.role !== 'superadmin') {
      return new Response(JSON.stringify({ error: "Forbidden: Requires superadmin role" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = await req.json().catch(() => ({}));
    const sightingIds = body.sighting_ids;

    if (!Array.isArray(sightingIds) || sightingIds.length === 0 || sightingIds.length > 50) {
      return new Response(JSON.stringify({ error: "Bad Request: sighting_ids must be an array of 1-50 IDs" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const results = [];

    for (const sightingId of sightingIds) {
      try {
        // Fetch sighting details
        const { data: sighting, error: sightingError } = await supabase
          .from('sightings')
          .select('org_id, image_urls, image_store_status')
          .eq('id', sightingId)
          .single();

        if (sightingError || !sighting) {
          results.push({ sighting_id: sightingId, status: 'error', reason: 'Not found' });
          continue;
        }

        if (sighting.image_store_status === 'complete') {
          results.push({ sighting_id: sightingId, status: 'skipped', reason: 'Already complete' });
          continue;
        }

        const imageUrls = Array.isArray(sighting.image_urls) ? sighting.image_urls.slice(0, 12) : [];
        if (imageUrls.length === 0) {
          results.push({ sighting_id: sightingId, status: 'skipped', reason: 'No images to store' });
          continue;
        }

        try {
          const firstUrl = new URL(imageUrls[0]);
          const host = firstUrl.hostname.toLowerCase();
          if (host.endsWith('bid.car') || host.endsWith('bid.cars')) {
             await supabase
              .from('sightings')
              .update({ image_store_status: 'extension_managed' })
              .eq('id', sightingId);
             
             results.push({ sighting_id: sightingId, status: 'extension_managed', reason: 'Handled by extension' });
             continue;
          }
        } catch(e) {
          // ignore parsing error here
        }

        // Set pending
        await supabase
          .from('sightings')
          .update({ image_store_status: 'pending' })
          .eq('id', sightingId);

        let storedCount = 0;
        let failedCount = 0;
        const storedUrls = [];
        let firstError = null;

          for (let i = 0; i < imageUrls.length; i++) {
          const urlStr = imageUrls[i];
          const referer = refererFor(urlStr);
          const origin = originFor(urlStr);
          
          let success = false;
          let attempt = 0;
          let lastErrMsg = '';

          while (attempt < 2 && !success) {
            attempt++;
            try {
              const headers = new Headers();
              headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36");
              headers.set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
              headers.set("Accept-Language", "en-US,en;q=0.9");
              headers.set("Sec-Fetch-Dest", "image");
              headers.set("Sec-Fetch-Mode", "no-cors");
              headers.set("Sec-Fetch-Site", "cross-site");
              headers.set("Referer", referer);
              if (origin) {
                headers.set("Origin", origin);
              }

              console.log(`Fetching image ${i + 1}/${imageUrls.length} for ${sightingId} | URL: ${urlStr}`);
              console.log(`Headers:`, Object.fromEntries(headers.entries()));

              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 15000);

              const imgRes = await fetch(urlStr, { headers, signal: controller.signal });
              clearTimeout(timeout);

              if (!imgRes.ok) {
                const status = imgRes.status;
                const statusText = imgRes.statusText;
                
                let errorBody = '';
                if (status === 403 || status === 429 || status === 401) {
                  try {
                    const text = await imgRes.text();
                    errorBody = text.substring(0, 500);
                  } catch (e) {
                    errorBody = 'Could not read body';
                  }
                }

                lastErrMsg = `HTTP ${status} ${statusText}${errorBody ? ` | Body: ${errorBody}` : ''}`;
                console.error(`Fetch failed | ID: ${sightingId} | URL: ${urlStr} | Status: ${status} ${statusText} | Referer: ${referer} | Body: ${errorBody}`);
                
                if ((status === 403 || status === 429) && attempt === 1) {
                  await new Promise(r => setTimeout(r, 500));
                  continue; // retry
                }
                throw new Error(lastErrMsg);
              }

              const buffer = await imgRes.arrayBuffer();
              const padIndex = i.toString().padStart(2, '0');
              const path = `${sighting.org_id}/${sightingId}/${padIndex}.jpg`;

              const { error: uploadError } = await supabase.storage
                .from('vehicle-images')
                .upload(path, buffer, {
                  contentType: 'image/jpeg',
                  upsert: true
                });

              if (uploadError) {
                lastErrMsg = uploadError.message;
                console.error(`Upload failed | ID: ${sightingId} | URL: ${urlStr} | Error: ${uploadError.message}`);
                throw uploadError;
              }

              storedUrls.push(path);
              storedCount++;
              success = true;

            } catch (e: any) {
              lastErrMsg = e.message || String(e);
              if (attempt === 1 && (lastErrMsg.includes('403') || lastErrMsg.includes('429'))) {
                console.error(`Fetch error (retry pending) | ID: ${sightingId} | URL: ${urlStr} | Error: ${lastErrMsg} | Referer: ${referer}`);
                await new Promise(r => setTimeout(r, 500));
              } else {
                console.error(`Fetch error | ID: ${sightingId} | URL: ${urlStr} | Error: ${lastErrMsg} | Referer: ${referer}`);
                failedCount++;
                if (!firstError) {
                  firstError = `${lastErrMsg.substring(0, 200)} (${urlStr})`;
                }
              }
            }
          }
        }

        let newStatus = 'failed';
        if (storedCount === imageUrls.length) newStatus = 'complete';
        else if (storedCount > 0) newStatus = 'partial';

        const updatePayload: any = {
          image_store_status: newStatus,
          images_stored_at: new Date().toISOString()
        };

        if (firstError) {
          updatePayload.image_store_error = firstError;
        } else if (newStatus === 'complete') {
          updatePayload.image_store_error = null;
        }

        if (storedUrls.length > 0) {
          updatePayload.stored_image_urls = storedUrls;
        }

        await supabase
          .from('sightings')
          .update(updatePayload)
          .eq('id', sightingId);

        results.push({ 
          sighting_id: sightingId, 
          status: newStatus, 
          stored_count: storedCount, 
          failed_count: failedCount 
        });

      } catch (err: any) {
        console.error(`Error processing sighting ${sightingId}:`, err);
        results.push({ sighting_id: sightingId, status: 'error', reason: err.message });
        
        await supabase
          .from('sightings')
          .update({ image_store_status: 'failed', image_store_error: err.message?.substring(0, 100) })
          .eq('id', sightingId);
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("store-images error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

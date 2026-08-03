chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "executeCaptureToSupabase") {
    chrome.storage.local.get(["supabaseUrl", "researchSecret"], async (result) => {
      if (!result.supabaseUrl || !result.researchSecret) {
        sendResponse({ success: false, error: "Settings not configured. Check Options." });
        return;
      }

      try {
        console.log('[AutoData BG] image_blobs present:', Array.isArray(request.payload?.image_blobs), request.payload?.image_blobs?.length);
        const url = `${result.supabaseUrl}/functions/v1/research-capture`;
        const { image_blobs, ...payloadWithoutBlobs } = request.payload;

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Research-Secret": result.researchSecret
          },
          body: JSON.stringify(payloadWithoutBlobs)
        });

        const data = await res.json();
        if (!res.ok) {
           throw new Error(data.error || "Edge Function returned an error");
        }

        sendResponse({ success: true, data });

        if (image_blobs && Array.isArray(image_blobs) && image_blobs.length > 0) {
          const validBlobs = image_blobs.map((b, i) => b ? { index: i, data_base64: b } : null).filter(Boolean);
          if (validBlobs.length > 0) {
            console.log('[AutoData BG] POSTing to upload-images, sighting:', data.sighting_id, 'images:', validBlobs.length);
            fetch(`${result.supabaseUrl}/functions/v1/upload-images`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Research-Secret": result.researchSecret
              },
              body: JSON.stringify({
                sighting_id: data.sighting_id,
                images: validBlobs
              })
            }).then(uploadRes => {
              console.log('[AutoData BG] upload-images status:', uploadRes.status);
              return uploadRes.json();
            }).then(uploadData => {
              console.log("upload-images completed:", uploadData);
            }).catch(e => {
              console.error("upload-images failed:", e);
            });
          }
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message || String(e) });
      }
    });
    return true; // Keep message channel open for async fetch
  }
});

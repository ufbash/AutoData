chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "executeCaptureToSupabase") {
    chrome.storage.local.get(["supabaseUrl", "researchSecret"], async (result) => {
      if (!result.supabaseUrl || !result.researchSecret) {
        sendResponse({ success: false, error: "Settings not configured. Check Options." });
        return;
      }

      try {
        const url = `${result.supabaseUrl}/functions/v1/research-capture`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Research-Secret": result.researchSecret
          },
          body: JSON.stringify(request.payload)
        });

        const data = await res.json();
        if (!res.ok) {
           throw new Error(data.error || "Edge Function returned an error");
        }
        sendResponse({ success: true, data });
      } catch (e) {
        sendResponse({ success: false, error: e.message || String(e) });
      }
    });
    return true; // Keep message channel open for async fetch
  }
});

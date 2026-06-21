document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(["supabaseUrl", "researchSecret"], (result) => {
       if (result.supabaseUrl) document.getElementById('supabase_url').value = result.supabaseUrl;
       if (result.researchSecret) document.getElementById('secret').value = result.researchSecret;
    });
});

document.getElementById('save-btn').addEventListener('click', () => {
    const url = document.getElementById('supabase_url').value.trim();
    const secret = document.getElementById('secret').value.trim();
    
    chrome.storage.local.set({
        supabaseUrl: url,
        researchSecret: secret
    }, () => {
        document.getElementById('status').innerText = "Saved successfully!";
        setTimeout(() => document.getElementById('status').innerText='', 2000);
    });
});

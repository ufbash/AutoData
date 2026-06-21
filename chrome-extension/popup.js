document.getElementById('options-link').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

function init() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const statusDiv = document.getElementById('status');
        const captureBtn = document.getElementById('capture-btn');
        
        if (!tabs[0] || !tabs[0].url) {
            statusDiv.style.color = 'red';
            statusDiv.innerText = "Error: Cannot access tab.";
            captureBtn.disabled = true;
            return;
        }

        chrome.tabs.sendMessage(tabs[0].id, {type: "checkLotPage"}, function(response) {
            if (chrome.runtime.lastError || !response) {
                statusDiv.style.color = 'red';
                statusDiv.innerText = "Not on a supported lot page";
                captureBtn.disabled = true;
                return;
            }

            if (response.isLotPage) {
                statusDiv.style.color = 'green';
                if (response.platform === 'copart') {
                    statusDiv.innerText = "Copart lot detected";
                } else if (response.platform === 'bidcars') {
                    statusDiv.innerText = "Bid.cars lot detected";
                } else {
                    statusDiv.innerText = "Lot detected";
                }
                captureBtn.disabled = false;
            } else {
                statusDiv.style.color = 'red';
                statusDiv.innerText = "Not on a supported lot page";
                captureBtn.disabled = true;
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', init);

document.getElementById('capture-btn').addEventListener('click', async () => {
    const statusDiv = document.getElementById('status');
    statusDiv.style.color = '#333';
    statusDiv.innerText = "Querying DOM...";
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {action: "captureCurrentLot"}, function(response) {
            if (chrome.runtime.lastError || !response) {
               statusDiv.style.color = 'red';
               statusDiv.innerText = "Error: Could not reach content script (Refresh page?).";
               return;
            }

            if (!response.success) {
               statusDiv.style.color = 'red';
               statusDiv.innerText = "Extraction Error: " + response.error;
               return;
            }

            const payload = response.data;
            const runId = document.getElementById('run_id').value.trim();
            if (runId) {
               payload.research_run_id = runId;
            }

            statusDiv.innerText = `Extracted! Sending to Edge Function...`;

            chrome.runtime.sendMessage({
                action: "executeCaptureToSupabase",
                payload: payload
            }, function(bgResponse) {
                if (chrome.runtime.lastError || !bgResponse) {
                    statusDiv.style.color = 'red';
                    statusDiv.innerText = "Background communication failed.";
                    return;
                }

                if (!bgResponse.success) {
                    statusDiv.style.color = 'red';
                    statusDiv.innerText = "Server Error: " + bgResponse.error;
                } else {
                    statusDiv.style.color = 'green';
                    statusDiv.innerHTML = `Success! <b>DB ID:</b> ${bgResponse.data.sighting_id.split('-')[0]}<br><b>Fingerprint:</b> ${bgResponse.data.fingerprint.substring(0, 8)}`;
                }
            });
        });
    });
});

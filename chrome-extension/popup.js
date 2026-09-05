document.getElementById('options-link').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

const RUN_TYPE_LABELS = { sold_comps: 'Market research', active_listings: 'Client options', mixed: 'Both' };
const SECTION_ORDER = ['active_listings', 'sold_comps', 'mixed'];
const SESSION_IDLE_MS = 10 * 60 * 1000;

let allRuns = [];
let pendingCapture = null; // set while a card-click capture is in flight

function relativeDate(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function showActiveView(clientLabel, subLabel) {
    document.getElementById('active_view').style.display = 'block';
    document.getElementById('picker_view').style.display = 'none';
    document.getElementById('capture-btn').style.display = 'block';
    document.getElementById('active_run_client').innerText = clientLabel;
    document.getElementById('active_run_sub').innerText = subLabel;
}

function showPickerView() {
    document.getElementById('active_view').style.display = 'none';
    document.getElementById('picker_view').style.display = 'block';
    document.getElementById('capture-btn').style.display = 'none';
    loadRunPicker();
}

function renderRunList(query) {
    const listEl = document.getElementById('run_list');
    const noResultsEl = document.getElementById('no_results');
    listEl.innerHTML = '';

    const q = (query || '').trim().toLowerCase();
    const visibleRuns = q
        ? allRuns.filter(r =>
            (r.client_name || '').toLowerCase().includes(q) ||
            (r.name || '').toLowerCase().includes(q))
        : allRuns;

    noResultsEl.style.display = (q && visibleRuns.length === 0) ? 'block' : 'none';

    SECTION_ORDER.forEach(type => {
        const runsOfType = visibleRuns.filter(r => r.run_type === type);
        if (runsOfType.length === 0) return;

        const label = document.createElement('div');
        label.className = 'section-label';
        label.innerText = RUN_TYPE_LABELS[type] || type;
        listEl.appendChild(label);

        runsOfType.forEach(run => {
            const card = document.createElement('div');
            card.className = 'run-card';
            card.innerHTML = `
                <div class="run-card-main">
                    <div class="run-card-client">${escapeHtml(run.client_name || 'No client')}</div>
                    <div class="run-card-label">${escapeHtml(run.name)}</div>
                </div>
                <div class="run-card-date">${relativeDate(run.created_at)}</div>
            `;
            card.addEventListener('click', () => selectRunAndCapture(run.id, run.client_name || 'No client', run.name, run.run_type));
            listEl.appendChild(card);
        });
    });
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.innerText = s == null ? '' : String(s);
    return d.innerHTML;
}

function loadRunPicker() {
    const fetchStatus = document.getElementById('run_fetch_status');
    const searchInput = document.getElementById('run_search');
    const listEl = document.getElementById('run_list');
    listEl.innerHTML = '';
    searchInput.style.display = 'none';
    searchInput.value = '';
    fetchStatus.style.display = 'block';
    fetchStatus.style.color = '#999';
    fetchStatus.innerText = 'Loading runs...';

    chrome.runtime.sendMessage({ action: "fetchActiveRuns" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
            // Do not block capture because the list did not load - fall back to
            // manual entry with a visible message.
            fetchStatus.style.color = '#c00';
            fetchStatus.innerText = 'Could not load run list — enter a Run ID manually below.';
            document.getElementById('manual_entry').style.display = 'block';
            return;
        }

        allRuns = response.runs || [];
        fetchStatus.style.display = 'none';
        if (allRuns.length > 6) {
            searchInput.style.display = 'block';
            searchInput.focus();
        }
        renderRunList();
    });
}

document.getElementById('run_search').addEventListener('input', (e) => {
    renderRunList(e.target.value);
});

document.getElementById('no_run_card').addEventListener('click', () => {
    selectRunAndCapture('', null, 'No run', null);
});

document.getElementById('manual_toggle').addEventListener('click', () => {
    const entry = document.getElementById('manual_entry');
    entry.style.display = entry.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('manual_use_btn').addEventListener('click', () => {
    const runId = document.getElementById('run_id_manual').value.trim();
    if (!runId) return;
    selectRunAndCapture(runId, `Manual run`, runId, null);
});

document.getElementById('end-session-btn').addEventListener('click', () => {
    chrome.storage.local.set({ sessionActive: false, activeRunId: null, activeRunClient: null, activeRunSub: null }, () => {
        showPickerView();
    });
});

function initSessionState() {
    chrome.storage.local.get(['sessionActive', 'activeRunId', 'activeRunClient', 'activeRunSub', 'activeRunLastActivity'], (saved) => {
        const isLive = saved.sessionActive && (Date.now() - (saved.activeRunLastActivity || 0)) < SESSION_IDLE_MS;
        if (isLive) {
            showActiveView(saved.activeRunClient || 'Active run', saved.activeRunSub || '');
        } else {
            if (saved.sessionActive) {
                chrome.storage.local.set({ sessionActive: false, activeRunId: null, activeRunClient: null, activeRunSub: null });
            }
            showPickerView();
        }
    });
}

document.addEventListener('DOMContentLoaded', initSessionState);

function checkLotPage(callback) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const statusDiv = document.getElementById('status');

        if (!tabs[0] || !tabs[0].url) {
            statusDiv.style.color = 'red';
            statusDiv.innerText = "Error: Cannot access tab.";
            callback(false);
            return;
        }

        chrome.tabs.sendMessage(tabs[0].id, {type: "checkLotPage"}, function(response) {
            if (chrome.runtime.lastError || !response) {
                statusDiv.style.color = 'red';
                statusDiv.innerText = "Not on a supported lot page";
                callback(false);
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
                callback(true);
            } else {
                statusDiv.style.color = 'red';
                statusDiv.innerText = "Not on a supported lot page";
                callback(false);
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', () => checkLotPage(() => {}));

function doCapture(runId, onDone) {
    const statusDiv = document.getElementById('status');
    statusDiv.style.color = '#333';
    statusDiv.innerText = "Querying DOM...";

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {action: "captureCurrentLot"}, function(response) {
            if (chrome.runtime.lastError || !response) {
                statusDiv.style.color = 'red';
                statusDiv.innerText = "Error: Could not reach content script (Refresh page?).";
                onDone(false);
                return;
            }

            if (!response.success) {
                statusDiv.style.color = 'red';
                statusDiv.innerText = "Extraction Error: " + response.error;
                onDone(false);
                return;
            }

            const payload = response.data;
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
                    onDone(false);
                    return;
                }

                if (!bgResponse.success) {
                    statusDiv.style.color = 'red';
                    statusDiv.innerText = "Server Error: " + bgResponse.error;
                    onDone(false);
                } else {
                    statusDiv.style.color = 'green';
                    statusDiv.innerHTML = `Success! <b>DB ID:</b> ${bgResponse.data.sighting_id.split('-')[0]}<br><b>Fingerprint:</b> ${bgResponse.data.fingerprint.substring(0, 8)}`;
                    onDone(true);
                }
            });
        });
    });
}

// Clicking a run card both selects it AND captures the current lot in one motion.
// It also starts (or refreshes) the sticky session so later tabs skip the picker.
function selectRunAndCapture(runId, clientLabel, subLabel, runType) {
    if (pendingCapture) return;
    pendingCapture = true;

    doCapture(runId, (success) => {
        pendingCapture = null;
        if (success) {
            chrome.storage.local.set({
                sessionActive: true,
                activeRunId: runId || null,
                activeRunClient: clientLabel,
                activeRunSub: subLabel,
                activeRunLastActivity: Date.now()
            });
            showActiveView(clientLabel, subLabel);
        }
    });
}

// While a session is active, the popup shows just this button - reuses the stored run.
document.getElementById('capture-btn').addEventListener('click', () => {
    chrome.storage.local.get(['activeRunId', 'activeRunLastActivity'], (saved) => {
        doCapture(saved.activeRunId, (success) => {
            if (success) {
                chrome.storage.local.set({ activeRunLastActivity: Date.now() });
            }
        });
    });
});

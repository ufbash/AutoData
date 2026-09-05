const BIDCARS_BARE_LABELS = [
  'Loss', 'Primary damage', 'Secondary damage', 'Odometer', 'Start code',
  'Key', 'ACV / ERC', 'Body Style', 'Exterior color', 'Engine',
  'Transmission', 'Fuel Type', 'Drive Type', 'Lot', 'VIN', 'Seller',
  'Sale Document', 'Current Bid', 'Final bid', 'Sold for', 'Final price'
];

function extractBidcarsField(text, label) {
  const lines = text.split('\n').map(l => l.trim());

  // 1. INLINE: "Label:Value"
  for (const line of lines) {
    if (line.startsWith(label + ':') && line.length > label.length + 1) {
      return line.substring(label.length + 1).trim();
    }
  }

  // 2. COLON-BLOCK: "Label:" then next non-empty
  let idx = lines.findIndex(l => l === label + ':');
  if (idx === -1 && BIDCARS_BARE_LABELS.includes(label)) {
    // 3. BARE-BLOCK: "Label" then next non-empty
    idx = lines.findIndex(l => l === label);
  }
  if (idx === -1) return null;

  for (let j = idx + 1; j < lines.length; j++) {
    if (lines[j] === '') continue;
    const v = lines[j].trim();
    // Treat dash or placeholders as null
    if (v === '-' || v === '–' || v === '—' || /^no information$/i.test(v)) return null;
    return v;
  }
  return null;
}

function parseEngineString(s) {
  if (!s) return { engine_type: null, cylinders: null, horsepower: null };
  const parts = s.split(',').map(p => p.trim());

  let displacement = null, config = null, hp = null, rawCyls = null;
  for (const p of parts) {
    if (/^\d+\.\d+L$/i.test(p)) displacement = p.toUpperCase();
    else if (/^[IVHWB]\d+$/i.test(p)) config = p.toUpperCase();
    else if (/^(\d+)\s*cyl\.?$/i.test(p)) {
      const m = p.match(/^(\d+)\s*cyl\.?$/i);
      if (m) rawCyls = parseInt(m[1], 10);
    }
    else if (/^\d+HP$/i.test(p)) hp = parseInt(p, 10);
  }

  const engine_type = [displacement, config].filter(Boolean).join(' ') || null;

  let cylinders = null;
  if (config) {
    const m = config.match(/\d+$/);
    if (m) cylinders = parseInt(m[0], 10);
  } else if (rawCyls !== null) {
    cylinders = rawCyls;
  }

  return { engine_type, cylinders, horsepower: hp };
}

function extractFinalSalePrice(text) {
  const lines = text.split('\n').map(l => l.trim());
  const LABELS = ['Final bid', 'Sold for', 'Final price'];

  for (let i = 0; i < lines.length; i++) {
    if (!LABELS.includes(lines[i])) continue;

    // look at the next non-empty line
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const v = lines[j];
      if (v === '') continue;

      // MUST be a USD value. Skip EUR/PLN occurrences (Price Estimator section)
      // and skip section headers (e.g. "Final Price Calculator").
      const m = v.match(/^\$\s?([\d,]+(?:\.\d{2})?)\s*(USD)?$/i);
      if (m) {
        const num = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(num) && num > 0) return num;
      }
      break; // this occurrence isn't a USD price; try the next label occurrence
    }
  }
  return null;
}

function extractSalesHistory() {
  const history = [];
  const tables = Array.from(document.querySelectorAll('table'));
  const salesTable = tables.find(t => {
    const headers = Array.from(t.querySelectorAll('th, td')).map(h => h.innerText || '');
    return headers.some(h => /Auction/i.test(h)) && headers.some(h => /Final bid/i.test(h));
  });

  if (!salesTable) return { history: [], found: false };

  const rows = Array.from(salesTable.querySelectorAll('tr'));
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].cells;
    if (!cells || cells.length < 7) continue;
    
    const auction_platform = cells[0]?.innerText.trim() || null;
    const auction_date = cells[1]?.innerText.trim() || null;
    if (!auction_date || !/^\d{4}-\d{2}-\d{2}$/.test(auction_date)) {
        continue;
    }
    
    let lot_number = null;
    if (cells[2]) {
        let clean = cells[2].innerText.replace(/\s+/g, '');
        const parts = clean.split('-');
        lot_number = parts.length > 1 ? parts[1] : clean;
    }

    let bid_amount_usd = null;
    if (cells[3]) {
        const rawBid = cells[3].innerText.trim();
        if (/^\$[\d,]+/.test(rawBid)) {
            const num = parseFloat(rawBid.replace(/[$,\s]/g, ''));
            if (!isNaN(num)) bid_amount_usd = num;
        }
    }

    let odometer_miles = null;
    if (cells[4]) {
        const num = parseInt(cells[4].innerText.replace(/[a-z\s]/gi, ''), 10);
        if (!isNaN(num)) odometer_miles = num;
    }

    const status = cells[5]?.innerText.trim() || null;
    const seller_type = cells[6]?.innerText.trim() || null;

    if (status) {
        const s = status.toLowerCase();
        // 'no information' is a real, valid status (16 live rows) - it means unknown, not an
        // anomaly, and the A2 derivation (auctionHistoryFlags.ts) deliberately treats it as
        // unknown rather than counting it toward previously_unsold (AGENTS.md 6: absence is
        // not violation). Stored raw either way - this only silences the false warning.
        if (!/(not sold|no sale|no information|withdrawn|cancell?ed|pending|sold|sale)/.test(s)) {
            console.warn("[AutoData] Unrecognised Sales History status:", status);
        }
    }

    history.push({
      auction_platform,
      auction_date,
      lot_number,
      bid_amount_usd,
      odometer_miles,
      status,
      seller_type
    });
  }

  return { history, found: true };
}

function isBidcarsLotPage() {
    const isLotUrl = /^\/en\/lot\//.test(location.pathname);
    const bodyText = document.body.innerText || '';
    return isLotUrl && /[A-HJ-NPR-Z0-9]{17}/.test(bodyText) && bodyText.includes('Sale Document');
}

// Detection-only retry, not a fixed delay. The URL path is available immediately, but the
// VIN string and "Sale Document" are DOM text that may not have rendered yet on a freshly
// loaded page - checking once at a fixed moment is the same defect class as the image-timing
// bug. Checks immediately first (zero delay if already rendered), then polls briefly only if
// the URL genuinely looks like a lot page. Non-lot pages (homepage, search results) fail the
// URL check and return false with no retry at all. This does not change what
// captureCurrentLot() extracts - detection only.
async function isBidcarsLotPageWithRetry(maxAttempts = 8, intervalMs = 250) {
    if (!/^\/en\/lot\//.test(location.pathname)) return false;
    for (let i = 0; i < maxAttempts; i++) {
        if (isBidcarsLotPage()) return true;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return false;
}

function normalizeMakeModel(make, model) {
    const toTitleCase = (str) => {
        if (!str) return null;
        return str.split(' ').map(word => {
            if (word.length <= 4 && /^[A-Z0-9]+$/i.test(word)) {
                return word.toUpperCase();
            }
            if (word.length === 0) return word;
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }).join(' ');
    };
    return { make: toTitleCase(make), model: toTitleCase(model) };
}

function captureCurrentLot() {
    const fullText = document.body.innerText || '';
    const lines = fullText.split('\n').map(l => l.trim());
    
    // VIN
    let vin = extractBidcarsField(fullText, 'VIN');
    if (vin) {
        vin = vin.toUpperCase();
        if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) vin = null;
    }
    if (!vin) {
        // Fallback to standalone VIN extraction above focal lot if labeled VIN missing
        const vinIdx = lines.findIndex(l => /^[A-HJ-NPR-Z0-9]{17}$/.test(l));
        if (vinIdx !== -1) vin = lines[vinIdx];
    }
    if (!vin) throw new Error("VIN not found on page.");
    
    // Title parsing (always standalone above the focal VIN)
    let year = null, make = null, model = null, trim = null;
    const vinIdx = lines.findIndex(l => l === vin);
    if (vinIdx > 0) {
        const titleLine = lines[vinIdx - 1];
        if (titleLine) {
            const tokens = titleLine.split(' ');
            if (tokens.length > 0 && /^\d{4}$/.test(tokens[0])) {
                year = parseInt(tokens[0], 10);
                const remainder = tokens.slice(1).join(' ');
                const commaSplit = remainder.split(',');
                if (commaSplit.length > 0) {
                    const mm = commaSplit[0].trim().split(' ');
                    make = mm[0];
                    model = mm.slice(1).join(' ');
                    if (commaSplit.length > 1) {
                        trim = commaSplit.slice(1).join(',').trim();
                    }
                }
            }
        }
    }
    const normalized = normalizeMakeModel(make, model);

    // Lot + Source Auction Platform
    let lot_number = null;
    let source_auction_platform = null;
    const rawLot = extractBidcarsField(fullText, 'Lot');
    if (rawLot) {
        const parts = rawLot.split('-');
        if (parts.length > 1) {
            lot_number = parts[1].trim();
            if (parts[0].trim() === '1' || parts[0].trim() === '0') source_auction_platform = 'copart';
            else if (parts[0].trim() === '2') source_auction_platform = 'iaai';
        } else {
            lot_number = rawLot;
        }
    }

    // Mileage
    let mileage_miles = null;
    const rawOdo = extractBidcarsField(fullText, 'Odometer');
    if (rawOdo) {
        const match = rawOdo.match(/(\d{1,3}(\s\d{3})*)\s*mi/);
        if (match) {
            const num = parseInt(match[1].replace(/\s/g, ''), 10);
            if (!isNaN(num)) mileage_miles = num;
        }
    }

    // Highlights & Runs and Drives
    let highlights = extractBidcarsField(fullText, 'Start code');
    let runs_and_drives = null;
    if (highlights) {
        if (/run and drive/i.test(highlights)) {
            runs_and_drives = true;
        }
    }

    // Key
    let has_key = null;
    const rawKey = extractBidcarsField(fullText, 'Key');
    if (rawKey) {
        if (/present/i.test(rawKey)) has_key = 'Yes';
        else if (/(missing|no)/i.test(rawKey)) has_key = 'No';
        else has_key = rawKey;
    }

    // ACV
    let estimated_retail_value_usd = null;
    const rawAcv = extractBidcarsField(fullText, 'ACV / ERC');
    if (rawAcv) {
        const match = rawAcv.match(/\$[\d,]+/);
        if (match) {
            const num = parseFloat(match[0].replace(/[$,USD\s]/g, ''));
            if (!isNaN(num) && num !== 0) estimated_retail_value_usd = num;
        }
    }

    // Engine
    const { engine_type, cylinders, horsepower } = parseEngineString(extractBidcarsField(fullText, 'Engine'));

    // Drivetrain
    let drivetrain = extractBidcarsField(fullText, 'Drive Type');
    if (drivetrain) {
        drivetrain = drivetrain.replace(/\|\s*$/, '').trim();
    }

    // Current Bid
    let current_bid_usd = null;
    const rawBid = extractBidcarsField(fullText, 'Current Bid');
    if (rawBid) {
        const num = parseFloat(rawBid.replace(/[$,USD\s]/g, ''));
        if (!isNaN(num)) current_bid_usd = num;
    }

    // Estimated Cost Range
    let estLow = null, estHigh = null;
    const estIdx = lines.findIndex(l => l === 'Estimated cost:');
    if (estIdx !== -1) {
        const prices = [];
        for (let j = estIdx + 1; j < Math.min(lines.length, estIdx + 7); j++) {
            if (lines[j] === '') continue;
            if (/^\$[\d,]+/.test(lines[j])) {
                const num = parseFloat(lines[j].replace(/[$,USD\s]/g, ''));
                if (!isNaN(num)) prices.push(num);
                if (prices.length >= 2) break;
            }
        }
        if (prices.length > 0) estLow = prices[0];
        if (prices.length > 1) estHigh = prices[1];
    }

    // Lot State Detection
    const tailMarkers = ['Frequently Asked Questions', 'Compare auctions', 'Popular models', '4 steps to purchasing', 'Help Center'];
    let headText = fullText;
    let minTailIdx = -1;
    for (const marker of tailMarkers) {
        const idx = fullText.indexOf(marker);
        if (idx !== -1 && (minTailIdx === -1 || idx < minTailIdx)) {
            minTailIdx = idx;
        }
    }
    if (minTailIdx !== -1) {
        headText = fullText.substring(0, minTailIdx);
    }

    let lot_state = 'unknown';
    const isFinished = /Final auction ended/i.test(headText) || /Final bid/i.test(headText) || (/Live auction/i.test(headText) && /^Ended$/im.test(headText));
    const isActive = /Current Bid/i.test(headText) && /Time left/i.test(headText) && !isFinished;
    
    if (isFinished) lot_state = 'finished';
    else if (isActive) lot_state = 'active';

    // Finished Lot Extraction
    let listed_price = null;
    let sale_date = null;
    let listed_currency = null;

    if (lot_state === 'finished' || lot_state === 'unknown') {
        listed_price = extractFinalSalePrice(headText);
    }

    // Active-lot date: the live page's own displayed date/time has no year
    // ("Friday, 4 September, 14:30"), so parseAuctionDate() correctly rejects it rather
    // than guessing a year (AGENTS.md 4.12). Instead read the machine-readable countdown
    // offset from #time-left and compute an absolute instant from it. Per the element's own
    // tooltip, this is when BIDDING CLOSES, ~30 minutes before the live auction itself
    // starts - it is stored as sale_date because that is the only date field available, but
    // it is not the auction start time. Stored as an ISO string, which parseAuctionDate()
    // already parses via `new Date(string)` - no second parser, no change to that helper.
    if (lot_state === 'active') {
        const timeLeftEl = document.getElementById('time-left');
        const totalSeconds = timeLeftEl ? parseInt(timeLeftEl.getAttribute('data-initial-total-seconds'), 10) : NaN;
        if (timeLeftEl && !isNaN(totalSeconds)) {
            sale_date = new Date(Date.now() + totalSeconds * 1000).toISOString();
        }
        // If #time-left or the attribute is absent, sale_date stays null - absence is not
        // violation (AGENTS.md 6), and this must never fall back to a guessed date.
    }

    let sale_date_unavailable = false;
    if (lot_state === 'finished') {
        current_bid_usd = null;
        sale_date = null; // Sale date is not available on finished bid.cars lots
        sale_date_unavailable = true;
        if (listed_price !== null) {
            listed_currency = 'USD';
        } else {
            listed_currency = 'USD';
        }
    }

    const { history: auctionHistoryArray, found: hasSalesTable } = extractSalesHistory();
    let auction_appearance_count = hasSalesTable ? auctionHistoryArray.length : null;
    let sale_confirmed = null;

    if (auctionHistoryArray.length > 0) {
        const sorted = [...auctionHistoryArray].sort((a, b) => {
            const d1 = a.auction_date ? new Date(a.auction_date).getTime() : 0;
            const d2 = b.auction_date ? new Date(b.auction_date).getTime() : 0;
            return d1 - d2;
        });
        const latest = sorted[sorted.length - 1];
        if (latest && latest.status) {
            const s = latest.status.toLowerCase();
            if (/(not sold|no sale|withdrawn|cancell?ed|pending)/.test(s)) {
                sale_confirmed = false;
            } else if (/(sold|sale)/.test(s) && !s.includes('not')) {
                sale_confirmed = true;
            }
        }
    }

    const payload = {
        source_platform: 'bidcars',
        source_url: window.location.href,
        raw_dom_snapshot: fullText.substring(0, 50000),
        captured_fields: {
            vin: vin,
            year: year,
            make: normalized.make,
            model: normalized.model,
            trim: trim,
            lot_number: lot_number,
            source_auction_platform: source_auction_platform,
            seller_type: extractBidcarsField(fullText, 'Seller'),
            title_type: extractBidcarsField(fullText, 'Sale Document'),
            damage_type: extractBidcarsField(fullText, 'Primary damage'),
            secondary_damage: extractBidcarsField(fullText, 'Secondary damage'),
            mileage_miles: mileage_miles,
            highlights: highlights,
            runs_and_drives: runs_and_drives,
            has_key: has_key,
            estimated_retail_value_usd: estimated_retail_value_usd,
            body_style: extractBidcarsField(fullText, 'Body Style'),
            exterior_color: extractBidcarsField(fullText, 'Exterior color'),
            engine_type: engine_type,
            cylinders: cylinders,
            horsepower: horsepower,
            transmission: extractBidcarsField(fullText, 'Transmission'),
            fuel: extractBidcarsField(fullText, 'Fuel Type'),
            drivetrain: drivetrain,
            location: extractBidcarsField(fullText, 'Location'),
            current_bid_usd: current_bid_usd,
            listed_price: listed_price,
            listed_currency: listed_currency,
            sale_date: sale_date,
            estimated_cost_low_usd: estLow,
            estimated_cost_high_usd: estHigh,
            sale_confirmed: sale_confirmed,
            auction_appearance_count: auction_appearance_count
        },
        lot_state: lot_state,
        sale_date_unavailable: sale_date_unavailable,
        image_urls: [],
        auction_history: auctionHistoryArray
    };

    if (location.search.includes('archived=true')) {
        payload.captured_fields.archived = true;
    }

    // Images logic
    const rx = /https?:\/\/(images\.bid\.cars|pluto\.bid\.car)\/[^\s"'<>\\]+\.jpg/gi;
    const found = new Set();
    document.querySelectorAll('*').forEach(el => {
      for (const a of el.attributes || []) {
        const m = (a.value || '').match(rx);
        if (m) m.forEach(u => found.add(u));
      }
      if (el.style && el.style.backgroundImage) {
        const m = el.style.backgroundImage.match(rx);
        if (m) m.forEach(u => found.add(u));
      }
    });
    // On an active lot the gallery carousel is empty at capture time - it fills in via the
    // page's own lazy-load, which the DOM walk above runs before. The same pluto URLs are
    // present at load inside inline <script> tags (preloadGalleryImage(...) calls), so scan
    // those too. This is additive to the DOM walk, not a replacement - archived lots already
    // work via the DOM walk and must keep doing so. Deliberately not scrolling/clicking to
    // force the lazy-load: that would be timing-dependent; script text is present at load.
    document.querySelectorAll('script').forEach(s => {
      const text = s.textContent || '';
      const m = text.match(rx);
      if (m) m.forEach(u => found.add(u));
    });
    const allUrls = [...found];
    
    // Filter by VIN
    let vinUrls = allUrls.filter(u => u.includes(vin));
    if (vinUrls.length === 0) vinUrls = allUrls; // fallback

    // Dedupe prefer pluto.bid.car over images.bid.cars. Both domains can carry the same
    // image on an active lot (confirmed 4 Sep 2026: images.bid.cars fetches from page
    // context fail with a CORS policy block - no Access-Control-Allow-Origin header on the
    // response - while the same image at pluto.bid.car fetches successfully). pluto.bid.car
    // is also the only domain observed on archived lots, where capture already works.
    const imageMap = new Map(); // key -> url
    vinUrls.forEach(u => {
        const match = u.match(/-(\d+)\.jpg$/i);
        if (match) {
            const idx = parseInt(match[1], 10);
            if (!imageMap.has(idx) || u.includes('pluto.bid.car')) {
                imageMap.set(idx, u);
            }
        }
    });

    const sortedIndices = Array.from(imageMap.keys()).sort((a, b) => a - b);
    payload.image_urls = sortedIndices.map(i => imageMap.get(i));

    const missing = [];
    if (!payload.captured_fields.vin) missing.push("vin");
    if (!payload.captured_fields.make) missing.push("make");
    if (!payload.captured_fields.model) missing.push("model");
    if (!payload.captured_fields.lot_number) missing.push("lot_number");
    if (lot_state === 'unknown') missing.push("lot_state");
  
    if (missing.length > 0) {
        payload.captured_fields._missing_fields = missing;
    }
    
    if (!payload.captured_fields.make) payload.captured_fields.make = "Unknown";
    if (!payload.captured_fields.model) payload.captured_fields.model = "Unknown";

    return payload;
}

async function fetchImagesAsBase64(urls) {
  const out = [];
  let totalBytes = 0;
  let truncated = false;
  
  console.log('[AutoData] fetching images, count:', urls.length);

  for (let i = 0; i < Math.min(urls.length, 12); i++) {
    try {
      let res;
      try {
        res = await fetch(urls[i], { credentials: 'omit', mode: 'cors' });
      } catch (e) {
        res = { ok: false };
      }
      
      if (!res.ok) { 
        res = await fetch(urls[i]);
      }
      
      if (!res.ok) { out.push(null); continue; }
      
      const blob = await res.blob();
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      
      if (totalBytes + b64.length > 20 * 1024 * 1024 && i >= 8) {
        truncated = true;
        break;
      }
      
      out.push(b64);
      totalBytes += b64.length;
    } catch (_e) { out.push(null); }
  }
  console.log('[AutoData] fetched blobs:', out.filter(Boolean).length, 'of', out.length);
  return { blobs: out, truncated };
}

async function captureCurrentLotAsync() {
    const payload = captureCurrentLot();
    if (payload.image_urls.length > 0) {
        const res = await fetchImagesAsBase64(payload.image_urls);
        payload.image_blobs = res.blobs;
        if (res.truncated) {
            payload.image_blobs_truncated = true;
        }
    }
    console.log('[AutoData] payload has image_blobs:', Array.isArray(payload.image_blobs), payload.image_blobs?.length);
    return payload;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "checkLotPage") {
        isBidcarsLotPageWithRetry().then(check => {
            sendResponse({
                isLotPage: check,
                platform: check ? 'bidcars' : null,
                url: window.location.href
            });
        });
        return true;
    }
    
    if (request.action === "captureCurrentLot") {
        captureCurrentLotAsync().then(data => {
            sendResponse({ success: true, data });
        }).catch(e => {
            sendResponse({ success: false, error: e.message || String(e) });
        });
        return true;
    }
});

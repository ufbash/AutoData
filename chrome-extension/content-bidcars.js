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

function isBidcarsLotPage() {
    const isLotUrl = /^\/en\/lot\//.test(location.pathname);
    const bodyText = document.body.innerText || '';
    return isLotUrl && /[A-HJ-NPR-Z0-9]{17}/.test(bodyText) && bodyText.includes('Sale Document');
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
            if (parts[0].trim() === '1') source_auction_platform = 'copart';
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
            estimated_cost_high_usd: estHigh
        },
        lot_state: lot_state,
        sale_date_unavailable: sale_date_unavailable,
        image_urls: []
    };

    // Images logic (preserve existing)
    const elements = document.querySelectorAll('*');
    const allUrls = [];
    
    elements.forEach(el => {
        ['src', 'srcset', 'data-src', 'href'].forEach(attr => {
            const val = el.getAttribute(attr) || el[attr];
            if (typeof val === 'string') {
                const urls = val.split(/[,\s]+/).filter(u => /https?:\/\/(images\.bid\.cars|pluto\.bid\.car)\/[^\s"'<>]+\.jpg/i.test(u));
                allUrls.push(...urls);
            }
        });
    });
    
    // Filter by VIN
    let vinUrls = allUrls.filter(u => u.includes(vin));
    if (vinUrls.length === 0) vinUrls = allUrls; // fallback

    // Dedupe prefer images.bid.cars over pluto.bid.car
    const imageMap = new Map(); // key -> url
    vinUrls.forEach(u => {
        const match = u.match(/-(\d+)\.jpg$/i);
        if (match) {
            const idx = parseInt(match[1], 10);
            if (!imageMap.has(idx) || u.includes('images.bid.cars')) {
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "checkLotPage") {
        const check = isBidcarsLotPage();
        sendResponse({
            isLotPage: check,
            platform: check ? 'bidcars' : null,
            url: window.location.href
        });
        return true;
    }
    
    if (request.action === "captureCurrentLot") {
        try {
            const data = captureCurrentLot();
            sendResponse({ success: true, data });
        } catch (e) {
            sendResponse({ success: false, error: e.message || String(e) });
        }
        return true;
    }
});

const BIDCARS_BARE_LABELS = [
  'Loss', 'Primary damage', 'Secondary damage', 'Odometer', 'Start code',
  'Key', 'ACV / ERC', 'Body Style', 'Exterior color', 'Engine',
  'Transmission', 'Fuel Type', 'Drive Type', 'Lot', 'VIN', 'Seller',
  'Sale Document', 'Current Bid'
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
    // Treat dash as null
    if (v === '-' || v === '–' || v === '—') return null;
    return v;
  }
  return null;
}

function parseEngineString(s) {
  if (!s) return { engine_type: null, cylinders: null, horsepower: null };
  const parts = s.split(',').map(p => p.trim());

  let displacement = null, config = null, hp = null;
  for (const p of parts) {
    if (/^\d+\.\d+L$/i.test(p)) displacement = p.toUpperCase();
    else if (/^[IVHWB]\d+$/i.test(p)) config = p.toUpperCase();
    else if (/^\d+HP$/i.test(p)) hp = parseInt(p, 10);
  }

  const engine_type = [displacement, config].filter(Boolean).join(' ') || null;

  let cylinders = null;
  if (config) {
    const m = config.match(/\d+$/);
    if (m) cylinders = parseInt(m[0], 10);
  }

  return { engine_type, cylinders, horsepower: hp };
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
            if (!isNaN(num)) estimated_retail_value_usd = num;
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
            estimated_cost_low_usd: estLow,
            estimated_cost_high_usd: estHigh
        },
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

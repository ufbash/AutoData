const ALL_LABELS = [
  'VIN', 'Lot number', 'Title code', 'Odometer', 'Primary damage',
  'Secondary damage', 'Estimated retail value', 'Current bid', 'Cylinders',
  'Color', 'Engine type', 'Transmission', 'Vehicle type', 'Drivetrain',
  'Fuel', 'Body style', 'Has key', 'Sale date', 'Seller', 'Sale name',
  'Location', 'Sublot location', 'Highlights', 'Notes', 'Lane/Item'
];

function extractField(text, label, opts = { multiline: false }) {
  const lines = text.split('\n').map(l => l.trim());

  // INLINE format unchanged
  for (const line of lines) {
    if (line.startsWith(label + ':') && line.length > label.length + 1) {
      return line.substring(label.length + 1).trim();
    }
  }

  // BLOCK format — find label line
  const idx = lines.findIndex(l => l === label + ':');
  if (idx === -1) return null;

  if (!opts.multiline) {
    // Single-line: take next non-empty line, period
    for (let j = idx + 1; j < lines.length; j++) {
      if (lines[j] !== '') return lines[j].trim() || null;
    }
    return null;
  }

  // Multi-line: existing behavior — collect until next known label or 4-line cap
  const valueLines = [];
  for (let j = idx + 1; j < lines.length; j++) {
    const next = lines[j];
    if (next === '') continue;
    const isNextLabel = ALL_LABELS.some(L =>
      next === L + ':' || next.startsWith(L + ':')
    );
    if (isNextLabel) break;
    valueLines.push(next);
    if (valueLines.length >= 4) break;
  }
  return valueLines.join(' ').trim() || null;
}

function extractCurrentBid(text) {
  const lines = text.split('\n').map(l => l.trim());
  const idx = lines.findIndex(l => /^current bid$/i.test(l));
  if (idx === -1) return null;

  for (let j = idx + 1; j < Math.min(lines.length, idx + 6); j++) {
    if (lines[j] === '') continue;
    if (/^\$[\d,]+(\.\d{2})?$/.test(lines[j])) {
      const num = parseFloat(lines[j].replace(/[$,]/g, ''));
      return isNaN(num) ? null : num;
    }
    // Stop if we've crossed into another section
    if (/^(Auction countdown|Bid now|Eligibility|Shipping|Bidding increment|Starting bid)/i.test(lines[j])) break;
  }
  return null;
}

function extractOdometerBrand(text) {
  const lines = text.split('\n').map(l => l.trim());
  const idx = lines.findIndex(l => l === 'Odometer:');
  if (idx === -1) return null;
  let foundMileage = false;
  for (let j = idx + 1; j < Math.min(lines.length, idx + 4); j++) {
    if (lines[j] === '') continue;
    if (!foundMileage) { foundMileage = true; continue; }
    if (/^(Actual|Not Actual|Exempt)$/i.test(lines[j])) {
      const v = lines[j].toLowerCase();
      if (v === 'actual') return 'Actual';
      if (v === 'not actual') return 'Not Actual';
      if (v === 'exempt') return 'Exempt';
    }
    break;
  }
  return null;
}

function isCopartLotPage() {
    const isLotUrl = /^\/lot\/\d+/.test(location.pathname);
    const bodyText = document.body.innerText || '';
    return isLotUrl && bodyText.includes('VIN:') && bodyText.includes('Lot number:');
}

function extractYearMakeModel(text) {
    const lines = text.split('\n').map(l => l.trim());
    const regex = /^(19|20)\d{2}\s+\S+/;
    for (const line of lines) {
        if (regex.test(line)) {
            const tokens = line.split(/\s+/);
            const year = parseInt(tokens[0], 10);
            const make = tokens[1];
            const model = tokens.slice(2).join(' ');
            return { year, make, model };
        }
    }
    
    // URL fallback
    const match = location.pathname.match(/\/lot\/\d+\/(.+)/);
    if (match && match[1]) {
        const slug = match[1];
        if (slug.startsWith('salvage-')) {
            const tokens = slug.split('-');
            const yearIndex = tokens.findIndex(t => /^(19|20)\d{2}$/.test(t));
            if (yearIndex !== -1 && tokens.length > yearIndex + 3) {
                const year = parseInt(tokens[yearIndex], 10);
                const make = tokens[yearIndex + 1];
                const modelTokens = tokens.slice(yearIndex + 2, tokens.length - 2);
                return { year, make, model: modelTokens.join(' ') };
            }
        }
    }
    return { year: null, make: null, model: null };
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

    let normMake = toTitleCase(make);
    let normModel = toTitleCase(model);
    
    return { make: normMake, model: normModel };
}

function captureCurrentLot() {
    const fullText = document.body.innerText || '';
    
    const { year, make, model } = extractYearMakeModel(fullText);
    const normalized = normalizeMakeModel(make, model);
    
    let vin = extractField(fullText, 'VIN');
    if (vin) {
        vin = vin.toUpperCase();
        if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) vin = null;
    }
    
    let lot_number = extractField(fullText, 'Lot number');
    if (lot_number) {
        lot_number = lot_number.replace(/\D/g, '');
    }
    
    let mileage_miles = extractField(fullText, 'Odometer');
    if (mileage_miles) {
        const firstToken = mileage_miles.split(' ')[0];
        mileage_miles = parseInt(firstToken.replace(/\D/g, ''), 10);
        if (isNaN(mileage_miles)) mileage_miles = null;
    }
    
    let sec_damage = extractField(fullText, 'Secondary damage');
    if (sec_damage === '—' || sec_damage === '') sec_damage = null;
    
    let erv = extractField(fullText, 'Estimated retail value');
    if (erv) erv = parseFloat(erv.replace(/[$\s,A-Za-z]/g, ''));
    if (isNaN(erv)) erv = null;

    let current_bid = extractCurrentBid(fullText);
    
    let cylinders = extractField(fullText, 'Cylinders');
    if (cylinders) {
        cylinders = parseInt(cylinders, 10);
        if (isNaN(cylinders)) cylinders = null;
    }

    let highlights = extractField(fullText, 'Highlights');
    if (highlights === 'There are no highlights') highlights = null;

    let runs_and_drives = null;
    if (highlights && highlights.toLowerCase().includes('run and drive')) {
        runs_and_drives = true;
    }
    
    let engine_starts = null;
    if (/Copart verified that the engine starts/i.test(fullText)) {
        engine_starts = true;
    }
    
    let trans_engages = null;
    if (/Copart verified that the transmission engages/i.test(fullText)) {
        trans_engages = true;
    }

    const payload = {
        source_platform: 'copart',
        source_url: window.location.href,
        raw_dom_snapshot: fullText.substring(0, 50000),
        captured_fields: {
            vin: vin,
            year: year,
            make: normalized.make,
            model: normalized.model,
            lot_number: lot_number,
            title_type: extractField(fullText, 'Title code', { multiline: true }),
            mileage_miles: mileage_miles,
            damage_type: extractField(fullText, 'Primary damage'),
            secondary_damage: sec_damage,
            estimated_retail_value_usd: erv,
            current_bid_usd: current_bid,
            cylinders: cylinders,
            exterior_color: extractField(fullText, 'Color'),
            engine_type: extractField(fullText, 'Engine type'),
            transmission: extractField(fullText, 'Transmission'),
            drivetrain: extractField(fullText, 'Drivetrain'),
            fuel: extractField(fullText, 'Fuel'),
            body_style: extractField(fullText, 'Body style'),
            has_key: extractField(fullText, 'Has key'),
            seller: extractField(fullText, 'Seller'),
            sale_date: extractField(fullText, 'Sale date'),
            highlights: highlights,
            location: extractField(fullText, 'Location'),
            runs_and_drives: runs_and_drives,
            engine_starts: engine_starts,
            transmission_engages: trans_engages,
            odometer_brand: extractOdometerBrand(fullText),
        },
        image_urls: []
    };

    // Images logic
    const elements = document.querySelectorAll('*');
    const uniqueUrls = new Set(); 
    
    elements.forEach(el => {
        ['src', 'currentSrc', 'srcset', 'data-src', 'href'].forEach(attr => {
            const val = el.getAttribute(attr) || el[attr];
            if (typeof val === 'string') {
                const urls = val.split(/[,\s]+/).filter(u => u.includes('cs.copart.com'));
                urls.forEach(u => {
                    if (u.includes('cs.copart.com') && /\.jpg$/i.test(u) && !u.includes('_vthb')) {
                        let finalUrl = null;
                        if (/_thb\.jpg$/i.test(u)) {
                            finalUrl = u.replace(/_thb\.jpg$/i, '_ful.jpg');
                        } else if (/_ful\.jpg$/i.test(u)) {
                            finalUrl = u;
                        }
                        if (finalUrl) uniqueUrls.add(finalUrl);
                    }
                });
            }
        });
    });

    payload.image_urls = Array.from(uniqueUrls);

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
        sendResponse({
            isLotPage: isCopartLotPage(),
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

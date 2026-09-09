// PROMPT 22 Phase 5 — IAAI content script (B1). Mirrors content-copart.js's structure and
// message contract; does NOT copy its text-line-scanning extraction approach, because IAAI's
// real DOM (confirmed via recon against real live lot pages, not assumed) exposes labels and
// values as a clean, consistent element pair: <li class="data-list__item"><span
// class="data-list__label">Label:</span>(<span>|<div>) class="data-list__value">Value</...>
// </li> — reading that structurally is more reliable than Copart's line-based text scan.
//
// lot_state / current_bid_usd are DELIBERATELY UNFINISHED below — see the block marked
// "PENDING AUTHENTICATED RECON". IAAI's "Bid Information" section is login-gated on every
// lot recon'd for this build (public pages show "You are not logged in..." instead of a real
// bid figure or sold/active state), and current_bid_usd-as-liveness-proxy has already caused
// three separate real bugs on this project (AGENTS.md S4.1). Writing this block from
// assumption is exactly what AGENTS.md S4.6 ("never guess at DOM structure") exists to
// prevent — it is being completed once real logged-in-session HTML has been reviewed, not
// guessed now to make Phase 5 look more finished than it is.

function extractField(labelText) {
  const labels = Array.from(document.querySelectorAll('.data-list__label'));
  const labelEl = labels.find(l => l.textContent.trim() === labelText);
  if (!labelEl) return null;
  // Some fields (confirmed live: "Primary Damage:") have a hidden <input> (e.g.
  // #hdnPDVideo_Ind, a damage-video-exists flag) inserted between the label and its actual
  // value span - a naive nextElementSibling grabs the hidden input instead of the value and
  // silently returns null forever. Walk forward until an actual .data-list__value element is
  // found, rather than assuming the immediate sibling is always it.
  let sib = labelEl.nextElementSibling;
  while (sib && !sib.classList.contains('data-list__value')) {
    sib = sib.nextElementSibling;
  }
  if (!sib) return null;
  // "Live Auction:"-style values are a <div> with several child <span>s and bare text nodes
  // (day/month/date/time/zone) rather than one flat string - .textContent already concatenates
  // all of that, so a single whitespace-collapse handles both the <span> and <div> value shapes.
  const raw = sib.textContent || '';
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed === '' ? null : collapsed;
}

function isIaaiLotPage() {
  const isLotUrl = /^\/VehicleDetail\/\d+/.test(location.pathname);
  if (!isLotUrl) return false;
  // Confirmed structural marker on every real lot page recon'd - a page that hasn't rendered
  // the vehicle-info list yet (or a 404/"DetailsNotFoundView", seen directly this session on a
  // bad lot id) won't have this element at all.
  return document.querySelectorAll('.data-list__label').length > 0;
}

function checkReady() {
  return isIaaiLotPage() && extractField('Stock #:') !== null;
}

async function waitForIaaiReady() {
  let elapsed = 0;
  while (elapsed < 8000) {
    if (checkReady()) return true;
    await new Promise(r => setTimeout(r, 300));
    elapsed += 300;
  }
  return false;
}

// VIN is confirmed MASKED on every public (unauthenticated) lot page recon'd this session
// (e.g. "4T1BF3EK5BU******"). The existing 17-char VIN regex already rejects a masked value
// (it contains "*", not a valid VIN character) and correctly falls through to null - this is
// not a special case to add, it is the existing Copart-pattern validation doing the right
// thing by construction. Whether a logged-in bidder session unmasks it is unverified and is
// part of the same pending-recon question as the bid-state block below.
function extractVin() {
  let raw = extractField('VIN (Status):') || extractField('VIN:');
  if (!raw) return null;
  // "VIN (Status):" value is like "4T1BF3EK5BU****** (OK)" - strip the trailing status paren.
  const vin = raw.replace(/\s*\([^)]*\)\s*$/, '').trim().toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}

function extractYearMakeModelSeries() {
  // "Model:" and "Series:" are separate fields in IAAI's own data (confirmed: "Model: CAMRY",
  // "Series: LE") - Series maps to this project's "trim" concept. Year isn't a labelled field
  // on its own; it's the leading token of the page's <h1> title ("2011 TOYOTA CAMRY LE").
  const heading = document.querySelector('h1');
  const headingText = heading ? heading.textContent.trim() : '';
  const yearMatch = headingText.match(/^(19|20)\d{2}/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
  const make = headingText.replace(/^(19|20)\d{2}\s+/, '').split(/\s+/)[0] || null;
  const model = extractField('Model:');
  const series = extractField('Series:');
  return { year, make, model, series };
}

function normalizeMakeModel(make, model) {
  const toTitleCase = (str) => {
    if (!str) return null;
    return str.split(' ').map(word => {
      if (word.length <= 4 && /^[A-Z0-9]+$/i.test(word)) return word.toUpperCase();
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
  };
  return { make: toTitleCase(make), model: toTitleCase(model) };
}

function captureCurrentLot() {
  const { year, make, model, series } = extractYearMakeModelSeries();
  const normalized = normalizeMakeModel(make, model);

  let mileage_miles = extractField('Odometer:');
  let odometer_brand = null;
  if (mileage_miles) {
    // "336,202 mi (Actual)" - same shape as Copart's odometer field.
    const brandMatch = mileage_miles.match(/\((Actual|Not Actual|Exempt)\)/i);
    if (brandMatch) {
      const v = brandMatch[1].toLowerCase();
      odometer_brand = v === 'actual' ? 'Actual' : v === 'not actual' ? 'Not Actual' : 'Exempt';
    }
    const numMatch = mileage_miles.match(/^([\d,]+)/);
    mileage_miles = numMatch ? parseInt(numMatch[1].replace(/,/g, ''), 10) : null;
    if (isNaN(mileage_miles)) mileage_miles = null;
  }

  // Title/Sale Doc: "CLEAR (North Carolina)" - the state-branded title status. Kept as free
  // text, same messy-by-source-format treatment as Copart's "Title code" (SCHEMA.md S5) -
  // no attempt to normalise it here, that is the E2 resolver's job, not capture's.
  const title_type = extractField('Title/Sale Doc:');

  // sale_date: route the machine-readable close-date field straight through, per instruction -
  // do NOT back-compute against the displayed "Live Auction" text or encode the observed ~1
  // hour gap between them as a formula. #AdjustedCloseDate is a real DOM element present at
  // load (no lazy-load/timing race, unlike bid.cars' active-lot countdown), already in a
  // format `new Date(...)` parses directly ("9/9/2026 12:30:00 PM +00:00") - parseAuctionDate()
  // needs no changes to handle it, and no second parser is being written here.
  const closeDateEl = document.getElementById('AdjustedCloseDate');
  const sale_date = closeDateEl && closeDateEl.value ? closeDateEl.value.trim() : null;

  const payload = {
    source_platform: 'iaai',
    source_url: window.location.href,
    raw_dom_snapshot: (document.body.innerText || '').substring(0, 50000),
    captured_fields: {
      vin: extractVin(),
      year: year,
      make: normalized.make,
      model: normalized.model,
      trim: series,
      lot_number: (extractField('Stock #:') || '').replace(/\D/g, '') || null,
      title_type: title_type,
      mileage_miles: mileage_miles,
      odometer_brand: odometer_brand,
      damage_type: extractField('Primary Damage:'),
      secondary_damage: extractField('Secondary Damage:'),
      cylinders: (() => {
        const c = extractField('Cylinders:');
        const n = c ? parseInt(c, 10) : NaN;
        return isNaN(n) ? null : n;
      })(),
      exterior_color: (extractField('Exterior/Interior:') || '').split('/')[0]?.trim() || null,
      engine_type: extractField('Engine:'),
      transmission: extractField('Transmission:'),
      drivetrain: extractField('Drive Line Type:'),
      fuel: extractField('Fuel Type:'),
      body_style: extractField('Body Style:'),
      has_key: extractField('Key:'),
      seller: extractField('Seller:'),
      sale_date: sale_date,
      location: extractField('Selling Branch:'),
      // "Actual Cash Value: $3,250 USD" - IAAI's name for the same insurance-valuation concept
      // Copart calls "Estimated retail value". Confirmed present on real lots recon'd; only
      // parsed when the currency is explicitly USD (every ACV seen was, but this project's
      // Prompt 22 currency guard finding applies equally here - never assume a $ figure is
      // USD without the document/page actually saying so).
      estimated_retail_value_usd: (() => {
        const raw = extractField('Actual Cash Value:');
        if (!raw || !/USD/i.test(raw)) return null;
        const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
        return isNaN(n) ? null : n;
      })(),
      highlights: null,
      runs_and_drives: null,
      engine_starts: null,
      transmission_engages: null,

      // --- PENDING AUTHENTICATED RECON — do not fill from assumption ---
      // IAAI's "Bid Information" section renders "You are not logged in..." on every public
      // lot page recon'd for this build; the real current-bid figure and sold/active wording
      // have not been seen. Left null/unknown until reviewed against real logged-in-session
      // HTML (an active lot and a finished/sold lot), per the standing rule that
      // current_bid_usd must never be guessed at as a liveness proxy (AGENTS.md S4.1 - three
      // prior bugs on this exact field).
      current_bid_usd: null,
    },
    lot_state: 'unknown', // see PENDING AUTHENTICATED RECON above - never defaulted to 'active'
    image_urls: [],
  };

  // Images: confirmed NOT lazy-loaded - real <img src> present at page load, unlike bid.cars.
  // Full resolution is obtained by rewriting width/height to the RW/H values already embedded
  // in the same imageKeys query param (verified live: a rewritten URL loaded at its full
  // 2576x1932 natural size) - the IAAI equivalent of Copart's _thb -> _ful filename rewrite,
  // done via query-string rewrite instead of filename rewrite.
  const uniqueUrls = new Set();
  document.querySelectorAll('img[src*="vis.iaai.com/resizer"]').forEach(img => {
    const src = img.getAttribute('src');
    const dims = src.match(/RW(\d+)~H(\d+)/);
    if (!dims) return;
    const [, rw, h] = dims;
    const fullUrl = src.replace(/width=\d+&height=\d+/, `width=${rw}&height=${h}`);
    uniqueUrls.add(fullUrl);
  });
  payload.image_urls = Array.from(uniqueUrls);

  const missing = [];
  if (!payload.captured_fields.vin) missing.push('vin');
  if (!payload.captured_fields.make) missing.push('make');
  if (!payload.captured_fields.model) missing.push('model');
  if (!payload.captured_fields.lot_number) missing.push('lot_number');
  if (missing.length > 0) payload.captured_fields._missing_fields = missing;

  if (!payload.captured_fields.make) payload.captured_fields.make = 'Unknown';
  if (!payload.captured_fields.model) payload.captured_fields.model = 'Unknown';

  return payload;
}

async function captureCurrentLotAsync() {
  const isReady = await waitForIaaiReady();
  const payload = captureCurrentLot();
  if (!isReady) {
    payload.page_not_fully_loaded = true;
    if (!payload.captured_fields._missing_fields) payload.captured_fields._missing_fields = [];
    payload.captured_fields._missing_fields.push('page_readiness');
  }
  return payload;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'checkLotPage') {
    sendResponse({ isLotPage: isIaaiLotPage(), url: window.location.href });
    return true;
  }

  if (request.action === 'captureCurrentLot') {
    captureCurrentLotAsync().then(data => {
      sendResponse({ success: true, data });
    }).catch(e => {
      sendResponse({ success: false, error: e.message || String(e) });
    });
    return true;
  }
});

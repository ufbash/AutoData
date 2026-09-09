// PROMPT 22 Phase 5/6 — IAAI content script (B1).
//
// Superseded design note: an earlier version of this file scraped the rendered
// .data-list__label / .data-list__value DOM pairs (mirroring content-copart.js's approach).
// That version is gone. Real recon against real logged-in-session HTML (pasted by Bashir,
// a genuine active lot, "IAAI HTML.rtf") found a far better source already on every lot
// page: a single <script type="application/json" id="ProductDetailsVM"> element carrying
// the exact same data the page renders from, as clean typed JSON - no DOM traversal, no
// hidden-input-between-label-and-value trap (a real bug this file's first version hit and
// fixed against a live page before this rewrite superseded the whole approach), no
// duplicate-label-picks-the-wrong-one risk (the DOM literally has 3-4 near-identical copies
// of "Stock #:"/"Live Auction:" for different responsive layouts; more than one had an empty
// "Seller:" - the JSON's saleInformation.Seller is unambiguous).
//
// This JSON blob is present and well-formed whether or not the viewer is logged in -
// confirmed directly (same lot, both states): logged out, `attributes.VIN` IS the masked
// string and `decimalHighBidAmount` is "0"; logged in, `attributes.VIN` is the real 17-char
// VIN and `decimalHighBidAmount` is the real current bid. The existing VIN-format regex
// validation (same one content-copart.js uses) already rejects the masked form on its own -
// no login-state branching needed in this file at all.
//
// lot_state is 'active' unconditionally on a successful capture. This is not an assumption -
// Bashir confirmed directly that a sold/closed IAAI lot's URL redirects to the search page
// rather than rendering a VehicleDetail page at all, so this content script (matched only on
// /VehicleDetail/*) structurally never runs against a finished lot. There is no 'finished'
// state for IAAI to detect, the same way Copart has no Sales History panel (B2) - a platform
// fact, not a gap in this parser. See docs/SOLVED.md and SCHEMA.md for the fuller writeup.

function getProductDetailsVM() {
  const el = document.getElementById('ProductDetailsVM');
  if (!el || !el.textContent) return null;
  try {
    return JSON.parse(el.textContent);
  } catch (e) {
    return null;
  }
}

function isIaaiLotPage() {
  // Case-insensitive on purpose: a real lot URL was observed as
  // "/vehicledetail/46324658~US" (lowercase) from one navigation path and
  // "/VehicleDetail/46566883~US" from another (search-result click) - the manifest's
  // content_scripts "matches" glob is case-sensitive with no case-insensitive option, which
  // is exactly why the match pattern itself was broadened to the whole iaai.com host instead
  // of trying to enumerate every casing IAAI's routing might produce. This regex is the real
  // gate now, and it does not make the same assumption.
  if (!/^\/vehicledetail\/\d+/i.test(location.pathname)) return false;
  return getProductDetailsVM() !== null;
}

function checkReady() {
  const vm = getProductDetailsVM();
  return !!(vm && vm.inventoryView && vm.inventoryView.attributes && vm.inventoryView.attributes.StockNumber);
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

function extractVin(attrs) {
  const raw = attrs.VIN;
  if (!raw) return null;
  const vin = String(raw).trim().toUpperCase();
  // Rejects the masked form ("4T1BF3EK5BU******") by construction - "*" is not a valid VIN
  // character. This is the ONLY VIN-unmasking logic needed; it works identically whether the
  // viewer is logged in (real VIN, passes) or not (masked VIN, fails, correctly null).
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}

function toLookup(vm) {
  // vehicleInformation / vehicleDescription / saleInformation are each a {key, value, order}
  // array of the SAME human-readable strings the page itself renders (confirmed identical to
  // the visible DOM text on the pasted real lot, e.g. "TitleSaleDoc": "SALVAGE (California)").
  // Merged into one lookup since no key collides in practice; a later section's value would
  // win over an earlier one only for the handful of keys both carry (VINStatus,
  // SellingBranch), which are identical in both anyway.
  const iv = vm.inventoryView;
  const map = {};
  for (const section of ['vehicleInformation', 'vehicleDescription', 'saleInformation']) {
    const values = iv[section] && iv[section].$values;
    if (!Array.isArray(values)) continue;
    for (const item of values) {
      if (item && item.key) map[item.key] = item.value;
    }
  }
  return map;
}

function captureCurrentLot() {
  const vm = getProductDetailsVM();
  const attrs = vm.inventoryView.attributes;
  const lookup = toLookup(vm);
  const prebid = vm.auctionInformation.prebidInformation;

  const year = attrs.Year ? parseInt(attrs.Year, 10) : null;

  let mileage_miles = attrs.ODOValue ? parseInt(attrs.ODOValue, 10) : null;
  if (isNaN(mileage_miles)) mileage_miles = null;
  const odoBrandRaw = (attrs.ODOBrand || '').toLowerCase();
  const odometer_brand = odoBrandRaw === 'actual' ? 'Actual' : odoBrandRaw === 'not actual' ? 'Not Actual' : odoBrandRaw === 'exempt' ? 'Exempt' : null;

  let cylinders = attrs.Cylinders ? parseInt(attrs.Cylinders, 10) : null;
  if (isNaN(cylinders)) cylinders = null;

  // "$36,945 USD" - only parsed when the string explicitly says USD (the currency guard
  // established in PROMPT_22 Stage 1 applies here too: never assume a $ figure is USD without
  // the source actually saying so - every ACV seen on real IAAI lots has said USD explicitly).
  let estimated_retail_value_usd = null;
  const acv = lookup.ActualCashValue;
  if (acv && /USD/i.test(acv)) {
    const n = parseFloat(acv.replace(/[^0-9.]/g, ''));
    if (!isNaN(n)) estimated_retail_value_usd = n;
  }

  // Real current bid, not a DOM scrape - confirmed against a real logged-in session showing
  // a genuine $25 current bid. `0` is a real value (no bids yet), never coerced to null -
  // same rule AGENTS.md S4.1 already enforces for Copart/bid.cars.
  let current_bid_usd = null;
  if (prebid && prebid.decimalHighBidAmount != null && prebid.decimalHighBidAmount !== '') {
    const n = parseFloat(prebid.decimalHighBidAmount);
    if (!isNaN(n)) current_bid_usd = n;
  }

  // sale_date: the same absolute, machine-readable close-date field this file's first version
  // read from a hidden #AdjustedCloseDate input - now read from the JSON that input's value
  // is itself rendered from. Passed straight through to parseAuctionDate() with no back-
  // calculation against the displayed "Live Auction" time (confirmed ~1hr earlier on every
  // sample checked) - that gap is a display quirk to note, not a formula to encode, per
  // instruction.
  const sale_date = prebid && prebid.adjustedCloseDate ? String(prebid.adjustedCloseDate).trim() : null;

  const payload = {
    source_platform: 'iaai',
    source_url: window.location.href,
    raw_dom_snapshot: (document.body.innerText || '').substring(0, 50000),
    captured_fields: {
      vin: extractVin(attrs),
      year: year,
      make: attrs.Make || null,
      model: attrs.Model || null,
      trim: attrs.Series || null,
      lot_number: attrs.StockNumber || null,
      title_type: lookup.TitleSaleDoc || null,
      mileage_miles: mileage_miles,
      odometer_brand: odometer_brand,
      damage_type: lookup.PrimaryDamage || null,
      secondary_damage: lookup.SecondaryDamage || null,
      cylinders: cylinders,
      exterior_color: attrs.ExteriorColor || null,
      engine_type: lookup.Engine || null,
      transmission: lookup.Transmission || null,
      drivetrain: lookup.DriveLineType || null,
      fuel: lookup.FuelType || null,
      body_style: lookup.BodyStyle || null,
      has_key: lookup.KeySlashFob || null,
      seller: lookup.Seller || null,
      seller_type: lookup.SellerType || null,
      sale_date: sale_date,
      location: lookup.SellingBranch || null,
      estimated_retail_value_usd: estimated_retail_value_usd,
      highlights: null,
      runs_and_drives: lookup.StartCode === 'Run & Drive' ? true : null,
      engine_starts: null,
      transmission_engages: null,
      current_bid_usd: current_bid_usd,
    },
    // See the file header - this is a confirmed platform fact (sold lots redirect away
    // before this script ever runs), not a default guessed for convenience.
    lot_state: 'active',
    image_urls: [],
  };

  // Images: sourced from the same JSON's imageDimensions.keys array rather than scraping
  // rendered <img> tags - confirmed to return MORE images than are in the visible thumbnail
  // strip at load (18 keys in the JSON vs 11 rendered <img> tags on one real lot checked),
  // and each entry already carries its own real width/height (RW/H), so no filename/query
  // rewrite guesswork is needed - the resizer URL is built directly at full resolution.
  const imageKeys = vm.inventoryView.imageDimensions && vm.inventoryView.imageDimensions.keys && vm.inventoryView.imageDimensions.keys.$values;
  if (Array.isArray(imageKeys)) {
    payload.image_urls = imageKeys
      .filter(k => k && k.k && k.w && k.h)
      .map(k => `https://vis.iaai.com/resizer?imageKeys=${k.k}&width=${k.w}&height=${k.h}`);
  }

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
  if (!isReady) {
    return {
      source_platform: 'iaai',
      source_url: window.location.href,
      captured_fields: { _missing_fields: ['page_readiness'] },
      lot_state: 'unknown',
      image_urls: [],
      page_not_fully_loaded: true,
    };
  }
  return captureCurrentLot();
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

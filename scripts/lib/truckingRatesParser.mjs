// PROMPT 20 Phase 3 — deterministic parser for the vendor trucking-rate spreadsheet.
// No AI: this is a clean grid, and a parser is faster, cheaper, and exactly correct.
//
// Column layout is derived from each sheet's own header row, NOT hardcoded to fixed
// indices. The prompt described COPART's specific layout (container pairs at 3/4, 6/7,
// 9/10, 12/13; RoRo at 16/17, 19/20, 22/23) - but the real November 2025 file's other three
// sheets (IAAI, MANHEIM, ADESSA) have fewer port options and DIFFERENT column positions:
//   IAAI:    container (3,4) (6,7) (9,10) (11,12); roro (13,14) (15,16) (18,19)
//   MANHEIM: container (3,4) (6,7) (9,10);         roro (11,12)
//   ADESSA:  container (3,4) (6,7) (9,10);         roro (11,12) (14,15)
// Hardcoding COPART's indices for every sheet would have silently misread three of the
// four sheets. The general rule that holds across all four: any header cell whose text
// contains "CONTAINER" or "RORO" marks the start of a (port, price) pair at that column
// and the next one - derivePairs() below does this detection per sheet.
//
// Identity columns (0-indexed), consistent across all four sheets:
//   0: state (vertically merged - blank means "same as the last non-blank state above")
//   1: city
//   2: street

// Known port-name inconsistencies observed in the vendor file. Extend this as new vendors
// arrive with their own spelling quirks (PLAN_TRACKER.md debt register) - never silently
// "fix" a name that isn't in this table, since that would be guessing, not normalising.
export const PORT_ALIASES = {
  'JACKSONVILLE YARD': 'JACKSONVILLE',
  'LOS ANGELOS': 'LOS ANGELES', // sic, in the source file
};

export function normalizePort(raw) {
  let s = String(raw).trim().replace(/\s+/g, ' ').toUpperCase();
  if (PORT_ALIASES[s]) s = PORT_ALIASES[s];
  return s;
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

export function parsePrice(raw) {
  if (isBlank(raw)) return { ok: false, reason: 'empty' };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, reason: `not finite: ${raw}` };
    return { ok: true, value: raw };
  }
  const cleaned = String(raw).replace(/[$,]/g, '').trim();
  const n = Number(cleaned);
  if (Number.isNaN(n)) return { ok: false, reason: `non-numeric price: "${raw}"` };
  return { ok: true, value: n };
}

const SHEET_TO_PLATFORM = {
  COPART: 'copart',
  IAAI: 'iaai',
  MANHEIM: 'manheim',
  ADESSA: 'adesa', // sic in the vendor file - the real company is ADESA
  ADESA: 'adesa',
};

export function sheetNameToPlatform(sheetName) {
  return SHEET_TO_PLATFORM[String(sheetName).trim().toUpperCase()] || null;
}

// Derive (port, price) column pairs from a sheet's own header row, rather than assuming
// every sheet shares one fixed layout. A pair is (idx, idx+1) wherever a header cell's
// text contains CONTAINER or RORO.
export function derivePairs(headerRow) {
  const containerPairs = [];
  const roroPairs = [];
  (headerRow || []).forEach((cell, idx) => {
    if (isBlank(cell)) return;
    const label = String(cell).trim().toUpperCase();
    if (label.includes('CONTAINER')) containerPairs.push([idx, idx + 1]);
    else if (label.includes('RORO')) roroPairs.push([idx, idx + 1]);
  });
  return { containerPairs, roroPairs };
}

// rows: array-of-arrays (0-indexed). headerRowIndex is the row carrying the STATE/CITY/
// STREET/CONTAINER/RORO labels (may not be row 0 - this file has a fully blank row 0 before
// the real header on row 1). Data starts the row after it.
export function parseSheet(sheetName, auctionPlatform, rows, { headerRowIndex = 0 } = {}) {
  const records = [];
  const failures = [];
  const yardsSeen = new Set();
  let skippedSeparatorRows = 0;
  let currentState = null;

  const headerRow = rows[headerRowIndex] || [];
  const { containerPairs, roroPairs } = derivePairs(headerRow);
  if (containerPairs.length === 0 && roroPairs.length === 0) {
    failures.push({ sheet: sheetName, row: headerRowIndex + 1, reason: 'no CONTAINER or RORO columns detected in the header row - check headerRowIndex' });
    return { records, failures, skippedSeparatorRows, yardCount: 0 };
  }

  const allPairs = [
    ...containerPairs.map(([port, price]) => ({ port, price, method: 'container' })),
    ...roroPairs.map(([port, price]) => ({ port, price, method: 'roro' })),
  ];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const rowNumber = i + 1; // 1-indexed, matching what a human sees in the spreadsheet

    const rawState = row[0];
    if (!isBlank(rawState)) currentState = String(rawState).trim();

    const cityRaw = row[1];
    const streetRaw = row[2];

    const allPortPriceCellsBlank = allPairs.every(({ port, price }) => isBlank(row[port]) && isBlank(row[price]));
    const cityBlank = isBlank(cityRaw);

    // A genuine blank separator row between states - not a yard, not a failure.
    if (cityBlank && allPortPriceCellsBlank && isBlank(streetRaw)) {
      skippedSeparatorRows++;
      continue;
    }

    if (cityBlank) {
      failures.push({ sheet: sheetName, row: rowNumber, reason: 'row has data but city is blank - cannot identify the yard' });
      continue;
    }

    if (!currentState) {
      failures.push({ sheet: sheetName, row: rowNumber, reason: 'no state established yet (fill-down has no prior value to carry)' });
      continue;
    }

    const yardCity = String(cityRaw).trim();
    const yardStreet = isBlank(streetRaw) ? null : String(streetRaw).trim();
    yardsSeen.add(`${currentState}|${yardCity}|${yardStreet ?? ''}`);

    for (const { port, price, method } of allPairs) {
      const portRaw = row[port];
      const priceRaw = row[price];
      const portBlank = isBlank(portRaw);
      const priceBlank = isBlank(priceRaw);

      if (portBlank && priceBlank) continue; // no option in this slot for this yard - fine

      if (portBlank !== priceBlank) {
        failures.push({
          sheet: sheetName,
          row: rowNumber,
          reason: `partial ${method} pair at columns ${port}/${price} - port="${portRaw ?? ''}" price="${priceRaw ?? ''}"`,
        });
        continue;
      }

      const priceResult = parsePrice(priceRaw);
      if (!priceResult.ok) {
        failures.push({
          sheet: sheetName,
          row: rowNumber,
          reason: `unparseable ${method} price at column ${price}: ${priceResult.reason}`,
        });
        continue;
      }

      records.push({
        auction_platform: auctionPlatform,
        yard_state: currentState,
        yard_city: yardCity,
        yard_street: yardStreet,
        destination_port_raw: String(portRaw).trim(),
        destination_port_normalized: normalizePort(portRaw),
        shipping_method: method,
        price: priceResult.value,
        _sheet: sheetName,
        _row: rowNumber,
      });
    }
  }

  return { records, failures, skippedSeparatorRows, yardCount: yardsSeen.size };
}

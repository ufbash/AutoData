#!/usr/bin/env node
// PROMPT 21 Phase 2 — generates the SQL to store the confirmed Copart auction fee structure.
// Never touches the database itself (same pattern as importTruckingRates.mjs) - writes a SQL
// file for review, executed separately only after confirmation.
//
// Every bracket table string below is copied verbatim from Copart's own published pages
// (copart.com/content/us/en/member-fees-us-non-licensed and .../member-fees-us-licensed,
// High-Volume path), extracted via the DOM this session, not retyped by hand and not
// invented. Non-Clean/Unsecured rows for both member accounts are additionally confirmed to
// the penny against three real invoices (PROMPT_21 Phase 1). Clean-title and Secured-tier
// rows are stored too where the full table was captured, sourced as official_tariff since
// they were not independently invoice-tested - only the Non-Clean/Unsecured rows earn
// actual_paid. High-Volume Licensed Clean-title brackets were NOT fully captured this session
// (only previewed) and are deliberately left out - Caplimo's real purchases are salvage/
// Non-Clean, so this is a real, stated gap, not a silent omission.

import fs from 'node:fs';
import path from 'node:path';

const ORG_ID = 'a93378ea-33ef-4c75-97c4-44c37f2e9002';
const EFFECTIVE_FROM = '2025-07-15'; // earliest of the three invoices confirming these figures

function sqlEscape(str) {
  return `'${String(str).replace(/'/g, "''")}'`;
}

// Parses "$0 - $49.99 $25.00 | $50.00 - $99.99 $45.00 | ... | $15,000.00+ 7.25%" into bracket rows.
function parseBracketTable(raw) {
  const rows = [];
  const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    // Open-ended terminal bracket: "$15,000.00+ 7.25%"
    let m = part.match(/^\$?([\d,]+\.?\d*)\+\s+([\d.]+)%$/);
    if (m) {
      rows.push({ min: parseFloat(m[1].replace(/,/g, '')), max: null, unit: 'percent', value: parseFloat(m[2]) });
      continue;
    }
    // Ranged bracket: "$1,000.00 - $1,199.99 $375.00" or "... FREE"
    m = part.match(/^\$?([\d,]+\.?\d*)\s*-\s*\$?([\d,]+\.?\d*)\s+(FREE|\$[\d,]+\.?\d*)$/i);
    if (m) {
      const min = parseFloat(m[1].replace(/,/g, ''));
      const max = parseFloat(m[2].replace(/,/g, ''));
      const valRaw = m[3];
      const value = /free/i.test(valRaw) ? 0 : parseFloat(valRaw.replace(/[$,]/g, ''));
      rows.push({ min, max, unit: 'usd', value });
      continue;
    }
    // Open-ended dollar bracket: "$8,000.00+ $140.00"
    m = part.match(/^\$?([\d,]+\.?\d*)\+\s+\$?([\d,]+\.?\d*)$/);
    if (m) {
      rows.push({ min: parseFloat(m[1].replace(/,/g, '')), max: null, unit: 'usd', value: parseFloat(m[2].replace(/,/g, '')) });
      continue;
    }
    console.error(`UNPARSED BRACKET SEGMENT: "${part}"`);
  }
  return rows;
}

// --- Non-Licensed (Member 387085, "Jamilu Danmusa Danmusa") ---
const NL_CLEAN_SECURED = "$0 - $49.99 $25.00 | $50.00 - $99.99 $45.00 | $100.00 - 199.99 $80.00 | $200.00 - $299.99 $120.00 | $300.00 - $349.99 $120.00 | $350.00 - $399.99 $120.00 | $400.00 - $449.99 $160.00 | $450.00 - $499.99 $160.00 | $500.00 - $549.99 $185.00 | $550.00 - $599.99 $185.00 | $600.00 - $699.99 $210.00 | $700.00 - $799.99 $230.00 | $800.00 - $899.99 $250.00 | $900.00 - $999.99 $275.00 | $1,000.00 - $1,199.99 $325.00 | $1,200.00 - $1,299.99 $350.00 | $1,300.00 - $1,399.99 $365.00 | $1,400.00 - $1,499.99 $380.00 | $1,500.00 - $1,599.99 $390.00 | $1,600.00 - $1,699.99 $410.00 | $1,700.00 - $1,799.99 $420.00 | $1,800.00 - $1,999.99 $440.00 | $2,000.00 - $2,399.99 $470.00 | $2,400.00 - $2,499.99 $480.00 | $2,500.00 - $2,999.99 $500.00 | $3,000.00 - $3,499.99 $600.00 | $3,500.00 - $3,999.99 $675.00 | $4,000.00 - $4,499.99 $710.00 | $4,500.00 - $4,999.99 $750.00 | $5,000.00 - $5,499.99 $750.00 | $5,500.00 - $5,999.99 $750.00 | $6,000.00 - $6,499.99 $800.00 | $6,500.00 - $6,999.99 $800.00 | $7,000.00 - $7,499.99 $800.00 | $7,500.00 - $7,999.99 $815.00 | $8,000.00 - $8,499.99 $840.00 | $8,500.00 - $8,999.99 $840.00 | $9,000.00 - $9,999.99 $840.00 | $10,000.00 - $10,499.99 $850.00 | $10,500.00 - $10,999.99 $850.00 | $11,000.00 - $11,499.99 $850.00 | $11,500.00 - $11,999.99 $850.00 | $12,000.00 - $12,499.99 $850.00 | $12,500.00 - $14,999.99 $850.00 | $15,000.00+ 7.25%";
const NL_CLEAN_UNSECURED = "$0 - $49.99 $27.50 | $50.00 - $99.99 $50.00 | $100.00 - 199.99 $90.00 | $200.00 - $299.99 $135.00 | $300.00 - $349.99 $137.50 | $350.00 - $399.99 $140.00 | $400.00 - $449.99 $182.50 | $450.00 - $499.99 $185.00 | $500.00 - $549.99 $212.50 | $550.00 - $599.99 $215.00 | $600.00 - $699.99 $245.00 | $700.00 - $799.99 $270.00 | $800.00 - $899.99 $295.00 | $900.00 - $999.99 $325.00 | $1,000.00 - $1,199.99 $385.00 | $1,200.00 - $1,299.99 $415.00 | $1,300.00 - $1,399.99 $435.00 | $1,400.00 - $1,499.99 $455.00 | $1,500.00 - $1,599.99 $470.00 | $1,600.00 - $1,699.99 $495.00 | $1,700.00 - $1,799.99 $510.00 | $1,800.00 - $1,999.99 $540.00 | $2,000.00 - $2,399.99 $590.00 | $2,400.00 - $2,499.99 $605.00 | $2,500.00 - $2,999.99 $650.00 | $3,000.00 - $3,499.99 $775.00 | $3,500.00 - $3,999.99 $875.00 | $4,000.00 - $4,499.99 $935.00 | $4,500.00 - $4,999.99 $1,000.00 | $5,000.00 - $5,499.99 $1,000.00 | $5,500.00 - $5,999.99 $1,000.00 | $6,000.00 - $6,499.99 $1,050.00 | $6,500.00 - $6,999.99 $1,050.00 | $7,000.00 - $7,499.99 $1,050.00 | $7,500.00 - $7,999.99 $1,065.00 | $8,000.00 - $8,499.99 $1,090.00 | $8,500.00 - $8,999.99 $1,090.00 | $9,000.00 - $9,999.99 $1,090.00 | $10,000.00 - $10,499.99 $1,200.00 | $10,500.00 - $10,999.99 $1,200.00 | $11,000.00 - $11,499.99 $1,200.00 | $11,500.00 - $11,999.99 $1,200.00 | $12,000.00 - $12,499.99 $1,200.00 | $12,500.00 - $14,999.99 $1,200.00 | $15,000.00+ 12.25%";
const NL_NONCLEAN_SECURED = "$0 - $49.99 $25.00 | $50.00 - $99.99 $45.00 | $100.00 - 199.99 $80.00 | $200.00 - $299.99 $130.00 | $300.00 - $349.99 $137.50 | $350.00 - $399.99 $145.00 | $400.00 - $449.99 $175.00 | $450.00 - $499.99 $185.00 | $500.00 - $549.99 $205.00 | $550.00 - $599.99 $210.00 | $600.00 - $699.99 $240.00 | $700.00 - $799.99 $270.00 | $800.00 - $899.99 $295.00 | $900.00 - $999.99 $320.00 | $1,000.00 - $1,199.99 $375.00 | $1,200.00 - $1,299.99 $395.00 | $1,300.00 - $1,399.99 $410.00 | $1,400.00 - $1,499.99 $430.00 | $1,500.00 - $1,599.99 $445.00 | $1,600.00 - $1,699.99 $465.00 | $1,700.00 - $1,799.99 $485.00 | $1,800.00 - $1,999.99 $510.00 | $2,000.00 - $2,399.99 $535.00 | $2,400.00 - $2,499.99 $570.00 | $2,500.00 - $2,999.99 $610.00 | $3,000.00 - $3,499.99 $655.00 | $3,500.00 - $3,999.99 $705.00 | $4,000.00 - $4,499.99 $725.00 | $4,500.00 - $4,999.99 $750.00 | $5,000.00 - $5,499.99 $775.00 | $5,500.00 - $5,999.99 $800.00 | $6,000.00 - $6,499.99 $825.00 | $6,500.00 - $6,999.99 $845.00 | $7,000.00 - $7,499.99 $880.00 | $7,500.00 - $7,999.99 $900.00 | $8,000.00 - $8,499.99 $925.00 | $8,500.00 - $8,999.99 $945.00 | $9,000.00 - $9,999.99 $945.00 | $10,000.00 - $10,499.99 $1,000.00 | $10,500.00 - $10,999.99 $1,000.00 | $11,000.00 - $11,499.99 $1,000.00 | $11,500.00 - $11,999.99 $1,000.00 | $12,000.00 - $12,499.99 $1,000.00 | $12,500.00 - $14,999.99 $1,000.00 | $15,000.00+ 7.50%";
const NL_NONCLEAN_UNSECURED = "$0 - $49.99 $27.50 | $50.00 - $99.99 $50.00 | $100.00 - 199.99 $90.00 | $200.00 - $299.99 $145.00 | $300.00 - $349.99 $155.00 | $350.00 - $399.99 $167.50 | $400.00 - $449.99 $200.00 | $450.00 - $499.99 $210.00 | $500.00 - $549.99 $235.00 | $550.00 - $599.99 $240.00 | $600.00 - $699.99 $275.00 | $700.00 - $799.99 $312.50 | $800.00 - $899.99 $342.50 | $900.00 - $999.99 $370.00 | $1,000.00 - $1,199.99 $440.00 | $1,200.00 - $1,299.99 $460.00 | $1,300.00 - $1,399.99 $482.50 | $1,400.00 - $1,499.99 $510.00 | $1,500.00 - $1,599.99 $530.00 | $1,600.00 - $1,699.99 $555.00 | $1,700.00 - $1,799.99 $582.50 | $1,800.00 - $1,999.99 $620.00 | $2,000.00 - $2,399.99 $662.50 | $2,400.00 - $2,499.99 $705.00 | $2,500.00 - $2,999.99 $775.00 | $3,000.00 - $3,499.99 $830.00 | $3,500.00 - $3,999.99 $927.50 | $4,000.00 - $4,499.99 $935.00 | $4,500.00 - $4,999.99 $1,000.00 | $5,000.00 - $5,499.99 $1,025.00 | $5,500.00 - $5,999.99 $1,055.00 | $6,000.00 - $6,499.99 $1,085.00 | $6,500.00 - $6,999.99 $1,110.00 | $7,000.00 - $7,499.99 $1,145.00 | $7,500.00 - $7,999.99 $1,175.00 | $8,000.00 - $8,499.99 $1,200.00 | $8,500.00 - $8,999.99 $1,225.00 | $9,000.00 - $9,999.99 $1,225.00 | $10,000.00 - $10,499.99 $1,390.00 | $10,500.00 - $10,999.99 $1,390.00 | $11,000.00 - $11,499.99 $1,390.00 | $11,500.00 - $11,999.99 $1,400.00 | $12,000.00 - $12,499.99 $1,400.00 | $12,500.00 - $14,999.99 $1,400.00 | $15,000.00+ 12.50%";

// Bid fee tables use "$X - $Y $Z" / "FREE" shape too, terminal "$8,000.00+ $N".
const NL_CLEAN_PREBID = "$0 - $99.99 FREE | $100.00 - $499.99 $39.00 | $500.00 - $999.99 $49.00 | $1,000.00 - $1,499.99 $69.00 | $1,500.00 - $1,999.99 $79.00 | $2,000.00 - $3,999.99 $89.00 | $4,000.00 - $5,999.99 $99.00 | $6,000.00 - $7,999.99 $119.00 | $8,000.00+ $129.00";
const NL_CLEAN_LIVEBID = "$0 - $99.99 FREE | $100.00 - $499.99 $49.00 | $500.00 - $999.99 $59.00 | $1,000.00 - $1,499.99 $79.00 | $1,500.00 - $1,999.99 $89.00 | $2,000.00 - $3,999.99 $99.00 | $4,000.00 - $5,999.99 $109.00 | $6,000.00 - $7,999.99 $139.00 | $8,000.00+ $149.00";
const NL_NONCLEAN_PREBID = "$0 - $99.99 FREE | $100.00 - $499.99 $40.00 | $500.00 - $999.99 $55.00 | $1,000.00 - $1,499.99 $75.00 | $1,500.00 - $1,999.99 $85.00 | $2,000.00 - $3,999.99 $100.00 | $4,000.00 - $5,999.99 $110.00 | $6,000.00 - $7,999.99 $125.00 | $8,000.00+ $140.00";
const NL_NONCLEAN_LIVEBID = "$0 - $99.99 FREE | $100.00 - $499.99 $50.00 | $500.00 - $999.99 $65.00 | $1,000.00 - $1,499.99 $85.00 | $1,500.00 - $1,999.99 $95.00 | $2,000.00 - $3,999.99 $110.00 | $4,000.00 - $5,999.99 $125.00 | $6,000.00 - $7,999.99 $145.00 | $8,000.00+ $160.00";

// --- High-Volume Licensed (Member 18732, "White Nexus Ltd") - Non-Clean only, both captured in full ---
const HV_NONCLEAN_SECURED = "$0 - $49.99 $1.00 | $50.00 - $99.99 $1.00 | $100.00 - 199.99 $25.00 | $200.00 - $299.99 $60.00 | $300.00 - $349.99 $85.00 | $350.00 - $399.99 $100.00 | $400.00 - $449.99 $125.00 | $450.00 - $499.99 $135.00 | $500.00 - $549.99 $145.00 | $550.00 - $599.99 $155.00 | $600.00 - $699.99 $170.00 | $700.00 - $799.99 $195.00 | $800.00 - $899.99 $215.00 | $900.00 - $999.99 $230.00 | $1,000.00 - $1,199.99 $250.00 | $1,200.00 - $1,299.99 $270.00 | $1,300.00 - $1,399.99 $285.00 | $1,400.00 - $1,499.99 $300.00 | $1,500.00 - $1,599.99 $315.00 | $1,600.00 - $1,699.99 $330.00 | $1,700.00 - $1,799.99 $350.00 | $1,800.00 - $1,999.99 $370.00 | $2,000.00 - $2,399.99 $390.00 | $2,400.00 - $2,499.99 $425.00 | $2,500.00 - $2,999.99 $460.00 | $3,000.00 - $3,499.99 $505.00 | $3,500.00 - $3,999.99 $555.00 | $4,000.00 - $4,499.99 $600.00 | $4,500.00 - $4,999.99 $625.00 | $5,000.00 - $5,499.99 $650.00 | $5,500.00 - $5,999.99 $675.00 | $6,000.00 - $6,499.99 $700.00 | $6,500.00 - $6,999.99 $720.00 | $7,000.00 - $7,499.99 $755.00 | $7,500.00 - $7,999.99 $775.00 | $8,000.00 - $8,499.99 $800.00 | $8,500.00 - $8,999.99 $820.00 | $9,000.00 - $9,999.99 $820.00 | $10,000.00 - $10,499.99 $850.00 | $10,500.00 - $10,999.99 $850.00 | $11,000.00 - $11,499.99 $850.00 | $11,500.00 - $11,999.99 $860.00 | $12,000.00 - $12,499.99 $875.00 | $12,500.00 - $14,999.99 $890.00 | $15,000.00+ 6.00%";
const HV_NONCLEAN_UNSECURED = "$0 - $49.99 $27.50 | $50.00 - $99.99 $40.00 | $100.00 - 199.99 $65.00 | $200.00 - $299.99 $100.00 | $300.00 - $349.99 $122.50 | $350.00 - $399.99 $137.50 | $400.00 - $449.99 $145.00 | $450.00 - $499.99 $155.00 | $500.00 - $549.99 $170.00 | $550.00 - $599.99 $175.00 | $600.00 - $699.99 $200.00 | $700.00 - $799.99 $232.50 | $800.00 - $899.99 $257.50 | $900.00 - $999.99 $280.00 | $1,000.00 - $1,199.99 $310.00 | $1,200.00 - $1,299.99 $340.00 | $1,300.00 - $1,399.99 $352.50 | $1,400.00 - $1,499.99 $370.00 | $1,500.00 - $1,599.99 $385.00 | $1,600.00 - $1,699.99 $405.00 | $1,700.00 - $1,799.99 $427.50 | $1,800.00 - $1,999.99 $455.00 | $2,000.00 - $2,399.99 $487.50 | $2,400.00 - $2,499.99 $525.00 | $2,500.00 - $2,999.99 $580.00 | $3,000.00 - $3,499.99 $690.00 | $3,500.00 - $3,999.99 $737.50 | $4,000.00 - $4,499.99 $765.00 | $4,500.00 - $4,999.99 $790.00 | $5,000.00 - $5,499.99 $890.00 | $5,500.00 - $5,999.99 $925.00 | $6,000.00 - $6,499.99 $950.00 | $6,500.00 - $6,999.99 $975.00 | $7,000.00 - $7,499.99 $1,015.00 | $7,500.00 - $7,999.99 $1,120.00 | $8,000.00 - $8,499.99 $1,147.50 | $8,500.00 - $8,999.99 $1,175.00 | $9,000.00 - $9,999.99 $1,175.00 | $10,000.00 - $10,499.99 $1,250.00 | $10,500.00 - $10,999.99 $1,250.00 | $11,000.00 - $11,499.99 $1,250.00 | $11,500.00 - $11,999.99 $1,260.00 | $12,000.00 - $12,499.99 $1,270.00 | $12,500.00 - $14,999.99 $1,285.00 | $15,000.00+ 11.00%";

// HV bid-fee brackets use whole-number boundaries ($100.00 - $500.00, not $499.99) - captured as-is.
const HV_NONCLEAN_PREBID = "$0 - $100.00 FREE | $100.00 - $500.00 $40.00 | $500.00 - $1,000.00 $55.00 | $1,000.00 - $1,500.00 $75.00 | $1,500.00 - $2,000.00 $85.00 | $2,000.00 - $4,000.00 $100.00 | $4,000.00 - $6,000.00 $110.00 | $6,000.00 - $8,000.00 $125.00 | $8,000.00+ $140.00";
const HV_NONCLEAN_LIVEBID = "$0 - $100.00 FREE | $100.00 - $500.00 $50.00 | $500.00 - $1,000.00 $65.00 | $1,000.00 - $1,500.00 $85.00 | $1,500.00 - $2,000.00 $95.00 | $2,000.00 - $4,000.00 $110.00 | $4,000.00 - $6,000.00 $125.00 | $6,000.00 - $8,000.00 $145.00 | $8,000.00+ $160.00";

const NL_ACCOUNT = 'Jamilu Danmusa Danmusa (Copart Non-Licensed)';
const HV_ACCOUNT = 'White Nexus Ltd (Copart High-Volume Licensed)';

const bracketRows = [];
function addBracketTable(raw, { memberAccount, feeType, titleStatus, paymentTier, bidMethod, source }) {
  for (const b of parseBracketTable(raw)) {
    bracketRows.push({
      auction_platform: 'copart',
      member_account: memberAccount,
      fee_type: feeType,
      title_status: titleStatus,
      payment_tier: paymentTier,
      bid_method: bidMethod,
      bracket_min: b.min,
      bracket_max: b.max,
      fee_unit: b.unit,
      fee_value: b.value,
      source,
    });
  }
}

// Non-Licensed: all four title/payment combos for buyer_fee, all four for bid_fee (both methods).
addBracketTable(NL_CLEAN_SECURED,   { memberAccount: NL_ACCOUNT, feeType: 'buyer_fee', titleStatus: 'clean',     paymentTier: 'secured',   bidMethod: null, source: 'official_tariff' });
addBracketTable(NL_CLEAN_UNSECURED, { memberAccount: NL_ACCOUNT, feeType: 'buyer_fee', titleStatus: 'clean',     paymentTier: 'unsecured', bidMethod: null, source: 'official_tariff' });
addBracketTable(NL_NONCLEAN_SECURED,{ memberAccount: NL_ACCOUNT, feeType: 'buyer_fee', titleStatus: 'non_clean', paymentTier: 'secured',   bidMethod: null, source: 'official_tariff' });
// Non-Clean/Unsecured tables are only PARTLY invoice-confirmed - one bracket each, not the
// whole table (an earlier version of this script marked every row in a table 'actual_paid'
// just because one bracket in it matched an invoice, which overstated confidence in the other
// ~39 untested brackets in the same table - exactly the kind of overclaiming this whole
// exercise exists to catch). Every row defaults to 'official_tariff'; only the specific
// bracket a real invoice actually landed in is upgraded to 'actual_paid', below.
addBracketTable(NL_NONCLEAN_UNSECURED, { memberAccount: NL_ACCOUNT, feeType: 'buyer_fee', titleStatus: 'non_clean', paymentTier: 'unsecured', bidMethod: null, source: 'official_tariff' });

addBracketTable(NL_CLEAN_PREBID,    { memberAccount: NL_ACCOUNT, feeType: 'bid_fee', titleStatus: 'clean',     paymentTier: 'secured',   bidMethod: 'proxy', source: 'official_tariff' });
addBracketTable(NL_CLEAN_LIVEBID,   { memberAccount: NL_ACCOUNT, feeType: 'bid_fee', titleStatus: 'clean',     paymentTier: 'secured',   bidMethod: 'live',  source: 'official_tariff' });
addBracketTable(NL_NONCLEAN_PREBID, { memberAccount: NL_ACCOUNT, feeType: 'bid_fee', titleStatus: 'non_clean', paymentTier: 'unsecured', bidMethod: 'proxy', source: 'official_tariff' });
addBracketTable(NL_NONCLEAN_LIVEBID,{ memberAccount: NL_ACCOUNT, feeType: 'bid_fee', titleStatus: 'non_clean', paymentTier: 'unsecured', bidMethod: 'live',  source: 'official_tariff' });

// High-Volume Licensed: Non-Clean only (Clean not fully captured this session - real gap, stated in PLAN_TRACKER debt).
addBracketTable(HV_NONCLEAN_SECURED,  { memberAccount: HV_ACCOUNT, feeType: 'buyer_fee', titleStatus: 'non_clean', paymentTier: 'secured',   bidMethod: null, source: 'official_tariff' });
addBracketTable(HV_NONCLEAN_UNSECURED,{ memberAccount: HV_ACCOUNT, feeType: 'buyer_fee', titleStatus: 'non_clean', paymentTier: 'unsecured', bidMethod: null, source: 'official_tariff' });
addBracketTable(HV_NONCLEAN_PREBID,   { memberAccount: HV_ACCOUNT, feeType: 'bid_fee', titleStatus: 'non_clean', paymentTier: 'unsecured', bidMethod: 'proxy', source: 'official_tariff' });
addBracketTable(HV_NONCLEAN_LIVEBID,  { memberAccount: HV_ACCOUNT, feeType: 'bid_fee', titleStatus: 'non_clean', paymentTier: 'unsecured', bidMethod: 'live',  source: 'official_tariff' });

// Exactly the five brackets a real invoice actually landed in - and no others - are upgraded
// to actual_paid. Everything else in these same tables stays official_tariff.
function markActualPaid(memberAccount, feeType, titleStatus, paymentTier, bidMethod, bracketMin) {
  const row = bracketRows.find(r =>
    r.member_account === memberAccount && r.fee_type === feeType && r.title_status === titleStatus &&
    r.payment_tier === paymentTier && r.bid_method === bidMethod && r.bracket_min === bracketMin
  );
  if (!row) throw new Error(`No matching bracket row to mark actual_paid: ${memberAccount}/${feeType}/${titleStatus}/${paymentTier}/${bidMethod}/${bracketMin}`);
  row.source = 'actual_paid';
}

markActualPaid(NL_ACCOUNT, 'buyer_fee', 'non_clean', 'unsecured', null, 10000);       // Invoices 1 & 3, $1,390
markActualPaid(NL_ACCOUNT, 'bid_fee', 'non_clean', 'unsecured', 'proxy', 8000);       // Invoice 3, $140
markActualPaid(NL_ACCOUNT, 'bid_fee', 'non_clean', 'unsecured', 'live', 8000);        // Invoice 1, $160
markActualPaid(HV_ACCOUNT, 'buyer_fee', 'non_clean', 'unsecured', null, 7500);        // Invoice 2, $1,120
markActualPaid(HV_ACCOUNT, 'bid_fee', 'non_clean', 'unsecured', 'live', 6000);        // Invoice 2, $145

// --- Flat auction fees -> cost_rates (cost_category='auction_fee') ---
// All four confirmed identically across all three real invoices, both member accounts.
const flatFees = [
  { label: 'Copart Environmental Fee', value: 15, source: 'actual_paid' },
  { label: 'Copart Gate Fee (Non-Clean Title)', value: 95, source: 'actual_paid' },
  { label: 'Copart Title Pickup Fee', value: 20, source: 'actual_paid' },
  { label: 'Copart Late Payment Fee', value: 50, source: 'actual_paid' },
];

let sql = `-- Generated by scripts/generateAuctionFeeRates.mjs — PROMPT 21 Phase 2\n`;
sql += `-- ${bracketRows.length} auction_fee_brackets rows, ${flatFees.length} cost_rates rows.\n\n`;

sql += `INSERT INTO public.auction_fee_brackets\n  (org_id, auction_platform, member_account, fee_type, title_status, payment_tier, bid_method, bracket_min, bracket_max, fee_unit, fee_value, source, effective_from, effective_to)\nVALUES\n`;
sql += bracketRows.map(r => `(${sqlEscape(ORG_ID)}, ${sqlEscape(r.auction_platform)}, ${sqlEscape(r.member_account)}, ${sqlEscape(r.fee_type)}, ${sqlEscape(r.title_status)}, ${sqlEscape(r.payment_tier)}, ${r.bid_method ? sqlEscape(r.bid_method) : 'NULL'}, ${r.bracket_min}, ${r.bracket_max === null ? 'NULL' : r.bracket_max}, ${sqlEscape(r.fee_unit)}, ${r.fee_value}, ${sqlEscape(r.source)}, ${sqlEscape(EFFECTIVE_FROM)}, NULL)`).join(',\n');
sql += ';\n\n';

sql += `INSERT INTO public.cost_rates\n  (org_id, cost_category, label, basis, rate_unit, rate_value, rate_value_max, source, effective_from, effective_to)\nVALUES\n`;
sql += flatFees.map(f => `(${sqlEscape(ORG_ID)}, 'auction_fee', ${sqlEscape(f.label)}, NULL, 'usd', ${f.value}, NULL, ${sqlEscape(f.source)}, ${sqlEscape(EFFECTIVE_FROM)}, NULL)`).join(',\n');
sql += ';\n';

const outPath = path.resolve('scripts/out/auction_fee_rates_import.sql');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, sql, 'utf8');

console.log(`Bracket rows: ${bracketRows.length}`);
console.log(`Flat fee rows: ${flatFees.length}`);
console.log(`\nBy source:`);
const bySource = {};
[...bracketRows, ...flatFees].forEach(r => { bySource[r.source] = (bySource[r.source] || 0) + 1; });
console.log(bySource);
console.log(`\nSQL written to ${outPath} (NOT executed).`);

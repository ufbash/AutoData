#!/usr/bin/env node
// PROMPT 20 Phase 3 — importer CLI. Parses a vendor rate spreadsheet deterministically and
// writes a SQL file for review. This script NEVER touches the database itself - it has no
// Supabase credentials and makes no network calls. The generated SQL is reviewed and run
// separately, only after explicit confirmation (AGENTS.md S3 / this prompt's "confirm before
// any non-SELECT SQL including the import itself").
//
// Usage:
//   node scripts/importTruckingRates.mjs \
//     --file path/to/vendor-rates-nov-2025.xlsx \
//     --vendor "Vendor Name" \
//     --effective-from 2025-11-01 \
//     --source agent_quote \
//     --org-id a93378ea-33ef-4c75-97c4-44c37f2e9002 \
//     --out scripts/out/trucking_rates_import.sql

import XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { parseSheet, sheetNameToPlatform } from './lib/truckingRatesParser.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = value;
    }
  }
  return args;
}

function sqlEscape(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

function dayBefore(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const args = parseArgs(process.argv.slice(2));
const required = ['file', 'vendor', 'effective-from', 'source', 'org-id'];
const missing = required.filter(k => !args[k]);
if (missing.length > 0) {
  console.error(`Missing required arguments: ${missing.map(m => `--${m}`).join(', ')}`);
  process.exit(1);
}

const SOURCE_VALUES = ['official_tariff', 'agent_quote', 'actual_paid'];
if (!SOURCE_VALUES.includes(args.source)) {
  console.error(`--source must be one of: ${SOURCE_VALUES.join(', ')}`);
  process.exit(1);
}

const filePath = path.resolve(args.file);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const outPath = path.resolve(args.out || 'scripts/out/trucking_rates_import.sql');

const workbook = XLSX.readFile(filePath, { cellDates: false });

// The header row (STATE/CITY/STREET/CONTAINER.../RORO...) is not always row 0 - this file
// has a fully blank row 0 before the real header on row 1. Detected per sheet by looking
// for the row whose first cell is literally "STATE", rather than assuming a fixed offset
// that might not hold for a future vendor file.
function findHeaderRowIndex(rows) {
  for (let i = 0; i < rows.length; i++) {
    const first = rows[i]?.[0];
    if (first !== null && first !== undefined && String(first).trim().toUpperCase() === 'STATE') return i;
  }
  return -1;
}

let totalRecords = [];
let totalFailures = [];
let totalSkipped = 0;
const sheetReports = [];

for (const sheetName of workbook.SheetNames) {
  const platform = sheetNameToPlatform(sheetName);
  if (!platform) {
    console.log(`Skipping sheet "${sheetName}" - not one of COPART/IAAI/MANHEIM/ADESSA`);
    continue;
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex === -1) {
    console.log(`Skipping sheet "${sheetName}" - no row with "STATE" in column A found`);
    continue;
  }
  const { records, failures, skippedSeparatorRows, yardCount } = parseSheet(sheetName, platform, rows, { headerRowIndex });

  totalRecords = totalRecords.concat(records);
  totalFailures = totalFailures.concat(failures);
  totalSkipped += skippedSeparatorRows;

  sheetReports.push({ sheetName, platform, yardCount, recordCount: records.length, skippedSeparatorRows, failureCount: failures.length });
}

console.log('\n=== Per-sheet report ===');
for (const r of sheetReports) {
  console.log(`${r.sheetName} (${r.platform}): ${r.yardCount} distinct yards, ${r.recordCount} rate rows, ${r.skippedSeparatorRows} blank rows skipped, ${r.failureCount} failures`);
}

console.log(`\n=== Totals ===`);
console.log(`Rate rows to create: ${totalRecords.length}`);
console.log(`Blank separator rows skipped: ${totalSkipped}`);
console.log(`Rows that failed to parse: ${totalFailures.length}`);

if (totalFailures.length > 0) {
  console.log('\n=== Failures (sheet, row, reason) ===');
  for (const f of totalFailures) {
    console.log(`  ${f.sheet} row ${f.row}: ${f.reason}`);
  }
}

if (totalRecords.length === 0) {
  console.log('\nNo records parsed - not writing a SQL file.');
  process.exit(totalFailures.length > 0 ? 1 : 0);
}

const closeOldRatesSql = `UPDATE public.trucking_rates
SET effective_to = ${sqlEscape(dayBefore(args['effective-from']))}
WHERE org_id = ${sqlEscape(args['org-id'])}
  AND vendor = ${sqlEscape(args.vendor)}
  AND effective_to IS NULL;`;

const insertValues = totalRecords.map(r => `(
  ${sqlEscape(args['org-id'])},
  ${sqlEscape(args.vendor)},
  ${sqlEscape(r.auction_platform)},
  ${sqlEscape(r.yard_state)},
  ${sqlEscape(r.yard_city)},
  ${sqlEscape(r.yard_street)},
  ${sqlEscape(r.destination_port_raw)},
  ${sqlEscape(r.destination_port_normalized)},
  ${sqlEscape(r.shipping_method)},
  ${r.price},
  ${sqlEscape(args.source)},
  ${sqlEscape(args['effective-from'])},
  NULL
)`).join(',\n');

const insertSql = `INSERT INTO public.trucking_rates
  (org_id, vendor, auction_platform, yard_state, yard_city, yard_street,
   destination_port_raw, destination_port_normalized, shipping_method, price,
   source, effective_from, effective_to)
VALUES
${insertValues};`;

// Re-import approach (PROMPT_20 Phase 3, stated per the prompt's own instruction to decide
// and state one): supersede by vendor, wholesale, not a row-by-row identical-diff. A new
// import for a vendor closes out every one of that vendor's currently-open rows (this
// UPDATE), then inserts the whole new file's rows fresh (this INSERT). Simpler than
// row-level diffing, and no less correct: even a single price changing in a real reissued
// list means the list should be re-dated as a whole, not spot-patched.
const sql = `-- Generated by scripts/importTruckingRates.mjs
-- vendor=${args.vendor} effective_from=${args['effective-from']} source=${args.source}
-- org_id=${args['org-id']}
-- Re-import approach: supersede by vendor (close all this vendor's open rows, insert fresh).

${closeOldRatesSql}

${insertSql}
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, sql, 'utf8');
console.log(`\nSQL written to ${outPath} (NOT executed - review and run separately).`);

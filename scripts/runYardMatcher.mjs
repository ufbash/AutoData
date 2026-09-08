#!/usr/bin/env node
// PROMPT 20 Phase 5 - runs the yard matcher across sightings exported from production and
// reports matched/unmatched/ambiguous counts, percentages, and examples (Checkpoint 5).
// Read-only: this script makes no database writes. Sightings and trucking_rates are
// exported beforehand via `supabase db query --linked -o json` into JSON files, since this
// script has no Supabase credentials of its own (same reasoning as the importer).
//
// Usage:
//   node --experimental-strip-types scripts/runYardMatcher.mjs \
//     --sightings scripts/out/sightings.json \
//     --yards scripts/out/yards.json

import fs from 'node:fs';
import { matchSightingToYard } from '../src/services/yardMatchingService.ts';

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

const args = parseArgs(process.argv.slice(2));
if (!args.sightings || !args.yards) {
  console.error('Usage: --sightings <path.json> --yards <path.json>');
  process.exit(1);
}

// supabase db query -o json wraps rows in { rows: [...] } - handle both that and a bare array.
function loadRows(path) {
  const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Array.isArray(parsed) ? parsed : parsed.rows;
}

const sightings = loadRows(args.sightings);
const yards = loadRows(args.yards);

const results = sightings.map(s => ({ sighting: s, result: matchSightingToYard(s, yards) }));

const byStatus = { matched: [], unmatched: [], ambiguous: [] };
results.forEach(r => byStatus[r.result.status].push(r));

const total = results.length;
console.log('=== Yard matcher report ===');
console.log(`Total sightings: ${total}`);
for (const status of ['matched', 'unmatched', 'ambiguous']) {
  const count = byStatus[status].length;
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
  console.log(`${status}: ${count} (${pct}%)`);
}

for (const status of ['matched', 'unmatched', 'ambiguous']) {
  console.log(`\n--- ${status} examples (up to 5) ---`);
  byStatus[status].slice(0, 5).forEach(({ sighting, result }) => {
    console.log(`  id=${sighting.id} source=${sighting.source_platform} source_auction_platform=${sighting.source_auction_platform ?? 'null'} location="${sighting.location ?? 'null'}" -> ${result.status}: ${result.reason}`);
  });
}

// Specific failure-to-prove-absent checks (Checkpoint 5): a Copart listing must never match
// an IAAI yard, and "Mobile" must resolve ambiguous against "Mobile South", not a guess.
console.log('\n=== Specific checks ===');
const crossPlatformLeak = results.filter(r =>
  r.result.status === 'matched' &&
  r.result.effectivePlatform &&
  r.result.matchedYard &&
  !yards.some(y => y.auction_platform === r.result.effectivePlatform && y.yard_state === r.result.matchedYard.yard_state && y.yard_city === r.result.matchedYard.yard_city)
);
console.log(`Cross-platform leaks (matched yard not actually on the effective platform): ${crossPlatformLeak.length} (must be 0)`);

const mobileTest = matchSightingToYard(
  { id: 'test-mobile', source_platform: 'copart', source_auction_platform: null, location: 'AL - MOBILE' },
  yards
);
console.log(`"AL - MOBILE" (Copart) against real yard data -> ${mobileTest.status}: ${mobileTest.reason}`);

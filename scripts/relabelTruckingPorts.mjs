// Debt #66 - corrects trucking_rates.destination_port_normalized on rows written BEFORE an alias
// existed, using the importer's own PORT_ALIASES table (scripts/lib/truckingRatesParser.mjs) so there
// is one definition of what a port name normalises to, not a second copy of the mapping in SQL.
//
// It prints SQL; it does not touch the database. destination_port_raw is never changed
// (PROJECT_CHARTER.md section 5.8) - only the derived, matching form. The rate itself (price, yard,
// vendor, dates) is untouched, so this is a reclassification, not a new or edited rate.
//
// Idempotent: each statement only matches rows still carrying the old value. Usage:
//   node scripts/relabelTruckingPorts.mjs            # prints a preview SELECT, then the UPDATEs
import { PORT_ALIASES, normalizePort } from './lib/truckingRatesParser.mjs';

const entries = Object.entries(PORT_ALIASES);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

console.log('-- Preview: rows this would change');
console.log(`SELECT destination_port_normalized AS from_value, count(*) AS rows FROM trucking_rates`);
console.log(`WHERE destination_port_normalized IN (${entries.map(([k]) => lit(k)).join(', ')}) GROUP BY 1 ORDER BY 1;`);
console.log('');
console.log('-- Corrections (derived column only; destination_port_raw untouched)');
for (const [from] of entries) {
  const to = normalizePort(from); // resolves through PORT_ALIASES, the single definition
  if (to === from) continue;
  console.log(`UPDATE trucking_rates SET destination_port_normalized = ${lit(to)} WHERE destination_port_normalized = ${lit(from)};`);
}

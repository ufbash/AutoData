// Debt #61 - which auction house a bid.cars lot really belongs to, derived from the numeric prefix
// of bid.cars' own "Lot" field (page text: "Lot\n0-45905795"). bid.cars aggregates Copart and IAAI
// (and other sources); it is never a yard network itself (see yardMatchingService.ts), so its real
// house decides which fee schedule and which yard list apply.
//
// THE MAPPING IS EVIDENCE, NOT A GUESS - measured on all 168 real bid.cars captures (20 Sep 2026):
//   prefix 1: 100 captures; 49 sit in cities that only Copart has yards in, 0 in IAAI-only cities;
//             bid.cars' own sales-history table says "Copart" on all 71 assets that have one.
//   prefix 0:  62 captures; 18 sit in cities only IAAI has yards in (Akron-Canton, Bridgeport,
//             Englishtown, Kansas City East, Metro DC ...), 0 in Copart-only cities; the sales-history
//             table says "IAAI" on all 41 assets that have one; one is literally "IAA Dallas/Ft Worth".
// The Chrome extension used to map 0 -> copart (and 2 -> iaai), which had the 0 case backwards and
// labelled every IAAI lot as Copart. A prefix not in this table (e.g. 2 - never observed) is NOT
// guessed: it resolves to null, and downstream fee/yard logic abstains ("no resolvable platform").
//
// This is the ONE definition. research-capture calls it at ingest and the relabel backfill calls it
// on history; the extension no longer classifies.

export type AuctionHouse = 'copart' | 'iaai';

export const BIDCARS_LOT_PREFIX_TO_HOUSE: Record<string, AuctionHouse> = {
  '1': 'copart',
  '0': 'iaai',
};

export interface BidcarsLotResult {
  prefix: string | null;
  house: AuctionHouse | null;
}

// "Lot" not preceded by a letter, up to 4 non-alphanumeric characters (newline/space/colon), then
// "<prefix>-<number>". Validated against the same expression in SQL over all real snapshots.
const LOT_PATTERN = /(?<![A-Za-z])Lot[^A-Za-z0-9]{0,4}(\d+)-\d+/;

export function auctionHouseFromBidcarsSnapshot(rawDomSnapshot: string | null | undefined): BidcarsLotResult {
  if (!rawDomSnapshot) return { prefix: null, house: null };
  const m = LOT_PATTERN.exec(rawDomSnapshot);
  if (!m) return { prefix: null, house: null };
  const prefix = m[1];
  return { prefix, house: BIDCARS_LOT_PREFIX_TO_HOUSE[prefix] ?? null };
}

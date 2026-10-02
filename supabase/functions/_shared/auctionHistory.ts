// PROMPT 43 Stage 2 - moved here from src/utils/auctionHistoryFlags.ts so Deno (public-run) and React both import
// the same code. Contains no imports.
export interface AuctionHistoryRow {
  auction_platform: string | null;
  auction_date: string | null;
  lot_number: string | null;
  bid_amount_usd: number | null;
  odometer_miles: number | null;
  status: string | null;
}

export interface AuctionHistoryFlags {
  checkable: boolean;
  appearanceCount: number;
  previouslyUnsold: boolean;
  // PROMPT 27 - A2's trigger fires on ANY prior appearance regardless of outcome
  // (DECISIONS.md 4.8), and that stays unchanged. This flag exists only to let the BADGE
  // WORDING distinguish two real, different signals the trigger deliberately collapses: a car
  // that ran and didn't sell (market-ceiling intelligence, PROJECT_CHARTER.md S6) vs. a car
  // that sold and reappeared (closer to a fraud signal). True if ANY row's status is 'Sold' -
  // if a vehicle was ever sold at auction, that is the stronger, more relevant fact to surface
  // even if it also has unsold appearances.
  previouslySold: boolean;
  highestRejectedBid: number | null;
  hasPriorAuctionHistory: boolean;
  odometerRollback: boolean;
  // Distinct auction events (platform + lot) whose status is 'Sold'. 2 or more = the vehicle sold at auction, was
  // (presumably) repaired/relisted, and sold again - the price of ANY of those sales then describes a vehicle with
  // a repair history, which is not a like-for-like comp. Counted per distinct event so the same sale listed twice by
  // a scrape is still one sale.
  soldEventCount: number;
  repeatSale: boolean;
  // Distinct appearances whose OUTCOME is not recorded ('No information', or any status that is neither Sold nor Not sold).
  // A vehicle with ONE recorded Sold plus one or more of these MAY have sold again: that is unknown, not 'single sale'
  // (Prompt 44 Stage 4; 2 real assets are in this state).
  unknownOutcomeEventCount: number;
  possibleRepeatSale: boolean;
}

const NOT_CHECKABLE: AuctionHistoryFlags = {
  checkable: false,
  appearanceCount: 0,
  previouslyUnsold: false,
  previouslySold: false,
  highestRejectedBid: null,
  hasPriorAuctionHistory: false,
  odometerRollback: false,
  soldEventCount: 0,
  repeatSale: false,
  unknownOutcomeEventCount: 0,
  possibleRepeatSale: false,
};

export function deriveAuctionHistoryFlags(rows: AuctionHistoryRow[] | null | undefined): AuctionHistoryFlags {
  if (!rows || rows.length === 0) {
    return NOT_CHECKABLE;
  }

  const eventKeys = new Set<string>();
  rows.forEach(r => {
    eventKeys.add(`${r.auction_platform ?? ''}::${r.lot_number ?? ''}`);
  });
  const appearanceCount = eventKeys.size;

  const previouslyUnsold = rows.some(r => r.status === 'Not sold');
  const isSoldStatus = (st: string | null | undefined) => (st ?? '').trim().toLowerCase() === 'sold';
  const previouslySold = rows.some(r => isSoldStatus(r.status));
  // A repeat sale = two DISTINCT sale events. An event is identified by platform + lot + date (normalised: case and
  // surrounding whitespace never make one sale look like two) and, when the lot number is missing, by its bid too - so
  // a relist at the same lot on another date is a second sale, two null-lot rows are not silently merged, and the same
  // scraped row stored twice stays ONE sale. (Found by the Prompt 43 adversarial verifier; none fired on live data.)
  const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
  // dates compared as calendar days, whatever format they arrived in ('2026-01-01', '2026-01-01T00:00:00Z', ...)
  const day = (v: unknown) => { const t = String(v ?? '').trim(); if (!t) return ''; const m = t.match(/^(\d{4}-\d{2}-\d{2})/); if (m) return m[1]; const d = new Date(t); return Number.isNaN(d.getTime()) ? t.toLowerCase() : d.toISOString().slice(0, 10); };
  // A sale event = platform + lot (+ calendar day). A row with NO date is the same sale as a dated row at the same lot (the
  // same sale stored twice, once with its date missing, must not read as two sales); two rows with DIFFERENT dates at the
  // same lot are two sales (a relist); a row with no lot number is told apart by its date, or by its bid when it has no date.
  const soldRows = rows.filter(r => isSoldStatus(r.status));
  const byLot = new Map<string, { dates: Set<string>; bids: Set<string> }>();
  soldRows.forEach(r => {
    const k = `${norm(r.auction_platform)}|${norm(r.lot_number)}`;
    const g = byLot.get(k) ?? { dates: new Set<string>(), bids: new Set<string>() };
    const d = day(r.auction_date); if (d) g.dates.add(d);
    g.bids.add(norm(r.bid_amount_usd));
    byLot.set(k, g);
  });
  const soldEvents = new Set<string>();
  byLot.forEach((g, k) => {
    if (g.dates.size) g.dates.forEach(d => soldEvents.add(`${k}|${d}`));
    else if (k.endsWith('|')) g.bids.forEach(b => soldEvents.add(`${k}|bid:${b}`));   // no lot AND no date: the bid tells sales apart
    else soldEvents.add(`${k}|`);                                                    // lot, no date: one sale
  });
  const soldEventCount = soldEvents.size;
  const isNotSoldStatus = (st: string | null | undefined) => (st ?? '').trim().toLowerCase() === 'not sold';
  const unknownEvents = new Set<string>();
  rows.forEach(r => { if (!isSoldStatus(r.status) && !isNotSoldStatus(r.status)) unknownEvents.add([norm(r.auction_platform), norm(r.lot_number), norm(r.auction_date)].join('|')); });
  const unknownOutcomeEventCount = unknownEvents.size;

  const rejectedBids = rows
    .filter(r => r.status === 'Not sold' && r.bid_amount_usd != null)
    .map(r => Number(r.bid_amount_usd));
  const highestRejectedBid = rejectedBids.length > 0 ? Math.max(...rejectedBids) : null;

  // Every auction_history row represents a genuinely prior appearance by data provenance
  // (populated from the bid.cars Sales History panel, which lists past auctions only).
  const hasPriorAuctionHistory = rows.length > 0;

  const chronological = rows
    .filter(r => r.auction_date != null && r.odometer_miles != null)
    .slice()
    .sort((a, b) => new Date(a.auction_date as string).getTime() - new Date(b.auction_date as string).getTime());
  let odometerRollback = false;
  for (let i = 1; i < chronological.length; i++) {
    if (Number(chronological[i].odometer_miles) < Number(chronological[i - 1].odometer_miles)) {
      odometerRollback = true;
      break;
    }
  }

  return {
    checkable: true,
    appearanceCount,
    previouslyUnsold,
    previouslySold,
    highestRejectedBid,
    hasPriorAuctionHistory,
    odometerRollback,
    soldEventCount,
    repeatSale: soldEventCount >= 2,
    unknownOutcomeEventCount,
    possibleRepeatSale: soldEventCount === 1 && unknownOutcomeEventCount >= 1,
  };
}

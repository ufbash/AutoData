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
}

const NOT_CHECKABLE: AuctionHistoryFlags = {
  checkable: false,
  appearanceCount: 0,
  previouslyUnsold: false,
  previouslySold: false,
  highestRejectedBid: null,
  hasPriorAuctionHistory: false,
  odometerRollback: false,
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
  const previouslySold = rows.some(r => r.status === 'Sold');

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
  };
}

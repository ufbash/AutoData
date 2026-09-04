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
  highestRejectedBid: number | null;
  hasPriorAuctionHistory: boolean;
  odometerRollback: boolean;
}

const NOT_CHECKABLE: AuctionHistoryFlags = {
  checkable: false,
  appearanceCount: 0,
  previouslyUnsold: false,
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
    highestRejectedBid,
    hasPriorAuctionHistory,
    odometerRollback,
  };
}

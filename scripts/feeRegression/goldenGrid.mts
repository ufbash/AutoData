// The regression grid: every (account, title status, payment tier) schedule x every price of interest
// x every bid method, through the fee arithmetic, plus bracket boundaries and the max-bid solver.
// `buildGrid(core, rowsFile)` is run twice - against the frozen pre-Phase-1 oracle (oldCore.mts) to make
// golden.json, and against the refactored core to prove nothing moved. Any difference is a failure.
import fs from 'node:fs';

export interface Core {
  auctionFeeComponentFromRows: (price: number, account: string, title: any, rows: any, tier: any, method: any) => any;
  boundaryPair: (rows: any[], price: number, feeAt: (p: number) => number) => any;
  combinedFeeAt: (bid: number, rows: any) => number | null;
  solveMaxBidForFees: (target: number, rows: any) => number | null;
  findBracket: (rows: any[], price: number) => any;
  feeForBracket: (row: any, price: number) => number;
}

export function buildGrid(core: Core, rowsFile: string, opts: { sortByMin?: boolean } = {}) {
  const parsed = JSON.parse(fs.readFileSync(rowsFile, 'utf8'));
  const flatFees = parsed.flatFees;
  // The old code took whichever row the database returned first, so its answer at a price that sits on a shared
  // boundary depended on physical row order. sortByMin fixes the order so two implementations can be compared.
  const brackets = opts.sortByMin ? [...parsed.brackets].sort((a: any, b: any) => a.bracket_min - b.bracket_min) : parsed.brackets;
  const flatFeeTotal = flatFees.reduce((s: number, f: any) => s + Number(f.rate_value), 0);
  const prices = new Set<number>([0, 0.01, 1650, 1700, 5000, 10000, 15000, 15000.01, 50000, 1000000]);
  for (const b of brackets) for (const v of [b.bracket_min, b.bracket_max]) if (v !== null) for (const d of [-0.01, 0, 0.01]) if (v + d >= 0) prices.add(Math.round((v + d) * 100) / 100);
  const priceList = [...prices].sort((a, b) => a - b);
  const targets: number[] = [];
  for (let t = 250; t <= 60000; t += 250) targets.push(t);
  targets.push(1234.56, 7777.77, 20000.5);
  const out: Record<string, any> = {};
  const accounts = [...new Set<string>(brackets.map((b: any) => b.member_account))].sort();
  for (const account of accounts) for (const title of ['clean', 'non_clean']) for (const tier of ['secured', 'unsecured']) {
    const mine = brackets.filter((b: any) => b.member_account === account && b.title_status === title && b.payment_tier === tier);
    const buyerFeeRows = mine.filter((r: any) => r.fee_type === 'buyer_fee');
    const bidFeeRows = mine.filter((r: any) => r.fee_type === 'bid_fee');
    const rows = {
      buyerFeeRows, bidFeeProxyRows: bidFeeRows.filter((r: any) => r.bid_method === 'proxy'), bidFeeLiveRows: bidFeeRows.filter((r: any) => r.bid_method === 'live'),
      flatFees, flatFeeTotal,
    };
    const key = `${account}|${title}|${tier}`;
    const cell: any = { rowCount: mine.length, forward: {}, boundaries: {}, solver: {} };
    for (const p of priceList) {
      for (const m of [null, 'proxy', 'live']) cell.forward[`${p}|${m}`] = core.auctionFeeComponentFromRows(p, account, title, rows, tier, m);
      cell.boundaries[p] = {
        buyer: core.boundaryPair(rows.buyerFeeRows, p, q => { const b = core.findBracket(rows.buyerFeeRows, q); return b ? core.feeForBracket(b, q) : 0; }),
        bid: core.boundaryPair(rows.bidFeeProxyRows, p, q => { const a = core.findBracket(rows.bidFeeProxyRows, q); const l = core.findBracket(rows.bidFeeLiveRows, q); return a && l ? (core.feeForBracket(a, q) + core.feeForBracket(l, q)) / 2 : 0; }),
      };
    }
    for (const t of targets) { const s = core.solveMaxBidForFees(t, rows); cell.solver[t] = { max: s, fee: s === null ? null : core.combinedFeeAt(s, rows) }; }
    out[key] = cell;
  }
  return { prices: priceList.length, targets: targets.length, cells: out };
}

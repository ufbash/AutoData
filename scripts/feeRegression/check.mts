// Diffs the refactored fee core (supabase/functions/_shared/feeSchedule.ts) against the frozen pre-Phase-1
// oracle (oldCore.mts) over the whole grid: 8 real schedules x every bracket boundary and +-0.01 x 3 bid
// methods, plus bracket boundaries and 243 max-bid solver targets. Also asserts the seven verified Copart
// figures explicitly. Exit code 1 on ANY difference. Run:
//   node --experimental-strip-types scripts/feeRegression/check.mts
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as old from './oldCore.mts';
import * as next from '../../supabase/functions/_shared/feeSchedule.ts';
import { buildGrid } from './goldenGrid.mts';

const rowsFile = new URL('./rows_baseline.json', import.meta.url).pathname;
const ROLE: Record<string, string> = { 'Copart Environmental Fee': 'environmental', 'Copart Gate Fee (Non-Clean Title)': 'gate', 'Copart Title Pickup Fee': 'title_pickup' };
const withRoles = (rows: any) => ({ ...rows, flatFees: rows.flatFees.map((f: any) => ({ ...f, fee_role: ROLE[f.label] })) });

const adapter = {
  auctionFeeComponentFromRows: (price: number, account: string, title: any, rows: any, tier: any, method: any) => next.auctionFeeFromRows(price, account, title, withRoles(rows), tier, method),
  boundaryPair: next.boundaryPair, combinedFeeAt: (b: number, r: any) => next.combinedFeeAt(b, withRoles(r)),
  solveMaxBidForFees: (t: number, r: any) => next.solveMaxBidForFees(t, withRoles(r)),
  findBracket: next.findBracket, feeForBracket: next.feeForBracket,
};

const physicalOld = buildGrid(old as any, rowsFile);                       // as the old code ran: database row order
const oldGrid = buildGrid(old as any, rowsFile, { sortByMin: true });        // old logic, canonical row order
const newGrid = buildGrid(adapter as any, rowsFile, { sortByMin: true });    // new logic, canonical row order

// 1. The frozen oracle still produces the recorded golden grid.
const goldenHash = fs.readFileSync(new URL('./golden.sha256', import.meta.url), 'utf8').split(/\s/)[0];
const oracleHash = crypto.createHash('sha256').update(JSON.stringify(physicalOld)).digest('hex');
console.log(`oracle == recorded golden hash: ${oracleHash === goldenHash}`);

// 2. New vs old, cell by cell. Numbers, statuses and texts must be identical; the order of the flat-fee lines
// in sourceRows is presentation only and is compared as a set.
const norm = (v: any): any => {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const o: any = {};
    for (const k of Object.keys(v).sort()) o[k] = k === 'sourceRows' ? [...v[k]].map(norm).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : norm(v[k]);
    return o;
  }
  return v;
};
let compared = 0, diffs = 0; const examples: string[] = [];
for (const key of Object.keys(oldGrid.cells)) {
  for (const part of ['forward', 'boundaries', 'solver'] as const) {
    for (const k of Object.keys((oldGrid.cells[key] as any)[part])) {
      compared++;
      const a = JSON.stringify(norm((oldGrid.cells[key] as any)[part][k]));
      const b = JSON.stringify(norm((newGrid.cells[key] as any)[part][k]));
      if (a !== b) { diffs++; if (examples.length < 5) examples.push(`${key} ${part} ${k}\n  old ${a.slice(0, 220)}\n  new ${b.slice(0, 220)}`); }
    }
  }
}
console.log(`grid points compared: ${compared}; differences: ${diffs}`);
examples.forEach(e => console.log(e));

// 2b. Finding, not a failure: the old code's own answers depended on physical row order at shared boundaries.
let orderDependent = 0; const where = new Set<string>();
for (const key of Object.keys(physicalOld.cells)) for (const part of ['forward', 'boundaries', 'solver'] as const) for (const k of Object.keys((physicalOld.cells[key] as any)[part])) {
  if (JSON.stringify(norm((physicalOld.cells[key] as any)[part][k])) !== JSON.stringify(norm((oldGrid.cells[key] as any)[part][k]))) { orderDependent++; where.add(`${key} @ price ${k.split('|')[0]}`); }
}
console.log(`old code, database row order vs canonical order: ${orderDependent} grid points depend on row order at: ${[...where].join('; ') || 'none'}`);

// 3. The seven verified Copart figures, asserted by name (Jamilu = the default Non-Licensed account, unsecured).
const cell = (title: string) => (newGrid.cells as any)[`Jamilu Danmusa Danmusa (Copart Non-Licensed)|${title}|unsecured`].forward;
const want: [string, string, number][] = [
  ['non_clean', '1700|null', 802.5], ['non_clean', '5000|null', 1272.5], ['non_clean', '1700|proxy', 797.5], ['non_clean', '1700|live', 807.5],
  ['non_clean', '5000|proxy', 1265], ['non_clean', '5000|live', 1280], ['non_clean', '1650|live', 780],
];
let bad = 0;
for (const [title, k, amt] of want) { const got = cell(title)[k].amountUsd; const ok = got === amt; if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${title} ${k.replace('|', ' price, method ')} -> ${got} (expected ${amt})`); }
process.exit(diffs === 0 && bad === 0 && oracleHash === goldenHash ? 0 : 1);

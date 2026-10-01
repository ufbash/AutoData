// The "sold twice" rule, proven against the real shapes. Run: node --experimental-strip-types scripts/testRepeatSale.mts
// Born from the VIN 4T1DAACK2SU169784 case (Copart 2025-10-15 $17,100 @ 9,078 mi, then 2026-09-03 $12,300 @ 37,904 mi):
// stored correctly, flagged nowhere on a historical run. Each case below is something that went wrong, or could.
import { deriveAuctionHistoryFlags } from '../src/utils/auctionHistoryFlags.ts';
import { countsTowardSoldAverage, countsInSoldAverageForRun, isInSoldPopulation } from '../supabase/functions/_shared/soldGroup.ts';

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

const sold = (platform: string, lot: string, date: string, bid: number, odo: number) => ({ auction_platform: platform, lot_number: lot, auction_date: date, bid_amount_usd: bid, odometer_miles: odo, status: 'Sold' });
const notSold = (platform: string, lot: string, date: string) => ({ auction_platform: platform, lot_number: lot, auction_date: date, bid_amount_usd: 5000, odometer_miles: 20000, status: 'Not sold' });

// the real VIN
const camry = deriveAuctionHistoryFlags([sold('Copart', '85718855', '2025-10-15', 17100, 9078), sold('Copart', '60824366', '2026-09-03', 12300, 37904)]);
check('real Camry: two distinct Sold events -> repeatSale', camry.repeatSale, true);
check('real Camry: soldEventCount 2', camry.soldEventCount, 2);
check('real Camry: odometer went UP, so this is NOT an odometer-rollback case', camry.odometerRollback, false);

check('one Sold only -> not a repeat sale', deriveAuctionHistoryFlags([sold('Copart', '1', '2026-01-01', 9000, 10000)]).repeatSale, false);
check('the SAME sale scraped twice (same platform+lot) counts once', deriveAuctionHistoryFlags([sold('Copart', '1', '2026-01-01', 9000, 10000), sold('Copart', '1', '2026-01-01', 9000, 10000)]).repeatSale, false);
check('sold once + not-sold once is a prior appearance, not a repeat SALE', deriveAuctionHistoryFlags([sold('Copart', '1', '2026-01-01', 9000, 10000), notSold('Copart', '2', '2026-05-01')]).repeatSale, false);
check('two Not sold -> not a repeat sale', deriveAuctionHistoryFlags([notSold('Copart', '1', '2026-01-01'), notSold('Copart', '2', '2026-02-01')]).repeatSale, false);
check('across platforms (Copart then IAAI) both Sold -> repeat sale', deriveAuctionHistoryFlags([sold('Copart', '1', '2025-01-01', 8000, 5000), sold('IAAI', '1', '2026-01-01', 9000, 9000)]).repeatSale, true);
check('no history rows -> not checkable, not a repeat sale (absence is not violation)', deriveAuctionHistoryFlags([]).repeatSale, false);
check('null rows -> not checkable', deriveAuctionHistoryFlags(null).checkable, false);

// the predicate both the staff page and public-run import
const base = { lot_state: 'finished', current_bid_usd: null, price_usd: 12300, sale_confirmed: true, logged_via: 'extension_dom_capture', source_platform: 'bidcars' };
check('a confirmed sold comp counts', countsTowardSoldAverage(base), true);
check('the same comp as a repeat sale does NOT count', countsTowardSoldAverage({ ...base, repeat_sale: true }), false);
check('repeat_sale: false / null / undefined change nothing', [countsTowardSoldAverage({ ...base, repeat_sale: false }), countsTowardSoldAverage({ ...base, repeat_sale: null }), countsTowardSoldAverage(base)], [true, true, true]);
check('on a sold_comps run the repeat-sale comp is in the population but not in the average', [isInSoldPopulation({ ...base, repeat_sale: true }, 'sold_comps'), countsInSoldAverageForRun({ ...base, repeat_sale: true }, 'sold_comps')], [true, false]);
check('a mixed run: a finished repeat sale is excluded too', countsInSoldAverageForRun({ ...base, repeat_sale: true }, 'mixed'), false);

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');

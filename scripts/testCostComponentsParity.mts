// PROMPT 38 (debt #79) - parity test for the cost logic MOVED into supabase/functions/_shared/costComponents.ts.
// The frozen regression (scripts/feeRegression/check.mts) proves the fee ARITHMETIC; it imports feeSchedule.ts directly, so it
// cannot catch a mistake in the code that resolves house -> account -> tier -> rows and calls it. This test runs the moved
// components end to end against a fake database loaded with the 324 frozen real rows and the real flat fees, and checks the
// figures the project has verified by hand ($797.50 / $807.50 / $802.50 at $1,700 and $1,265 / $1,280 / $1,272.50 at $5,000,
// non-clean, unsecured: the default Non-Licensed account), plus the abstentions that must survive the move.
//   node --experimental-strip-types scripts/testCostComponentsParity.mts
import fs from 'node:fs';
import { auctionFeeComponent, inlandTruckingComponent, oceanFreightComponent, dutyComponent, classifyTitleStatus } from '../supabase/functions/_shared/costComponents.ts';

const base = JSON.parse(fs.readFileSync(new URL('./feeRegression/rows_baseline.json', import.meta.url), 'utf8'));
const TIER_OF: Record<string, string> = { 'Jamilu Danmusa Danmusa (Copart Non-Licensed)': 'Copart U.S. Non-Licensed' };
const ORG = 'org-1';
const ROLE: Record<string, string> = { 'Copart Environmental Fee': 'environmental', 'Copart Gate Fee (Non-Clean Title)': 'gate', 'Copart Title Pickup Fee': 'title_pickup' };
const NON_LICENSED = 'Jamilu Danmusa Danmusa (Copart Non-Licensed)';

// ---- a tiny fake of the supabase-js query builder: select / eq / is / ilike / order / range / maybeSingle, plus head-count
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {
  auction_houses: [{ auction_platform: 'copart', display_name: 'Copart', location_prefixes: ['COPART'] }, { auction_platform: 'iaai', display_name: 'IAA', location_prefixes: ['IAA', 'IAAI'] }],
  auction_accounts: [{ id: 'acct-1', org_id: ORG, auction_platform: 'copart', fee_tier: 'Copart U.S. Non-Licensed', holder_name: 'Holder', member_number: null, payment_tier: 'unsecured', is_default: true, notes: null, updated_at: '' }],
  auction_fee_brackets: base.brackets.filter((b: Row) => b.member_account === NON_LICENSED).map((b: Row) => ({ ...b, org_id: ORG, auction_platform: 'copart', fee_tier: TIER_OF[NON_LICENSED], currency: 'usd', amount_usd: null, effective_to: null, id: `${b.fee_type}-${b.bracket_min}-${b.title_status}-${b.payment_tier}-${b.bid_method}` })),
  cost_rates: base.flatFees.map((f: Row, i: number) => ({ ...f, id: `f${i}`, org_id: ORG, cost_category: 'auction_fee', auction_platform: 'copart', fee_applies: 'always', fee_role: ROLE[f.label], currency: 'usd', amount_usd: null, effective_to: null })),
  trucking_rates: [],
};
class Q {
  rows: Row[]; countOnly = false;
  constructor(table: string) { this.rows = [...(tables[table] ?? [])]; }
  select(_c?: string, opts?: { count?: string; head?: boolean }) { if (opts?.head) this.countOnly = true; return this; }
  eq(k: string, v: any) { this.rows = this.rows.filter(r => r[k] === v); return this; }
  is(k: string, v: any) { this.rows = this.rows.filter(r => (r[k] ?? null) === v); return this; }
  ilike(k: string, p: string) { const needle = p.replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase(); this.rows = this.rows.filter(r => String(r[k] ?? '').toLowerCase().includes(needle)); return this; }
  order(k: string) { this.rows.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0)); return this; }
  range(from: number, to: number) { this.rows = this.rows.slice(from, to + 1); return this; }
  maybeSingle() { return Promise.resolve({ data: this.rows[0] ?? null, error: null }); }
  then(res: any, rej: any) { return Promise.resolve(this.countOnly ? { data: null, count: this.rows.length, error: null } : { data: this.rows, count: null, error: null }).then(res, rej); }
}
const db = { from: (t: string) => new Q(t) };

let failed = 0;
const t = async (name: string, fn: () => Promise<string | void>) => { try { const r = await fn(); console.log(`PASS  ${name}${r ? '  -> ' + r : ''}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n        ${(e as Error).message}`); } };
const eq = (got: unknown, want: unknown, what: string) => { if (got !== want) throw new Error(`${what}: got ${got}, want ${want}`); };
const copart = { id: 's1', source_platform: 'copart', source_auction_platform: null, location: 'Houston, TX' } as any;
const fee = (price: number | null, title: string, method: 'proxy' | 'live' | null, s = copart) =>
  auctionFeeComponent(db, { sighting: s, titleType: title, referencePriceUsd: price, orgId: ORG, bidMethod: method });

await t('non-clean $1,700 by proxy = $797.50', async () => { const c = await fee(1700, 'Salvage', 'proxy'); eq(c.status, 'available', 'status'); eq(c.amountUsd, 797.5, 'fee'); });
await t('non-clean $1,700 live = $807.50', async () => eq((await fee(1700, 'Salvage', 'live')).amountUsd, 807.5, 'fee'));
await t('non-clean $1,700, method not recorded = $802.50 (midpoint) and it says so', async () => { const c = await fee(1700, 'Salvage', null); eq(c.amountUsd, 802.5, 'fee'); return c.partialReason ? 'flagged as a range' : 'NOT flagged'; });
await t('non-clean $5,000 proxy = $1,265.00 / live = $1,280.00 / unknown method = $1,272.50', async () => {
  eq((await fee(5000, 'Salvage', 'proxy')).amountUsd, 1265, 'proxy'); eq((await fee(5000, 'Salvage', 'live')).amountUsd, 1280, 'live'); eq((await fee(5000, 'Salvage', null)).amountUsd, 1272.5, 'null');
});
await t('the gate fee is still added on a CLEAN title (debt #70 closed: label only, no figure moved)', async () => {
  const clean = await fee(1700, 'Clean Title', 'proxy'); const non = await fee(1700, 'Salvage', 'proxy');
  if (clean.status !== 'available') throw new Error(`clean title abstained: ${clean.reason}`);
  return `clean $${clean.amountUsd} vs non-clean $${non.amountUsd}`;
});
await t('a title that cannot be classified abstains (never guessed)', async () => { const c = await fee(1700, 'zzz-not-a-title', 'proxy'); eq(c.status, 'unavailable', 'status'); return c.reason ?? ''; });
await t('no price abstains', async () => { const c = await fee(null, 'Salvage', 'proxy'); eq(c.status, 'unavailable', 'status'); });
await t('an IAAI lot with no account abstains and says why (the Yaris case)', async () => {
  const c = await fee(1700, 'Salvage', 'proxy', { id: 's2', source_platform: 'iaai', source_auction_platform: null, location: 'IAA Dallas/Ft Worth' } as any);
  eq(c.status, 'unavailable', 'status'); if (!/no IAA account is set up/.test(c.reason ?? '')) throw new Error(c.reason ?? ''); return c.reason ?? '';
});
await t('a platform label that contradicts the yard abstains', async () => {
  const c = await fee(1700, 'Salvage', 'proxy', { id: 's3', source_platform: 'bidcars', source_auction_platform: 'copart', location: 'IAA Dallas/Ft Worth' } as any);
  eq(c.status, 'unavailable', 'status'); return c.reason ?? '';
});
await t('duty is never computed', async () => eq(dutyComponent().status, 'unavailable', 'status'));
await t('freight with no stored rate abstains; two matching rates abstain (no arbitrary pick)', async () => {
  eq((await oceanFreightComponent(db, ORG, 'roro', 'Lagos')).status, 'unavailable', 'none stored');
  tables.cost_rates.push({ id: 'o1', org_id: ORG, cost_category: 'ocean_freight', label: 'RoRo to Lagos', rate_value: 1500, rate_value_max: null, currency: 'usd', amount_usd: null, source: 'agent_quote', effective_from: '2026-01-01', effective_to: null });
  const one = await oceanFreightComponent(db, ORG, 'roro', 'Lagos'); eq(one.amountUsd, 1500, 'single rate');
  tables.cost_rates.push({ id: 'o2', org_id: ORG, cost_category: 'ocean_freight', label: 'RoRo to Lagos (alt)', rate_value: 1700, rate_value_max: null, currency: 'usd', amount_usd: null, source: 'agent_quote', effective_from: '2026-02-01', effective_to: null });
  const two = await oceanFreightComponent(db, ORG, 'roro', 'Lagos'); eq(two.status, 'unavailable', 'ambiguous'); return two.reason ?? '';
});
await t('trucking with no destination abstains; title classifier unchanged', async () => {
  eq((await inlandTruckingComponent(db, { sighting: copart, destinationPortNormalized: null, shippingMethod: null, orgId: ORG })).status, 'unavailable', 'no port');
  eq(classifyTitleStatus('Salvage'), 'non_clean', 'salvage'); eq(classifyTitleStatus('Clean Title'), 'clean', 'clean'); eq(classifyTitleStatus('???'), 'unknown', 'unknown');
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);

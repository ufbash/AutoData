// Node: node --experimental-strip-types scripts/testInvoiceRules.mts
import { deriveInvoice, type InvoiceInput, type LineInput } from '../supabase/functions/_shared/invoiceRules.ts';

const L = (kind: any, usd: number, extra: Partial<LineInput> = {}): LineInput => ({ kind, description: kind, amount_usd: usd, origin: 'computed', ...extra });
const ex = (kind: any, reason = 'no real figure yet') => ({ kind, reason });
let fails = 0;
const t = (name: string, input: InvoiceInput, want: { ok: boolean; scope?: string; total?: number; err?: RegExp }) => {
  const r = deriveInvoice(input);
  const good = r.ok === want.ok && (!r.ok || ((want.scope === undefined || r.scope === want.scope) && (want.total === undefined || r.totalUsd === want.total))) && (want.ok || (want.err ? r.ok === false && r.errors.some(e => want.err!.test(e)) : true));
  if (!good) fails++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${name}${r.ok ? `  -> ${r.scope}, $${r.totalUsd}, missing [${r.missing.join(',')}]` : `  -> ${r.errors[0]}`}`);
};

// The real Yaris today: winning bid and matched trucking are real; everything else abstains and is stated.
t('Yaris today: price + trucking lines, the four abstaining components excluded -> partial $2,175',
  { hat: 'brokerage', currency: 'USD', lines: [L('vehicle_price', 1700), L('inland_trucking', 475)], excluded: [ex('auction_fees', 'IAAI schedule not loaded'), ex('ocean_freight', 'no freight rate'), ex('duty', 'C2 not built'), ex('brokerage_fee', 'fee not yet agreed')] },
  { ok: true, scope: 'partial', total: 2175 });
t('THE FAILURE: same lines, abstaining components simply left out -> refused (silent about shipping and duty)',
  { hat: 'brokerage', currency: 'USD', lines: [L('vehicle_price', 1700), L('inland_trucking', 475)], excluded: [] }, { ok: false, err: /silent about Ocean freight/ });
t('only some abstentions stated -> still refused', { hat: 'brokerage', currency: 'USD', lines: [L('vehicle_price', 1700), L('inland_trucking', 475)], excluded: [ex('auction_fees'), ex('brokerage_fee')] }, { ok: false, err: /silent about (Ocean freight|Import duty)/ });
t('exclusion with no reason -> refused', { hat: 'brokerage', currency: 'USD', lines: [L('vehicle_price', 1700)], excluded: REQUIRED().filter(k => k !== 'vehicle_price').map(k => ({ kind: k, reason: '  ' })) }, { ok: false, err: /needs a stated reason/ });
t('all six as real lines -> complete', { hat: 'brokerage', currency: 'USD', lines: [L('vehicle_price', 1700), L('auction_fees', 640), L('inland_trucking', 475), L('ocean_freight', 1500), L('duty', 900), L('brokerage_fee', 500, { origin: 'staff_entered', basis: 'agreed 12 Sep' })], excluded: [] }, { ok: true, scope: 'complete', total: 5715 });
t('complete claimed but a component is both a line and excluded -> refused', { hat: 'brokerage', currency: 'USD', lines: [L('vehicle_price', 1700), L('duty', 900)], excluded: [ex('duty'), ex('auction_fees'), ex('inland_trucking'), ex('ocean_freight'), ex('brokerage_fee')] }, { ok: false, err: /both a line and excluded/ });
t('computed zero (a silently zeroed abstention) -> refused', { hat: 'brokerage', currency: 'USD', lines: [L('vehicle_price', 1700), L('duty', 0)], excluded: [ex('auction_fees'), ex('inland_trucking'), ex('ocean_freight'), ex('brokerage_fee')] }, { ok: false, err: /computed figure of zero/ });
t('a real, stated zero (fee waived) is allowed', { hat: 'brokerage', currency: 'USD', lines: [L('vehicle_price', 1700), L('brokerage_fee', 0, { origin: 'staff_entered', basis: 'waived by agreement' })], excluded: [ex('auction_fees'), ex('inland_trucking'), ex('ocean_freight'), ex('duty')] }, { ok: true, scope: 'partial', total: 1700 });
t('staff-entered figure with no basis -> refused', { hat: 'brokerage', currency: 'USD', lines: [L('vehicle_price', 1700, { origin: 'staff_entered' })], excluded: [] }, { ok: false, err: /what it rests on/ });
t('brokerage with a hidden line -> refused', { hat: 'brokerage', currency: 'USD', lines: [L('vehicle_price', 1700), L('other', 300, { client_visible: false })], excluded: [] }, { ok: false, err: /discloses every line/ });
t('retail: one all-inclusive line + internal cost lines -> ok, margin never a client line', { hat: 'retail', currency: 'USD', lines: [L('all_inclusive_price', 4200, { origin: 'staff_entered', basis: 'quoted price' }), L('vehicle_price', 1700, { client_visible: false }), L('inland_trucking', 475, { client_visible: false })], excluded: [] }, { ok: true, scope: 'complete', total: 4200 });
t('retail showing itemised lines -> refused', { hat: 'retail', currency: 'USD', lines: [L('vehicle_price', 1700), L('inland_trucking', 475)], excluded: [] }, { ok: false, err: /exactly one client-visible line/ });
t('no hat -> refused', { hat: undefined as any, currency: 'USD', lines: [L('vehicle_price', 1)], excluded: [] }, { ok: false, err: /which hat/ });
function REQUIRED() { return ['vehicle_price', 'auction_fees', 'inland_trucking', 'ocean_freight', 'duty', 'brokerage_fee']; }
process.exit(fails ? 1 : 0);

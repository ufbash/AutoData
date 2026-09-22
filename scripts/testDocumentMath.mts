// PROMPT 38 Phase A - tests for the shared document arithmetic (supabase/functions/_shared/documentMath.ts).
// The two real Caplimo invoices are the golden cases: every figure below is copied from the printed PDFs, never computed
// by the code under test. Run: node --experimental-strip-types scripts/testDocumentMath.mts
import { computeDocument, discountApplied, centsToDecimal, decimalToCents, mulRate, divRate } from '../supabase/functions/_shared/documentMath.ts';
import type { CalcInput } from '../supabase/functions/_shared/documentMath.ts';

let failed = 0;
const t = (name: string, fn: () => string | void) => {
  try { const r = fn(); console.log(`PASS  ${name}${r ? '  -> ' + r : ''}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n        ${(e as Error).message}`); }
};
const eq = (got: unknown, want: unknown, what: string) => { if (got !== want) throw new Error(`${what}: got ${got}, want ${want}`); };
const refused = (name: string, input: CalcInput, part: string) => t(name, () => {
  try { computeDocument(input); } catch (e) { const m = (e as Error).message; if (!m.includes(part)) throw new Error(`refused for the wrong reason: ${m}`); return m; }
  throw new Error('was ACCEPTED');
});
const NGN = (n: number) => Math.round(n * 100);

// ---------------------------------------------------------------- INV-0025 (repair, NGN, per-line discounts, VAT on services only)
const parts: [number, number, string, number][] = [   // qty, rate, discount type/value
  [1, 165000, 'none', 0], [1, 50000, 'none', 0], [1, 18000, 'none', 0], [1, 360000, 'percent', 10], [2, 40000, 'none', 0],
  [1, 63000, 'none', 0], [1, 315000, 'percent', 5], [2, 180000, 'percent', 10], [1, 305000, 'percent', 10], [2, 10000, 'none', 0],
  [6, 200, 'none', 0], [1, 5000, 'none', 0], [1, 50000, 'none', 0], [1, 300000, 'percent', 10], [2, 63000, 'none', 0], [1, 7000, 'none', 0],
];
const inv25: CalcInput = {
  lines: [
    ...parts.map(([q, r, dt, dv], i) => ({ position: i + 1, section: 'Parts and Materials', quantity: q, rate: r, discountType: dt as any, discountValue: dv })),
    { position: 17, section: 'Services', quantity: 1, rate: 200000, taxCode: 'VAT' },
    { position: 18, section: 'Services', quantity: 1, rate: 30000, taxCode: 'EXEMPT' },
  ],
  taxRates: { VAT: 7.5, EXEMPT: 0 },
};
t('INV-0025: every printed line amount', () => {
  const r = computeDocument(inv25);
  const printed = [165000, 50000, 18000, 324000, 80000, 63000, 299250, 324000, 274500, 20000, 1200, 5000, 50000, 270000, 126000, 7000, 200000, 30000];
  printed.forEach((p, i) => eq(r.lines[i].netCents, NGN(p), `line ${i + 1}`));
});
t('INV-0025: the per-line discounts, and "Discount Applied" 148,250 DERIVED', () => {
  const r = computeDocument(inv25);
  [[4, 36000], [7, 15750], [8, 36000], [9, 30500], [14, 30000]].forEach(([n, d]) => eq(r.lines[n - 1].discountCents, NGN(d), `line ${n} discount`));
  eq(discountApplied(r), NGN(148250), 'Discount Applied');
});
t('INV-0025: section subtotals 2,076,950 and 230,000; VAT 15,000 on a 200,000 base; total 2,321,950', () => {
  const r = computeDocument(inv25);
  eq(r.sections[0].subtotalCents, NGN(2076950), 'Parts Sub-Total'); eq(r.sections[1].subtotalCents, NGN(230000), 'Services Sub-Total');
  eq(r.taxBreakdown.length, 2, 'tax groups');
  const vat = r.taxBreakdown.find(x => x.code === 'VAT')!; eq(vat.baseCents, NGN(200000), 'vatable base'); eq(vat.amountCents, NGN(15000), 'VAT');
  const ex = r.taxBreakdown.find(x => x.code === 'EXEMPT')!; eq(ex.amountCents, 0, 'exempt contributes nothing');
  eq(r.totalCents, NGN(2321950), 'Total Invoice');
});
t('INV-0025: THE TRAP - the informational discount is NOT subtracted again (a double deduction would give 2,173,700)', () => {
  const r = computeDocument(inv25);
  if (r.totalCents === NGN(2173700)) throw new Error('the discount was subtracted a second time');
  eq(r.totalCents - NGN(2321950), 0, 'difference to the printed total');
  eq(NGN(2321950) - NGN(2173700), NGN(148250), 'the size of the trap');
});

// ---------------------------------------------------------------- INV-0027 / INV-0026 (USD lines; deposits are applications, not lines)
const inv27: CalcInput = { lines: [
  { position: 1, section: 'Vehicle Purchase', quantity: 1, rate: 2345 }, { position: 2, section: 'Vehicle Purchase', quantity: 1, rate: 300 },
], taxRates: {} };
t('INV-0027: subtotal $2,645; no tax; deposits are not lines (there is no way to state a negative line)', () => {
  const r = computeDocument(inv27);
  eq(r.subtotalCents, 264500, 'Sub-Total (USD)'); eq(r.taxTotalCents, 0, 'tax'); eq(r.totalCents, 264500, 'total'); eq(r.lines.length, 2, 'lines');
});
t('INV-0027 / 0026: applied deposits and the agreed rate give the printed balances (the applied figure comes from applications, then x rate)', () => {
  const total = computeDocument(inv27).totalCents;
  const bal27 = total - 80000 - 70000; eq(bal27, 114500, 'Balance (USD) 0027');
  const bal26 = total - 80000; eq(bal26, 184500, 'Balance (USD) 0026');
  // settlement = round(balance x rate) at the frozen rate 1390, exact in cents
  eq((bal27 * 1390), 159155000, 'Balance Due (NGN) 0027 = 1,591,550.00 (x100)');
  eq((bal26 * 1390), 256455000, 'Balance Due (NGN) 0026 = 2,564,550.00 (x100)');
});

// ---------------------------------------------------------------- semantics
t('service fee $700 at VAT 7.5% = $52.50 VAT (the policy Bashir stated)', () => {
  const r = computeDocument({ lines: [{ position: 1, quantity: 1, rate: 700, taxCode: 'VAT' }], taxRates: { VAT: 7.5 } });
  eq(r.taxTotalCents, 5250, 'VAT'); eq(r.totalCents, 75250, 'total');
});
t('a discount reduces the TAXABLE base: 10% off a $700 taxed fee -> base 630, VAT 47.25', () => {
  const r = computeDocument({ lines: [{ position: 1, quantity: 1, rate: 700, discountType: 'percent', discountValue: 10, taxCode: 'VAT' }], taxRates: { VAT: 7.5 } });
  eq(r.taxBreakdown[0].baseCents, 63000, 'base'); eq(r.taxTotalCents, 4725, 'VAT'); eq(r.totalCents, 67725, 'total');
});
t('invoice-level discount reduces the taxable base pro rata by tax code', () => {
  const r = computeDocument({
    lines: [{ position: 1, quantity: 1, rate: 800, taxCode: 'VAT' }, { position: 2, quantity: 1, rate: 200, taxCode: 'EXEMPT' }],
    invoiceDiscount: { type: 'fixed', value: 100 }, taxRates: { VAT: 10, EXEMPT: 0 } });
  const vat = r.taxBreakdown.find(x => x.code === 'VAT')!;
  eq(vat.baseCents, 72000, 'VAT base = 800 - round(100 x 800/1000)'); eq(vat.amountCents, 7200, 'VAT'); eq(r.totalCents, 100000 - 10000 + 7200, 'total');
});
t('signed labelled adjustment (rounding) is part of the total', () => {
  const r = computeDocument({ lines: [{ position: 1, quantity: 1, rate: 100.5 }], adjustment: -0.5, taxRates: {} });
  eq(r.totalCents, 10000, 'total');
});
t('half-cent rounding goes UP, exactly as the database round() does (never a float)', () => {
  const r = computeDocument({ lines: [{ position: 1, quantity: 3, rate: 0.5, discountType: 'percent', discountValue: 10 }], taxRates: {} });
  eq(r.lines[0].grossCents, 150, 'gross'); eq(r.lines[0].discountCents, 15, 'discount'); eq(r.lines[0].netCents, 135, 'net');
  const r2 = computeDocument({ lines: [{ position: 1, quantity: 1, rate: 0.05, discountType: 'percent', discountValue: 10 }], taxRates: {} });
  eq(r2.lines[0].discountCents, 1, '0.5 cent rounds up to 1');
});
t('decimal helpers are exact', () => { eq(centsToDecimal(232195000), '2321950.00', 'cents->decimal'); eq(decimalToCents('2321950.00'), 232195000, 'decimal->cents'); eq(decimalToCents('0.10'), 10, '0.10'); });

t('retail: internal cost lines are computed but NEVER charged, taxed or subtotalled (the client is charged the one all-inclusive price)', () => {
  const r = computeDocument({ lines: [
    { position: 1, section: 'Vehicle', quantity: 1, rate: 4200, taxCode: 'VAT' },
    { position: 2, quantity: 1, rate: 1700, clientVisible: false, taxCode: 'VAT' },
    { position: 3, quantity: 1, rate: 475, clientVisible: false } ], taxRates: { VAT: 7.5 } });
  eq(r.subtotalCents, 420000, 'subtotal is the visible price only'); eq(r.taxBreakdown[0].baseCents, 420000, 'tax base'); eq(r.totalCents, 451500, 'total');
  eq(r.lines[1].netCents, 170000, 'the hidden line is still computed'); eq(r.lines[1].taxCode, null, 'a hidden line carries no tax code');
});

t('currency conversion is EXACT: balance x agreed rate (INV-0027 / 0026) and a settlement-currency payment back to the document currency', () => {
  eq(mulRate(114500, 1390), 159155000, '1,145.00 x 1390 = 1,591,550.00'); eq(mulRate(184500, '1390'), 256455000, '1,845.00 x 1390 = 2,564,550.00');
  eq(divRate(159155000, 1390), 114500, 'NGN 1,591,550.00 / 1390 = USD 1,145.00');
  eq(mulRate(5, '1326.41230000'), 6632, 'USD 0.05 x 1326.4123 = NGN 66.320615 -> 66.32');
  eq(mulRate(3, '1326.4145'), 3979, 'USD 0.03 x 1326.4145 = NGN 39.792435 -> 39.79 (3979.2435 kobo rounds down)');
  eq(mulRate(1, '0.5'), 1, 'exactly half a cent rounds up, as the database round() does');
  eq(divRate(1, 2), 1, '0.01 / 2 = 0.005 -> 0.01 (half up)');
});

// ---------------------------------------------------------------- refusals: what must never be storable
const one = (o: Partial<CalcInput['lines'][0]> = {}): CalcInput => ({ lines: [{ position: 1, quantity: 1, rate: 100, ...o }], taxRates: { VAT: 7.5 } });
refused('a negative line (a deposit typed as a line) is refused', one({ rate: -800 }), 'rate must be above zero');
refused('a zero-rate line is refused', one({ rate: 0 }), 'rate must be above zero');
refused('zero quantity is refused', one({ quantity: 0 }), 'quantity must be above zero');
refused('a discount larger than the line is refused', one({ discountType: 'fixed', discountValue: 150 }), 'exceeds the line');
refused('a percent discount over 100 is refused', one({ discountType: 'percent', discountValue: 120 }), 'at most 100');
refused('a discount value with no type is refused', one({ discountValue: 10 }), 'needs a discount type');
refused('an unknown tax code is refused (the rate must be a dated row, not assumed)', one({ taxCode: 'GST' }), 'no dated rate');
refused('an invoice discount larger than the subtotal is refused', { ...one(), invoiceDiscount: { type: 'fixed', value: 500 } }, 'exceeds the subtotal');
refused('sub-cent precision is refused rather than silently rounded', one({ rate: '10.005' }), 'more than 2 decimal places');
refused('no lines is refused', { lines: [], taxRates: {} }, 'at least one line');

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);

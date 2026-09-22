// PROMPT 38 Phase A - the arithmetic of a billing document, in one pure file with NO imports.
//
// This mirrors public.billing_compute() (migration 063) exactly, in INTEGER CENTS with BigInt (no floating point), so
// the builder can show live totals, the Edge Function can cross-check the database, and tests can prove the two agree.
// The DATABASE stays the authority: it recomputes at commit and refuses any stored figure that differs.
//
// Semantics (see 063 for the reasoning):
//   line gross    = round(quantity x rate)                       (round half up on non-negatives = the database's round())
//   line discount = percent: round(gross x value / 100); fixed: the amount, never above gross; none: 0
//   line net      = gross - discount        (a discount is never a separate negative line)
//   invoice discount reduces the TAXABLE base per tax code:  base = sum(net of the code's lines) - round(discount x thatNet / subtotal)
//   tax per code  = round(base x rate / 100)
//   total         = subtotal - invoice discount + tax + adjustment
// "Discount Applied" on a printed invoice is DERIVED (line discounts + invoice discount); there is no stored informational
// discount that could be subtracted a second time.

export type DiscountType = 'none' | 'percent' | 'fixed';

export interface CalcLineInput {
  position: number;
  section?: string;
  quantity: string | number;          // up to 4 decimals
  rate: string | number;              // up to 2 decimals
  discountType?: DiscountType;
  discountValue?: string | number;    // percent (up to 4 decimals) or an amount (up to 2 decimals)
  taxCode?: string | null;
  clientVisible?: boolean;            // false = an internal line (a retail invoice's cost): computed but never charged, taxed or subtotalled
}
export interface CalcInput {
  lines: CalcLineInput[];
  invoiceDiscount?: { type: DiscountType; value: string | number };
  adjustment?: string | number;       // signed, up to 2 decimals
  taxRates: Record<string, string | number>;   // code -> percent, AS OF the issue date (exactly one dated rate per code)
}
export interface CalcLine { position: number; grossCents: number; discountCents: number; netCents: number; taxCode: string | null; taxRatePercent: number }
export interface CalcResult {
  lines: CalcLine[];
  sections: { title: string; subtotalCents: number }[];
  subtotalCents: number;
  lineDiscountTotalCents: number;
  invoiceDiscountCents: number;
  taxBreakdown: { code: string; ratePercent: number; baseCents: number; amountCents: number }[];
  taxTotalCents: number;
  adjustmentCents: number;
  totalCents: number;
}

// ---- exact decimal parsing: never goes through a float
const parseScaled = (v: string | number | undefined, scale: number, what: string): bigint => {
  const s = String(v ?? '0').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`${what}: "${s}" is not a number`);
  const neg = s.startsWith('-');
  const [ip, fp = ''] = s.replace('-', '').split('.');
  if (fp.replace(/0+$/, '').length > scale) throw new Error(`${what}: "${s}" has more than ${scale} decimal places`);
  const n = BigInt(ip + fp.padEnd(scale, '0').slice(0, scale));
  return neg ? -n : n;
};
// round(n / d) half away from zero, for a positive divisor
const roundDiv = (n: bigint, d: bigint): bigint => {
  if (d <= 0n) throw new Error('bad divisor');
  return n >= 0n ? (2n * n + d) / (2n * d) : -((2n * -n + d) / (2n * d));
};

export function computeDocument(input: CalcInput): CalcResult {
  if (!input.lines.length) throw new Error('A document needs at least one line');
  const ordered = [...input.lines].sort((a, b) => a.position - b.position);
  const groups = new Map<string, { rate: bigint; net: bigint }>();      // code -> rate (x1e4) and net cents
  const secOrder: string[] = []; const secSum = new Map<string, bigint>();
  const lines: CalcLine[] = [];
  let subtotal = 0n, lineDisc = 0n;

  for (const l of ordered) {
    const qty = parseScaled(l.quantity, 4, `Line ${l.position} quantity`);
    const rateC = parseScaled(l.rate, 2, `Line ${l.position} rate`);
    if (qty <= 0n) throw new Error(`Line ${l.position}: quantity must be above zero`);
    if (rateC <= 0n) throw new Error(`Line ${l.position}: rate must be above zero (a negative or zero figure is not a line)`);
    const gross = roundDiv(qty * rateC, 10_000n);
    const dt = l.discountType ?? 'none';
    let disc = 0n;
    if (dt === 'none') {
      if (parseScaled(l.discountValue ?? 0, 4, 'discount') !== 0n) throw new Error(`Line ${l.position}: a discount value needs a discount type`);
    } else if (dt === 'percent') {
      const pct = parseScaled(l.discountValue, 4, `Line ${l.position} discount`);
      if (pct <= 0n || pct > 1_000_000n) throw new Error(`Line ${l.position}: a percent discount must be above 0 and at most 100`);
      disc = roundDiv(gross * pct, 1_000_000n);
    } else if (dt === 'fixed') {
      disc = parseScaled(l.discountValue, 2, `Line ${l.position} discount`);
      if (disc <= 0n) throw new Error(`Line ${l.position}: a fixed discount must be a positive amount`);
      if (disc > gross) throw new Error(`Line ${l.position}: the discount exceeds the line`);
    } else throw new Error(`Line ${l.position}: unknown discount type ${dt}`);
    const net = gross - disc;
    const vis = l.clientVisible ?? true;
    const code = vis && l.taxCode && l.taxCode.trim() ? l.taxCode.trim() : null;
    let rateX = 0n;
    if (code) {
      if (!(code in input.taxRates)) throw new Error(`Tax code ${code} has no dated rate for this issue date`);
      rateX = parseScaled(input.taxRates[code], 4, `Tax rate ${code}`);
      const g = groups.get(code) ?? { rate: rateX, net: 0n };
      g.net += net; groups.set(code, g);
    }
    if (vis) {
      subtotal += net; lineDisc += disc;
      const sec = l.section ?? '';
      if (!secSum.has(sec)) { secOrder.push(sec); secSum.set(sec, 0n); }
      secSum.set(sec, secSum.get(sec)! + net);
    }
    lines.push({ position: l.position, grossCents: Number(gross), discountCents: Number(disc), netCents: Number(net), taxCode: code, taxRatePercent: Number(rateX) / 10_000 });
  }

  const idt = input.invoiceDiscount?.type ?? 'none';
  let idAmt = 0n;
  if (idt === 'percent') {
    const pct = parseScaled(input.invoiceDiscount!.value, 4, 'Invoice discount');
    if (pct <= 0n || pct > 1_000_000n) throw new Error('The invoice discount percent must be above 0 and at most 100');
    idAmt = roundDiv(subtotal * pct, 1_000_000n);
  } else if (idt === 'fixed') {
    idAmt = parseScaled(input.invoiceDiscount!.value, 2, 'Invoice discount');
    if (idAmt <= 0n) throw new Error('The invoice discount must be a positive amount');
    if (idAmt > subtotal) throw new Error('The invoice discount exceeds the subtotal');
  } else if (idt === 'none') {
    if (input.invoiceDiscount && parseScaled(input.invoiceDiscount.value ?? 0, 4, 'Invoice discount') !== 0n) throw new Error('An invoice discount value needs a discount type');
  } else throw new Error(`Unknown invoice discount type ${idt}`);

  const adj = parseScaled(input.adjustment ?? 0, 2, 'Adjustment');
  const taxBreakdown: CalcResult['taxBreakdown'] = [];
  let taxTotal = 0n;
  for (const code of [...groups.keys()].sort()) {                        // the database orders groups by code
    const g = groups.get(code)!;
    const share = subtotal === 0n ? 0n : roundDiv(idAmt * g.net, subtotal);
    const base = g.net - share;
    const amt = roundDiv(base * g.rate, 1_000_000n);
    taxBreakdown.push({ code, ratePercent: Number(g.rate) / 10_000, baseCents: Number(base), amountCents: Number(amt) });
    taxTotal += amt;
  }
  const total = subtotal - idAmt + taxTotal + adj;
  return {
    lines, sections: secOrder.map(t => ({ title: t, subtotalCents: Number(secSum.get(t)!) })),
    subtotalCents: Number(subtotal), lineDiscountTotalCents: Number(lineDisc), invoiceDiscountCents: Number(idAmt),
    taxBreakdown, taxTotalCents: Number(taxTotal), adjustmentCents: Number(adj), totalCents: Number(total),
  };
}

/** The "Discount Applied" figure printed on an invoice: DERIVED from the discounts that produced the line amounts. */
export const discountApplied = (r: CalcResult): number => r.lineDiscountTotalCents + r.invoiceDiscountCents;

/** cents (integer) -> a decimal string with two places, exact: 232195000 -> "2321950.00" */
export const centsToDecimal = (c: number): string => {
  const neg = c < 0; const a = Math.abs(c);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};
/** a database numeric (string or number) -> integer cents, exactly (no float multiplication) */
export const decimalToCents = (v: string | number): number => Number(parseScaled(String(v), 2, 'amount'));

/** cents x rate -> cents, EXACT (the database's round(balance * fx_rate, 2)); the rate may have up to 8 decimals. */
export const mulRate = (amountCents: number, rate: string | number): number =>
  Number(roundDiv(BigInt(amountCents) * parseScaled(rate, 8, 'exchange rate'), 100_000_000n));
/** cents / rate -> cents, EXACT (the database's round(source_amount / fx_rate, 2)): a payment in the settlement currency in the document's currency. */
export const divRate = (amountCents: number, rate: string | number): number => {
  const r = parseScaled(rate, 8, 'exchange rate');
  if (r <= 0n) throw new Error('The exchange rate must be above zero');
  return Number(roundDiv(BigInt(amountCents) * 100_000_000n, r));
};

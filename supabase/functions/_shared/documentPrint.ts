// PROMPT 38 Phase A - turns what the DATABASE holds about a billing document into the model the template renders.
// Pure (imports types only). It formats and arranges; every figure is copied from the database's own numbers - nothing is
// summed, converted or rounded here, so what prints is exactly what is stored (and what the deferred check verified).
import type { InvoicePrintModel, PrintLine, PrintSection, TotalsRow, ReceiptPrintModel, OrgHeader, Currency } from './documentModel.ts';

export interface PrintDoc {
  docType: 'invoice' | 'retainer' | 'credit_note';
  invoiceKind: 'vehicle_purchase' | 'retail' | 'repair' | null;
  numberText: string;
  issueDate: string;                 // YYYY-MM-DD
  dueDate: string | null;
  currency: Currency;
  settlementCurrency: Currency;
  fxRate: number | null;
  reference: string | null;
  scopeStatement: string | null;
  notes: string | null;
  total: number;
  invoiceDiscountAmount: number;
  invoiceDiscountType: 'none' | 'percent' | 'fixed';
  invoiceDiscountValue: number;
  adjustmentAmount: number;
  adjustmentLabel: string | null;
  taxBreakdown: { code: string; rate: number; base: number; amount: number }[];
  appliedAtIssue: number;
  balanceAtIssue: number;
  settlementBalanceAtIssue: number | null;
  creditForNumber?: string | null;   // a credit note: the invoice it reduces
}
export interface PrintDocLine {
  position: number; section: string; description: string; quantity: number; rate: number;
  discountAmount: number; netAmount: number; clientVisible: boolean;
  origin: 'computed' | 'document_backed' | 'staff_entered'; basis: string | null; sourceRef: string | null; sourceDocumentLabel: string | null;
}
export interface PrintApplication { kind: 'payment' | 'retainer_credit'; purpose: 'deposit' | 'payment' | null; amount: number; retainerNumber: string | null }
export interface PrintOrg { name: string; headerLines: string[]; logoPng: Uint8Array | null; footerNotes: string[]; paymentInstructions: string[] | null; originFootnotes: boolean }
export interface PrintVehicle { title: string; plate?: string | null; lotNo?: string | null; vin?: string | null }

const SYM: Record<Currency, string> = { USD: '$', NGN: '₦' };
const money = (n: number, c: Currency) => `${n < 0 ? '-' : ''}${SYM[c]}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const rateText = (r: number) => r.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const firstWord = (s: string) => (s.trim().split(/\s+/)[0] || s).replace(/[^\p{L}\p{N}-]/gu, '');

const TITLE = { invoice: 'INVOICE', retainer: 'RETAINER INVOICE', credit_note: 'CREDIT NOTE' } as const;

export function buildInvoicePrintModel(input: {
  doc: PrintDoc; lines: PrintDocLine[]; applications: PrintApplication[]; org: PrintOrg;
  client: { name: string; lines: string[] }; vehicle: PrintVehicle | null;
}): InvoicePrintModel {
  const { doc, org, client, vehicle } = input;
  const cur = doc.currency, settle = doc.settlementCurrency, cross = settle !== cur;
  const visible = input.lines.filter(l => l.clientVisible).sort((a, b) => a.position - b.position);
  const isCredit = doc.docType === 'credit_note';

  // sections in order of first appearance
  const order: string[] = [];
  for (const l of visible) if (!order.includes(l.section)) order.push(l.section);
  const multi = order.length > 1;
  const anyDiscount = visible.some(l => l.discountAmount > 0);

  const sections: PrintSection[] = order.map((title, i) => {
    const ls = visible.filter(l => l.section === title);
    const lines: PrintLine[] = ls.map(l => ({ position: l.position, description: l.description, quantity: l.quantity, rate: l.rate, discountAmount: l.discountAmount > 0 ? l.discountAmount : null, amount: l.netAmount }));
    const footerRows: TotalsRow[] = [];
    if (multi) {
      const discSum = ls.reduce((s, l) => s + Math.round(l.discountAmount * 100), 0);
      const netSum = ls.reduce((s, l) => s + Math.round(l.netAmount * 100), 0);   // copied stored nets, added as integer cents only to print a section subtotal
      if (anyDiscount && discSum > 0) footerRows.push({ label: 'Discount Applied', amount: -discSum / 100, currency: cur, emphasis: 'accent' });
      footerRows.push({ label: `${firstWord(title)} Sub-Total`, amount: netSum / 100, currency: cur, emphasis: 'strong' });
      if (i === order.length - 1) {
        for (const t of doc.taxBreakdown) if (t.amount > 0 || t.rate > 0) footerRows.push({ label: `${t.code === 'VAT' ? 'VAT' : t.code} @ ${t.rate.toFixed(2)}% (on ${money(t.base, cur)} vatable)`, amount: t.amount, currency: cur, emphasis: 'bold' });
      }
    }
    const particulars = multi ? `PARTICULARS OF ${firstWord(title).toUpperCase()}` : 'PARTICULARS';
    return { title, particularsLabel: particulars, lines, footerRows };
  });

  // the totals block after the sections
  const rows: TotalsRow[] = [];
  const hasExtras = doc.taxBreakdown.some(t => t.amount > 0) || doc.invoiceDiscountAmount > 0 || doc.adjustmentAmount !== 0;
  if (!multi) {
    const sub = visible.reduce((s, l) => s + Math.round(l.netAmount * 100), 0) / 100;
    rows.push({ label: `Sub-Total (${cur})`, amount: sub, currency: cur, emphasis: 'bold' });
    for (const t of doc.taxBreakdown) if (t.amount > 0) rows.push({ label: `${t.code === 'VAT' ? 'VAT' : t.code} @ ${t.rate.toFixed(2)}% (on ${money(t.base, cur)} vatable)`, amount: t.amount, currency: cur, emphasis: 'plain' });
  }
  if (doc.invoiceDiscountAmount > 0) {
    const pct = doc.invoiceDiscountType === 'percent' ? ` (${doc.invoiceDiscountValue}%)` : '';
    rows.push({ label: `Invoice Discount${pct}`, amount: -doc.invoiceDiscountAmount, currency: cur, emphasis: 'accent' });
  }
  if (doc.adjustmentAmount !== 0) rows.push({ label: doc.adjustmentLabel ?? 'Adjustment', amount: doc.adjustmentAmount, currency: cur, emphasis: 'plain' });
  if (multi || hasExtras) rows.push({ label: isCredit ? `Total Credit (${cur})` : `Total Invoice (${cur})`, amount: doc.total, currency: cur, emphasis: 'strong', ruleAbove: true });

  const applied = input.applications.filter(a => a.amount > 0);
  for (const a of applied) {
    const label = a.kind === 'retainer_credit' ? `Less: Retainer ${a.retainerNumber ?? ''} applied (${cur})`.replace('  ', ' ')
                : a.purpose === 'deposit' ? `Less: Deposit Received (${cur})` : `Less: Payment Received (${cur})`;
    rows.push({ label, amount: -a.amount, currency: cur, emphasis: 'accent' });
  }
  if (applied.length > 0) rows.push({ label: `Balance (${cur})`, amount: doc.balanceAtIssue, currency: cur, emphasis: 'bold', ruleAbove: true });
  if (cross && doc.fxRate) rows.push({ label: 'Exchange Rate', text: `${SYM[cur]}1.00 = ${SYM[settle]}${rateText(doc.fxRate)}`, emphasis: 'plain' });

  const finalAmount = cross && doc.settlementBalanceAtIssue !== null ? doc.settlementBalanceAtIssue : doc.balanceAtIssue;
  const finalCur: Currency = cross ? settle : cur;
  const vehicleBlock = vehicle
    ? { label: 'VEHICLE', title: vehicle.title, lines: [
        ...(vehicle.plate ? [`Reg. ${vehicle.plate}`] : []), ...(vehicle.lotNo ? [`Lot No. ${vehicle.lotNo}`] : []),
        ...(vehicle.vin ? [`VIN ${vehicle.vin}`] : []), ...(doc.reference ? [`Ref: ${doc.reference}`] : []) ] }
    : null;

  // per-line origin footnotes (an org may switch them off): what each figure IS - computed / per a document / a staff figure
  const footnotes: { marker: string; text: string }[] = [];
  if (org.originFootnotes) {
    for (const l of visible) {
      const text = l.origin === 'computed' ? `Computed by the system from the current rates${l.sourceRef ? ` (${l.sourceRef})` : ''}`
                 : l.origin === 'document_backed' ? `Per ${l.sourceDocumentLabel ?? 'the attached document'}`
                 : `Staff figure${l.basis ? `: ${l.basis}` : ''}`;
      footnotes.push({ marker: `Line ${l.position}`, text });
    }
  }
  const header: OrgHeader = { name: org.name, headerLines: org.headerLines, logoPng: org.logoPng };
  return {
    kind: doc.docType, title: TITLE[doc.docType], org: header, currency: cur,
    topBalance: { label: isCredit ? 'Credit Amount' : 'Balance Due', amount: finalAmount, currency: finalCur },
    meta: isCredit
      ? [{ label: 'Credit Note No.', value: doc.numberText }, { label: 'Credit Note Date', value: ddmmyyyy(doc.issueDate) }, ...(doc.creditForNumber ? [{ label: 'Against Invoice', value: doc.creditForNumber }] : [])]
      : [{ label: 'Invoice No.', value: doc.numberText }, { label: 'Invoice Date', value: ddmmyyyy(doc.issueDate) }, ...(doc.dueDate ? [{ label: 'Payment Due', value: ddmmyyyy(doc.dueDate) }] : [])],
    billTo: client, vehicle: vehicleBlock, reference: vehicleBlock ? null : (doc.reference ? `Ref: ${doc.reference}` : null),
    columns: { rate: cross ? `RATE (${cur})` : 'RATE', amount: cross ? `AMOUNT (${cur})` : 'AMOUNT', showDiscount: anyDiscount },
    sections, totalsRows: rows,
    band: { label: isCredit ? `Credit Amount (${finalCur})` : `Balance Due (${finalCur})`, amount: finalAmount, currency: finalCur },
    scopeStatement: doc.scopeStatement, footnotes,
    footerNotes: [...(doc.notes ? doc.notes.split('\n').map(s => s.trim()).filter(Boolean) : []), ...org.footerNotes],
    paymentInstructions: org.paymentInstructions,
  };
}

export function buildReceiptPrintModel(input: {
  org: PrintOrg; numberText: string; issueDate: string; client: { name: string; lines: string[] }; vehicle: PrintVehicle | null;
  payment: { amount: number; currency: Currency; paidOn: string; method: string; reference: string | null };
  appliedTo: { label: string; number: string; total: number; paidToDate: number; outstanding: number; currency: Currency }[];
}): ReceiptPrintModel {
  const v = input.vehicle;
  return {
    org: { name: input.org.name, headerLines: input.org.headerLines, logoPng: input.org.logoPng }, title: 'RECEIPT',
    meta: [{ label: 'Receipt No.', value: input.numberText }, { label: 'Receipt Date', value: ddmmyyyy(input.issueDate) }],
    receivedFrom: input.client,
    vehicle: v ? { label: 'VEHICLE', title: v.title, lines: [...(v.plate ? [`Reg. ${v.plate}`] : []), ...(v.lotNo ? [`Lot No. ${v.lotNo}`] : []), ...(v.vin ? [`VIN ${v.vin}`] : [])] } : null,
    payment: { ...input.payment, paidOn: ddmmyyyy(input.payment.paidOn), method: input.payment.method.replace(/_/g, ' ') },
    appliedTo: input.appliedTo, footerNotes: input.org.footerNotes,
  };
}

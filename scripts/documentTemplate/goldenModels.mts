// Hand-built print models that reproduce the three real Caplimo invoices (INV-0025, INV-0026, INV-0027) exactly as PRINTED,
// plus smoke-test models (credit note, retainer, receipt, stress cases). Every figure is copied from the printed originals;
// nothing here is computed (the renderer does no arithmetic either).
import type { InvoicePrintModel, ReceiptPrintModel, PrintLine, OrgHeader } from '../../supabase/functions/_shared/documentModel.ts';

export function org(logoPng: Uint8Array | null): OrgHeader {
  return { name: 'Caplimo', headerLines: ['CITEC VILLAS, 28 44 CRES,', 'GWARIMPA, FCT +(234) 916 0715 157', 'caplimoltd@gmail.com'], logoPng };
}

const N = 'NGN' as const;
// 'strong' (bold label AND value; with ruleAbove the label sits left, INV-0025's "Total Invoice") is a PROPOSED addition to
// TotalsRow.emphasis in documentModel.ts - not in the union yet, hence the cast.
const STRONG = 'strong' as any;
const ln = (position: number, description: string, quantity: number, rate: number, discountAmount: number | null, amount: number): PrintLine =>
  ({ position, description, quantity, rate, discountAmount, amount });

// ---- INV-0025 (NGN repair, two sections, DISCOUNT column, VAT, footer notes) - printed figures
export function inv0025(logo: Uint8Array | null): InvoicePrintModel {
  return {
    kind: 'invoice', title: 'INVOICE', org: org(logo), currency: N,
    topBalance: { label: 'Balance Due', amount: 2321950, currency: N },
    meta: [{ label: 'Invoice No.', value: 'INV-0025' }, { label: 'Invoice Date', value: '25/08/2026' }],
    billTo: { name: 'Abdulrazaq Ambrusa', lines: ['Abuja, Nigeria', '08098811666'] },
    vehicle: { label: 'VEHICLE', title: '2022 Toyota Camry SE', lines: ['Reg. DLA49443', 'VIN 4T1G11AK4NU649443', 'Ref: Luftreiber Jobcard 2968 (22/08/2026)'] },
    reference: null,
    columns: { rate: 'RATE', amount: 'AMOUNT', showDiscount: true },
    sections: [
      {
        title: 'Parts and Materials', particularsLabel: 'PARTICULARS OF PARTS',
        lines: [
          ln(1, 'Bumper', 1, 165000, null, 165000), ln(2, 'Buffing', 1, 50000, null, 50000), ln(3, 'Bumper Clip LHS', 1, 18000, null, 18000),
          ln(4, 'Windshield', 1, 360000, 36000, 324000), ln(5, 'Seat Belts - Left Hand Side', 2, 40000, null, 80000),
          ln(6, 'Repair of Running Board LHS', 1, 63000, null, 63000), ln(7, 'Painting Material - One Side LHS', 1, 315000, 15750, 299250),
          ln(8, 'Air Bag', 2, 180000, 36000, 324000), ln(9, 'Air Bag Module', 1, 305000, 30500, 274500), ln(10, 'Sealant Gum', 2, 10000, null, 20000),
          ln(11, 'Clips', 6, 200, null, 1200), ln(12, 'Bonnet Bracket Fixing', 1, 5000, null, 5000), ln(13, 'Battery', 1, 50000, null, 50000),
          ln(14, 'Interior Upholstery Kit', 1, 300000, 30000, 270000), ln(15, 'Door Hinges', 2, 63000, null, 126000), ln(16, 'Parts Waybill / Delivery', 1, 7000, null, 7000),
        ],
        footerRows: [
          { label: 'Discount Applied', amount: -148250, currency: N, emphasis: 'accent' },
          { label: 'Parts Sub-Total', amount: 2076950, currency: N, emphasis: STRONG },
        ],
      },
      {
        title: 'Services', particularsLabel: 'PARTICULARS OF SERVICES',
        lines: [ln(17, 'Painting and Body Work Labour', 1, 200000, null, 200000), ln(18, 'Car Detailing (VAT exempt)', 1, 30000, null, 30000)],
        footerRows: [
          { label: 'Services Sub-Total', amount: 230000, currency: N, emphasis: 'bold' },
          { label: 'VAT @ 7.50% (on ₦200,000.00 vatable)', amount: 15000, currency: N, emphasis: 'bold' },
        ],
      },
    ],
    totalsRows: [{ label: 'Total Invoice (NGN)', amount: 2321950, currency: N, emphasis: STRONG, ruleAbove: true }],
    band: { label: 'Balance Due (NGN)', amount: 2321950, currency: N },
    scopeStatement: null, footnotes: [],
    footerNotes: [
      'All amounts stated in Nigerian Naira. VAT at 7.50% applied to services only; car detailing is exempt.',
      'Repair scope and discounts based on Luftreiber Automobile jobcard 2968 dated 22/08/2026.',
    ],
    paymentInstructions: null,
  };
}

// ---- INV-0026 / INV-0027 (USD purchase, agreed FX, NGN balance due)
function usdPurchase(logo: Uint8Array | null, o: { no: string; date: string; deposits: number[]; balanceUsd: number; ngn: number }): InvoicePrintModel {
  const deposits = o.deposits.map((d) => ({ label: 'Less: Deposit Received (USD)', amount: -d, currency: 'USD' as const, emphasis: 'accent' as const }));
  return {
    kind: 'invoice', title: 'INVOICE', org: org(logo), currency: 'USD',
    topBalance: { label: 'Balance Due', amount: o.ngn, currency: N },
    meta: [{ label: 'Invoice No.', value: o.no }, { label: 'Invoice Date', value: o.date }, { label: 'Payment Due', value: '18/09/2026' }],
    billTo: { name: 'Mohammed Jamilu Danmusa', lines: ['Abuja, Nigeria'] },
    vehicle: { label: 'VEHICLE', title: '2008 Toyota Yaris', lines: ['Lot No. 45905795', 'VIN JTDBT923781219099', 'Ref: IAAI Dallas / Fort Worth, TX (14/09/2026)'] },
    reference: null,
    columns: { rate: 'RATE (USD)', amount: 'AMOUNT (USD)', showDiscount: false },
    sections: [{
      title: 'Vehicle Purchase', particularsLabel: 'PARTICULARS',
      lines: [ln(1, '2008 Toyota Yaris — auction purchase price and fees', 1, 2345, null, 2345), ln(2, 'Caplimo service fee', 1, 300, null, 300)],
      footerRows: [],
    }],
    totalsRows: [
      { label: 'Sub-Total (USD)', amount: 2645, currency: 'USD', emphasis: 'bold' },
      ...deposits,
      { label: 'Balance (USD)', amount: o.balanceUsd, currency: 'USD', emphasis: 'bold', ruleAbove: true },
      { label: 'Exchange Rate', text: '$1.00 = ₦1,390.00', emphasis: 'plain' },
    ],
    band: { label: 'Balance Due (NGN)', amount: o.ngn, currency: N },
    scopeStatement: null, footnotes: [], footerNotes: [], paymentInstructions: null,
  };
}
export const inv0026 = (logo: Uint8Array | null) => usdPurchase(logo, { no: 'INV-0026', date: '14/09/2026', deposits: [800], balanceUsd: 1845, ngn: 2564550 });
export const inv0027 = (logo: Uint8Array | null) => usdPurchase(logo, { no: 'INV-0027', date: '15/09/2026', deposits: [800, 700], balanceUsd: 1145, ngn: 1591550 });

// ---- smoke-test models (figures are illustrative; they are typed in, not computed)
export function creditNote(logo: Uint8Array | null): InvoicePrintModel {
  const m = usdPurchase(logo, { no: 'CN-0003', date: '20/09/2026', deposits: [], balanceUsd: 0, ngn: 0 });
  return {
    ...m, kind: 'credit_note', title: 'CREDIT NOTE',
    topBalance: { label: 'Credit Amount', amount: -1112000, currency: N },
    meta: [{ label: 'Credit Note No.', value: 'CN-0003' }, { label: 'Credit Note Date', value: '20/09/2026' }, { label: 'Against Invoice', value: 'INV-0026' }],
    sections: [{ title: 'Credit', particularsLabel: 'PARTICULARS', lines: [ln(1, 'Refund of Caplimo service fee (agreed 19/09/2026)', 1, -300, null, -300), ln(2, 'Refund of duplicated auction fee', 1, -500, null, -500)], footerRows: [] }],
    totalsRows: [{ label: 'Total Credit (USD)', amount: -800, currency: 'USD', emphasis: 'bold' }, { label: 'Exchange Rate', text: '$1.00 = ₦1,390.00', emphasis: 'plain' }],
    band: { label: 'Credit Due (NGN)', amount: -1112000, currency: N },
    scopeStatement: 'This credit note reverses the service fee and one duplicated auction fee on INV-0026. It does not change the vehicle price.',
  };
}

export function retainer(logo: Uint8Array | null): InvoicePrintModel {
  const m = usdPurchase(logo, { no: 'INV-0028', date: '21/09/2026', deposits: [], balanceUsd: 0, ngn: 0 });
  return {
    ...m, kind: 'retainer', title: 'RETAINER INVOICE',
    topBalance: { label: 'Balance Due', amount: 695000, currency: N },
    meta: [{ label: 'Invoice No.', value: 'INV-0028' }, { label: 'Invoice Date', value: '21/09/2026' }, { label: 'Payment Due', value: '25/09/2026' }],
    vehicle: null, reference: 'Ref: Retainer for 2019 Lexus RX 350 purchase (IAAI lot 47102233)',
    sections: [{ title: 'Retainer', particularsLabel: 'PARTICULARS', lines: [ln(1, 'Retainer toward vehicle purchase, shipping and clearing', 1, 500, null, 500)], footerRows: [] }],
    totalsRows: [{ label: 'Total (USD)', amount: 500, currency: 'USD', emphasis: 'bold' }, { label: 'Exchange Rate', text: '$1.00 = ₦1,390.00', emphasis: 'plain' }],
    band: { label: 'Balance Due (NGN)', amount: 695000, currency: N },
    scopeStatement: 'This retainer covers the deposit only. Auction fees, ocean freight, duty and delivery will be invoiced separately when their figures are confirmed.',
    footnotes: [{ marker: '*', text: 'Retainer figure agreed with the client on 20/09/2026.' }],
    footerNotes: ['A retainer is credited in full against the final invoice.'],
    paymentInstructions: ['Bank: Example Bank Plc', 'Account name: Caplimo Limited', 'Account number: 0123456789 (NGN)'],
  };
}

export function receipt(logo: Uint8Array | null): ReceiptPrintModel {
  return {
    org: org(logo), title: 'RECEIPT',
    meta: [{ label: 'Receipt No.', value: 'RCT-0009' }, { label: 'Receipt Date', value: '16/09/2026' }],
    receivedFrom: { name: 'Mohammed Jamilu Danmusa', lines: ['Abuja, Nigeria'] },
    vehicle: { label: 'VEHICLE', title: '2008 Toyota Yaris', lines: ['Lot No. 45905795', 'VIN JTDBT923781219099'] },
    payment: { amount: 700, currency: 'USD', paidOn: '15/09/2026', method: 'Bank transfer', reference: 'TRF/2026/09/15/00871' },
    appliedTo: [{ label: 'Invoice', number: 'INV-0027', total: 2645, paidToDate: 1500, outstanding: 1145, currency: 'USD' }],
    footerNotes: ['Thank you for your payment.'],
  };
}

// ---- stress models
export function manyLines(logo: Uint8Array | null, n = 60): InvoicePrintModel {
  const base = inv0025(logo);
  const lines: PrintLine[] = [];
  for (let i = 1; i <= n; i++) lines.push(ln(i, i % 7 === 0 ? `Part ${i} with a longer description that should wrap onto a second line because it is quite long indeed` : `Part ${i}`, 1 + (i % 3), 10000 + i * 100, i % 5 === 0 ? 500 : null, 10000 + i * 100 - (i % 5 === 0 ? 500 : 0)));
  return { ...base, sections: [{ title: 'Parts and Materials', particularsLabel: 'PARTICULARS OF PARTS', lines, footerRows: [{ label: 'Parts Sub-Total', amount: 1234567.89, currency: N, emphasis: 'bold' }] }, base.sections[1]], scopeStatement: 'Stress test: sixty lines across pages.' };
}

export function longDescription(logo: Uint8Array | null): InvoicePrintModel {
  const m = inv0026(logo);
  const long = 'Supply and fitting of a complete genuine front suspension assembly including control arms, ball joints, stabiliser links, bushings, and wheel alignment after fitment, with a twelve-month warranty on parts — unsupported glyphs: \u{1F697} 中文 and a Supercalifragilisticexpialidocious_SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious word';
  return { ...m, sections: [{ ...m.sections[0], lines: [ln(1, long, 1, 2345, null, 2345), m.sections[0].lines[1]] }] };
}

export function millions(logo: Uint8Array | null): InvoicePrintModel {
  const m = inv0025(logo);
  return {
    ...m, topBalance: { label: 'Balance Due', amount: 123456789.5, currency: N },
    sections: [{ ...m.sections[0], lines: [ln(1, 'Complete engine and gearbox replacement', 1, 98765432.1, 9876543.21, 88888888.89), ln(2, 'Bumper', 2, 12500000, null, 25000000)], footerRows: [{ label: 'Discount Applied', amount: -9876543.21, currency: N, emphasis: 'accent' }, { label: 'Parts Sub-Total', amount: 113888888.89, currency: N, emphasis: 'bold' }] }, m.sections[1]],
    totalsRows: [{ label: 'Total Invoice (NGN)', amount: 123456789.5, currency: N, emphasis: 'bold', ruleAbove: true }],
    band: { label: 'Balance Due (NGN)', amount: 123456789.5, currency: N },
  };
}

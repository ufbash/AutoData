// PROMPT 38 Phase A - the PRINT MODEL: the contract between the document engine and the PDF template.
//
// The template (documentTemplate.ts) is a pure renderer: it receives a fully computed print model and lays it out. It does
// NO arithmetic - every figure below (line amounts, discounts, subtotals, tax, totals, balances, the settlement amount) is
// computed by the DATABASE (the compute function) and passed in already final. The renderer only formats and positions.
//
// No imports: this file is types only, shared by the Edge Function and the Node tests.

export type Currency = 'USD' | 'NGN';

/** A money figure in a stated currency. Formatting (symbol, grouping, sign) is the renderer's job; it never converts. */
export interface Amount { amount: number; currency: Currency }

export interface PrintLine {
  position: number;                    // 1-based, global across sections (INV-0025 continues at 17 in "Services")
  description: string;
  quantity: number;
  rate: number;                        // unit rate in the document currency
  discountAmount: number | null;       // null or 0 prints "-"; a positive figure prints as "-₦36,000.00"
  amount: number;                      // NET line amount (already after the line discount)
}

/** One row in a totals block. The label sits left of the value column; `value` is either a money figure or preformatted text. */
export interface TotalsRow {
  label: string;
  amount?: number;                     // printed in `currency`; a negative number prints with a leading minus ("-$800.00")
  currency?: Currency;
  text?: string;                       // alternative to amount, printed as given (e.g. "$1.00 = ₦1,390.00")
  emphasis?: 'plain' | 'bold' | 'accent' | 'muted' | 'strong';   // 'strong' = label AND value bold (with ruleAbove, the label sits at the band's left text edge)
  ruleAbove?: boolean;                 // a thin rule above this row (the line above "Balance (USD)" / "Total Invoice")
}

export interface PrintSection {
  title: string;                       // "Parts and Materials", "Services", "Vehicle Purchase"
  particularsLabel: string;            // column heading: "PARTICULARS OF PARTS", "PARTICULARS OF SERVICES", "PARTICULARS"
  lines: PrintLine[];
  footerRows: TotalsRow[];             // rows printed under this section's table (Discount Applied, Parts Sub-Total, VAT ...)
}

export interface OrgHeader {
  name: string;                        // "Caplimo"
  headerLines: string[];               // printed as given under the name (address, phone, email lines)
  logoPng: Uint8Array | null;          // the org's logo, already cropped; the renderer scales it, never redraws it
}

export interface InvoicePrintModel {
  kind: 'invoice' | 'retainer' | 'credit_note';
  title: string;                       // the big word top right: "INVOICE", "RETAINER INVOICE", "CREDIT NOTE"
  org: OrgHeader;
  currency: Currency;                  // the currency of the lines
  topBalance: { label: string; amount: number; currency: Currency };   // "Balance Due" / ₦2,564,550.00 (the settlement figure)
  meta: { label: string; value: string }[];                            // "Invoice No.", "Invoice Date", "Payment Due" - WITHOUT the colon: the renderer prints "label : value"; value pre-formatted DD/MM/YYYY
  billTo: { name: string; lines: string[] };
  vehicle: { label: string; title: string; lines: string[] } | null;  // "VEHICLE" / "2008 Toyota Yaris" / ["Lot No. 45905795", "VIN ...", "Ref: ..."]
  reference: string | null;            // a stand-alone reference line when there is no vehicle block
  columns: { rate: string; amount: string; showDiscount: boolean };   // "RATE"/"AMOUNT" or "RATE (USD)"/"AMOUNT (USD)"
  sections: PrintSection[];
  totalsRows: TotalsRow[];             // after all sections (Total Invoice / Sub-Total, deposits, Balance, Exchange Rate)
  band: { label: string; amount: number; currency: Currency };        // the highlighted final line: "Balance Due (NGN)"
  scopeStatement: string | null;       // what this invoice covers / what will be invoiced separately (staged invoices)
  footnotes: { marker: string; text: string }[];   // per-line origin footnotes; empty when the org has them switched off
  footerNotes: string[];               // the fixed notes at the foot of the page
  paymentInstructions: string[] | null;
}

export interface ReceiptPrintModel {
  org: OrgHeader;
  title: string;                       // "RECEIPT"
  meta: { label: string; value: string }[];
  receivedFrom: { name: string; lines: string[] };
  vehicle: { label: string; title: string; lines: string[] } | null;
  payment: { amount: number; currency: Currency; paidOn: string; method: string; reference: string | null };
  // a payment can be applied to several documents, or to none yet (received on account -> empty array)
  appliedTo: { label: string; number: string; total: number; paidToDate: number; outstanding: number; currency: Currency }[];
  footerNotes: string[];
}

export type DocumentPrintModel = ({ type: 'invoice' } & InvoicePrintModel) | ({ type: 'receipt' } & ReceiptPrintModel);

/** What the renderer needs from pdf-lib and fontkit (injected, so the same file runs in Deno and Node). */
export interface PdfLibLike {
  PDFDocument: { create(): Promise<any> };
  rgb: (r: number, g: number, b: number) => unknown;
}
export interface TemplateFonts { regular: Uint8Array; bold: Uint8Array }

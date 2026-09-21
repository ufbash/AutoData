// PROMPT 37 Phase 2 - renders an invoice or a receipt to a PDF. Pure layout code: pdf-lib is passed IN (the Edge
// Function imports it from npm:; the Node test imports it from node_modules), so this file has no imports and the same
// rendering runs in both. Every figure printed here was computed by the DATABASE (convert_invoice_lines) and is the same
// number stored on the invoice - nothing is converted, summed or rounded in this file.
//
// What the page says is the honesty doctrine made visible: the hat, the scope, a stated list of anything excluded, and
// for an NGN invoice the frozen exchange rate and its date. A brokerage invoice shows every line; a retail invoice shows
// one all-inclusive price and NEVER a cost or margin line (client_visible = false lines are not passed in).

export interface PdfLib {
  PDFDocument: { create(): Promise<any> };
  StandardFonts: { Helvetica: string; HelveticaBold: string };
  rgb: (r: number, g: number, b: number) => unknown;
}

export interface PdfLine { description: string; amount: number; amount_usd: number }
export interface InvoicePdfInput {
  orgName: string;
  number: string;
  issuedOn: string;              // YYYY-MM-DD
  hat: 'brokerage' | 'retail';
  scope: 'complete' | 'partial';
  currency: 'USD' | 'NGN';
  clientName: string;
  vehicle: string;               // "2008 Toyota Yaris - VIN ..."
  lines: PdfLine[];              // client-visible lines only
  total: number;
  totalUsd: number;
  excluded: { label: string; reason: string }[];
  fx?: { rate: number; date: string; source: string } | null;
  notes?: string | null;
}
export interface ReceiptPdfInput {
  orgName: string;
  number: string;
  issuedOn: string;
  clientName: string;
  vehicle: string;
  invoiceNumber: string;
  paymentAmount: number;
  currency: 'USD' | 'NGN';
  paidOn: string;
  method: string;
  reference?: string | null;
  invoiceTotal: number;
  paidToDate: number;
  outstanding: number;
}

const money = (n: number, currency: string) => `${currency === 'NGN' ? 'NGN' : 'USD'} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// pdf-lib's standard fonts are WinAnsi only: anything outside it (an en dash, a curly quote, a naira sign) would throw.
const safe = (s: string) => String(s ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/₦/g, 'NGN ').replace(/[^\x20-\x7E -ÿ]/g, '?');

function wrap(font: any, text: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(t, size) <= maxWidth || !line) line = t; else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

async function begin(lib: PdfLib) {
  const doc = await lib.PDFDocument.create();
  const font = await doc.embedFont(lib.StandardFonts.Helvetica);
  const bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 48;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const ink = lib.rgb(0.25, 0.25, 0.3), grey = lib.rgb(0.45, 0.45, 0.5), gold = lib.rgb(0.65, 0.5, 0.22), red = lib.rgb(0.73, 0.23, 0.27);
  const ensure = (need: number) => { if (y - need < M + 30) { page = doc.addPage([W, H]); y = H - M; } };
  const text = (s: string, x: number, size = 10, f = font, color: unknown = ink) => page.drawText(safe(s), { x, y, size, font: f, color });
  const rightText = (s: string, xRight: number, size = 10, f = font, color: unknown = ink) => {
    const w = f.widthOfTextAtSize(safe(s), size); page.drawText(safe(s), { x: xRight - w, y, size, font: f, color });
  };
  const para = (s: string, x: number, maxW: number, size = 10, f = font, color: unknown = ink, gap = 3) => {
    for (const ln of wrap(f, s, size, maxW)) { ensure(size + gap); text(ln, x, size, f, color); y -= size + gap; }
  };
  const rule = () => { page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: lib.rgb(0.8, 0.8, 0.82) }); y -= 10; };
  return { doc, font, bold, W, H, M, ink, grey, gold, red, get y() { return y; }, set y(v: number) { y = v; }, ensure, text, rightText, para, rule };
}

export async function renderInvoicePdf(lib: PdfLib, d: InvoicePdfInput): Promise<Uint8Array> {
  const c = await begin(lib);
  const right = c.W - c.M;
  c.text(d.orgName.toUpperCase(), c.M, 14, c.bold, c.gold);
  c.rightText('INVOICE', right, 16, c.bold); c.y -= 22;
  c.text(`Number: ${d.number}`, c.M, 10, c.bold); c.rightText(`Issued: ${d.issuedOn}`, right); c.y -= 14;
  c.text(`Bill to: ${d.clientName}`, c.M); c.y -= 14;
  c.para(`Vehicle: ${d.vehicle}`, c.M, right - c.M);
  c.y -= 2;
  c.para(d.hat === 'brokerage'
    ? 'Issued by Caplimo as your agent. Costs are passed through and shown line by line, with our fee disclosed.'
    : 'Vehicle supplied by Caplimo at the all-inclusive price below.', c.M, right - c.M, 9, c.font, c.grey);
  c.y -= 6; c.rule();

  c.text('Description', c.M, 9, c.bold, c.grey); c.rightText(`Amount (${d.currency})`, right, 9, c.bold, c.grey); c.y -= 14;
  for (const l of d.lines) {
    c.ensure(24);
    const wrapped = wrap(c.font, l.description, 10, right - c.M - 140);
    const top = c.y;
    wrapped.forEach((ln, i) => { c.text(ln, c.M, 10); if (i === 0) c.rightText(money(l.amount, d.currency), right, 10); c.y -= 13; });
    if (wrapped.length === 0) c.y -= 13;
    c.y = Math.min(c.y, top - 13);
  }
  c.y -= 2; c.rule();
  c.text(d.scope === 'partial' ? 'Total of the items listed' : 'Total', c.M, 11, c.bold);
  c.rightText(money(d.total, d.currency), right, 11, c.bold); c.y -= 16;
  if (d.currency === 'NGN' && d.fx) {
    c.para(`USD equivalent ${money(d.totalUsd, 'USD')}, at NGN ${d.fx.rate.toLocaleString('en-US', { maximumFractionDigits: 4 })} per USD, rate of ${d.fx.date} (${d.fx.source}). The rate is fixed at issue and is not recalculated.`, c.M, right - c.M, 9, c.font, c.grey);
  }
  c.y -= 6;

  if (d.scope === 'partial') {
    c.ensure(60);
    c.para('PARTIAL INVOICE - the total above is NOT the full cost of this vehicle. It does not include:', c.M, right - c.M, 10, c.bold, c.red, 4);
    for (const e of d.excluded) c.para(`- ${e.label}: ${e.reason}`, c.M + 10, right - c.M - 10, 9.5);
    c.para('Each item above will be invoiced separately when its figure is known.', c.M, right - c.M, 9, c.font, c.grey);
  }
  if (d.notes) { c.y -= 4; c.para(d.notes, c.M, right - c.M, 9, c.font, c.grey); }
  c.y = 40;
  c.text(`${d.number}  -  generated ${d.issuedOn}  -  ${d.scope === 'partial' ? 'partial invoice' : 'complete invoice'}  -  ${d.hat}`, c.M, 8, c.font, c.grey);
  return await c.doc.save();
}

export async function renderReceiptPdf(lib: PdfLib, d: ReceiptPdfInput): Promise<Uint8Array> {
  const c = await begin(lib);
  const right = c.W - c.M;
  c.text(d.orgName.toUpperCase(), c.M, 14, c.bold, c.gold);
  c.rightText('RECEIPT', right, 16, c.bold); c.y -= 22;
  c.text(`Number: ${d.number}`, c.M, 10, c.bold); c.rightText(`Issued: ${d.issuedOn}`, right); c.y -= 14;
  c.text(`Received from: ${d.clientName}`, c.M); c.y -= 14;
  c.para(`Vehicle: ${d.vehicle}`, c.M, right - c.M);
  c.y -= 6; c.rule();
  c.text('Payment received', c.M, 10, c.bold); c.rightText(money(d.paymentAmount, d.currency), right, 12, c.bold); c.y -= 16;
  c.text(`Date paid: ${d.paidOn}   Method: ${d.method.replace(/_/g, ' ')}${d.reference ? `   Reference: ${d.reference}` : ''}`, c.M, 9.5, c.font, c.grey); c.y -= 18;
  c.text(`Against invoice ${d.invoiceNumber}`, c.M, 10, c.bold); c.y -= 14;
  c.text('Invoice total', c.M); c.rightText(money(d.invoiceTotal, d.currency), right); c.y -= 13;
  c.text('Paid to date (this receipt included)', c.M); c.rightText(money(d.paidToDate, d.currency), right); c.y -= 13;
  c.text('Outstanding', c.M, 10, c.bold); c.rightText(money(d.outstanding, d.currency), right, 10, c.bold); c.y -= 22;
  c.para('The outstanding figure is the balance of the invoice named above at the time this receipt was issued. It does not include any item that invoice states it excludes.', c.M, right - c.M, 9, c.font, c.grey);
  c.y = 40;
  c.text(`${d.number}  -  generated ${d.issuedOn}`, c.M, 8, c.font, c.grey);
  return await c.doc.save();
}

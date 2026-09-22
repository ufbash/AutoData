// PROMPT 38 Phase A - the PDF TEMPLATE: a pure renderer for invoices, retainer invoices, credit notes and receipts.
//
// Data in, PDF out. It receives a fully computed print model (documentModel.ts) and lays it out. It does NO ARITHMETIC:
// every figure in the model is final. The only thing done to a number here is FORMATTING it (currency symbol, thousands
// grouping, two decimals, a leading minus for a negative) - nothing is summed, subtracted, converted or rounded.
//
// pdf-lib and fontkit are INJECTED (the Edge Function imports them from npm:, the Node scripts from node_modules), and the
// two DejaVu Sans fonts are passed in as bytes, so this file has no imports beyond the type-only model. The fonts are
// embedded because pdf-lib's standard fonts cannot print the naira sign (U+20A6).
//
// Layout: one template family (invoice / retainer invoice / credit note, the `title` is the big word top right) plus a
// small separate layout for receipts. Coordinates are PDF points, origin bottom-left, A4. The numbers come from the real
// Caplimo invoices INV-0025/0026/0027 (see scripts/documentTemplate/README.md).
//
// Two table densities share one code path:
//   comfortable (no per-line discount column): the INV-0026/0027 geometry
//   dense       (columns.showDiscount):        the INV-0025 geometry (two sections, DISCOUNT column, a rule under each row)
// Nothing may overlap: the totals block, band, scope statement and notes are laid out as a flowing tail under the last
// table; if a section overflows a page the table header is repeated on a new page and the tail stays together on the last.

import type { InvoicePrintModel, ReceiptPrintModel, PdfLibLike, TemplateFonts, TotalsRow, PrintSection, Currency, OrgHeader } from './documentModel.ts';

// ---------------------------------------------------------------- constants

const PAGE_W = 595.276;
const PAGE_H = 841.89;
const ML = 42.52;                 // left margin (15 mm)
const MR = 552.756;               // right content edge
const CW = MR - ML;               // content width 510.236

type RGB = [number, number, number];
const BROWN: RGB = [0x8b, 0x6a, 0x4e];
const DARK: RGB = [0x1a, 0x1a, 0x1a];
const MUTED: RGB = [0x8a, 0x84, 0x80];
const BODY: RGB = [0x3d, 0x3a, 0x37];
const ZEBRA: RGB = [0xfb, 0xf9, 0xf7];
const BAND: RGB = [0xf5, 0xf1, 0xec];
const RULE: RGB = [0xdd, 0xdd, 0xdd];
const WHITE: RGB = [255, 255, 255];

const NAIRA = '₦';
const SYMBOL: Record<string, string> = { USD: '$', NGN: NAIRA };

/** Lowest ink a page may carry: rows on a non-final page stop above ROW_FLOOR; the last page's tail may reach TAIL_FLOOR. */
const ROW_FLOOR = 40;
const TAIL_FLOOR = 16;

// ---------------------------------------------------------------- formatting (no arithmetic)

function groupInt(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** "$2,345.00", "-$800.00", "₦2,321,950.00", "-₦36,000.00". The sign comes from the figure as given. */
export function formatMoney(value: number, currency: Currency | string): string {
  const sym = SYMBOL[currency] ?? '';
  if (!Number.isFinite(value)) return '?';
  const neg = value < 0;
  const fixed = Math.abs(value).toFixed(2);       // formatting only: the model's figures already carry two decimals
  const [whole, frac] = fixed.split('.');
  const body = `${sym}${groupInt(whole)}.${frac}`;
  return neg && Number(fixed) !== 0 ? `-${body}` : body;
}

/** A quantity as given: integers plain, fractions without trailing zeros, never exponent form. */
export function formatQty(q: number): string {
  if (!Number.isFinite(q)) return '?';
  if (Number.isInteger(q)) return groupInt(String(Math.abs(q))).replace(/^/, q < 0 ? '-' : '');
  return q.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

// ---------------------------------------------------------------- fonts and text

interface Face { font: any; chars: Set<number> }

interface Canvas {
  page: any;                 // null in a dry run (measuring only)
  minY: number;              // lowest ink drawn so far (also tracked in a dry run)
}

interface Kit {
  lib: PdfLibLike;
  doc: any;
  reg: Face;
  bold: Face;
  logo: any | null;
}

function color(kit: Kit, c: RGB) { return kit.lib.rgb(c[0] / 255, c[1] / 255, c[2] / 255); }

/** Replace anything the embedded font cannot print with '?', so the renderer never throws on odd characters. */
function clean(face: Face, text: string): string {
  let out = '';
  for (const ch of String(text ?? '').replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ')) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xa0) { out += ' '; continue; }
    out += face.chars.has(cp) ? ch : '?';
  }
  return out;
}

function faceOf(kit: Kit, bold: boolean): Face { return bold ? kit.bold : kit.reg; }

function widthOf(kit: Kit, text: string, size: number, bold: boolean): number {
  const f = faceOf(kit, bold);
  const t = clean(f, text);
  return t === '' ? 0 : f.font.widthOfTextAtSize(t, size);
}

interface TextOpts { size: number; bold?: boolean; color?: RGB; align?: 'left' | 'right'; maxW?: number; minSize?: number }

/** Draw one line of text. With maxW, the size shrinks (down to minSize) until the text fits. Returns the width drawn. */
function text(kit: Kit, cv: Canvas, s: string, x: number, y: number, o: TextOpts): number {
  const bold = !!o.bold;
  const f = faceOf(kit, bold);
  const t = clean(f, s);
  if (t === '') return 0;
  let size = o.size;
  let w = f.font.widthOfTextAtSize(t, size);
  if (o.maxW !== undefined && w > o.maxW) {
    const min = o.minSize ?? 6;
    size = Math.max(min, size * (o.maxW / w));
    w = f.font.widthOfTextAtSize(t, size);
  }
  const px = o.align === 'right' ? x - w : x;
  cv.minY = Math.min(cv.minY, y - size * 0.24);      // descender allowance
  if (cv.page) cv.page.drawText(t, { x: px, y, size, font: f.font, color: color(kit, o.color ?? BODY) });
  return w;
}

function rect(kit: Kit, cv: Canvas, x: number, y: number, w: number, h: number, c: RGB) {
  cv.minY = Math.min(cv.minY, y);
  if (cv.page) cv.page.drawRectangle({ x, y, width: w, height: h, color: color(kit, c) });
}

function hline(kit: Kit, cv: Canvas, x1: number, x2: number, y: number, thickness: number, c: RGB) {
  cv.minY = Math.min(cv.minY, y);
  if (cv.page) cv.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color: color(kit, c) });
}

/** Greedy word wrap to maxW; a single word wider than maxW is broken by character. Explicit newlines start a new line. */
function wrap(kit: Kit, s: string, size: number, bold: boolean, maxW: number): string[] {
  const f = faceOf(kit, bold);
  const out: string[] = [];
  for (const para of String(s ?? '').split(/\r?\n/)) {
    const words = clean(f, para).split(' ').filter((w) => w !== '');
    if (words.length === 0) { out.push(''); continue; }
    let line = '';
    const w = (t: string) => f.font.widthOfTextAtSize(t, size);
    for (let word of words) {
      while (w(word) > maxW && word.length > 1) {                       // break an over-long word
        let cut = word.length - 1;
        while (cut > 1 && w(word.slice(0, cut)) > maxW) cut--;
        if (line !== '') { out.push(line); line = ''; }
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const next = line === '' ? word : `${line} ${word}`;
      if (w(next) <= maxW || line === '') line = next;
      else { out.push(line); line = word; }
    }
    if (line !== '') out.push(line);
  }
  return out.length ? out : [''];
}

// ---------------------------------------------------------------- setup

async function setup(lib: PdfLibLike, fontkit: unknown, fonts: TemplateFonts, org: OrgHeader): Promise<Kit> {
  const doc = await lib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const embed = async (bytes: Uint8Array): Promise<Face> => {
    const font = await doc.embedFont(bytes, { subset: true });
    return { font, chars: new Set<number>(font.getCharacterSet()) };
  };
  const reg = await embed(fonts.regular);
  const bold = await embed(fonts.bold);
  const logo = org.logoPng && org.logoPng.length > 0 ? await doc.embedPng(org.logoPng) : null;
  return { lib, doc, reg, bold, logo };
}

// ---------------------------------------------------------------- shared header pieces

/** Logo, org name and address lines (left) - identical on every document. */
function orgBlock(kit: Kit, cv: Canvas, org: OrgHeader) {
  if (kit.logo && cv.page) cv.page.drawImage(kit.logo, { x: ML, y: 762.52, width: 39.69, height: 39.69 });   // ring centre (62.36, 782.36)
  text(kit, cv, org.name, ML, 739.84, { size: 10, bold: true, color: DARK, maxW: 300 });
  org.headerLines.forEach((l, i) => text(kit, cv, l, ML, 727.09 - i * 11.34, { size: 7.5, color: MUTED, maxW: 300, minSize: 6 }));
}

/** Big title top right, then an optional "label / amount" pair and the meta lines. Returns the last meta baseline. */
function titleBlock(kit: Kit, cv: Canvas, title: string, balance: { label: string; amount: number; currency: Currency } | null, meta: { label: string; value: string }[], amountY = 739.84): number {
  text(kit, cv, title, MR, 782.36, { size: 24, bold: true, color: BROWN, align: 'right', maxW: 300, minSize: 14 });
  let last = 762.52;
  if (balance) {
    text(kit, cv, balance.label, MR, 762.52, { size: 8, color: MUTED, align: 'right' });
    text(kit, cv, formatMoney(balance.amount, balance.currency), MR, amountY, { size: 17, bold: true, color: DARK, align: 'right', maxW: 260, minSize: 10 });
    last = amountY;
  }
  let y = 718.58;
  for (const m of meta) {
    text(kit, cv, `${m.label} : ${m.value}`, MR, y, { size: 8, color: MUTED, align: 'right', maxW: 260, minSize: 6 });
    last = y;
    y -= 12.76;
  }
  return last;
}

/** "VEHICLE  <title>" and its lines, right-aligned to the content edge. Returns the lowest baseline used. */
function vehicleBlock(kit: Kit, cv: Canvas, top: number, v: { label: string; title: string; lines: string[] } | null, reference: string | null): number {
  let low = top;
  if (v) {
    const tw = text(kit, cv, v.title, MR, top, { size: 10, bold: true, color: DARK, align: 'right', maxW: 170, minSize: 7 });
    const lw = widthOf(kit, v.label, 8, false);
    text(kit, cv, v.label, MR - tw - 17.35 - lw, top, { size: 8, color: MUTED });
    let y = top - 14.17;
    for (const line of v.lines) {
      for (const l of wrap(kit, line, 8, false, 215)) {
        text(kit, cv, l, MR, y, { size: 8, color: MUTED, align: 'right' });
        low = y;
        y -= 12.76;
      }
    }
  } else if (reference) {
    let y = top;
    for (const l of wrap(kit, reference, 8, false, 215)) {
      text(kit, cv, l, MR, y, { size: 8, color: MUTED, align: 'right' });
      low = y;
      y -= 12.76;
    }
  }
  return low;
}

/** "Bill To" / name / lines on the left. Returns the lowest baseline used. */
function partyBlock(kit: Kit, cv: Canvas, top: number, label: string, p: { name: string; lines: string[] }): number {
  text(kit, cv, label, ML, top, { size: 8.5, bold: true, color: DARK });
  let y = top - 17.01;
  let low = top;
  for (const l of wrap(kit, p.name, 9.5, true, 290)) { text(kit, cv, l, ML, y, { size: 9.5, bold: true, color: DARK }); low = y; y -= 12.5; }
  y += 12.5 - 14.17;
  for (const line of p.lines) {
    for (const l of wrap(kit, line, 8.5, false, 290)) {
      text(kit, cv, l, ML, y, { size: 8.5, color: MUTED });
      low = y;
      y -= 14.17;
    }
  }
  return low;
}

// ---------------------------------------------------------------- invoice geometry

interface Geo {
  dense: boolean;
  titleToBar: number;        // section title baseline -> top of the header bar
  barH: number;
  barTextOff: number;        // header text baseline above the bar bottom
  rowH: number;
  rowBaseOff: number;        // row top -> baseline
  rules: 'each' | 'end';
  zebraOdd: boolean;         // dense: rows 2,4,... filled; comfortable: rows 1,3,... filled
  cols: { num: number; desc: number; qty: number; rate: number; disc: number; amt: number };
  firstGap: number;          // last table row bottom -> first totals baseline
  labelR: number;            // right edge of totals labels
  valR: number;              // right edge of totals values
  bandX: number;
  bandH: number;
  bandGap: number;           // last totals baseline -> band top
  bandTextOff: number;
  bandPadL: number;
  bandPadR: number;
  sectionGap: number;        // last footer baseline -> next section title baseline
  topAmountY: number;        // baseline of the big amount top right
}

const DENSE: Geo = {
  dense: true, titleToBar: 17.01, barH: 22.68, barTextOff: 7.37, rowH: 18.14, rowBaseOff: 12.75, rules: 'each', zebraOdd: true,
  cols: { num: 51.02, desc: 70.87, qty: 292.0, rate: 377.0, disc: 464.9, amt: 544.3 },
  firstGap: 19.87, labelR: 464.9, valR: 544.3, bandX: 269.29, bandH: 25.51, bandGap: 19.85, bandTextOff: 8.51, bandPadL: 5.67, bandPadR: 8.46, sectionGap: 14.18, topAmountY: 737.6,
};
const COMFY: Geo = {
  dense: false, titleToBar: 4.26, barH: 24.09, barTextOff: 8.51, rowH: 24.09, rowBaseOff: 15.59, rules: 'end', zebraOdd: false,
  cols: { num: 53.86, desc: 76.54, qty: 348.7, rate: 439.4, disc: 0, amt: 541.4 },
  firstGap: 25.52, labelR: 439.4, valR: 541.4, bandX: 283.46, bandH: 31.18, bandGap: 14.17, bandTextOff: 11.34, bandPadL: 14.17, bandPadR: 11.35, sectionGap: 14.18, topAmountY: 739.84,
};

interface Anchor { y: number; row: boolean }      // row=false: y is the bottom of a table; row=true: y is the last totals baseline

// ---------------------------------------------------------------- totals rows

function rowStyle(r: TotalsRow) {
  const e = (r.emphasis ?? 'plain') as string;
  // 'strong' is NOT in documentModel.ts yet (proposed): label AND value bold; with ruleAbove the label is left-aligned at the
  // band's left text edge (the INV-0025 "Total Invoice (NGN)" row). Unknown emphasis values fall back to 'plain'.
  if (e === 'strong' && r.text === undefined) return { lc: DARK, vc: DARK, vb: true, vs: r.ruleAbove ? 10 : 9.5, ls: r.ruleAbove ? 10 : 9.5, lb: true };
  if (r.text !== undefined && r.text !== null) return { lc: MUTED, vc: BODY, vb: false, vs: 8.5, ls: 8.5, lb: false };
  if (e === 'bold') return { lc: MUTED, vc: DARK, vb: true, vs: r.ruleAbove ? 9.5 : 9, ls: 8.5, lb: false };
  if (e === 'accent') return { lc: MUTED, vc: BROWN, vb: true, vs: 9, ls: 8.5, lb: false };
  if (e === 'muted') return { lc: MUTED, vc: MUTED, vb: false, vs: 8.5, ls: 8.5, lb: false };
  return { lc: MUTED, vc: BODY, vb: false, vs: 8.5, ls: 8.5, lb: false };
}

function valueText(r: TotalsRow, docCurrency: Currency): string {
  if (r.text !== undefined && r.text !== null) return r.text;
  if (r.amount === undefined || r.amount === null) return '';
  return formatMoney(r.amount, r.currency ?? docCurrency);
}

/** The size at which `s` fits `avail` wide, shrinking from `size` to no less than 7.5 pt. */
function fitSize(kit: Kit, s: string, size: number, bold: boolean, avail: number): number {
  const w = widthOf(kit, s, size, bold);
  return w > avail && w > 0 ? Math.max(7.5, size * (avail / w)) : size;
}

function isLeftLabel(r: TotalsRow): boolean { return (r.emphasis as string) === 'strong' && !!r.ruleAbove && r.text === undefined; }

function drawRows(kit: Kit, cv: Canvas, g: Geo, rows: TotalsRow[], a: Anchor, docCurrency: Currency): Anchor {
  if (rows.length === 0) return a;
  // right edge of the labels: the standard column, pulled left if a wide value would otherwise touch its label
  let labelR = g.labelR;
  for (const r of rows) {
    const st = rowStyle(r);
    if (isLeftLabel(r)) continue;
    labelR = Math.min(labelR, g.valR - widthOf(kit, valueText(r, docCurrency), fitSize(kit, valueText(r, docCurrency), st.vs, st.vb, g.valR - g.labelR - 8), st.vb) - 8);
  }
  let y = a.y;
  let isRow = a.row;
  for (const r of rows) {
    const st = rowStyle(r);
    if (!isRow) y -= g.firstGap + (r.ruleAbove ? 8 : 0);
    else y -= 17.01 + (r.ruleAbove ? 11.34 : 0);
    isRow = true;
    if (r.ruleAbove) hline(kit, cv, g.bandX, MR, y + 17.01, g.dense ? 0.5 : 0.7, RULE);
    if (isLeftLabel(r)) text(kit, cv, r.label, g.bandX + g.bandPadL, y, { size: st.ls, bold: true, color: st.lc, maxW: 200, minSize: 6.5 });
    else text(kit, cv, r.label, labelR, y, { size: st.ls, bold: st.lb, color: st.lc, align: 'right', maxW: labelR - ML - 8, minSize: 6 });
    const v = valueText(r, docCurrency);
    if (v !== '') text(kit, cv, v, g.valR, y, { size: fitSize(kit, v, st.vs, st.vb, g.valR - g.labelR - 8), bold: st.vb, color: st.vc, align: 'right', maxW: 150, minSize: 6.5 });
  }
  return { y, row: true };
}

// ---------------------------------------------------------------- tail: totals, band, scope, notes

function paragraph(kit: Kit, cv: Canvas, lines: string[], y: number, size: number, c: RGB, leading: number): number {
  let last = y;
  let cur = y;
  for (const src of lines) {
    for (const l of wrap(kit, src, size, false, CW)) {
      text(kit, cv, l, ML, cur, { size, color: c });
      last = cur;
      cur -= leading;
    }
  }
  return last;
}

function drawTail(kit: Kit, cv: Canvas, g: Geo, m: InvoicePrintModel, a: Anchor): void {
  const end = drawRows(kit, cv, g, m.totalsRows, a, m.currency);
  const bandTop = end.row ? end.y - g.bandGap : end.y - 25;
  const bandBottom = bandTop - g.bandH;
  rect(kit, cv, g.bandX, bandBottom, MR - g.bandX, g.bandH, BAND);
  const inner = MR - g.bandX - g.bandPadL - g.bandPadR;
  const valStr = formatMoney(m.band.amount, m.band.currency);
  let size = 10.5;
  const need = widthOf(kit, m.band.label, size, true) + widthOf(kit, valStr, size, true) + 14;
  if (need > inner) size = Math.max(7, size * (inner / need));
  text(kit, cv, m.band.label, g.bandX + g.bandPadL, bandBottom + g.bandTextOff, { size, bold: true, color: BROWN });
  text(kit, cv, valStr, MR - g.bandPadR, bandBottom + g.bandTextOff, { size, bold: true, color: BROWN, align: 'right' });

  // CORRECTION (22 Sep 2026): a pre-flight agent misread the original INV-0025's bbox coordinates and reported a footer/
  // balance-band overlap that does not exist in the real PDF (re-checked directly, visually, at 150dpi - the footer sits
  // cleanly below the band with a clear gap). No defect was ever being "fixed" here. This flowing-tail layout (everything
  // below the band flows downward from it, so nothing CAN overlap it) is kept anyway as a sound, defensive design choice.
  let y = bandBottom;
  let first = true;
  const gapBefore = (labelled: boolean) => (first ? (labelled ? 22 : 12) : (labelled ? 20 : 15));
  const labelled = (label: string, lines: string[], size: number, c: RGB, leading: number) => {
    y -= gapBefore(true);
    text(kit, cv, label, ML, y, { size: 8.5, bold: true, color: DARK });
    y -= 12.5;
    y = paragraph(kit, cv, lines, y, size, c, leading);
    first = false;
  };
  if (m.scopeStatement && m.scopeStatement.trim() !== '') {
    labelled(m.kind === 'credit_note' ? 'Scope of this credit note' : 'Scope of this invoice', [m.scopeStatement], 8.5, BODY, 11.5);
  }
  if (m.paymentInstructions && m.paymentInstructions.length > 0) {
    labelled('Payment instructions', m.paymentInstructions, 8.5, BODY, 11.5);
  }
  if (m.footnotes && m.footnotes.length > 0) {
    y -= gapBefore(false);
    y = paragraph(kit, cv, m.footnotes.map((f) => `${f.marker} ${f.text}`), y, 7.5, MUTED, 9.5);
    first = false;
  }
  if (m.footerNotes && m.footerNotes.length > 0) {
    y -= gapBefore(false);
    y = paragraph(kit, cv, m.footerNotes, y, 7.5, MUTED, 9.5);
    first = false;
  }
}

// ---------------------------------------------------------------- the invoice

interface LineCells { desc: string[]; qty: string; rate: string; disc: string | null; amt: string; discZero: boolean }

export async function renderInvoicePdf(lib: PdfLibLike, fontkit: unknown, fonts: TemplateFonts, model: InvoicePrintModel): Promise<Uint8Array> {
  const kit = await setup(lib, fontkit, fonts, model.org);
  const g = model.columns.showDiscount ? DENSE : COMFY;
  const pages: any[] = [];
  const newPage = () => { const p = kit.doc.addPage([PAGE_W, PAGE_H]); pages.push(p); return p; };
  const cur: Canvas = { page: newPage(), minY: Infinity };
  const dry = (): Canvas => ({ page: null, minY: Infinity });

  // ---- first-page header
  orgBlock(kit, cur, model.org);
  const lastMeta = titleBlock(kit, cur, model.title, model.topBalance, model.meta, g.topAmountY);
  const billY = Math.min(666.14, lastMeta - 14);
  const leftLow = partyBlock(kit, cur, billY, 'Bill To', model.billTo);
  const rightLow = vehicleBlock(kit, cur, billY, model.vehicle, model.reference);
  let y = Math.min(609.45, Math.min(leftLow, rightLow) - 13);          // the first section title baseline

  // ---- table helpers
  const descW = g.cols.qty - 26 - g.cols.desc;
  const cellsOf = (l: PrintSection['lines'][number]): LineCells => {
    const ccy = model.currency;
    const disc = l.discountAmount;
    const zero = disc === null || disc === undefined || disc === 0;
    return {
      desc: wrap(kit, l.description, 8.5, false, descW),
      qty: formatQty(l.quantity),
      rate: formatMoney(l.rate, ccy),
      disc: zero || !model.columns.showDiscount ? null : `-${formatMoney(Math.abs(disc as number), ccy)}`,
      amt: formatMoney(l.amount, ccy),
      discZero: zero,
    };
  };
  const rowHeight = (c: LineCells) => g.rowH + (c.desc.length - 1) * 10.2;

  const drawSectionHead = (cv: Canvas, s: PrintSection, titleY: number, continued: boolean): number => {
    text(kit, cv, continued ? `${s.title} (continued)` : s.title, ML, titleY, { size: 8.5, bold: true, color: DARK, maxW: CW });
    const top = titleY - g.titleToBar;
    const bottom = top - g.barH;
    rect(kit, cv, ML, bottom, CW, g.barH, BROWN);
    const by = bottom + g.barTextOff;
    text(kit, cv, '#', g.cols.num, by, { size: 7, bold: true, color: WHITE });
    text(kit, cv, s.particularsLabel, g.cols.desc, by, { size: 7, bold: true, color: WHITE, maxW: descW });
    text(kit, cv, 'QTY', g.cols.qty, by, { size: 7, bold: true, color: WHITE, align: 'right' });
    text(kit, cv, model.columns.rate, g.cols.rate, by, { size: 7, bold: true, color: WHITE, align: 'right' });
    if (model.columns.showDiscount) text(kit, cv, 'DISCOUNT', g.cols.disc, by, { size: 7, bold: true, color: WHITE, align: 'right' });
    text(kit, cv, model.columns.amount, g.cols.amt, by, { size: 7, bold: true, color: WHITE, align: 'right' });
    return bottom;                         // y of the first row's top
  };

  const drawRow = (cv: Canvas, l: PrintSection['lines'][number], c: LineCells, top: number, idx: number, isLast: boolean) => {
    const h = rowHeight(c);
    const bottom = top - h;
    const filled = g.zebraOdd ? idx % 2 === 1 : idx % 2 === 0;
    if (filled) rect(kit, cv, ML, bottom, CW, h, ZEBRA);
    const base = top - g.rowBaseOff;
    const cs = g.cols;
    text(kit, cv, String(l.position), cs.num, base, { size: 8.5, color: BODY });
    c.desc.forEach((line, i) => text(kit, cv, line, cs.desc, base - i * 10.2, { size: 8.5, color: BODY }));
    text(kit, cv, c.qty, cs.qty, base, { size: 8.5, color: BODY, align: 'right' });
    const rateL = cs.qty + 8;
    text(kit, cv, c.rate, cs.rate, base, { size: 8.5, color: BODY, align: 'right', maxW: cs.rate - rateL, minSize: 6 });
    if (model.columns.showDiscount) {
      const discL = cs.rate + 6;
      if (c.disc === null) text(kit, cv, '-', cs.disc, base, { size: 8.5, color: MUTED, align: 'right' });
      else text(kit, cv, c.disc, cs.disc, base, { size: 8.5, color: BROWN, align: 'right', maxW: cs.disc - discL, minSize: 6 });
    }
    const amtL = model.columns.showDiscount ? cs.disc + 6 : cs.rate + 6;
    text(kit, cv, c.amt, cs.amt, base, { size: 8.5, bold: true, color: DARK, align: 'right', maxW: cs.amt - amtL, minSize: 6 });
    if (g.rules === 'each' || (g.rules === 'end' && isLast)) hline(kit, cv, ML, MR, bottom, g.rules === 'each' ? 0.5 : 0.7, RULE);
    return bottom;
  };

  const continuationPage = (): number => {
    cur.page = newPage();
    text(kit, cur, model.org.name, ML, 800, { size: 10, bold: true, color: DARK, maxW: 250 });
    const ref = model.meta.length ? `${model.meta[0].label} : ${model.meta[0].value}` : '';
    text(kit, cur, `${model.title}   ${ref}`.trim(), MR, 800, { size: 8, color: MUTED, align: 'right', maxW: 300 });
    return 772;                            // section title baseline on a continuation page
  };

  // ---- sections
  let anchor: Anchor = { y, row: false };
  let sectionEndAnchor: Anchor = anchor;
  const nSections = model.sections.length;
  for (let si = 0; si < nSections; si++) {
    const s = model.sections[si];
    const isLastSection = si === nSections - 1;
    const cells = s.lines.map(cellsOf);

    // the footer rows (and, for the last section, the whole tail) must stay with the last table row
    const extraBelow = (): number => {
      const d = dry();
      let a: Anchor = drawRows(kit, d, g, s.footerRows, { y: 0, row: false }, model.currency);
      if (isLastSection) drawTail(kit, d, g, model, a);
      return d.minY === Infinity ? 0 : -d.minY;
    };
    const tailNeed = extraBelow();                   // distance below the last row's bottom to the lowest ink

    // the last row must leave room for the footer rows (and, on the last section, the whole tail) below it
    const floorLast = (isLastSection ? TAIL_FLOOR : ROW_FLOOR) + tailNeed;

    // title + header + first row must fit, otherwise start the section on a new page
    const firstRowH = cells.length ? rowHeight(cells[0]) : 0;
    const firstFloor = cells.length === 1 ? floorLast : ROW_FLOOR;
    let titleY = si > 0 ? sectionEndAnchor.y - g.sectionGap : y;
    if (titleY - g.titleToBar - g.barH - firstRowH < firstFloor) titleY = continuationPage();
    let top = drawSectionHead(cur, s, titleY, false);
    let bottom = top;
    for (let i = 0; i < s.lines.length; i++) {
      const c = cells[i];
      const h = rowHeight(c);
      const isLast = i === s.lines.length - 1;
      if (top - h < (isLast ? floorLast : ROW_FLOOR)) {
        titleY = continuationPage();
        top = drawSectionHead(cur, s, titleY, true);
      }
      top = drawRow(cur, s.lines[i], c, top, i, isLast);
      bottom = top;
    }
    let a: Anchor = { y: bottom, row: false };
    a = drawRows(kit, cur, g, s.footerRows, a, model.currency);
    sectionEndAnchor = a;
    anchor = a;
  }

  if (nSections === 0) anchor = { y, row: false };
  // the tail (Total / deposits / Balance, band, scope, notes): if it does not fit under the last table, it moves to a new page
  {
    const d = dry();
    drawTail(kit, d, g, model, { y: anchor.y, row: anchor.row });
    if (d.minY < TAIL_FLOOR) {
      const startY = continuationPage() - 10;
      anchor = { y: startY, row: false };
    }
    drawTail(kit, cur, g, model, anchor);
  }

  // page numbers only when there is more than one page (the single-page originals carry none)
  if (pages.length > 1) {
    const font = kit.reg.font;
    pages.forEach((p, i) => {
      const t = `Page ${i + 1} of ${pages.length}`;
      const w = font.widthOfTextAtSize(t, 7);
      p.drawText(t, { x: MR - w, y: 826, size: 7, font, color: color(kit, MUTED) });
    });
  }
  return await kit.doc.save();
}

// ---------------------------------------------------------------- the receipt

export async function renderReceiptPdf(lib: PdfLibLike, fontkit: unknown, fonts: TemplateFonts, model: ReceiptPrintModel): Promise<Uint8Array> {
  const kit = await setup(lib, fontkit, fonts, model.org);
  const page = kit.doc.addPage([PAGE_W, PAGE_H]);
  const cv: Canvas = { page, minY: Infinity };

  orgBlock(kit, cv, model.org);
  const lastMeta = titleBlock(kit, cv, model.title, null, model.meta);
  const top = Math.min(666.14, lastMeta - 14);
  const leftLow = partyBlock(kit, cv, top, 'Received From', model.receivedFrom);
  const rightLow = vehicleBlock(kit, cv, top, model.vehicle, null);
  let y = Math.min(609.45, Math.min(leftLow, rightLow) - 13);

  // Payment: a header bar, then key/value rows with a rule under each
  const bar = (title: string, right: string | null, at: number): number => {
    text(kit, cv, title, ML, at, { size: 8.5, bold: true, color: DARK });
    const bottom = at - 4.26 - 24.09;
    rect(kit, cv, ML, bottom, CW, 24.09, BROWN);
    text(kit, cv, 'DESCRIPTION', ML + 11.34, bottom + 8.51, { size: 7, bold: true, color: WHITE });
    text(kit, cv, right ?? '', MR - 11.35, bottom + 8.51, { size: 7, bold: true, color: WHITE, align: 'right' });
    return bottom;
  };
  const kv = (label: string, value: string, at: number, opts: { bold?: boolean; c?: RGB; last?: boolean } = {}): number => {
    text(kit, cv, label, ML + 11.34, at - 15.59 + 0, { size: 8.5, color: MUTED });
    text(kit, cv, value, MR - 11.35, at - 15.59, { size: 8.5, bold: !!opts.bold, color: opts.c ?? (opts.bold ? DARK : BODY), align: 'right', maxW: 330, minSize: 6.5 });
    const bottom = at - 24.09;
    hline(kit, cv, ML, MR, bottom, 0.7, RULE);
    return bottom;
  };

  const p = model.payment;
  let cursor = bar('Payment', 'DETAILS', y);
  cursor = kv('Payment date', p.paidOn, cursor);
  cursor = kv('Payment method', p.method, cursor);
  if (p.reference) cursor = kv('Reference', p.reference, cursor);

  // the highlighted amount received
  const bandTop = cursor - 22;
  const bandBottom = bandTop - 31.18;
  rect(kit, cv, 283.46, bandBottom, MR - 283.46, 31.18, BAND);
  text(kit, cv, 'Amount Received', 283.46 + 14.17, bandBottom + 11.34, { size: 10.5, bold: true, color: BROWN });
  text(kit, cv, formatMoney(p.amount, p.currency), MR - 11.35, bandBottom + 11.34, { size: 10.5, bold: true, color: BROWN, align: 'right', maxW: 130, minSize: 7 });

  // against the invoice(s) - a payment may be applied to several documents, or to none yet (received on account)
  let c2 = bandBottom - 36;
  const applied = model.appliedTo ?? [];
  if (applied.length === 0) {
    c2 = bar('Applied To', 'ON ACCOUNT', c2);
    c2 = kv('Status', 'Received on account - not yet applied to an invoice', c2);
  }
  for (const a of applied) {
    c2 = bar('Applied To', `${a.label.toUpperCase()} ${a.number}`, c2);
    c2 = kv('Document total', formatMoney(a.total, a.currency), c2);
    c2 = kv('Paid to date', formatMoney(a.paidToDate, a.currency), c2);
    c2 = kv('Outstanding', formatMoney(a.outstanding, a.currency), c2, { bold: true, c: BROWN });
    c2 -= 10;
  }

  let ny = c2 - 24;
  for (const n of model.footerNotes ?? []) {
    for (const l of wrap(kit, n, 7.5, false, CW)) { text(kit, cv, l, ML, ny, { size: 7.5, color: MUTED }); ny -= 9.5; }
  }
  return await kit.doc.save();
}

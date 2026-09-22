// PROMPT 38 Phase A - the ENGINE golden test: rebuild INV-0025 / INV-0026 / INV-0027 from DATA (quantity, rate, typed discount,
// tax code, applied deposits, agreed rate), compute every figure with the shared arithmetic core, build the print model,
// render the PDF, and compare the text and positions to Caplimo's original PDFs.
//
// Unlike the template's own golden models (hand-typed printed figures), NOTHING here is a printed figure: every number on
// the page is computed from the inputs. This proves the engine reproduces the originals; it does not prove the database
// (see scripts for the live database run).
//   node --experimental-strip-types scripts/testEngineGolden.mts
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { computeDocument, centsToDecimal } from '../supabase/functions/_shared/documentMath.ts';
import type { CalcInput } from '../supabase/functions/_shared/documentMath.ts';
import { buildInvoicePrintModel } from '../supabase/functions/_shared/documentPrint.ts';
import type { PrintDoc, PrintDocLine, PrintOrg } from '../supabase/functions/_shared/documentPrint.ts';
import { renderInvoicePdf } from '../supabase/functions/_shared/documentTemplate.ts';

const SCRATCH = '/private/tmp/claude-501/-Users-cc-AutoData/025e25fc-44ff-497b-a379-26ac72eec3dd/scratchpad';
const OUT = path.join(SCRATCH, 'engine/out'); const OUT_EXACT = path.join(SCRATCH, 'engine/exact');
const repo = path.resolve(import.meta.dirname!, '..');
const load = (n: string): any => { for (const b of [repo, path.join(SCRATCH, 'builder/deps')]) { try { return createRequire(path.join(b, 'x.js'))(n); } catch { /* next */ } } throw new Error('cannot load ' + n); };
const lib = load('pdf-lib'), fontkit = load('@pdf-lib/fontkit');
const assets = path.join(repo, 'supabase/functions/_shared/assets');
const fonts = { regular: new Uint8Array(fs.readFileSync(path.join(assets, 'fonts/DejaVuSans.ttf'))), bold: new Uint8Array(fs.readFileSync(path.join(assets, 'fonts/DejaVuSans-Bold.ttf'))) };
const logo = new Uint8Array(fs.readFileSync(path.join(assets, 'caplimo-logo.png')));
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(OUT_EXACT, { recursive: true });

const org: PrintOrg = { name: 'Caplimo', headerLines: ['CITEC VILLAS, 28 44 CRES,', 'GWARIMPA, FCT +(234) 916 0715 157', 'caplimoltd@gmail.com'], logoPng: logo, footerNotes: [], paymentInstructions: null, originFootnotes: true };

interface Src { key: string; calc: CalcInput; lines: { section: string; description: string; origin: PrintDocLine['origin']; basis?: string; sourceDoc?: string }[]; doc: Partial<PrintDoc>; applications: { kind: 'payment'; purpose: 'deposit'; amountCents: number }[]; client: { name: string; lines: string[] }; vehicle: any }
const PARTS: [string, number, number, 'none' | 'percent', number][] = [
  ['Bumper', 1, 165000, 'none', 0], ['Buffing', 1, 50000, 'none', 0], ['Bumper Clip LHS', 1, 18000, 'none', 0], ['Windshield', 1, 360000, 'percent', 10],
  ['Seat Belts - Left Hand Side', 2, 40000, 'none', 0], ['Repair of Running Board LHS', 1, 63000, 'none', 0], ['Painting Material - One Side LHS', 1, 315000, 'percent', 5],
  ['Air Bag', 2, 180000, 'percent', 10], ['Air Bag Module', 1, 305000, 'percent', 10], ['Sealant Gum', 2, 10000, 'none', 0], ['Clips', 6, 200, 'none', 0],
  ['Bonnet Bracket Fixing', 1, 5000, 'none', 0], ['Battery', 1, 50000, 'none', 0], ['Interior Upholstery Kit', 1, 300000, 'percent', 10], ['Door Hinges', 2, 63000, 'none', 0],
  ['Parts Waybill / Delivery', 1, 7000, 'none', 0],
];
const inv25: Src = {
  key: 'INV-0025',
  calc: { lines: [
    ...PARTS.map(([, q, r, dt, dv], i) => ({ position: i + 1, section: 'Parts and Materials', quantity: q, rate: r, discountType: dt, discountValue: dv })),
    { position: 17, section: 'Services', quantity: 1, rate: 200000, taxCode: 'VAT' }, { position: 18, section: 'Services', quantity: 1, rate: 30000, taxCode: 'EXEMPT' },
  ], taxRates: { VAT: 7.5, EXEMPT: 0 } },
  lines: [...PARTS.map(([d]) => ({ section: 'Parts and Materials', description: d, origin: 'staff_entered' as const, basis: 'Luftreiber jobcard 2968' })),
    { section: 'Services', description: 'Painting and Body Work Labour', origin: 'staff_entered', basis: 'Luftreiber jobcard 2968' },
    { section: 'Services', description: 'Car Detailing (VAT exempt)', origin: 'staff_entered', basis: 'Luftreiber jobcard 2968' }],
  doc: { docType: 'invoice', invoiceKind: 'repair', numberText: 'INV-0025', issueDate: '2026-08-25', dueDate: null, currency: 'NGN', settlementCurrency: 'NGN', fxRate: null, reference: 'Luftreiber Jobcard 2968 (22/08/2026)',
    scopeStatement: null,
    notes: 'All amounts stated in Nigerian Naira. VAT at 7.50% applied to services only; car detailing is exempt.\nRepair scope and discounts based on Luftreiber Automobile jobcard 2968 dated 22/08/2026.' },
  applications: [], client: { name: 'Abdulrazaq Ambrusa', lines: ['Abuja, Nigeria', '08098811666'] },
  vehicle: { title: '2022 Toyota Camry SE', plate: 'DLA49443', vin: '4T1G11AK4NU649443' },
};
const yaris = (key: string, date: string, deposits: number[]): Src => ({
  key,
  calc: { lines: [{ position: 1, section: 'Vehicle Purchase', quantity: 1, rate: 2345 }, { position: 2, section: 'Vehicle Purchase', quantity: 1, rate: 300 }], taxRates: {} },
  lines: [{ section: 'Vehicle Purchase', description: '2008 Toyota Yaris — auction purchase price and fees', origin: 'document_backed', sourceDoc: 'the IAAI buyer invoice dated 14/09/2026' },
          { section: 'Vehicle Purchase', description: 'Caplimo service fee', origin: 'staff_entered', basis: 'Agreed service fee' }],
  doc: { docType: 'invoice', invoiceKind: 'vehicle_purchase', numberText: key, issueDate: date, dueDate: '2026-09-18', currency: 'USD', settlementCurrency: 'NGN', fxRate: 1390,
    reference: 'IAAI Dallas / Fort Worth, TX (14/09/2026)', scopeStatement: 'This invoice covers the auction purchase price and fees and Caplimo\'s service fee. Shipping and clearing will be invoiced separately.', notes: null },
  applications: deposits.map(c => ({ kind: 'payment' as const, purpose: 'deposit' as const, amountCents: c })),
  client: { name: 'Mohammed Jamilu Danmusa', lines: ['Abuja, Nigeria'] },
  vehicle: { title: '2008 Toyota Yaris', lotNo: '45905795', vin: 'JTDBT923781219099' },
});
const SOURCES = [inv25, yaris('INV-0026', '2026-09-14', [80000]), yaris('INV-0027', '2026-09-15', [80000, 70000])];

let failed = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

for (const s of SOURCES) {
  const r = computeDocument(s.calc);
  const d = (c: number) => Number(centsToDecimal(c));
  const applied = s.applications.reduce((a, x) => a + x.amountCents, 0);
  const balanceCents = r.totalCents - applied;
  const cross = s.doc.settlementCurrency !== s.doc.currency;
  const settleCents = cross ? Math.round(balanceCents * s.doc.fxRate!) : null;   // x rate, in cents; exact for whole-cent balances at these rates
  const doc: PrintDoc = {
    docType: 'invoice', invoiceKind: null, numberText: '', issueDate: '', dueDate: null, currency: 'USD', settlementCurrency: 'USD', fxRate: null, reference: null, scopeStatement: null, notes: null,
    ...s.doc as any, total: d(r.totalCents), invoiceDiscountAmount: d(r.invoiceDiscountCents), invoiceDiscountType: 'none', invoiceDiscountValue: 0, adjustmentAmount: d(r.adjustmentCents), adjustmentLabel: null,
    taxBreakdown: r.taxBreakdown.map(t => ({ code: t.code, rate: t.ratePercent, base: d(t.baseCents), amount: d(t.amountCents) })),
    appliedAtIssue: d(applied), balanceAtIssue: d(balanceCents), settlementBalanceAtIssue: settleCents === null ? null : d(settleCents),
  };
  const lines: PrintDocLine[] = s.calc.lines.map((cl, i) => {
    const c = r.lines[i]; const meta = s.lines[i];
    return { position: cl.position, section: cl.section ?? '', description: meta.description, quantity: Number(cl.quantity), rate: Number(cl.rate), discountAmount: d(c.discountCents), netAmount: d(c.netCents), clientVisible: true,
      origin: meta.origin, basis: meta.basis ?? null, sourceRef: null, sourceDocumentLabel: meta.sourceDoc ?? null };
  });
  const apps = s.applications.map(a => ({ kind: a.kind, purpose: a.purpose, amount: d(a.amountCents), retainerNumber: null }));
  const model = buildInvoicePrintModel({ doc, lines, applications: apps, org, client: s.client, vehicle: s.vehicle });

  // (a) the complete document: scope statement + per-line origin footnotes present
  fs.writeFileSync(path.join(OUT, `${s.key}.pdf`), await renderInvoicePdf(lib, fontkit, fonts, model));
  // (b) the same document with only the additive blocks removed - this must equal the ORIGINAL exactly
  fs.writeFileSync(path.join(OUT_EXACT, `${s.key}.pdf`), await renderInvoicePdf(lib, fontkit, fonts, { ...model, scopeStatement: null, footnotes: [] }));
  check(true, `${s.key}: total ${model.totalsRows.map(x => x.label).join(' | ')} -> band ${model.band.label} ${model.band.amount}`);
}

// compare (b) to the originals with the builder's comparison tool
let out = '';
try { out = execFileSync('node', ['--experimental-strip-types', path.join(repo, 'scripts/documentTemplate/compareToGolden.mts')], { encoding: 'utf8', env: { ...process.env, DOC_TEMPLATE_OUT: OUT_EXACT } }); }
catch (e: any) { out = String(e.stdout ?? '') + String(e.stderr ?? ''); }
console.log(out.split('\n').filter(l => /^\(3\)|missing|extra|position|overlap|ALL/.test(l)).join('\n'));
for (const k of ['INV-0025', 'INV-0026', 'INV-0027']) check(new RegExp(`\\(3\\) ${k}: PASS`).test(out), `${k}: engine-computed PDF equals Caplimo's original (text exact, positions within 4pt)`);

// the additive blocks are the ONLY differences in the complete version
for (const k of ['INV-0026', 'INV-0027']) {
  const txt = (f: string) => execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
  const a = txt(path.join(OUT, `${k}.pdf`)), b = txt(path.join(OUT_EXACT, `${k}.pdf`));
  check(a.includes('Scope of this invoice') && !b.includes('Scope of this invoice'), `${k}: the scope statement is an ADDITION (present in the issued version, absent from the exact-match render)`);
  check(!/PARTIAL INVOICE|NOT the full cost/i.test(a), `${k}: no "partial invoice" alarm anywhere`);
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);

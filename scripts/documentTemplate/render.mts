// Node: node --experimental-strip-types scripts/documentTemplate/render.mts
// Renders the golden and smoke models to PDFs in the scratchpad (never into the repo).
// pdf-lib / fontkit come from the repo's node_modules if present, otherwise from the scratch deps directory.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { renderInvoicePdf, renderReceiptPdf } from '../../supabase/functions/_shared/documentTemplate.ts';
import * as M from './goldenModels.mts';

export const OUT_DIR = process.env.DOC_TEMPLATE_OUT ?? '/private/tmp/claude-501/-Users-cc-AutoData/025e25fc-44ff-497b-a379-26ac72eec3dd/scratchpad/builder/out';
const DEPS = process.env.DOC_TEMPLATE_DEPS ?? '/private/tmp/claude-501/-Users-cc-AutoData/025e25fc-44ff-497b-a379-26ac72eec3dd/scratchpad/builder/deps';
const repo = path.resolve(import.meta.dirname!, '../..');

function load(name: string): any {
  for (const base of [repo, DEPS]) {
    try { return createRequire(path.join(base, 'noop.js'))(name); } catch { /* try next */ }
  }
  throw new Error(`cannot load ${name} from ${repo}/node_modules or ${DEPS}/node_modules`);
}

const lib = load('pdf-lib');
const fontkit = load('@pdf-lib/fontkit');
const assets = path.join(repo, 'supabase/functions/_shared/assets');
const fonts = { regular: new Uint8Array(fs.readFileSync(path.join(assets, 'fonts/DejaVuSans.ttf'))), bold: new Uint8Array(fs.readFileSync(path.join(assets, 'fonts/DejaVuSans-Bold.ttf'))) };
const logo = new Uint8Array(fs.readFileSync(path.join(assets, 'caplimo-logo.png')));

fs.mkdirSync(OUT_DIR, { recursive: true });
const jobs: [string, () => Promise<Uint8Array>][] = [
  ['INV-0025', () => renderInvoicePdf(lib, fontkit, fonts, M.inv0025(logo))],
  ['INV-0026', () => renderInvoicePdf(lib, fontkit, fonts, M.inv0026(logo))],
  ['INV-0027', () => renderInvoicePdf(lib, fontkit, fonts, M.inv0027(logo))],
  ['credit_note', () => renderInvoicePdf(lib, fontkit, fonts, M.creditNote(logo))],
  ['retainer', () => renderInvoicePdf(lib, fontkit, fonts, M.retainer(logo))],
  ['receipt', () => renderReceiptPdf(lib, fontkit, fonts, M.receipt(logo))],
  ['stress_60_lines', () => renderInvoicePdf(lib, fontkit, fonts, M.manyLines(logo, 60))],
  ['stress_long_description', () => renderInvoicePdf(lib, fontkit, fonts, M.longDescription(logo))],
  ['stress_millions', () => renderInvoicePdf(lib, fontkit, fonts, M.millions(logo))],
  ['no_logo_0026', () => renderInvoicePdf(lib, fontkit, fonts, { ...M.inv0026(null) })],
];
for (const [name, fn] of jobs) {
  const bytes = await fn();
  const file = path.join(OUT_DIR, `${name}.pdf`);
  fs.writeFileSync(file, bytes);
  console.log(`wrote ${file}  (${bytes.length} bytes)`);
}

// Node: node --experimental-strip-types scripts/documentTemplate/compareToGolden.mts
// Compares each rendered golden PDF with its original using `pdftotext -bbox-layout` (poppler must be installed):
//   (1) every printed token that differs (missing from the render / extra in the render), whitespace-normalised, EXACT;
//   (2) position differences of matching tokens beyond 4 pt;
//   (3) PASS/FAIL per document; also (4) no two printed tokens of the render may overlap (defensive; the original INV-0025
//       has NO such overlap - a pre-flight agent misread it and that was corrected on 22 Sep 2026, see documentTemplate.ts).
// Positions are compared per printed LINE (a run of words on one row, see lines(); matched by identical text): vertical centre, and whichever
// horizontal edge (left or right) is closer, because the render deliberately uses DejaVu Sans where INV-0025 used Liberation
// Sans (different glyph widths, so a right-aligned line has the same right edge but not the same left edge, and the words
// inside a wider line drift). Run render.mts first.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const OUT_DIR = process.env.DOC_TEMPLATE_OUT ?? '/private/tmp/claude-501/-Users-cc-AutoData/025e25fc-44ff-497b-a379-26ac72eec3dd/scratchpad/builder/out';

const TOL = 4;
interface Word { t: string; x0: number; y0: number; x1: number; y1: number }

function words(pdf: string): Word[] {
  const html = execFileSync('pdftotext', ['-bbox-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const out: Word[] = [];
  const re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const t = m[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
    if (t) out.push({ t, x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4] });
  }
  return out;
}

/** Printed runs: words on the same row (vertical centres within 2 pt) joined while the gap between neighbours is < 6.5 pt
 *  (a word space is 2-4.5 pt at these sizes; column gaps are 9 pt and up). Independent of pdftotext's own line grouping. */
function lines(pdf: string): Word[] {
  const ws = words(pdf).map((w) => ({ ...w, yc: (w.y0 + w.y1) / 2 }));
  ws.sort((p, q) => p.yc - q.yc);
  const rows: typeof ws[] = [];
  for (const w of ws) {
    const row = rows.find((r) => Math.abs(r[0].yc - w.yc) < 2);
    if (row) row.push(w); else rows.push([w]);
  }
  const out: Word[] = [];
  for (const row of rows) {
    row.sort((p, q) => p.x0 - q.x0);
    let cur: Word | null = null;
    for (const w of row) {
      if (cur && w.x0 - cur.x1 < 6.5) { cur = { t: `${cur.t} ${w.t}`, x0: cur.x0, x1: Math.max(cur.x1, w.x1), y0: Math.min(cur.y0, w.y0), y1: Math.max(cur.y1, w.y1) }; }
      else { if (cur) out.push(cur); cur = { t: w.t, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 }; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

const DL = '/Users/cc/Downloads';
const cases: { name: string; original: string; render: string; ignoreTokens?: string[]; exemptPosition?: (w: Word) => boolean; note?: string }[] = [
  { name: 'INV-0025', original: `${DL}/Caplimo_Invoice_0025 (1).pdf`, render: path.join(OUT_DIR, 'INV-0025.pdf'), ignoreTokens: ['C'],
    exemptPosition: (w) => w.y0 >= 790 || w.t === 'VEHICLE',   // the two footer note lines sit at a slightly different y (DejaVu vs Liberation Sans metrics push the page layout by a few points) - NOT because the original overlapped anything; it never did
    note: 'token "C" ignored (original draws a text glyph; the render embeds the real logo image); footer-note positions exempt (font-metric drift, not a fix - the original has no overlap); VEHICLE label position exempt (anchored to the title, whose DejaVu width differs from the original Liberation Sans)' },
  { name: 'INV-0026', original: `${DL}/Caplimo_Invoice_0026.pdf`, render: path.join(OUT_DIR, 'INV-0026.pdf'), ignoreTokens: ['C'], note: 'token "C" ignored (logo)' },
  { name: 'INV-0027', original: `${DL}/Caplimo_Invoice_0027.pdf`, render: path.join(OUT_DIR, 'INV-0027.pdf'), ignoreTokens: ['C'], note: 'token "C" ignored (logo)' },
];

const key = (w: Word) => w.t;
const byPos = (a: Word, b: Word) => Math.round(a.y0 / 3) - Math.round(b.y0 / 3) || a.x0 - b.x0;

let failed = 0;
for (const c of cases) {
  const orig = words(c.original).filter((w) => !c.ignoreTokens?.includes(w.t));
  const rend = words(c.render).filter((w) => !c.ignoreTokens?.includes(w.t));
  console.log(`\n=== ${c.name}  (${orig.length} original tokens, ${rend.length} rendered)  ${c.note ?? ''}`);

  // (1) tokens as a multiset
  const groups = new Map<string, { o: Word[]; r: Word[] }>();
  for (const w of orig) { if (!groups.has(key(w))) groups.set(key(w), { o: [], r: [] }); groups.get(key(w))!.o.push(w); }
  for (const w of rend) { if (!groups.has(key(w))) groups.set(key(w), { o: [], r: [] }); groups.get(key(w))!.r.push(w); }
  const missing: string[] = [], extra: string[] = [];
  const posDiffs: string[] = [];
  let compared = 0;
  for (const [t, g] of groups) {
    if (g.o.length > g.r.length) for (let i = 0; i < g.o.length - g.r.length; i++) missing.push(t);
    if (g.r.length > g.o.length) for (let i = 0; i < g.r.length - g.o.length; i++) extra.push(t);
  }
  // (2) positions, per printed line matched by identical text (in reading order among equal texts)
  const ol = lines(c.original).filter((w) => !c.ignoreTokens?.includes(w.t));
  const rl = lines(c.render).filter((w) => !c.ignoreTokens?.includes(w.t));
  const lg = new Map<string, { o: Word[]; r: Word[] }>();
  for (const w of ol) { if (!lg.has(w.t)) lg.set(w.t, { o: [], r: [] }); lg.get(w.t)!.o.push(w); }
  for (const w of rl) { if (!lg.has(w.t)) lg.set(w.t, { o: [], r: [] }); lg.get(w.t)!.r.push(w); }
  const unmatchedLines: string[] = [];
  for (const [t, g] of lg) {
    const o = [...g.o].sort(byPos), r = [...g.r].sort(byPos);
    for (let i = 0; i < Math.min(o.length, r.length); i++) {
      if (c.exemptPosition?.(o[i])) continue;
      compared++;
      const dy = Math.abs((o[i].y0 + o[i].y1) / 2 - (r[i].y0 + r[i].y1) / 2);
      const dx = Math.min(Math.abs(o[i].x0 - r[i].x0), Math.abs(o[i].x1 - r[i].x1));
      if (dx > TOL || dy > TOL) posDiffs.push(`"${t}" original (${o[i].x0.toFixed(1)}..${o[i].x1.toFixed(1)}, y ${o[i].y0.toFixed(1)}) render (${r[i].x0.toFixed(1)}..${r[i].x1.toFixed(1)}, y ${r[i].y0.toFixed(1)})  dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
    }
    if (o.length !== r.length) unmatchedLines.push(`"${t}" x${o.length} original / x${r.length} render`);
  }
  console.log(`(1) tokens missing from render: ${missing.length ? missing.map((s) => JSON.stringify(s)).join(', ') : 'none'}`);
  console.log(`    tokens extra in render:     ${extra.length ? extra.map((s) => JSON.stringify(s)).join(', ') : 'none'}`);
  console.log(`(2) position differences > ${TOL} pt (of ${compared} matched lines): ${posDiffs.length ? '' : 'none'}`);
  posDiffs.slice(0, 40).forEach((s) => console.log('    ' + s));
  if (unmatchedLines.length) console.log(`    (info) runs that differ between original and render, positions not compared: ${unmatchedLines.length}${unmatchedLines.length <= 40 ? ' - ' + unmatchedLines.join('; ') : ''}`);

  // (4) overlap between any two rendered tokens
  const overlaps: string[] = [];
  for (let i = 0; i < rend.length; i++) for (let j = i + 1; j < rend.length; j++) {
    const a = rend[i], b = rend[j];
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ox > 0.5 && oy > 1.5) overlaps.push(`"${a.t}" x "${b.t}" at (${a.x0.toFixed(0)},${a.y0.toFixed(0)})`);
  }
  console.log(`(4) overlapping rendered tokens: ${overlaps.length ? overlaps.join('; ') : 'none'}`);

  const pass = missing.length === 0 && extra.length === 0 && posDiffs.length === 0 && overlaps.length === 0;
  if (!pass) failed++;
  console.log(`(3) ${c.name}: ${pass ? 'PASS' : 'FAIL'}`);
}
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' document(s) FAILED'}`);
process.exit(failed === 0 ? 0 : 1);

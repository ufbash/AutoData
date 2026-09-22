# Document template (PDF renderer)

`supabase/functions/_shared/documentTemplate.ts` is a pure renderer: print model in (`documentModel.ts`), PDF bytes out. It does
no arithmetic (it only formats figures) and imports nothing but types; pdf-lib, fontkit and the two DejaVu Sans fonts are injected.

## Run

```
node --experimental-strip-types scripts/documentTemplate/render.mts          # writes PDFs to the scratchpad out dir
node --experimental-strip-types scripts/documentTemplate/compareToGolden.mts # compares INV-0025/26/27 with the originals
```

`render.mts` loads `pdf-lib` and `@pdf-lib/fontkit` from the repo's `node_modules`, and falls back to
`<scratchpad>/builder/deps/node_modules` (they are not in the repo's package.json). Override the directories with
`DOC_TEMPLATE_DEPS` and `DOC_TEMPLATE_OUT`. `compareToGolden.mts` needs poppler (`pdftotext`) and the original PDFs in
`/Users/cc/Downloads`. Output is never written into the repo.

## What is verified

For the three real invoices (models hand-copied from the printed figures in `goldenModels.mts`):

- every printed token matches the original exactly, none missing or extra (the logo "C" glyph is ignored);
- every printed run of text is within 4 pt of the original (vertical centre, and the nearer horizontal edge);
- no two printed tokens overlap in the render.

Also rendered and inspected by eye: credit note, retainer (scope statement, payment instructions, footnotes, no vehicle block),
receipt, a 60-line three-page invoice, a very long description with unsupported glyphs, NGN amounts in the hundreds of millions,
and an invoice with no logo.

## What is NOT verified

- Behaviour under Deno / the Edge runtime (only Node was available). fontkit and pdf-lib are injected, so the file itself has no runtime-specific code.
- Colour, stroke weights and glyph shapes are not compared, only text and positions. The originals use a thin ring and a text "C"
  as the logo; the render embeds the real gold logo image, so that area differs by design.
- INV-0025 was set in Liberation Sans; the template uses DejaVu Sans for all documents (approved), so glyph widths differ. Text
  that is right-aligned matches on its right edge, and left-aligned text on its left edge; the interior of wide runs drifts.
- INV-0025's footer note lines are deliberately moved (the original overlapped the balance band), and its header rule is not drawn.
- The receipt layout has no original to compare with.

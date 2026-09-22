#!/usr/bin/env python3
# Regenerates supabase/functions/_shared/assets/fontData.ts from the subset TTFs next to it.
import base64, os
A = os.path.join(os.path.dirname(__file__), '..', 'supabase/functions/_shared/assets/')
b = lambda p: base64.b64encode(open(A + p, 'rb').read()).decode()
out = "// GENERATED - do not edit. The two DejaVu Sans subsets (Latin, Latin-1, punctuation, the naira and euro signs) the PDF template\n// embeds, base64-encoded so the Edge Function can bundle them without file access. Source: assets/fonts/*.ttf (licence:\n// assets/fonts/LICENSE_DEJAVU). Regenerate with: python3 scripts/generateFontData.py\n"
out += "export const DEJAVU_REGULAR_B64 = '" + b('fonts/DejaVuSans.ttf') + "';\n"
out += "export const DEJAVU_BOLD_B64 = '" + b('fonts/DejaVuSans-Bold.ttf') + "';\n"
open(A + 'fontData.ts', 'w').write(out)

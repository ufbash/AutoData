# Prompt 38 Phase A - independent verification (verbatim report)

A fresh subagent that wrote none of Phase A verified it cold: given the requirements and the code, not the author's reasoning or results. It ran SELECT-only queries against the live linked database one at a time, and every write it tried ran inside a transaction it always rolled back. No production org was written to. This is its report **verbatim**. The author's resolution and one correction it prompted follow at the end.

---

# Independent Verification Report — Prompt 38 Phase A (Document Engine, Server-Side Recomputation)

Verified cold against the code and the live linked database. All SQL adversarial tests ran as SELECT/rolled-back transactions (with `SET CONSTRAINTS ALL IMMEDIATE` before rollback where the check under test is a deferred constraint trigger — I caught myself missing this once; see NOTEWORTHY). Nothing was committed; every test row was confirmed absent afterward where relevant. No production org (Caplimo, `a93378ea-...`) was written to.

## Row-by-row findings

**Row 6 — Client-owned document, vehicle optional/external. PASS**
`supabase/migrations/063_billing_documents.sql:56-58,104-106`: `client_id NOT NULL`, `won_vehicle_id` nullable, `external_plate/vin/description`, and `billing_documents_vehicle_exclusive CHECK (won_vehicle_id IS NULL OR (external_plate IS NULL AND external_vin IS NULL AND external_description IS NULL))`. Live: org 3's INV-0025 (`a8bba462-...`) has `won_vehicle_id: null`, `external_plate: "DLA49443"`, `external_vin: "4T1G11AK4NU649443"` — a real external repair. Adversarially tried to set both a `won_vehicle_id` and external plate/VIN together via `issue_billing_document`: refused — `new row ... violates check constraint "billing_documents_vehicle_exclusive"`.

**Row 7 — Typed discount, informational figure derived, not stored/double-subtracted. PASS**
`063_billing_documents.sql:186` (comment) and `billing_compute()` lines 220-235: line discount reduces `net_amount`; only `invoice_discount_amount` is separately subtracted once, at the total. `documentMath.ts:144`: `discountApplied = lineDiscountTotalCents + invoiceDiscountCents` — a **derived** print-time figure, not a stored value fed back into arithmetic. Adversarial proof: called `billing_compute()` with a 50%-off line ($1000→$500) plus a $100 invoice discount and VAT — result `total: 967.5` (not `1000 - 500 - 100 + tax`, which would be double-subtracted); hand-verified: subtotal 1000, invoice discount 100 reduces VAT base only, tax 67.5, total = 1000−100+67.5 = 967.5. Correct.

**Row 8 — Per-line tax, exempt contributes 0, rate from dated table. PASS**
Live query on org 3 INV-0025 `tax_breakdown`: `{"code":"EXEMPT","rate":0,"base":30000,"amount":0}` and `{"code":"VAT","rate":7.5,"base":200000,"amount":15000}` — the exempt line (`Car Detailing`) contributes literally `0` to VAT. `grep -rn "7\.5" supabase/functions/**/*.ts` returns only font-size literals in `documentTemplate.ts` (7.5pt text), never a rate used in arithmetic. `billing_compute()` (`063:242-244`) looks the rate up from `tax_codes` `AS OF issue_date`, requiring `n=1` dated row. Adversarially inserted a second, date-overlapping `VAT` row (bypassing the `tax_codes_one_live` unique index by giving it an `effective_to`): `billing_compute` refused — `Tax code VAT has 2 dated rates on 2026-09-22 (exactly one is required)`.

**Row 9 — Deposits are applied payments, never negative lines. PASS**
`063_billing_documents.sql:136`: `rate numeric(14,2) NOT NULL CHECK (rate > 0)`. Adversarial: `billing_compute()` with `rate=-800` → `Line 2: rate must be above zero (a negative or zero figure is not a line)`; `rate=0` → same. `billing_applications` (`064:46-72`) is the only place a payment/retainer credit is recorded against a document.

**Row 10 — Credit note is the only way to reduce an issued invoice. PASS**
`billing_documents_guard` (`063:294-307`) refuses any UPDATE except voiding. `billing_credit_note_check` (`064:251-267`) refuses a credit note over the outstanding balance. Adversarial: attempted a $2000 credit note against org 4's INV-0028 (outstanding $1145) — refused: `The credit note (2000.00) is larger than what is outstanding on the invoice (1145.00)`. Issued a legitimate $600 credit note (leaving $545 outstanding), then attempted a second $600 — refused: `The credit note (600.00) is larger than what is outstanding on the invoice (545.00)`. Confirmed via rollback that `outstanding` stayed derived correctly through the view (`billing_document_balances`), never touching the invoice row.

**Row 11 — Retainer credit rules. PASS**
Live: `RET-0001` (org 4) total $500, `applied_payments=500` (paid in full), `applied_retainer_credits=500` (fully credited to INV-0030); `billing_retainer_available('RET-0001') = 0`. Adversarial: attempted a further $1 credit from the exhausted retainer — refused: `The retainer has only 0.00 paid and not yet credited`. Issued a fresh, unpaid retainer and immediately tried to credit it — refused: `The retainer has only 0 paid and not yet credited` (`064:238-239`, `billing_applications_guard`).

**Row 12 — Scope statement replaces "PARTIAL INVOICE" banner. PASS**
`check_billing_document()` (`065:62-64`): `IF d.invoice_kind IN ('vehicle_purchase','retail') AND btrim(coalesce(d.scope_statement,'')) = '' THEN RAISE`. Adversarial: issued a `vehicle_purchase` invoice with no scope statement — refused (deferred check, confirmed with `SET CONSTRAINTS ALL IMMEDIATE`): `A vehicle_purchase invoice must carry a scope statement...`. `grep -in "PARTIAL INVOICE\|NOT the full cost"` across all extracted PDF text (original Caplimo INV-0025/0027 and both reproductions) — **zero matches**. Live PDFs instead print `Scope of this invoice / This invoice covers the auction purchase price and fees...`.

**Row 13 — FX staff-set/live, recorded, frozen at issue. PASS**
`billing_documents_fx_shape` CHECK (`063:107-112`). Adversarial: issued a cross-currency doc with no `fx_rate/basis/source` — refused: `violates check constraint "billing_documents_fx_shape"`. Live org 4 INV-0028: `fx_basis: "agreed"`, `fx_rate: 1390.00000000`, `fx_source: "Agreed with the client, per Caplimo's real INV-0026/0027 (Prompt 38)"`, `balance_at_issue: 1145.00`, `settlement_balance_at_issue: 1591550.00`. Hand check: `1145 × 1390 = 1,591,550` exactly — matches stored figure and matches `round(balance_at_issue*fx_rate,2)` from `check_billing_document` (`065:47-49`).

**Row 14 — Real org's numbering continues at INV-0028, non-allocating peek. PASS**
`peek_next_document_number('a93378ea-...', 'invoice')` called twice in one query: both returned `"INV-0028"` — no state change between calls. `document_sequences` for the real org: `invoice → last_seq: 27, pad: 4`. Matches "INV-0027 already exists, next is INV-0028, 4-digit pad" exactly.

**Row 15 — Per-org branding, read from `org_billing_profile`, not hardcoded. PASS with a noted gap.**
`billing/index.ts:76-87` (`loadProfile`) selects `org_billing_profile` by `orgId`; nothing hardcoded. All 4 profiled orgs (`a93378ea-...`, `b0000000-...-020`, `c0000000-...-040`, `d0000000-...-040`) have **distinct `org_id`** rows, confirming the function is keyed correctly, but their **content is identical** (same legal name "Caplimo", same header lines, same logo) — expected, since the synthetic orgs exist specifically to reproduce Caplimo's own invoices as golden files, but it means I could not independently observe the branding actually varying. Flagged NOTEWORTHY, not material — the code path and the distinct-org_id keying are both proven.

**Row 16 — INV-0025 reproduced exactly. PASS**
Independently summed all 18 DB lines by hand: Parts subtotal = 2,076,950 (matches), Services = 230,000 (matches), tax = 15,000 (7.5% of the 200,000 VAT-able base only; the exempt 30,000 line contributes 0), total = 2,321,950 — matches DB `total` and `tax_breakdown` exactly. `pdftotext -layout` on the ORIGINAL PDF (`/Users/cc/Downloads/Caplimo_Invoice_0025 (1).pdf`) shows every line item, discount, subtotal and the final ₦2,321,950.00 identical to the DB figures. Downloaded the STORED PDF from Supabase Storage directly (via `supabase storage cp --experimental --linked`, since no staff session/service-role key was available to call the Edge Function's `file_url` mode — see Row 19) and `pdftotext`'d it: figures identical to the original (layout differs — the reproduction paginates at 2 pages vs. the original's 1 — but every number matches). Rendered to PNG (`pdftoppm`): logo renders as an actual circular "C" mark (not a placeholder box/text), the naira sign renders as `₦` (not "NGN" or "?"), and the 2-page split shows no overlap between the footnotes block and the totals/balance band on either page.

**Row 17 — INV-0027 reproduced exactly (as org 4's INV-0028, label mismatch acknowledged). PASS**
Stored figures for org 4's INV-0028: `applied_at_issue=1500.00` (two deposits, $800+$700), `balance_at_issue=1145.00`, `settlement_balance_at_issue=1591550.00`. `pdftotext` of the real original `Caplimo_Invoice_0027.pdf`: `$2,345.00 + $300.00 = $2,645.00`; `-$800.00`, `-$700.00`; `Balance $1,145.00`; `₦1,591,550.00`. `pdftotext` of the downloaded stored PDF for org 4's INV-0028: **byte-identical figures**, only the invoice number text differs (`INV-0028` vs `INV-0027`) and the printed date (`15/09/2026` in both, matching). This is the disclosed test-sequencing mismatch — content matches exactly, confirmed independently by me, not by trusting the disclosure.

**Row 18 — Discount not double-subtracted (Bashir's named failure). PASS, own adversarial construction.**
Built my own adversarial input directly against `billing_compute()` (not `testDocumentMath.mts`): a 50%-off $1000 line + a plain $500 line + a $100 fixed invoice discount, VAT 7.5%. Result: `subtotal=1000, invoice_discount_amount=100, tax_total=67.5 (base 900), total=967.5`. If the discount were double-subtracted the total would come out short (e.g. `1000-500-100+tax` territory); instead the line discount is baked into `net`/`subtotal` exactly once, and only the invoice discount is subtracted again at the total. Hand-verified the arithmetic is internally consistent and matches the documented formula (`063:186-189`, `documentMath.ts:9-14`).

**Row 19 — Tampered computed line refused server-side. PASS, via the documented fallback method.**
Attempted the live path first: `curl -X POST .../functions/v1/billing -H "Authorization: Bearer <anon key>"` → `{"error":"Unauthorized: Invalid token"}`, HTTP 401. No staff user session/credentials or service-role key are reachable from this environment (confirmed: `.env` holds only `VITE_SUPABASE_ANON_KEY`; no service-role key in env or files) — consistent with AGENTS.md §3 (sign-in is out of reach for the agent). **Used the documented fallback**: wrote `adversarial_req19.mts`, imported the real `auctionFeeComponent` from `supabase/functions/_shared/costComponents.ts` against a fake `db` mirroring a realistic Copart-style schedule (10% buyer fee + $130 proxy bid fee + $15 flat fee on a $2,345 price), got the real recomputed figure ($379.50), then ran the **exact comparison line copied from `billing/index.ts:214`** (`if (cents(figure) !== cents(l.rate)) throw new Refuse(...)`) with a deliberately tampered submitted rate ($329.50): the guard evaluated `true` (would throw/refuse); with the honest correct figure it evaluated `false` (would pass). Script output confirms both directions. Separately, `PLAN_TRACKER.md:2417` records the builder's own claim of having proved this live against the deployed function — per instructions I did **not** rely on that self-report, only on my own reconstruction of the guard logic.

## ALSO CHECK (adversarial, "try to break it")

All rolled back; nothing persisted.

- Negative line amount → refused (`billing_compute`, "rate must be above zero").
- Zero-rate line → refused (same guard).
- Discount larger than its line (fixed $500 on a $100 line) → refused: "the discount exceeds the line".
- Invoice discount larger than subtotal ($500 fixed on $100 subtotal) → refused: "The invoice discount exceeds the subtotal".
- Unknown tax code → refused: "Tax code NOPE has 0 dated rates...".
- Two dated tax rates active the same day for the same code → refused by `billing_compute` even though the unique index (`tax_codes_one_live`) alone did not prevent the overlapping insert (NOTEWORTHY, see below).
- Document inserted with a wrong stored total (999999 vs the real 100, bypassing `issue_billing_document`) → refused by the **deferred** `check_billing_document` trigger once forced with `SET CONSTRAINTS ALL IMMEDIATE`: "stored total 999999.00, computed 100.00".
- Line inserted onto an already-issued document → refused: "An issued document's lines are sealed...".
- Line edited or deleted → refused: "A document line is never edited or deleted".
- Document total edited post-issue → refused: "An issued document is never edited - void it, or issue a credit note".
- `TRUNCATE` on `billing_documents` / `billing_payments` → refused (FK-referenced-table protection and/or the custom no-truncate trigger both apply; either way, refused).
- Payment applied twice beyond its own amount (two $60 applications from a $100 payment) → refused: "The payment has only 40.00 left to apply".
- Payment applied to a different client's document → refused: "The payment and the document must belong to the same client".
- Application exceeding the outstanding balance ($3,000,000 against a $2,321,950 balance) → refused: "The application (3000000.00) exceeds the outstanding balance (2321950.00)".
- Voiding a document with money applied → refused: "A payment or retainer credit is applied to this document - void that first...".
- Voiding a payment that is applied → refused: "This payment is applied to a document - void that application first".
- NGN-payment-to-USD-document with no conversion path → refused: "No conversion path: a USD payment cannot be applied to a NGN document settled in NGN" (encountered incidentally while probing over-apply).
- Retail invoice hides cost lines from tax/subtotal: constructed my own retail invoice (1 visible `all_inclusive_price` line at $5000 + 1 hidden `vehicle_price` cost line at $3000, `client_visible=false`) — stored correctly with `subtotal=5000.00, tax_total=375.00 (7.5% of 5000), total=5375.00`; the hidden $3000 line is stored (`net_amount=3000.00`) but excluded entirely from subtotal/tax. PASS.
- Non-retail invoice with a hidden line → refused by the **deferred** trigger (again required `SET CONSTRAINTS ALL IMMEDIATE` to observe correctly — my first attempt without it was a false negative, corrected): "Only a retail invoice may have internal (hidden) lines; every line here is disclosed".
- Both `won_vehicle_id` and external plate/VIN on the same document → refused: CHECK `billing_documents_vehicle_exclusive`.

## COULD NOT DETERMINE

- **The specific "footer/balance-band overlap bug"** referenced in the task as something the original Caplimo PDFs supposedly showed. I could not find it: none of the three original PDFs I have (`Caplimo_Invoice_0025 (1).pdf`, `_0026.pdf`, `_0027.pdf`) show any overlap — INV-0025's original is a single clean page, INV-0027's original renders identically in style to the Prompt 38 reproduction (same logo mark, same layout family), suggesting the originals were themselves produced by an earlier version of a similar renderer, not hand-made documents with a visible defect. I cannot confirm whether a real defect was "fixed" vs. "reproduced" because it isn't present in any reference document available to me. What I can confirm independently: the reproduced 2-page INV-0025 shows no overlap between the per-line footnotes block and the totals/balance band on either page (visually inspected via `pdftoppm`).
- **Whether the org_billing_profile content genuinely differs between a second real-use org and Caplimo** — only synthetic test orgs (which intentionally mirror Caplimo to reproduce goldens) and the real org exist; I could not observe a profile with materially different name/header/logo content, only different `org_id` keys. The code path (`loadProfile` keyed by `org_id`) is proven regardless.
- **Font embedding correctness beyond visual/text inspection** (e.g., whether the DejaVu font subset is fully embedded vs. relying on a fallback) — I confirmed the naira sign renders correctly in the extracted text and in the rendered image, which is strong practical evidence, but did not inspect the PDF's embedded font tables directly.

## MATERIAL vs NOTEWORTHY

**MATERIAL:** None found. Every requirement in rows 6-19 held up under direct code reading and my own adversarial database tests, including attempts specifically designed to reconstruct the discount double-subtraction bug and the tampered-computed-line bug that motivated this build. I did hit one methodological trap of my own (see below) but caught and corrected it before reporting a false PASS.

**NOTEWORTHY:**
1. `tax_codes` has no exclusion constraint preventing two *dated-but-closed* rows from having overlapping `[effective_from, effective_to]` ranges for the same `(org_id, code)` — only the `tax_codes_one_live` unique index (which requires `effective_to IS NULL`) prevents duplicates. The overlap is still safely caught downstream by `billing_compute()`'s `count(*) <> 1` check at read time, so no bad figure can ever be computed from it — but a bad *write* can sit in the table undetected until someone tries to bill against that date.
2. Row 15's branding-differs check could not be shown with genuinely different content, only different `org_id` (see COULD NOT DETERMINE).
3. My own process note, disclosed per the self-report rule: two of my adversarial tests (`t19`/the two-line hidden-line-on-non-retail test, and the wrong-stored-total test) initially returned false negatives ("accepted, not refused") because I rolled back the transaction before the `DEFERRABLE INITIALLY DEFERRED` constraint triggers (`check_billing_document`) had a chance to fire. I caught this myself, re-ran both with `SET CONSTRAINTS ALL IMMEDIATE` before the rollback, and both then correctly refused as designed. Flagging this so the false-negative risk is visible, not because the underlying system has a gap — the deferred check worked exactly as intended once actually triggered.

---

# The author's resolution

No material disagreement. The verifier independently reconstructed both of the failures this build exists to prevent - the informational-discount double-subtraction and a tampered computed line - by writing its own adversarial inputs rather than trusting `testDocumentMath.mts`'s own PASS output, and both held.

**One correction the verifier's report prompted, made before this was written up.** The verifier could not find the "footer/balance-band overlap bug" my own task prompt described as something the original Caplimo PDFs showed, and said so plainly rather than assuming it must exist somewhere it didn't look. That sent me back to check directly: the real INV-0025, rendered at 150dpi, shows the footer notes sitting cleanly below the balance band with a clear gap - **no overlap ever existed in the original**. The false claim traced to an earlier pre-flight agent (Subagent A, the sample-invoice layout extraction) misreading the PDF's bbox coordinates before the builder subagent ever started; I passed that misreading into the builder's task description as a fact to fix, the builder's own report said it had fixed it, and I repeated that uncritically to Bashir in an earlier message this session. It never reached the permanent docs (PLAN_TRACKER, SCHEMA, DECISIONS, SOLVED), only three code comments (`documentTemplate.ts`, `compareToGolden.mts`) - all three corrected to state plainly that no defect existed and the flowing-tail layout is a sound design choice kept on its own merits, not a fix for a bug that was never real.

| Finding | Resolution |
|---|---|
| Rows 6-14, 16-19: PASS, own adversarial reconstruction | No action needed - independently proved, not merely re-confirmed |
| Row 15: branding keyed by `org_id` correctly, but content not observed to differ | Recorded as-is; the synthetic orgs exist to reproduce Caplimo's invoices, so identical content is expected, not a gap. A second real-use org would settle this the first time one exists |
| `tax_codes` allows overlapping closed date ranges for the same code | Left open, low severity: `billing_compute()` already refuses to bill against an ambiguous date (`count(*) <> 1`), so no wrong figure is reachable - only a messy row could persist, which is a data-hygiene concern, not a financial one |
| The non-existent footer/balance-band overlap, inherited from a pre-flight misread and repeated in the builder's task and two code comments | **Fixed**: `documentTemplate.ts` and `compareToGolden.mts` comments corrected to state plainly that the original has no overlap and none was fixed; the layout choice is kept as a defensive design decision on its own merits |
| The verifier's own two false negatives (missing `SET CONSTRAINTS ALL IMMEDIATE` before rollback) | No code issue - the deferred trigger worked exactly as designed once actually fired; recorded as a testing-methodology note, not a system gap |

# Prompt 43 Stage 6 - independent usability verification (verbatim)

Fresh subagent driving Playwright, forbidden from reading source, the database or repo docs; synthetic org-4 accounts only;
issued, voided, paid, shared and provisioned nothing. Run 1 Oct 2026 against the build as it stood before the Stage 6 fixes.
The report below is the subagent's own text, unedited. Triage and what was done about each finding is in
`PLAN_TRACKER.md` debt #125; nothing here has been softened or reordered.

---

USABILITY VERIFIER REPORT (AutoData, localhost:3000)

(a) RESULTS
| Task | Worked? | Evidence |
|---|---|---|
| S1 deposit request | Yes (cancelled, nothing issued) | Clients > ZZ Synthetic Client C > "Full relationship" > "2018 Toyota Corolla" > Billing > "New deposit request". Filled one line. Issue button showed the confirm dialog. Closed the browser without confirming, so nothing was issued. |
| S2 research runs | Yes | Opened all three runs and read checklists and badges. Did not touch sharing. |
| S3 client dashboard and PDFs | Partly | Dashboard read fully. View and Download PDF tested for an invoice, receipt, credit note and deposit request. Headless Chromium downloaded a PDF for both icons every time, so I could not see whether "View" opens a viewable tab in a real browser. I read the PDF text with pdftotext. |
| S4 vehicle URLs | Yes | Not-theirs and "abc" show the same message. The button works. Their own vehicle goes to the dashboard. |
| S5 second client | Yes | Empty-state page seen. |

(b) WHAT BROKE
1. Client "View" (eye) icon, in headless Chromium only. Steps: client dashboard > any invoice/receipt/credit note/deposit-request row > click the eye (title "View"). It produced a file download, the same as the download icon, plus a blank extra tab (url empty). I never saw an in-browser PDF view. I can't say whether this is a real bug or a headless limitation.
2. In the staff deposit-request dialog the title reads "New deposit request —" with a dangling dash. The document number is blank at that stage.
3. Deposit-request numbering is inconsistent. See the S1 numbering finding in (c) 2.
4. Client page for THEIR vehicle (/vehicle/d0000000-0000-4000-8000-000000000093) does not show a vehicle page. It stays on that URL but shows the normal dashboard. See (c) 8.
5. No flicker, no raw ids and no console crashes seen. I did not check the console systematically.

(c) WHAT WAS CONFUSING (app's own words)
S1:
1. Invoice-line table headings: "Section | Description | Qty | Rate | Discount | Tax | Basis (required)". Under "Basis (required)" is orange helper text "Printed on the client's invoice". The input placeholder is "what it rests on (printed)", truncated in the narrow box as "what it rests on (pri". My reading: Basis is a required free-text note saying what the line's price is based on, and it is printed on the client's invoice. I learned that only from the orange helper text. Placeholder and helper agree, but the helper is tiny and the placeholder is cut off. "What it rests on" is odd phrasing. I couldn't tell where on the invoice it prints (Scope? line?) without issuing.
2. Confirmation dialog, exact text: "Confirm issue. This will consume DEP-0002 and cannot be undone — the document can only be voided or reduced by a credit note afterward. Total: $500.00" with buttons "Cancel" and "Confirm, issue DEP-0002". A deposit request gets the prefix DEP-. "Consume" is odd wording for a document number.
3. Terms found for "money paid before the work":
- "New deposit request" (button and dialog title)
- "Issue deposit request"
- "Deposit request" (the document type label, e.g. "RET-0001 Deposit request")
- "deposit credit" ("Apply existing payments or deposit credit")
- "Retainer" (the line description on the existing document)
- "RETAINER INVOICE" (title at the top of the RET-0001 PDF)
- "Retail invoice" (a different thing, e.g. INV-0055 "Retail invoice"; easy to misread as a typo of Retainer)
Not consistent: the new number is DEP-0002, but the existing one is RET-0001 (prefix of the old "retainer" name), the PDF says "RETAINER INVOICE", and the PDF's number label is "Invoice No. : RET-0001" while the dashboard calls it "Deposit request". The new numbers would also start at DEP-0002 although no DEP-0001 is visible. The "Apply existing payments or deposit credit" list shows "Deposit request RET-0001", so a client sees a DEP- number for new requests and a RET- number for the old one.
S2:
4. "ZZ mixed lot state": the flagged listing is #4, 2022 Toyota Camry, $18,000, 19,000 mi. Its badge reads "LOT STATE UNKNOWN - NOT IN ANY AVERAGE". The checklist line reads "1 listing with unknown lot state - in NO average and NO risk check until classified." What to do is not stated: "until classified" has no button, link or hint on that row or in the checklist. (The row has icons for phone, $ and X, none labelled with text.) The checklist line is info-style (blue), not a warning, and does not name which listing. Also listing #3 shows "HISTORY NOT CHECKABLE" (info-level), which is a similar-looking but different issue.
5. Market Research (Sold) panel: "Avg sale price (2 sales) $21,000, Min / Max Price $20,000 / $22,000". That is listings 1 and 2 ($20,000 and $22,000), so the average is clear. Why #3 ($15,000, Copart, live) and #4 are out: #3 sits in a separate "CLIENT OPTIONS (LIVE)" panel with "Current bid range (live, provisional) $15,000 / $15,000"; #4 is in neither. "Sale / Listed Price" is the label on every row, including live ones, so the live car looks like a sale price. Reasonably clear but needed some inference. "Market research average is based on only 2 sales. Limited sample. (WARN)" is clear.
6. "ZZ run sold twice": checklist wording is "1 listing(s) are RE-SALES - the vehicle sold at auction more than once, so its price reflects a repair history and is EXCLUDED from the sold average: 2025 Toyota Camry (VIN 4T1ZZSYNTH0000001): sold 2025-10-15 $17,100 at 9,078 mi then 2026-09-03 $12,300 at 37,904 mi. (CRITICAL)". I understood why. The panel reads "Avg sale price (0 sales) —", which fits. The row badge is "SOLD TWICE - EXCLUDED FROM AVERAGE". The panel header is the generic "RUN LISTINGS" even though the run is Market Research, which looks slightly off compared with "MARKET RESEARCH (SOLD)" on the mixed run. What to do next is not said; there is a field "Reason for sharing despite critical warnings (recorded):" whose connection to the flag I can only guess. Odd: the row also shows "CERT OF SALVAGE > 75% DAMAGE (MD)" with no explanation.
7. "ZZ flags active", four flags:
- "Duplicate vehicle in run (2 listings) (BLOCK)": understood, the two Honda Civics carry "DUPLICATE VEHICLE" badges. No hint which to remove, but the X icon is the obvious move.
- "1 listing(s) flagged CRITICAL: water damage. (CRITICAL)": understood, the 2023 Camry "Water/Flood".
- "1 listing(s) blocked: this vehicle has been to auction before (1 prior appearance: 2025-03-01), and has sold at a prior auction. (BLOCK)": understood. Row badge is "PRIOR AUCTION HISTORY".
- "Prior auction history not checkable for this source (3 listing(s)) — bid.cars Sales History coverage only, Copart not yet available.": info only. "Copart not yet available" reads like an internal roadmap note.
Technical-looking labels: source chips "EXTENSION_DOM_CAPTURE" (raw snake_case, on every listing), "BIDCARS", "Unknown loc" (abbreviation), "NOT STORED", and bracketed "(WARN)/(BLOCK)/(CRITICAL)". Nothing "UNLABELLED" and no raw ids seen, except VIN in a message. "AUCTION DATE TBC" appears on most rows but not on the sold-twice row.
S3:
8. Dashboard sections: Amount owed, Your briefs, Research shared with you, Your vehicles, Invoices, Receipts. "Amount owed": NGN card "SETTLED, ₦0.00 outstanding, Invoiced ₦11,000.00 · Paid ₦11,000.00 · Credited ₦0.00". USD card "OVERDUE, $42,745.00 outstanding · $450.00 overdue, $10.00 unapplied credit, Invoiced $49,157.34 · Paid $5,712.34 · Credited $700.00". In my words: they owe ₦0 in naira (all paid) and $42,745 in dollars, of which $450 is past due; no currency mixing. "Overdue" is understandable; the status word itself is a red tag. "unapplied credit" is a bit jargon-y: $10.00 sits somewhere but nothing says how it is used. Arithmetic is not visibly reconcilable: 49,157.34 − 5,712.34 − 700 = 42,745 matches, good. "Settled" is understandable. The vehicles card shows a milestone strip (Won, Auction paid, Title received, ...). Only "Won" is ticked on the Corolla; the Civic says "No status recorded yet". Hundreds of rows: Invoices list is ~60 rows long, mostly "voided" test data, and receipts list is ~45 rows with no amount or invoice reference ("REC-0044" with only a date). Receipt PDF for REC-0044 shows "Amount Received $350.00 ... Received on account - not yet applied to an invoice", info the list doesn't show. "Invoice" label printed next to each INV number is redundant.
9. Invoice expand: click the row (INV-0071) and it shows line items ("Vehicle price (winning bid) $1,650.00", "Auction fees (actual) $700.00"), "Scope: Stage 3 verification invoice - vehicle price and auction fees.", and "Balance outstanding $2,350.00". At the top right of each row there are two small icons: an eye and a download arrow. Only a hover tooltip names them ("View", "Download PDF"), no visible text. Receipts have the same icons beside the date. Not self-explanatory without hover, though conventional.
10. PDFs (read as text): Invoice PDF top: "INVOICE ... Balance Due $2,350.00 ... Invoice No. : INV-0071", which matches the dashboard. Credit note: "CREDIT NOTE ... Credit Amount $200.00 ... Credit Note No. : CN-0001 ... Against Invoice : INV-0030", matches. Receipt: "RECEIPT ... Receipt No. : REC-0044 ... Amount Received $350.00", matches. Deposit request: "RETAINER INVOICE ... Balance Due $500.00 ... Invoice No. : RET-0001". It does not match the dashboard's "Deposit request". The PDF line items carry "Line 1 Staff figure: was $1,700.00, computed" / "Line 2 Staff figure: Stage 3 verification - fresh actual after void" on the invoice, and "Line 1 Staff figure: agreed reduction" on the credit note; "Staff figure" reads internal to a client. The credit note and retainer PDFs also have a stray single letter ("C" / "R") on a line of their own (likely a watermark or glyph artifact in pdftotext output, not verified visually). Dashboard deposit request RET-0001 expands to "Retainer $500.00 ... Scope: Retainer toward the Civic purchase. ... Balance outstanding $0.00", so "Retainer" appears inside what the dashboard calls "Deposit request".
S4:
11. Not-theirs vehicle and "/vehicle/abc" both show the same card: "This page isn't available. That vehicle isn't part of your account, or the address isn't right. If you were sent this link, please ask the team you're working with." and the button "Go to my account", which returned me to the dashboard. Understandable and gives a next step. A client cannot tell the two cases apart (fine, probably deliberate).
12. Their own vehicle (.../000000000093): the URL stays /vehicle/...93 but the dashboard renders, with no vehicle-specific detail (no highlighted vehicle). At 300 ms the page showed "Amount owed" with no figures, then the numbers appeared by about 1.5 s. Makes sense as a landing, but a newcomer would wonder where "that vehicle's page" is. Also the first load of the dashboard showed a bare spinner on a blank page for a few seconds (4 s in my first attempt).
S5:
13. Second client sees header "Abdulrazaq Ambrusa" with "zz-preexisting-account@autodata.test"; cards "Amount owed: No invoices yet.", "Your vehicles: No vehicles yet.", "Invoices: No invoices yet." Understandable. No amount owed shown. Mildly redundant (two "No invoices yet."), no hint what happens next or who to contact. The name shown does not match the account email, which is just test data.

(d) WHAT WORKED WELL
- Staff navigation to the billing section was quick (Clients > client > Full relationship > vehicle).
- The confirm-issue dialog states the number, total and irreversibility plainly.
- Checklist wording for re-sales, duplicates, water damage and prior auctions is specific, and each flag is tied to a visible row badge with colour.
- The unknown-lot-state listing is carried by badge and checklist saying "NOT IN ANY AVERAGE".
- Client amounts are per currency, with overdue and credit shown, and reconcile arithmetically.
- Invoice, receipt and credit-note PDFs download in 1-2 s with numbers matching the dashboard.
- The "This page isn't available" message is polite, actionable and the button works.

(e) HOW I TESTED
- Headless Chromium via Playwright (node), a fresh context per persona, signing in only via "Sign in with email and password instead" and the form (never Google). Staff, client C and the second client were each used.
- I actually looked at about 11 screenshots (staff0, s1_dep, s1_confirm, s2_1, s2_3, c0 (too small to read, then c_top), c_rec, s4_1, s5, plus the receipts/invoices crops); the other captured screenshots (s2_2 and others) I did not open and I relied on page text for them. Page text and PDF text were read via innerText and pdftotext.
- I created no issued documents. The only deposit-request editor session was closed without confirming, so nothing was issued, voided, paid, shared or provisioned.
- I did not toggle sharing.
- I read no source code, repo docs or database. I did look at rendered DOM attributes (data-testid, title) through Playwright's outerHTML of rows to find the icon controls; that is the page as served, not repo source. Scripts and files are in /private/tmp/claude-501/-Users-cc-AutoData/6b3272c0-26dd-49be-bc30-d1eafd1c3fe3/scratchpad/verifier2/. Downloaded PDFs also sit there.

# Prompt 44 Stage 6 - independent usability verification (verbatim)

Fresh subagent; drove Playwright through the real login form, read no source. Run 1-2 Oct 2026 against the build as it stood before the fixes it
prompted. The report below is the subagent's own text, unedited. Triage and what was done about each finding is in `PLAN_TRACKER.md` debt #133.

---

USABILITY REPORT (verifier3). Dates in the synthetic org show as 1 Oct 2026.

(a) RESULTS
| Task | Worked? | Evidence |
|---|---|---|
| S1 deposit request / record payment / terms | Yes | Opened "New deposit request" on the Toyota, reached the "Confirm issue" dialog and cancelled. Opened top-level "Record payment" and read its hint and Purpose choices. |
| S2 four runs | Yes (chips/text read for all four; screenshot looked at for "ZZ mixed lot state" only; the other three read from page text) | See below. |
| S3 averages | Partly | Cards read on every run. The sold average is understandable. The mileage cards are ambiguous (see C2 below). |
| C1 client dashboard + PDFs | Yes | Dashboard text read. Downloaded and pdftotext'd the invoice, deposit request, old-style deposit request, credit note and a receipt PDF. "View" in headless Chromium downloaded the file rather than opening a viewer. |
| C2 vehicle links | Yes | /093 = own vehicle, /092 = not theirs, /abc = junk. |
| C3 loading | Yes | 3 reloads, with screenshots at roughly 0.15s, 0.5s and 0.9s. |
| C4 second client | Yes | Logged in as zz-preexisting-account; empty state read. |

S1 findings
- Path to the vehicle: Clients -> "ZZ Synthetic Client C" -> "Full relationship" -> "2018 Toyota Corolla". "Full relationship" shows only a spinner for about 5-7 seconds, with just a "Back" link and no text. It took roughly 10 minutes to find the Billing buttons: the vehicle page is an overlay on top of the client page, and the client page behind it has an identical set of Billing buttons.
- First line description: "Commitment fee", Qty 1, Rate 0.
- Basis column header: "Basis (required)" with the orange sub-text "Printed on the client's invoice". The input placeholder is "what it rests on".
- Issue confirmation dialog, verbatim: "Confirm issue — This will issue DEP-0006 and cannot be undone — the document can only be voided or reduced by a credit note afterward. Total: $50.00" with buttons "Cancel" and "Confirm, issue DEP-0006". I did not confirm. I typed test values into the form (Basis "Test basis", Rate 50) and cancelled.
- "Issue deposit request" stays disabled for about 4-6 seconds after typing the rate and basis, while "Live preview" shows a spinner. Nothing says why it is greyed out.
- Record payment hint, verbatim: "Records money received that is not applied to any invoice - it is held as a credit balance. To pay a specific invoice, open that invoice below and use its own "Record payment"." Purpose options: "Commitment fee", "Payment". Method options: Bank transfer, Cash, Card, Cheque, Other.
- Terms on staff screens
  - (a) The document: "Deposit request" (button "New deposit request", modal title, list label, "Issue deposit request"). The button tooltip says "Asks for the commitment fee before work starts. Credits automatically against the final invoice once paid."
  - (b) The charge: "Commitment fee" (default line description; Purpose option; payments list entry "Commitment fee $500.00 · bank transfer"). Briefs show the chip "NO DEPOSIT".
  - (c) Money held: "credit balance" (client card "$214.00 credit balance"; "Apply existing payments or credit balance"; the hint above).
  - Consistent, except for the oddities below.
- Oddities
  1. The old-style document RET-0001 is listed on staff screens as "Deposit request", but its prefix is "RET-", and its PDF still says "RETAINER INVOICE".
  2. The "NO DEPOSIT" chip on briefs uses "deposit" rather than "commitment fee".
  3. The deposit-request form has an "Apply existing payments or credit balance" section, which is odd on a document that asks for money.
  4. The form's own labels use "Invoice discount" and "Invoice" for the new document.
  5. "Payments" rows read "Payment $100.00 · bank transfer" with "Issue receipt / Void" buttons.
  6. Staff Records heading "Invoices (legacy, retired path)".

S2 findings (each run page has panel "Pre-Share Checklist", "Client Sharing", "Run Listings (n of n included)")
- Panel headings
  - "MARKET RESEARCH (SOLD)" and "CLIENT OPTIONS (LIVE)" are clear.
  - The "Pre-Share Checklist" panel mixes passing items and flags, and the "I've reviewed these warnings" box sits below the flags without saying which flags it covers.
  - The "Client Sharing" toggle just says "Blocked by checks", with no pointer to which check.
- Jargon and raw wording
  - "1 listing(s) flagged CRITICAL: not confirmed run-and-drive. (CRITICAL)"
  - "1 listing(s) flagged CRITICAL: water damage. (CRITICAL)"
  - "Duplicate vehicle in run (2 listings) (BLOCK)"
  - "1 listing(s) blocked: this vehicle has been to auction before (1 prior appearance: 2025-03-01), and has sold at a prior auction. (BLOCK)". The date here is ISO format, while the rest of the app uses mm/dd/yyyy or dd/mm/yyyy.
  - "Market research average is based on only 2 sales. Limited sample. (WARN)" and "...only 1 sales." (grammar).
  - "Prior auction history could not be checked for 2 listings: only bid.cars records a sales history to check against, so a car from another source may have been through auction before without us knowing." It is long but understandable. It does not say what to do. The chip "HISTORY NOT CHECKABLE" is understandable.
  - "1 listing with unknown lot state - in NO average and NO count (risk checks still run on it). To fix: re-capture that lot from its auction page so its live/finished state is recorded, or remove it from the run. (WARN)". It says what to do, but "lot state" is jargon and "NO average and NO count" is shouty. Chip: "LOT STATE UNKNOWN - NOT IN ANY AVERAGE".
  - Re-sale: "1 listing(s) are RE-SALES - the vehicle sold at auction more than once, so its price reflects a repair history and is EXCLUDED from the sold average: 2025 Toyota Camry (VIN 4T1ZZSYNTH0000001): sold 2025-10-15 $17,100 at 9,078 mi then 2026-09-03 $12,300 at 37,904 mi. (CRITICAL)". Chip: "SOLD TWICE - EXCLUDED FROM AVERAGE". The wording "May be a re-sale" did not appear anywhere; the app says "RE-SALES".
  - Odometer: "1 listing(s) show odometer rollback across auction appearances — recorded mileage decreased between appearances, meaning the record may not describe the vehicle it claims to. (CRITICAL)". Chip "ODOMETER ROLLBACK". The wording is accusatory for what may be a data fault.
  - "1 of 2 included listings have an unconfirmed or not-sold status and are excluded from the average below. (WARN)". Chip "UNCONFIRMED SALE". Nothing says how to confirm.
  - Other chips: "CRITICAL", "DUPLICATE VEHICLE", "PRIOR AUCTION HISTORY", "CAPTURED FROM THE PAGE", "NOT STORED", "AUCTION DATE TBC", "CLEAN", "Side", "Front End", and "CERT OF SALVAGE > 75% DAMAGE (MD)". The title-type chip is shown in all caps. "Water/Flood" is normal. I saw no snake_case or database-looking values.
- Price labels: "Sale price", "Listed price (live, no bid yet)", "Listed price". "Listed price" with no qualifier appears on a listing whose lot state is unknown, which is reasonable.
- Is it clear what to do? Mostly no. Only the unknown-lot-state line says what to do. The CRITICAL, BLOCK and rollback lines state the problem but do not say whether to remove, re-capture or override. The override is a free-text box, "Reason for sharing despite critical warnings (recorded):" with "Min 10 characters required...".

S3 findings
- "ZZ mixed lot state" run
  - Sold group: "Avg sale price (2 sales)" $21,000; "Min / Max Price" $20,000 / $22,000; "Avg Mileage (2 sales with a price and mileage)" 21,000 mi.
  - Live group: "Avg Mileage (1 listing with a price and mileage)" 18,000 mi.
  - Sample size is shown in each label.
- The sold average covers confirmed sold listings; unconfirmed-sale and repeat-sale listings are excluded. Live listings are excluded from the sold card. The listing with unknown lot state is in no average.
- Confusing: "Avg Mileage (2 sales with a price and mileage)" does not say whether it counts listings that are in the run but excluded from the price average. "ZZ run sold twice" shows "Avg sale price (0 sales)" with "—". "ZZ flags sold" shows "Avg sale price (1 sales)" for 2 included listings, with the explanation only in the checklist. The mileage card sits next to the price card without saying it is a different filter.

C1 findings (client dashboard, top to bottom)
- Header with the client name and "Sign out". Then:
  1. "Amount owed": per-currency cards. NGN "SETTLED ₦0.00 outstanding" with "Invoiced ₦17,000.00 · Paid ₦17,000.00 · Credit notes ₦0.00". USD "OVERDUE $49,850.00 outstanding · $450.00 overdue", then "$214.00 credit balance", then "Invoiced $57,612.34 · Paid $7,062.34 · Credit notes $700.00".
  2. "Your briefs" ("Vehicle brief — Pending Review", "Toyota Corolla — Approved").
  3. "Research shared with you" ("Research run — Draft").
  4. "Your vehicles".
  5. "Invoices (110)".
  6. "Deposit requests (5)".
  7. "Credit notes (1)".
  8. "Receipts (64)".
  9. "Voided documents (26)".
- The sections are clearly separate, each with its own count. No mixing of types.
- Receipts do show an amount on every row, e.g. "REC-0065 $1.00". Voided receipts are tagged "(voided)" in the same list, e.g. "REC-0063 (voided) $77.77".
- Voided documents: "Voided documents (26)" has a collapsed section "Show voided documents", with the note "Documents that were cancelled. They carry no balance and are not part of what you owe." Each row says "· voided". They do not look like money owed. Voided receipts are NOT in this section; they stay in Receipts.
- "Amount owed" is understandable: the status word ("SETTLED", "OVERDUE") is clear. What is unclear: "outstanding" is not explained, and "credit balance" has no explanation of whether it reduces the amount owed. The $49,850.00 outstanding is very large next to Invoiced $57,612.34 and Paid $7,062.34, but the arithmetic is not obvious.
- Row expansion: expanding DEP-0005 shows "Deposit (journey 18)", "$50.00", "Balance outstanding", "$50.00". "Commitment fee" never appears on the client dashboard.
- PDFs read:
  - DEP-0005 PDF title "DEPOSIT REQUEST". The line is "Deposit (journey 18)". It says "Invoice No. : DEP-0005" and "Invoice Date" (so the "Invoice" words are used on a Deposit request PDF). It does not say "Commitment fee" (that line text was entered by staff, so I do not know if it is typical).
  - RET-0001 PDF title "RETAINER INVOICE", line "Retainer 1 $500.00", and "Retainer toward the Civic purchase." The old word "Retainer" is still present, on a document the dashboard calls "Deposit request".
  - INV-0175 PDF title "INVOICE", with no deposit or credit lines.
  - CN-0001 PDF title "CREDIT NOTE"; "Against Invoice : INV-0030".
  - REC-0065 PDF title "RECEIPT". The "Applied To" table has column "CREDIT BALANCE" and the line "Held as credit balance - not yet applied to an invoice". This matches the dashboard term.
  - PDFs for DEP-0005 and INV-0175 were identical when downloaded via View and via Download.

C2 findings (vehicle links)
- /vehicle/…093 opens the full client dashboard (not a standalone vehicle page) with a loading skeleton, and the Honda Civic is highlighted with the small label "THE VEHICLE FROM YOUR LINK". It is clear which vehicle was meant, but the page does not scroll to it. It is the second card, and the page also shows the whole account. For a first-time visitor expecting "a vehicle page", it is unexpected but understandable. The Honda shows "No status recorded yet".
- /vehicle/…092 (not theirs) and /vehicle/abc both show: "This page isn't available — That vehicle isn't part of your account, or the address isn't right. If you were sent this link, please ask the team you're working with." with a "Go to my account" button. It is understandable and does not reveal whether the vehicle exists. At about 0.3s the /abc and /092 pages showed a blank body before the message.

C3 findings (loading)
- At about 0.15s: a grey skeleton header, the text "Loading your account...", and three skeleton cards titled "Amount owed", "Your vehicles", "Invoices". It is clear the page is working.
- At about 0.5s the real header and briefs appear, "Amount owed" shows only a small spinner, and the vehicle cards show "No status recorded yet" under the Toyota. A moment later the Toyota updates to "Won 23/09/2026", so the vehicle card changes after first showing "No status recorded yet", and the layout shifts as invoices arrive.
- At about 1s the amounts appear. There was no blank screen on dashboard reloads.

C4 findings (zz-preexisting-account, name shown as "Abdulrazaq Ambrusa", with the email in the header)
- Amount owed: "No invoices yet." Your vehicles: "No vehicles yet." "Invoices (0)": "No invoices yet." Understandable, and not alarming. "Amount owed" says "No invoices yet." rather than $0, and it does not mention deposit requests or receipts. The Deposit requests, Credit notes, Receipts and Voided sections are absent when empty.

(b) WHAT BROKE
1. Staff, vehicle page behind the client page: two sets of identical Billing buttons exist (one in the vehicle overlay and one hidden behind it). My script clicking the first "New deposit request" hit the one under the overlay and the click was blocked by the overlay. For a human this is probably invisible; it is only a bug if the covered button can ever be reached.
2. Staff client page: the 2019 Honda Civic card in "Won vehicles" shows a single unbroken line "$175.00 + $2,722.50 + $2,350.00 + … owed" (17 amounts) that runs off the right edge of the card and is cut off ("$797.5…" visible in the screenshot), with the title text squeezed into a narrow column ("2019 / Honda / Civic").
3. RET-0001 is called "Deposit request" in lists but its PDF title is "RETAINER INVOICE" and its line is "Retainer" (old word).
4. "Issue deposit request" is greyed out for 4-6 seconds with no reason shown.
5. First-load of the vehicle page: only a spinner and "Back" for 5-7 seconds.

(c) WHAT WAS CONFUSING
1. Staff vehicle page, costs: "NOT CALCULABLE — title status could not be classified — title_type="clean" matched neither a clean nor non-clean indicator". This is a raw field name and quoted value in a staff screen.
2. Staff vehicle page, costs: "C2 duty calculator not yet built — blocked on collecting 10+ assessment notices (PLAN_TRACKER.md Phase C); the 51.47% formula exists but is uncalibrated for declared-CIF purposes". This is developer-facing text and a file name on a staff screen.
3. "Yard match: unmatched — no location on the sighting". "Sighting" is internal vocabulary.
4. "Source listing: d0000000-0000-4000-8000-0000000000a4 (inside the run above)" is a raw ID.
5. "Approval that authorised the bid: —" is a raw empty field.
6. Staff client page: the "Documents" section lists "test-title.pdf (TITLE)" and the vehicle page has a second, different "Documents" section ("No documents for this vehicle yet." with an Upload button), so the same title document is not shown on the vehicle. The Billing area also has its own "Documents" list of invoices and deposit requests. Three things are called "Documents".
7. "RE-SALES", "SOLD TWICE", "REPAIR HISTORY", "WARN", "BLOCK", "CRITICAL" appear in capitals with different meanings that are not explained.
8. "Market research average is based on only 1 sales."
9. Staff Billing "Documents" list: every row for a deposit request says "Deposit request" but the numbering is DEP- / RET-, and "Repair invoice" and "Retail invoice" appear as document types with no explanation.
10. Client dashboard "Amount owed" status chips and "credit balance" have no explanation.

(d) WHAT WORKED WELL
- Terms: "Deposit request / Commitment fee / credit balance" used consistently on the staff screens, the "Record payment" hint, and the receipt PDF ("Held as credit balance").
- The "Confirm issue" dialog is clear that issuing cannot be undone.
- The Record payment hint explains where to pay a specific invoice.
- Client dashboard: clear separate sections with counts, receipts show amounts, voided documents are collapsed and explained, "THE VEHICLE FROM YOUR LINK" is obvious.
- Not-found page is polite and clear. Loading skeleton with "Loading your account..." is reassuring. Empty state for the second client is calm and understandable.
- The unknown-lot-state warning says how to fix it.

Old words still present: "Retainer" / "RETAINER INVOICE" on the RET-0001 PDF, and the "RET-" prefix on staff and client lists. I saw no "on account", "unapplied credit", "in credit" or "deposit credit". "Deposit" does appear in "NO DEPOSIT" chips and in the line "Deposit (journey 18)" (staff-typed text).

(e) HOW I TESTED
- Playwright/Chromium, a fresh context per persona, signed in only through the "Sign in with email and password instead" form (staff, client C, and zz-preexisting-account). One login attempt failed ("Invalid login credentials") because my script mistyped the email address (zz-synthetic-preexisting-account); I corrected it and the second attempt succeeded. Nothing was issued, voided, paid, revoked or provisioned; the deposit-request modal and its "Confirm issue" dialog were cancelled.
- I downloaded 8 PDFs via the client dashboard and read them with pdftotext.
- Screenshots actually looked at: about 13 (s1b, s1c, s1e, s1f, s1g, s1h, s1i, run0, c3-0-0, c3-0-1, c2-link, c4, plus the failed-login screenshot). The full-page client dashboard screenshot (c1.png) was too tall to read, so I used text for that. Runs 2-4 (sold twice, flags active, flags sold) were read from page text only; I did not look at their screenshots.
- I read no source code, repo docs, or database. I did not open anything under /Users/cc/AutoData except through the browser. The only repo-adjacent thing I touched was the Playwright module under node_modules, via NODE_PATH. One slip to disclose: my page scripts printed element class names and tooltip titles that were part of the rendered page HTML (e.g. a tooltip "Asks for the commitment fee before work starts…"), which I used as UI text.

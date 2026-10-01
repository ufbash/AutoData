# Prompt 42 Stage 4 - independent usability verification (verbatim)

Fresh subagent, drove the live app through Playwright (headless Chromium, a fresh context per persona, real
login form only), forbidden from reading source code, the database, git, or repo docs. Run 1 Oct 2026 against
the synthetic org 4. The report below is the subagent's own text, unedited. Triage and what was done about each
finding is in `PLAN_TRACKER.md` debts #110-#119; nothing here has been softened or reordered.

---

## AutoData usability verification: report

(a) RESULTS TABLE

| Task | Worked? | Evidence |
|---|---|---|
| S1 sign in, find client, open full relationship | Yes | Clients tab, "ZZ Synthetic Client C", then the dark "Full relationship" button. About 2 clicks once I found the Clients tab. |
| S1 "is it clear how much they owe" | Partly | Per-currency cards: USD "OVERDUE $32,482.34 outstanding · $450.00 overdue" and NGN "SETTLED ₦0.00". Two currencies, no single total. |
| S1 vehicles with picture and balance | Partly | Vehicles are listed, but the "picture" is a grey empty box. The balance is a string of sums, e.g. "$37.34 + $450.00 + $350.00 + $9,000.00 owed". |
| S2 vehicle opens as own page | Yes | URL becomes /vehicle/d0000000-0000-4000-8000-0000000000a5. |
| S2 reload | Yes | Still on the vehicle page after reload. |
| S2 Back buttons | Partly | Browser Back and the page's "Back" both return to the client relationship page when navigated normally. After a reload or new tab, "Back" lands on the Research Runs home list and the client context is lost. |
| S2 URL in new tab | Yes | Loads the vehicle page (the home list flashes first). |
| S3 find costs, estimate vs actual | Partly | The Costs section is easy to find. The Corolla has no estimate at all, only "NOT CALCULABLE" rows. The Civic has a real pair: estimate "$797.5" and "Actual $700.00 (-$97.50 vs estimate)". |
| S3 record a new actual | Yes | Trucking, "+ Record actual", amount 12.34 and a note, Save. The line appeared as "Actual $12.34 — ZZ verifier test trucking actual". No confirmation message. |
| S4 create invoice | Yes | "New invoice", then the computed chip "Inland trucking — $12.34 (actual)", then a typed line "ZZ verifier test handling fee" $25. |
| S4 number visible before issuing | Partly | The editor title is "New invoice —" with no number. The number only appears after clicking Issue: "This will consume INV-0064 and cannot be undone". |
| S4 issue invoice | Yes, on the second attempt | INV-0064, total $37.34. The first attempt failed after the confirmation (see broke #1). |
| S4 where it appeared; PDF view and download | Yes | Top of the vehicle's Billing list. The eye icon opens a new tab and the download icon gives INV-0064.pdf (read as text and image). |
| S5 pay part, then the rest, against the invoice | Partly | The top-level "Record payment" has no invoice picker. It created unapplied credit (broke #3). Expanding the invoice row and using its "Record payment" worked: $20.00, then $17.34. Outstanding went $17.34, then $0.00. |
| S5 receipt produced and openable | Yes | REC-0017 and REC-0018 via "Record & issue receipt". The receipt PDF shows "INVOICE INV-0064 / Paid to date $37.34 / Outstanding $0.00". |
| S5 client account status before/after | Yes | USD outstanding $32,482.34 before. After the two payments $32,445.00, and "Paid" rose from $1,625.00 to $1,662.34. |
| S6 find how to ask for a deposit | Yes | "New deposit request" button in Billing, within a few seconds. The form opened and I cancelled without issuing. |
| S7 find how to give portal access | Partly | Clients without access show "No account linked. [client's email] [Provision]". Revoked shows "Access revoked (reason) Reactivate". Active shows "Account active  Revoke access". I did not click Provision (it creates an account), Reactivate, or Revoke. |
| S8 tab switch mid-typing | Partly | I tested with a second tab for 22 seconds in headless Chromium, plus simulated hidden/visible and blur/focus events. Half-typed text in the destination note, the record-actual amount and note, and the invoice Reference all survived. A real OS-level tab switch was not possible. |
| C1 client home | Yes | Described below. |
| C2 open an invoice | Yes | Clicking an invoice row expands it inline. |
| C3 look for internal wording | Yes | Findings under (b) and (c). |
| C4 other customer's vehicle URL | Partly | /vehicle/<other client's id> (the Yaris) shows the client's own portal home. No data leaked and no message was shown. |
| C5 second client and no-access account | Yes | Second client: "Your vehicles / No vehicles yet. / Invoices / No invoices yet." No-access account: "Your account isn't set up yet" (full text in (d)). |
| G1, G2 | Yes | Observations below. |

C1 in my own words: the screen has a heading with the client name, then "Your briefs" (rows "Vehicle brief  Pending Review" and "Toyota Corolla  Approved"), "Research shared with you", "Your vehicles" with a status track, and "Invoices". The invoice list holds about 30 rows, including voided ones, followed by "Receipts". It never says how much the client owes. Invoice rows show number, date and amount only. Invoice rows expand to show their line items.

C2 observations:
- Multi-line invoices read fine.
- Single-line invoices show one line, for example "ZZ all-inclusive price $9,000.00" with "Scope: Journey 8 retail fixture - all-inclusive price." That felt thin, and it does not say which vehicle it is for.

(b) WHAT BROKE

1. Issuing an invoice with a typed line and no "Origin" failed after the final confirm.
   - Steps: vehicle page, "New invoice", add a typed line, "Issue invoice", then "Confirm, issue INV-0064".
   - Symptom: the confirm dialog closed with a spinner, then a red line at the bottom of the editor: "Line 2: a staff figure must state what it rests on (a quote, an agreement, an invoice)". The console showed a 400 error.
   - The column that satisfies this is labelled "Origin" with placeholder "basis". It was blank and nothing marked it as required until this point.
   - The confirm text had just said "cannot be undone", so it was alarming to then get an error.
2. Voiding a payment that has a receipt fails with no message on screen.
   - Steps: vehicle page, Payments list, "Void" on "Payment $10.00". A browser prompt "Reason for voiding this payment:" appears. I accepted it.
   - Symptom: nothing changed and no message appeared. The network response was 400 `{"error":"A receipt has been issued for this payment - void the receipt first"}`.
   - The receipt rows only have view and download icons, so I found no way to void a receipt. Result: a $10.00 payment is stuck and shows as "$10.00 unapplied credit".
   - The void prompt is a native browser prompt, not an in-app dialog.
3. The top-level "Record payment" button takes Amount, Currency, Purpose, Method and Date, but has no invoice picker.
   - Steps: vehicle page, Billing, "Record payment", amount 10, Save.
   - Symptom: no message and the form just closes. The invoice stays unpaid, with the row still "$37.34". On the client page the status showed "$37.34 unapplied credit" and "Paid" did not change.
   - I recorded two payments this way before understanding why.
   - The correct route is to click the invoice row, which reveals "Outstanding $37.34 / Record payment / Raise a credit note / Void", then use "Record payment" there.
4. Clicking "Receipt" next to a payment issues a receipt as a side effect.
   - Steps: Payments list, click "Receipt" on "Payment $10.00".
   - Symptom: nothing opens and nothing is said. A new row "REC-0016" simply appears in the Receipts list. It is a numbered, permanent document, created by what looks like a view link. Its PDF says "Received on account - not yet applied to an invoice".
5. Client portal shows the wrong balance on fully paid invoices.
   - Steps: as the client, expand INV-0064, which staff had paid in full ($0.00 outstanding, receipts REC-0017 and REC-0018).
   - Symptom: it shows "Balance outstanding $37.34".
   - Same for RET-0001: "Balance outstanding $500.00", although staff list "Deposit $500.00 · bank transfer · 22/09/2026".
6. Stale, slow feedback when recording an invoice payment.
   - Steps: expand the invoice, "Record payment", then "Record & issue receipt".
   - Symptom: a spinner for about 7 seconds. Receipt creation is a second step that completed later. The invoice still showed "Outstanding $17.34" ten seconds later, and only updated after a reload.
7. Costs section briefly changes text when opening "+ Record actual".
   - Steps: click "+ Record actual" on Trucking.
   - Symptom: "NOT CALCULABLE" lines changed to "computing...", and the pricing note changed from "Fees priced under Copart U.S. Non-Licensed ..." to "No fee schedule basis could be resolved for this vehicle at the approved price of $2,200 ..." before reverting. This one is a flicker, not a failure.
8. Staff client page loads in two stages.
   - Symptom: a lone spinner in the header card for several seconds before the balances and per-vehicle "owed" figures appear. The Won vehicles rows had no amounts in the meantime.
9. Client at an invalid or foreign vehicle URL gets no explanation.
   - Steps: as the client, open /vehicle/<other client's id>, /vehicle/00000000-0000-0000-0000-000000000000 and /vehicle/abc.
   - Symptom: the normal portal home with the URL unchanged. There is no "not found" or "not yours" message. Nothing sensitive appeared.

(c) WHAT WAS CONFUSING

1. Per-vehicle balance reads as a sum, not a total. The Civic row shows "$2,350.00 + $797.50 + $2,722.50 + $2,350.00 + $1,000.00 + $2,350.00 + $2,350.00 + $6,200.00 + $2,350.00 + $175.00 owed". The vehicle's grey placeholder block stands in for a picture. The vehicle page itself says "No stored images for this vehicle."
2. Vehicle page leaks internal wording.
   - "NOT CALCULABLE ... C2 duty calculator not yet built / blocked on collecting 10+ assessment notices (PLAN_TRACKER.md Phase C); the 51.47% formula exists but is uncalibrated for declared-CIF purposes".
   - `title_type="clean" matched neither a clean nor non-clean indicator`.
   - "Source listing: d0000000-0000-4000-8000-0000000000a4 (inside the run above)".
   - "Fees priced under Copart U.S. Non-Licensed (account: Jamilu Danmusa Danmusa #387085)" appears on Client C's vehicle, so it looks like another person's account name.
3. On the Corolla, "Actual $450.00 — First actual - Stage 3 verification" sits under "Duty" and the item it belongs to is not obvious. The estimate/actual pair explanation is only one small caption: "the black figure is what the rate tables predict; the gold "Actual" line, when recorded, is a real bill and always wins". The estimate is never labelled "Estimate". On the Civic the estimate prints as "$797.5" and the actual as "$700.00".
4. "Origin" column and placeholder "basis" in the invoice editor. The error message calls it "what it rests on". The vocabulary does not match.
5. Invoice editor gives no number up front ("New invoice —"). The confirm dialog uses "This will consume INV-0064", which is jargon.
6. Deposit-request form from the client page shows "Won vehicle (none linked here)" and "External vehicle" pre-selected, with Plate, VIN and Description fields. It also shows "Apply existing payments or deposit credit" with chips "Payment $10.00 (2026-10-01)" (ISO date) and "Deposit request RET-0001", which is odd on a request for a deposit.
7. Terms for money paid before the work (S6), verbatim. Staff side:
   - "New deposit request" (button and form title) and "Issue deposit request".
   - "Deposit request" (document type, e.g. "RET-0001  Deposit request").
   - "NO DEPOSIT" (badge on each brief).
   - "Commitment fee deposit received" (checkbox on the brief page).
   - "Purpose: Deposit / Payment" and the payments row "Deposit $500.00 · bank transfer".
   - "Apply existing payments or deposit credit".
   - "unapplied credit" and "Received on account - not yet applied to an invoice".
   - Client side, inside RET-0001: line item "Retainer" and "Scope: Retainer toward the Civic purchase." (This is fixture text, but it is what the client reads.)
   - So the words used are Deposit, Retainer, Commitment fee, credit and on account. Document number prefix is "RET" for what is labelled "Deposit request".
8. Dates are inconsistent. Client page: "Client since 9/22/2026", "Won 9/23/2026" (month/day/year). Billing and the client portal: "01/10/2026", "23/09/2026" (day/month/year). A date such as 01/10/2026 is ambiguous. The editor shows ISO "(2026-10-01)".
9. Billing on a vehicle page lists dozens of the whole client's invoices (many other vehicles and currencies, including NGN), not just this vehicle's. The client page also shows "Invoices (legacy, retired path) 0 / No invoices issued through the retired path." and "Email history", which read as internal.
10. A paid invoice just shows "Outstanding $0.00" with no "Paid" label. The "Receipt" word beside payments and "REC-xxxx" rows both exist.
11. Client portal:
    - No amount owed anywhere.
    - Voided invoices, a credit note and a deposit request are all under the heading "Invoices".
    - "Vehicle brief" and "Research run" names are generic.
    - The brief row says "Pending Review" with no explanation.
    - Invoice rows say nothing about which vehicle they are for.
    - Invoices sort in no clear order.
    - There is no way to download an invoice PDF as the client; only receipts and the title document download.
    - Client-visible line labels include "Inland trucking (actual)", "Trucking (staff-entered)", "Vehicle price (winning bid)" and the scope text "Scope: Stage 6 verification invoice covering inland trucking actual cost." / "Scope: Debt #79 recompute proof." / "Scope: Journey 6 verification invoice." (fixture data, but it shows internal text reaches clients).
12. My cost note leaked onto the client-facing invoice PDF. The PDF I issued ends with "Line 1 Staff figure: ZZ verifier test trucking actual" and "Line 2 Staff figure: ZZ test agreement". My internal note and "basis" text were printed on it. The section header also reads "PARTICULARS OF ZZ".
13. Provision flow: "Provision" is jargon. The "Access revoked" reason shows a staff note "(End of Stage 3 verification - resetting for the next run)". "Reactivate" has no explanation.
14. The Clients list URL does not change (stays "/") so I could not deep-link to a client. Also a research-run card says "For ZZ Synthetic Client C · Brief:" with text I did not follow up on.
15. "Void" is a plain red link next to every payment with no confirmation beyond the native prompt, and the same word appears for invoices, cost actuals and payments.

(d) WHAT WORKED WELL
- Sign-in with email and password worked first time for all four accounts.
- Client page is arranged logically (balance, briefs, runs, vehicles, documents, billing).
- Vehicle pages are real routes and survive reload and new-tab.
- Invoice PDFs and receipt PDFs are clean and correct; the receipt arithmetic matched the screen.
- The confirm-before-issue dialog shows the exact number and total.
- "Landed cost: not calculable ... Missing: Auction fees, Shipping." is plain and honest.
- Client no-access message: "Your account isn't set up yet / zz-unprovisioned@autodata.test is signed in, but no organisation has linked this account yet. / If you're expecting access, ask the team you're working with to set it up - then sign in again." with a "Sign out" button. It tells the person what to do.
- Account status after payment moved correctly on the staff client page.
- Typed text survived a tab switch.

Records I created (all obviously test): trucking actual $12.34 on the 2018 Corolla; invoice INV-0064 ($37.34, now fully paid); payments $10.00 (stuck, with REC-0016), $27.34 (voided), $20.00 and $17.34 (REC-0017, REC-0018). Nothing pre-existing was paid or voided. I did not click Provision, Reactivate or Revoke.

(e) HOW I TESTED
- Playwright Chromium scripts in /private/tmp/claude-501/-Users-cc-AutoData/6b3272c0-26dd-49be-bc30-d1eafd1c3fe3/scratchpad/verifier/ (about 40 scripts, headless).
- A fresh browser context per persona, signing in only via the login form's "Sign in with email and password instead" path (never Google, no injected sessions).
- I looked at about 35 screenshots and read the text of every screen. I also read the downloaded PDFs with pdftotext and viewed one as an image.
- I cannot get a human's real timing, but each task took one to four scripts to find.
- Limits:
  - Headless mode means the S8 test is simulated.
  - Native browser prompts (the void reason) are auto-handled by my script.
  - The "ZZ Journey Test Client" relationship page returned no text in my script, so I did not evaluate it.
- Source code: I read none. I did not open src, supabase, e2e, any ts/tsx/sql file, or any repo doc. Playwright's own error output showed some element test IDs and class names from the rendered page when a click was blocked; that came from the live DOM in the browser, not from reading files, and I did not search for them.
- I ran no database access or git commands, and sent no emails.

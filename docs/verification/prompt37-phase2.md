# Prompt 37 Phase 2 - independent verification (verbatim report)

A fresh subagent that wrote none of Phase 2 was given the requirements and the code (not the author's reasoning or results) and told to verify cold: read-only on the repository, database access strictly one query at a time, tests only inside transactions that always abort, and only against a synthetic org. This is its report **verbatim**. The author's resolution of each finding follows in the table at the end.

---

All eight requirements verified; the requested failure is only partly ruled out. No invoice can be issued that is silent about a cost component. A "complete" invoice can still carry a $0.00 or unverified line for a missing component (details under requirement 2).

Method: I read the migrations, Edge Function, shared modules and services, and ran the requested tests. I also ran SELECTs and aborted `DO` blocks against the synthetic org, plus one catalog-only check on `cost_rates`. `npx tsc --noEmit` is clean. `testInvoiceRules.mts` (13 cases) and `testPaginatedRead.mts` (10 cases) all PASS. Test blocks used `SET CONSTRAINTS ALL IMMEDIATE` so the deferred triggers actually fired, and I confirmed with control cases that valid invoices are accepted.

## 1. NUMBERING: PASS, with caveats
- **Per-org, separate sequences.** `document_sequences` has PK (org_id, kind). `allocate_document_number` (058:81-97) prefixes INV-/REC-.
- **Database uniqueness.** `document_numbers_org_id_kind_seq_key`, `document_numbers_org_id_kind_number_text_key`, `won_vehicle_invoice_issuances_generated_number` (partial unique on org_id, invoice_number WHERE generated) and `won_vehicle_receipts_org_id_receipt_number_key`.
- **Serialisation.** The `UPDATE document_sequences … RETURNING` takes a row lock, so concurrent allocations queue. I could not rerun a concurrency test read-only. The code and constraints are sufficient, and a rolled-back test showed the constraint backstop: setting `last_seq=5` then allocating gave "duplicate key … seq_key".
- **Voided keeps its number.** Voiding an invoice sets the ledger row to `voided/ voided: t`, and re-inserting seq 18 was refused. Guard tests:
  - delete refused
  - identity edit refused
  - voided→issued and issued→abandoned refused
  - duplicate seq and duplicate number_text refused
- **Reuse paths.** I found no way for a number to be reused, and `issue_generated_invoice` locks the number row FOR UPDATE and requires status `allocated`.
- **Live ledger.** Invoice seq 1..18 and receipt seq 1..4 are gap-free with no duplicates. Every generated invoice and receipt matches its ledger row (status, ref_id, text): 0 mismatches.
- **Caveat 1.** 12 numbers are `allocated` with a null note and older than 10 minutes: invoice 2-9, 13, 15 and receipt 2, 3. The design says a failed issue is marked `abandoned` with a note, and nothing sweeps these. The cause is undetermined.
- **Caveat 2.** The unique index covers only `generated` rows. A legacy hand-typed issuance with `invoice_number='INV-000016'` was ACCEPTED in a rolled-back test, so two records in the org can show the same number. The migration comment states this is intended.
- **Caveat 3.** A generated issuance whose number never came from the ledger (INV-000500) was ACCEPTED at the database level. This is reachable only by the service role.

## 2. PRE-FILL ONLY FROM REAL COMPONENTS: pre-fill logic PASS; the failure is only partly ruled out
- **Pre-fill logic passes.** `computeInvoicePrefill` (wonVehicleBillingService.ts:114-152):
  - Pre-fills only `available` components with no `partialReason`.
  - Excludes fees with no `bid_method` and freight ranges.
  - Duty is always unavailable (bidHeadroomService.ts:302).
  - Brokerage fee is hardcoded `needs_figure` (line 150).
  - The vehicle price uses only the recorded winning bid.
  - `cost_rates` has 0 ocean_freight rows, so freight abstains today.
- **Silent absence is refused.** Aborted `issue_generated_invoice` tests refused every one of these:
  - vehicle price only, partial, no exclusions
  - three of four exclusions listed
  - complete with five lines
  - duty relabelled as kind `other`
  - blank or invalid exclusion reasons
  - a line that is also excluded
  - a partial invoice with `p_excluded` NULL
  - a partial invoice carrying an all-inclusive line
- **Zero or unverified lines get past.** Each of these was ACCEPTED at the database level:
  - c5: a complete invoice with ocean_freight $0 (staff-entered, basis "n/a")
  - c6: the same with origin `computed` at $0
  - c22: a vehicle_price $0 line in a partial invoice
  - The "computed zero refused" rule exists only in `deriveInvoice` (invoiceRules.ts:62), not in migration 059 (`amount >= 0`). The header comment "the database therefore refuses to hold one" is not true for zero lines.
- **Empty amount becomes $0.** Via the UI, an empty amount field is `Number('') = 0`. Switching a row to "line", typing any basis and leaving the amount blank gives a `staff_entered` zero, which `deriveInvoice` accepts. The result is a complete invoice with a $0.00 line, printed as "Total".
- **`origin` is self-declared.** Neither the Edge Function nor the database verifies it. INV-000012 is a "complete" invoice with duty $900 and ocean freight $1500 both stored as `computed`, though neither can compute (likely test data).
- **Freight approximation.** `getOceanFreightComponent` takes `data[0]` from fuzzy `ilike` matches with no ambiguity check. Freight is not pre-filled today because no rate exists.
- **Trucking approximation.** `getInlandTruckingComponent` returns the cheapest of several quotes as an available component (bidHeadroomService.ts:255-262). It is pre-filled as "real figure" when the yard matches and quotes exist.

## 3. TWO HATS: PASS
- The database check (059:304-327) requires a retail invoice to have exactly one client-visible line of kind `all_inclusive_price`, scope complete, and no exclusions. It requires a brokerage invoice to have no hidden lines and no all-inclusive line. Aborted tests c10, c11, c13 and c15 were refused. Control c12 (retail with hidden cost) was accepted.
- The Edge Function filters to `client_visible` lines before rendering (index.ts:120, 134). `renderInvoicePdf` receives only those lines, plus the org name, client name, vehicle heading and free-text notes.
- I found no path for hidden retail lines to reach the PDF or the share paths. `won-vehicle-tracking` and `won-vehicle-notify` don't reference the billing tables.
- Retail cost lines are readable by every staff member of the org through RLS. That is staff-only, and it is by design.
- Staff-entered internal cost lines typed in retail mode are silently dropped: only rows where `r.computed` are kept (WonVehicleBilling.tsx:66).
- Notes and line descriptions are free text and could contain anything.

## 4. CURRENCY FROZEN: PASS
- The rate is fetched once, and there is a 502 with no fallback (index.ts:103-113). `fx_rate`, `fx_rate_date` and `fx_source` are stored, and the shape CHECK requires them for NGN.
- `convert_invoice_lines` runs in the database and is called for both the PDF figures and the stored figures.
- I found no read-time conversion in the billing service, the billing UI, the relationship service or the balance view. The only `fx_rate` reads are display.
- Live check: NGN INV-000014 and INV-000017 have every line equal to `round(amount_usd*fx_rate,2)`. The header equals the sum of visible lines and `amount_usd` equals the sum of the USD lines, for all 8 invoices. For example, INV-17 is 1700 × 1332.834401 = 2265818.48.
- The JavaScript/SQL rounding mismatch cannot corrupt a stored figure. JavaScript only sums the values the database returned.
- `fx_rate_date` is today's UTC date, not the provider's rate date; the provider timestamp is inside `fx_source`.

## 5. PAYMENTS: PASS
- **Guards.** Append-only triggers, rolled-back tests refused:
  - update and delete of a payment
  - overpay by 0.01 (control at the exact balance was accepted)
  - an NGN payment on a USD invoice
  - a payment on a voided invoice
  - voiding an invoice that has live payments
  - re-voiding or un-voiding a voided payment
  - voiding a payment that has a live receipt
- **Serialisation.** `SELECT … FOR UPDATE` on the invoice row (059:189) serialises concurrent payments; I did not rerun concurrency.
- **Derived balance.** `won_vehicle_invoice_balances` is a view with `security_invoker`, and no balance column exists anywhere.
- **Void restores balance.** After voiding the receipt and then the payment on INV-16, the view showed paid=0.00 and outstanding=2175.00.
- **Live arithmetic.** INV-12 shows paid 3000 and outstanding 2715 (voided 2000 excluded). INV-16 shows paid 1000 and outstanding 1175. Both agree with an independent SUM.

## 6. RECEIPTS: PASS, with one integrity gap
- Live data:
  - REC-000001 voided (payment voided too)
  - REC-000004 live
  - one live receipt per payment via `won_vehicle_receipts_one_live_per_payment`
  - own sequence, tested independent (`p5`)
- Refused in tests: a receipt for a voided payment, a second live receipt for the same payment, and updating or deleting a receipt.
- **Gap.** `won_vehicle_receipts` has no FK on `org_id` (to organizations, or to the payment via the unused `UNIQUE(id, org_id)`). An insert with a random `org_id` and no ledger row was ACCEPTED (rolled back). `issue_receipt_record` doesn't check the payment's org. This is reachable only via the service role.

## 7. CLIENT RELATIONSHIP VIEW: PASS, with gaps in coverage
- **Isolation.**
  - Every query filters `org_id` plus `client_id` or a vehicle-id `.in()` list. `won_vehicle_status_history` has no `org_id` and is scoped by vehicle ids only.
  - Post-load `assertOrg`, `assertClient` and `assertVehicles` calls throw on leaks (service lines 121-168).
  - `.in()` is chunked at 50 and every read uses `fetchAllVerified` (paging plus exact count).
  - Emails are masked to `x***@domain`.
- **research_runs.** The permissive `select_research_runs_auth` policy (qual `true`) exists, and the service does not rely on RLS.
- **Coverage gaps.**
  - Invoices, payments, receipts and documents are loaded only for live (non-deleted) vehicles (`vehicleIds` = live). The money records of a soft-deleted vehicle are not shown, while its emails are included.
  - The Invoices section shows "Paid/Outstanding" for voided invoices too (ClientRelationship.tsx:178), while the billing UI hides it. The view returns outstanding 2175 for voided INV-10.
  - Emails cover only `related_table` in ('client_briefs', 'won_vehicles'). The live `email_log` contains only `won_vehicles` rows.
- **ClientsList.** The overlay at z-40 sits under `WonVehicleDetail` at z-50. The `onOpenWonVehicle` callback has no try/catch. I did not use the browser tools.

## 8. AUTH-GATED DOCUMENTS: PASS
- **Row-level access.** The new tables, `document_numbers` and `document_sequences` have only SELECT policies (org staff or superadmin). Anon queries on the issuances and documents tables returned 0 rows. Anon SELECT on the balance view fails at the underlying table (`won_vehicle_payments` has no anon grant).
- **Writes refused.** Authenticated INSERT into issuances and payments and UPDATE of payments were refused (RLS or permission denied).
- **Function grants.** `allocate_document_number`, `mark_document_number`, `issue_generated_invoice`, `issue_receipt_record` and `convert_invoice_lines` are executable by `service_role` only. `check_generated_invoice` and the guard functions are executable by anon and authenticated, but they are SECURITY INVOKER (RLS-bound).
- **Bucket.** `won-vehicle-documents` is private (`public=false`), has a staff SELECT policy on the org folder plus a service-role policy, and allows PDF/PNG/JPEG/WebP up to 10 MB. The client uses 300-second signed URLs.
- **Function auth.** The function isn't listed in config.toml, so `verify_jwt` defaults to on, and it also does its own `getUser` and membership check. I could not confirm the deployed `verify_jwt` value.
- **Share path.** The public `won-vehicle-tracking` function references none of these tables.
- **Deployed code.** `won-vehicle-billing` is at version 1, updated 16:59 UTC. The local `index.ts` was last modified at about 16:56 UTC. I could not diff the deployed body.

## OTHER FINDINGS
1. **Generated PDFs can be soft-deleted.** The existing `won-vehicle-documents` `delete` mode (index.ts:116-131) soft-deletes any document. There is no guard for a document referenced by an issuance or receipt, and no triggers exist on `won_vehicle_documents`. The billing UI then reports "You do not have access to download this file" (WonVehicleBilling.tsx:177). Currently 0 such rows.
2. **Wrongly retired PDF.** In `issue_invoice`, if `issue_generated_invoice` commits but the response errors client-side, the catch retires the PDF (index.ts:154-157). The `abandon` call then fails silently because the number is `issued`. The result is an issued invoice with a soft-deleted PDF.
3. **Idempotency key.** A repeated key returns the earlier invoice without comparing payloads (index.ts:92-96). The UI closes the builder as though the new content was issued.
4. **Racing receipts.** Two concurrent `issue_receipt` calls for one payment burn a number: the loser is retired and its number abandoned, and it gets a 400 rather than the winner.
5. **Lines can be appended.** The lines guard covers UPDATE and DELETE only. A zero-amount visible line inserted onto issued INV-16 was ACCEPTED in a rolled-back test (service role).
6. **PDF wording.** A partial invoice says each excluded item "will be invoiced separately when its figure is known" (documentPdf.ts:123), which is a promise even where the reason is something else. The hat text hardcodes "Caplimo" (lines 98-99). The receipt "Paid to date (this receipt included)" shows the balance at issue time, including later payments.
7. **No TRUNCATE guard.** `service_role` has TRUNCATE on lines, payments, receipts and issuances, and only `document_numbers` has a truncate trigger. The blanket anon and authenticated DML/TRUNCATE grants on `won_vehicle_invoice_issuances` and the balance view are RLS-gated and not reachable through PostgREST.
8. **Error handling.** Any thrown error returns HTTP 500 with the raw database message. A void of a payment or receipt that races to zero rows returns success (index.ts:189-191).
9. **No tests for the Edge Function or PDF rendering.** Only `testInvoiceRules.mts` covers new code.

## COULD NOT DETERMINE
- Concurrent double-issue and concurrent payments: not runnable read-only. The code and constraints are sufficient by reasoning. The ledger's `allocated_at` values are all at least 2.5 seconds apart, so the data shows no concurrent test.
- Why 12 numbers remain `allocated` with no note: I did not look at logs.
- The deployed function body versus the local file, and the deployed `verify_jwt` value: I did not diff or query them.
- Any UI behaviour, including overlay layering: I did not use the browser tools.
- Storage behaviour with real signed URLs: I read the policies only, and did not fetch a file.

---

# The author's resolution of each finding

The verifier **did** disagree materially on the point that matters (requirement 2): the design said the database refuses an invoice presented as complete while a component is missing, but a zero-amount line got past it. That was correct, and it stops the work until fixed (prompt stop rule 6).

| Finding | Resolution |
|---|---|
| Req 2: a $0 line (staff-entered with basis "n/a", or computed) for a missing component passes the database; the zero rule lived only in JavaScript | **Fixed** in migration 060 and in the shared rules: a zero amount is refused on every line except a **waived brokerage fee** (staff-entered, with its basis); a component that costs nothing is excluded with a reason. Node test adds the verifier's exact bypass (a staff-entered zero for ocean freight, basis "n/a") |
| Req 2: a blank amount field becomes $0 (`Number('') = 0`) | **Fixed** - the builder reads a blank as not-a-number, which the rules refuse |
| Req 2: `origin` is self-declared; a "computed" line can be anything | **Partly fixed, stated plainly.** A computed line must now carry the source it was computed from (database and rules). A computed **vehicle price** is verified server-side against the vehicle's current, un-voided winning bid at that exact amount. Other computed lines come from the browser's cost services and **cannot be recomputed on the server** (they live in frontend code); they carry their source rows but are trusted, as the builder's own output. INV-000012 in the synthetic org (duty and freight marked computed) is my own test data |
| Req 2: freight and trucking approximations | Freight has no stored rate today (abstains); trucking is the cheapest of the current quotes and is labelled "cheapest of N" by the cost service. Recorded, not changed |
| Req 1 caveat 1: 12 numbers `allocated` with no note | **Explained**: they are the numbers my own direct-SQL tests allocated and then refused (test 3's rejected attempts, one forged insert, refused receipt issues), bypassing the function's `abandon` step. Marked `abandoned` with a note on 21 Sep 2026 (confirmed) |
| Req 1 caveats 2 and 3: legacy hand-typed number can equal a generated one; a service-role insert with a number not from the ledger | Legacy: **by design** (free text; documented). Ledger: **fixed** in 060 - a generated invoice must use an allocated number of its own org, kind, sequence and text |
| Req 3: staff-entered internal cost lines dropped in retail mode | **Fixed** - staff-entered rows are kept as internal (never printed) lines, with their basis |
| Req 6: receipt org/vehicle not checked against the payment or the ledger | **Fixed** in 060 |
| Req 7: money records of a removed vehicle not shown; balance shown for a voided invoice | **Fixed** - all of the client's vehicles (removed ones labelled) feed invoices, payments, receipts and documents; a voided invoice shows no balance |
| Req 7: overlay layering / no try/catch on opening a vehicle | Recorded; the overlay sits under the vehicle popup by design |
| Other 1: a generated PDF can be soft-deleted | **Fixed** in 060 - a document a live invoice or receipt points at cannot be soft-deleted |
| Other 2: a committed invoice's PDF wrongly retired after a reply failure | **Fixed** - the function checks whether the number was issued before retiring anything and returns the committed invoice |
| Other 3: idempotency key returns the earlier invoice without comparing content | **Fixed** - a request hash is stored; the same key with different content is a 409 conflict |
| Other 4: racing receipts burn a number and return an error | **Fixed** - the loser returns the winner's receipt (the burned number is `abandoned`, explicable) |
| Other 5: lines can be appended to an issued invoice | **Fixed** in 060 - a line may only be inserted in the transaction that inserts its invoice |
| Other 6: PDF wording | **Fixed** - no promise of a later invoice for every exclusion; the org name is no longer hard-coded; the receipt says "at the time of issue" |
| Other 7: no TRUNCATE guard | **Fixed** in 060 |
| Other 8: raw database messages as 500; a void race returns success | Void race **fixed** (409). The raw-message behaviour is recorded; refusals surface as 400 where the function catches them |
| Other 9: no tests for the Edge Function or PDF | Recorded: the function was exercised end to end against the live database and the PDFs were read back, but there is no automated test |

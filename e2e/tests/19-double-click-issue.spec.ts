import { test, expect, Page } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';

// PROMPT 44 Stage 3 - a double-click must produce ONE document and ONE number, never burn numbers, never show a raw error.
// Found by firing 5 identical issue requests at once: one document, but four numbers allocated-then-abandoned (gaps in the
// series) and four raw "duplicate key value violates unique constraint" errors. Fixed by claiming the idempotency key BEFORE
// allocating (migration 086). This journey fires the same bursts through the real session, for an invoice AND a receipt.
test.setTimeout(180000);

const SUPABASE = 'https://xrotvpuainpfdulhfhtt.supabase.co';
const ORG4 = 'd0000000-0000-4000-8000-000000000040';
const CLIENT_C = 'd0000000-0000-4000-8000-000000000033';

async function session(page: Page) {
  await signInAsStaff(page);
  const apikeyP = new Promise<string>(r => page.on('request', q => { const k = q.headers()['apikey']; if (k && q.url().includes('/rest/v1/')) r(k); }));
  await page.reload();
  const apikey = await apikeyP;
  const token = await page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.endsWith('-auth-token'))!; return JSON.parse(localStorage.getItem(k)!).access_token as string; });
  return { apikey, token };
}
const abandoned = async (page: Page, s: { apikey: string; token: string }, kind: string) =>
  (await (await page.request.get(`${SUPABASE}/rest/v1/document_numbers?org_id=eq.${ORG4}&kind=eq.${kind}&status=eq.abandoned&select=seq`, { headers: { apikey: s.apikey, Authorization: `Bearer ${s.token}` } })).json()).length as number;
const billing = (page: Page, s: { apikey: string; token: string }, body: unknown) =>
  page.request.post(`${SUPABASE}/functions/v1/billing`, { headers: { apikey: s.apikey, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' }, data: body });

test('five simultaneous identical issue requests: one invoice, one number, no burned numbers, no errors; same for a receipt', async ({ page }) => {
  const s = await session(page);
  const key = `j19-${Date.now()}`;
  const invoice = {
    mode: 'issue_document', docType: 'invoice', invoiceKind: 'repair', clientId: CLIENT_C, externalVehicle: { description: 'journey 19 double-click' },
    issueDate: new Date().toISOString().slice(0, 10), currency: 'USD', settlementCurrency: 'USD', invoiceDiscount: { type: 'none', value: 0 }, adjustment: { amount: 0 },
    lines: [{ position: 1, section: 'Probe', description: 'Double-click probe', quantity: 1, rate: 1, discountType: 'none', discountValue: 0, taxCode: null, clientVisible: true, origin: 'staff_entered', basis: 'Journey 19 (synthetic)' }],
    apply: [], idempotencyKey: key,
  };
  const before = await abandoned(page, s, 'invoice');
  const burst = await Promise.all(Array.from({ length: 5 }, () => billing(page, s, invoice)));
  const bodies = await Promise.all(burst.map(r => r.json()));
  expect(burst.map(r => r.status()), `no raw errors: ${JSON.stringify(bodies.map(b => b.error).filter(Boolean))}`).toEqual([200, 200, 200, 200, 200]);
  expect(new Set(bodies.map(b => b.numberText)).size, 'one number').toBe(1);
  expect(new Set(bodies.map(b => b.documentId)).size, 'one document').toBe(1);
  const docs = await (await page.request.get(`${SUPABASE}/rest/v1/billing_documents?idempotency_key=eq.${key}&select=id`, { headers: { apikey: s.apikey, Authorization: `Bearer ${s.token}` } })).json();
  expect(docs.length, 'one document in the database').toBe(1);
  expect(await abandoned(page, s, 'invoice'), 'no invoice number burned').toBe(before);

  // a receipt: record one payment, then ask for its receipt five times at once
  const pay = await (await billing(page, s, { mode: 'record_payment', clientId: CLIENT_C, amount: 1, currency: 'USD', paidAt: new Date().toISOString().slice(0, 10), method: 'bank_transfer', purpose: 'payment', apply: [] })).json();
  const beforeR = await abandoned(page, s, 'receipt');
  const rb = await Promise.all(Array.from({ length: 5 }, () => billing(page, s, { mode: 'issue_receipt', paymentId: pay.paymentId })));
  const rbodies = await Promise.all(rb.map(r => r.json()));
  expect(rb.map(r => r.status())).toEqual([200, 200, 200, 200, 200]);
  expect(new Set(rbodies.map(b => b.receiptNumber)).size, 'one receipt number').toBe(1);
  const recs = await (await page.request.get(`${SUPABASE}/rest/v1/billing_receipts?payment_id=eq.${pay.paymentId}&select=id`, { headers: { apikey: s.apikey, Authorization: `Bearer ${s.token}` } })).json();
  expect(recs.length, 'one receipt for the payment').toBe(1);
  expect(await abandoned(page, s, 'receipt'), 'no receipt number burned').toBe(beforeR);
});

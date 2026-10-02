// STAGE 3 (#109) - capture an issuing stall with per-phase timings, and prove the double-click case. ORG 4 ONLY (synthetic).
// Uses the synthetic staff account through the real auth API (the same way the app does); nothing touches the real org.
// Run: node scripts/stressIssue.mjs [sequentialCount=40] [concurrency=5]
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('e2e/.env.e2e', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const appEnv = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const URL = appEnv.VITE_SUPABASE_URL, KEY = appEnv.VITE_SUPABASE_ANON_KEY;
const ORG4_CLIENT = 'd0000000-0000-4000-8000-000000000033'; // ZZ Synthetic Client C (org 4) - synthetic
const N = Number(process.argv[2] ?? 40), C = Number(process.argv[3] ?? 5);

const tok = async () => (await (await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.E2E_STAFF_EMAIL, password: env.E2E_STAFF_PASSWORD }) })).json()).access_token;
const body = (key, tag) => ({
  mode: 'issue_document', docType: 'invoice', invoiceKind: 'repair', clientId: ORG4_CLIENT, externalVehicle: { description: `stall probe ${tag}` },
  issueDate: new Date().toISOString().slice(0, 10), currency: 'USD', settlementCurrency: 'USD', invoiceDiscount: { type: 'none', value: 0 }, adjustment: { amount: 0 },
  lines: [{ position: 1, section: 'Probe', description: `Stall probe ${tag}`, quantity: 1, rate: 1, discountType: 'none', discountValue: 0, taxCode: null, clientVisible: true, origin: 'staff_entered', basis: 'Prompt 44 stall probe (synthetic)' }],
  apply: [], idempotencyKey: key,
});
const issue = async (token, b) => { const t = Date.now(); const r = await fetch(`${URL}/functions/v1/billing`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json().catch(() => ({})); return { status: r.status, ms: Date.now() - t, j }; };

const token = await tok();
console.log(`--- phase 1: ${N} sequential issues`);
const rows = [];
for (let i = 0; i < N; i++) {
  const r = await issue(token, body(`stall-${Date.now()}-${i}`, i));
  rows.push(r);
  const t = r.j.timings ?? {};
  console.log(`${String(i).padStart(2)} ${r.status} ${String(r.ms).padStart(6)}ms server=${String(t.total ?? '?').padStart(5)} cold=${t.cold ? 'Y' : 'n'} ${r.j.numberText ?? r.j.error ?? ''} ${JSON.stringify(Object.fromEntries(Object.entries(t).filter(([k]) => !['total', 'cold', 'instanceAgeMs', 'requestsServed'].includes(k))))}`);
}
const ok = rows.filter(r => r.status === 200 && r.j.timings);
const sorted = [...ok].sort((a, b) => b.ms - a.ms);
console.log(`\nclient-observed: median=${[...ok].map(r => r.ms).sort((a, b) => a - b)[Math.floor(ok.length / 2)]}ms  p90=${[...ok].map(r => r.ms).sort((a, b) => a - b)[Math.floor(ok.length * 0.9)]}ms  max=${sorted[0]?.ms}ms  over8s=${ok.filter(r => r.ms > 8000).length}  over15s=${ok.filter(r => r.ms > 15000).length}`);
console.log('slowest 3 with phases:'); sorted.slice(0, 3).forEach(r => console.log(' ', r.ms, 'ms', JSON.stringify(r.j.timings)));

const abandonedCount = async (kind) => (await rest(`document_numbers?org_id=eq.d0000000-0000-4000-8000-000000000040&kind=eq.${kind}&status=eq.abandoned&select=seq`)).length;
const rest = async (q) => (await (await fetch(`${URL}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } })).json());
const abandonedBefore = await abandonedCount('invoice');
console.log(`\n--- phase 2: ${C} SIMULTANEOUS identical requests (the double-click), one idempotency key`);
const key = `dbl-${Date.now()}`; const same = body(key, 'double-click');
const burst = await Promise.all(Array.from({ length: C }, () => issue(token, same)));
burst.forEach((r, i) => console.log(`req ${i}: ${r.status} ${r.ms}ms ${JSON.stringify({ number: r.j.numberText, doc: r.j.documentId?.slice(0, 8), alreadyIssued: r.j.alreadyIssued, recovered: r.j.recovered, error: r.j.error })}`));
const numbers = new Set(burst.map(r => r.j.numberText).filter(Boolean)), docs = new Set(burst.map(r => r.j.documentId).filter(Boolean));
// ground truth from the database through the staff session: how many documents carry this key, and any abandoned numbers
const docsWithKey = await rest(`billing_documents?idempotency_key=eq.${key}&select=id,number_text`);
console.log(`distinct numbers in replies=${numbers.size} distinct documents in replies=${docs.size} | documents in the database with this key=${docsWithKey.length} ${JSON.stringify(docsWithKey.map(d => d.number_text))}`);
const abandonedAfter = await abandonedCount('invoice');
const rawErrors = burst.filter(r => r.status !== 200).length;
console.log(`newly ABANDONED invoice numbers from the burst=${abandonedAfter - abandonedBefore}  non-200 replies=${rawErrors}`);
const invoiceSafe = docsWithKey.length === 1 && numbers.size === 1 && abandonedAfter === abandonedBefore && rawErrors === 0;
console.log(invoiceSafe ? 'INVOICE DOUBLE-CLICK SAFE: one document, one number, no burned numbers, no errors' : '*** INVOICE DOUBLE-CLICK UNSAFE ***');

console.log(`\n--- phase 3: ${C} SIMULTANEOUS 'issue receipt' requests for one payment`);
const pay = await (await fetch(`${URL}/functions/v1/billing`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'record_payment', clientId: ORG4_CLIENT, amount: 1, currency: 'USD', paidAt: new Date().toISOString().slice(0, 10), method: 'bank_transfer', purpose: 'payment', apply: [] }) })).json();
const abR = await abandonedCount('receipt');
const rb = await Promise.all(Array.from({ length: C }, async () => { const t = Date.now(); const r = await fetch(`${URL}/functions/v1/billing`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'issue_receipt', paymentId: pay.paymentId }) }); return { status: r.status, ms: Date.now() - t, j: await r.json().catch(() => ({})) }; }));
rb.forEach((r, i) => console.log(`req ${i}: ${r.status} ${r.ms}ms ${JSON.stringify({ number: r.j.receiptNumber, alreadyIssued: r.j.alreadyIssued, error: r.j.error })}`));
const recs = await rest(`billing_receipts?payment_id=eq.${pay.paymentId}&select=receipt_number,voided_at`);
const abR2 = await abandonedCount('receipt');
console.log(`receipts in the database for the payment=${recs.length} ${JSON.stringify(recs.map(x => x.receipt_number))} | newly abandoned receipt numbers=${abR2 - abR} | non-200=${rb.filter(r => r.status !== 200).length}`);
const receiptSafe = recs.length === 1 && abR2 === abR && rb.every(r => r.status === 200);
console.log(receiptSafe ? 'RECEIPT DOUBLE-CLICK SAFE' : '*** RECEIPT DOUBLE-CLICK UNSAFE ***');
const claims = await (await fetch(`${URL}/rest/v1/billing_issue_claims?select=claim_key`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } })).json();
console.log(`in-flight claims left behind (must be 0 or an error object for a non-staff-readable table)=${Array.isArray(claims) ? claims.length : 'not readable by staff (service-role only)'}`);
process.exit(invoiceSafe && receiptSafe ? 0 : 3);

import { test, expect, Page } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';

// PROMPT 43 Stage 4 - the invoice-download path as a HOSTILE caller, through the real API with real synthetic sessions:
//   * the client that OWNS a file can sign it (control - proves the answers below are not just a broken request);
//   * a DIFFERENT client cannot, by file id;
//   * a REVOKED client cannot sign even their own file (their access was withdrawn);
//   * an anonymous caller cannot.
// Found while building Stage 4: the billing Edge Function read memberships WITHOUT filtering revoked_at, and matched a
// client by clients.user_id alone, so a revoked client kept download access to their own documents.
// Fixture: an invoice issued to 'ZZ Provisioning Target' (the synthetic client whose account journey 2 leaves REVOKED).
test.setTimeout(180000);

const SUPABASE_REF = 'xrotvpuainpfdulhfhtt';
const FN = `https://${SUPABASE_REF}.supabase.co/functions/v1/billing`;

async function tokenFor(page: Page, email: string, password: string, apikey: string): Promise<string> {
  const r = await page.request.post(`https://${SUPABASE_REF}.supabase.co/auth/v1/token?grant_type=password`, { headers: { apikey, 'Content-Type': 'application/json' }, data: { email, password } });
  expect(r.ok(), `sign-in for ${email}`).toBeTruthy();
  return (await r.json()).access_token as string;
}
const sign = (page: Page, token: string | null, apikey: string, fileId: string) =>
  page.request.post(FN, { headers: { apikey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, data: { mode: 'file_url', fileId } });

test('a client can sign their own invoice file; another client, a revoked client and an anonymous caller cannot', async ({ page, browser }) => {
  // ---- staff issue an invoice to the revoked client and we capture its file id from the View click
  await signInAsStaff(page);
  const apikeyPromise = new Promise<string>(resolve => page.on('request', r => { const k = r.headers()['apikey']; if (k && r.url().includes('/rest/v1/')) resolve(k); }));
  await page.getByRole('button', { name: /clients/i }).click();
  await page.getByText('ZZ Provisioning Target').first().click();
  await page.getByRole('button', { name: 'Full relationship' }).click();
  await expect(page.getByText('Access revoked')).toBeVisible({ timeout: 15000 }); // precondition: this client's account is revoked
  const apikey = await apikeyPromise;

  const section = page.getByTestId('rel-billing').or(page.locator('text=Documents').first().locator('xpath=ancestor::div[3]'));
  void section;
  await page.getByRole('button', { name: 'New invoice' }).first().click();
  const editor = page.locator('.fixed.inset-0.bg-black\\/40');
  await expect(editor).toBeVisible({ timeout: 10000 });
  await editor.getByPlaceholder(/Description \(e\.g\./).fill('2022 Toyota Camry (hostile-download fixture)');
  await editor.getByRole('button', { name: /Add line/ }).click().catch(() => {});
  const i = (await editor.locator('tbody tr').count()) - 1;
  await editor.getByTestId(`line-desc-${i}`).fill('Hostile-download fixture line');
  await editor.getByTestId(`line-rate-${i}`).fill('10');
  await editor.getByTestId(`line-basis-${i}`).fill('Journey 16 fixture');
  await editor.getByTestId('invoice-scope').fill('Journey 16 hostile-download fixture.');
  await expect(editor.getByTestId('editor-issue-btn')).toBeEnabled({ timeout: 15000 });
  await editor.getByTestId('editor-issue-btn').click();
  const number = (await page.getByTestId('confirm-issue-number').textContent())!.trim();
  await page.getByTestId('confirm-issue-btn').click();
  await expect(editor).not.toBeVisible({ timeout: 60000 });

  const row = page.getByTestId('doc-row').filter({ hasText: number });
  await expect(row).toBeVisible({ timeout: 15000 });
  const bodyPromise = new Promise<string>(resolve => page.on('request', r => { if (r.url().endsWith('/functions/v1/billing') && (r.postData() ?? '').includes('file_url')) resolve(r.postData()!); }));
  await row.getByTestId('doc-view').click();
  const fileId = JSON.parse(await bodyPromise).fileId as string;
  expect(fileId).toMatch(/^[0-9a-f-]{36}$/);

  // ---- the hostile callers (real sessions, real API)
  const revokedToken = await tokenFor(page, process.env.E2E_UNPROVISIONED_EMAIL!, process.env.E2E_UNPROVISIONED_PASSWORD!, apikey);
  const clientAToken = await tokenFor(page, process.env.E2E_CLIENT_A_EMAIL!, process.env.E2E_CLIENT_A_PASSWORD!, apikey);

  const asRevoked = await sign(page, revokedToken, apikey, fileId);
  expect(asRevoked.status(), `a REVOKED client must not sign their own file (got ${asRevoked.status()})`).toBe(404);
  const asOther = await sign(page, clientAToken, apikey, fileId);
  expect(asOther.status(), 'client A must not sign another client\'s file').toBe(404);
  const asAnon = await sign(page, null, apikey, fileId);
  expect([401, 403]).toContain(asAnon.status());
  expect((await asRevoked.text()) + (await asOther.text())).not.toContain('signedUrl'); // no URL leaked in any refusal
  expect(await asOther.text()).toBe(await asRevoked.text()); // same answer for "not yours" and "revoked" and (below) "missing"
  const missing = await sign(page, clientAToken, apikey, '00000000-0000-4000-8000-000000000000');
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toBe(await asOther.text()); // never reveals whether a file exists

  // ---- the OTHER routes to the same bytes: the storage path itself, a signed-URL request for it, and the document id
  const staffToken = await tokenFor(page, process.env.E2E_STAFF_EMAIL!, process.env.E2E_STAFF_PASSWORD!, apikey);
  const rest = (token: string, q: string) => page.request.get(`https://${SUPABASE_REF}.supabase.co/rest/v1/${q}`, { headers: { apikey, Authorization: `Bearer ${token}` } });
  const fileRow = (await (await rest(staffToken, `billing_files?id=eq.${fileId}&select=storage_path`)).json())[0];
  expect(fileRow?.storage_path, 'staff can read the storage path (so the hostile attempts below are on a real object)').toBeTruthy();
  const docRow = (await (await rest(staffToken, `billing_documents?file_id=eq.${fileId}&select=id`)).json())[0];
  const storage = `https://${SUPABASE_REF}.supabase.co/storage/v1`;
  for (const [who, token] of [['client A (another client)', clientAToken], ['the revoked client', revokedToken], ['anonymous', null]] as const) {
    const h = { apikey, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const direct = await page.request.get(`${storage}/object/authenticated/won-vehicle-documents/${fileRow.storage_path}`, { headers: h });
    expect(direct.status(), `${who}: direct storage read of the object must not succeed (got ${direct.status()})`).not.toBe(200);
    const signedReq = await page.request.post(`${storage}/object/sign/won-vehicle-documents/${fileRow.storage_path}`, { headers: { ...h, 'Content-Type': 'application/json' }, data: { expiresIn: 300 } });
    expect(signedReq.status(), `${who}: asking storage to SIGN the object must not succeed (got ${signedReq.status()})`).not.toBe(200);
  }
  // by DOCUMENT id: the file_url endpoint takes file ids only (a document id is not one), and the document row itself is invisible to another client
  const byDocId = await sign(page, clientAToken, apikey, docRow.id);
  expect(byDocId.status()).toBe(404);
  expect(await (await rest(clientAToken, `billing_documents?id=eq.${docRow.id}&select=id`)).json()).toEqual([]);
  expect(await (await rest(clientAToken, `billing_files?id=eq.${fileId}&select=id`)).json()).toEqual([]);

  // control: client A CAN sign their own file, so the refusals above are not a broken request
  const own = await page.request.post(FN, { headers: { apikey, Authorization: `Bearer ${clientAToken}`, 'Content-Type': 'application/json' }, data: { mode: 'file_url', fileId: await ownFileId(browser, apikey) } });
  expect(own.status()).toBe(200);
  expect((await own.json()).url).toMatch(/^https:\/\/.+\/storage\/v1\/object\/sign\//);
});

// client A's own invoice file id, read the way the app does (their own session, their own receipt list -> any own file)
async function ownFileId(browser: any, apikey: string): Promise<string> {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  const t = await tokenFor(p, process.env.E2E_CLIENT_A_EMAIL!, process.env.E2E_CLIENT_A_PASSWORD!, apikey);
  const r = await p.request.get(`https://${SUPABASE_REF}.supabase.co/rest/v1/billing_documents?select=file_id&file_id=not.is.null&limit=1`, { headers: { apikey, Authorization: `Bearer ${t}` } });
  const id = (await r.json())[0].file_id as string;
  await ctx.close();
  return id;
}

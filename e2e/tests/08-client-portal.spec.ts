import { test, expect, Page } from '@playwright/test';
import { signInAsStaff, signInAsClientA, signInAsClientB } from '../helpers/auth';
import { openClientRelationship } from '../helpers/nav';
import { retainerHits } from '../helpers/vocab';

// PROMPT 42 Stage 3, journey 8 - the client portal, as a real client in a real browser:
//   * client A sees only client A's vehicles and documents;
//   * a RETAIL invoice shows the client ONE all-inclusive line - never the cost lines behind it;
//   * client A cannot open client B's... (any other client's) vehicle by its URL, nor read it through the API
//     with A's own session - and the same the other way round;
//   * no staff-only affordance and no "Retainer" anywhere in the portal.
// Ids are org-4 fixtures: 093/a5 belong to client A (033); 092 belongs to a different client (032).

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);

const A_VEHICLE_IDS = ['d0000000-0000-4000-8000-000000000093', 'd0000000-0000-4000-8000-0000000000a5'];
const OTHER_CLIENTS_VEHICLE_ID = 'd0000000-0000-4000-8000-000000000092';
const OTHER_CLIENT_ID = 'd0000000-0000-4000-8000-000000000032';
const VISIBLE = 'ZZ all-inclusive price';
const HIDDEN = 'ZZ hidden cost - auction';

let fixtureExists = false;

const expandAllInvoices = async (page: Page) => {
  const cards = page.getByTestId('portal-invoice');
  await expect(cards.first()).toBeVisible({ timeout: 15000 });
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    await cards.nth(i).getByRole('button').first().click();
    await expect(cards.nth(i).getByText(/Balance outstanding|voided/).or(cards.nth(i).getByTestId('portal-invoice-line').first()).first()).toBeVisible({ timeout: 10000 });
  }
};

test('8.0 does the retail fixture already exist? (as client A)', async ({ page }) => {
  await signInAsClientA(page);
  await expandAllInvoices(page);
  fixtureExists = (await page.getByText(VISIBLE).count()) > 0;
});

test('8.1 staff issue a retail invoice: one visible all-inclusive line, one hidden cost line (only if missing)', async ({ page }) => {
  test.skip(fixtureExists, 'retail fixture already issued on a previous run');
  await signInAsStaff(page);
  await openClientRelationship(page);
  await page.getByTestId('rel-won-vehicles').locator('text=Toyota').first().click();
  const billing = page.getByTestId('section-billing');
  await billing.getByRole('button', { name: 'New invoice' }).click();
  const editor = page.locator('.fixed.inset-0.bg-black\\/40');
  await expect(editor).toBeVisible({ timeout: 10000 });
  await editor.getByRole('button', { name: 'Retail sale' }).click();

  const addManualLine = async (desc: string, rate: string) => {
    await editor.getByRole('button', { name: /Add line/ }).click();
    const i = (await editor.locator('tbody tr').count()) - 1;
    await editor.getByTestId(`line-desc-${i}`).fill(desc);
    await editor.getByTestId(`line-rate-${i}`).fill(rate);
    await editor.getByTestId(`line-basis-${i}`).fill('Journey 8 retail fixture');
    return i;
  };
  // the editor starts with one empty line; use it for the all-inclusive price, then add the cost line behind it
  const first = (await editor.locator('tbody tr').count()) - 1;
  await editor.getByTestId(`line-desc-${first}`).fill(VISIBLE);
  await editor.getByTestId(`line-rate-${first}`).fill('9000');
  await editor.getByTestId(`line-basis-${first}`).fill('Journey 8 retail fixture');
  const hidden = await addManualLine(HIDDEN, '6000');
  await editor.getByTestId(`line-visible-${hidden}`).uncheck();

  await editor.getByTestId('invoice-scope').fill('Journey 8 retail fixture - all-inclusive price.');
  const issueBtn = editor.getByTestId('editor-issue-btn');
  await expect(issueBtn).toBeEnabled({ timeout: 15000 });
  await issueBtn.click();
  await expect(page.getByTestId('confirm-issue-number')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('confirm-issue-btn').click();
  await expect(editor).not.toBeVisible({ timeout: 60000 });
});

test('8.2 client A: only A\'s data, retail shows one all-inclusive line, nothing staff-only, no "Retainer"', async ({ page }) => {
  await signInAsClientA(page);
  await expect(page.getByText('ZZ Synthetic Client C').first()).toBeVisible({ timeout: 15000 });

  // only this client's vehicles (two), never the other client's
  await expect(page.getByTestId('portal-vehicle')).toHaveCount(2, { timeout: 15000 });
  await expandAllInvoices(page);
  const body = (await page.locator('body').innerText());
  expect(body).not.toMatch(/Danmusa|Mohammed/);

  // the retail invoice: exactly ONE client-visible line, the all-inclusive price - and the cost line never appears
  const retail = page.getByTestId('portal-invoice').filter({ hasText: VISIBLE }).first();
  await expect(retail).toBeVisible();
  await expect(retail.getByTestId('portal-invoice-line')).toHaveCount(1);
  expect(body).not.toContain(HIDDEN);
  expect(body).not.toContain('6,000.00'); // nor the hidden figure
  expect(await page.content()).not.toContain(HIDDEN); // nor anywhere in the DOM, visible or not

  // no staff-only affordance leaks into the portal
  for (const staffOnly of ['Record payment', 'Raise a credit note', 'New invoice', 'New deposit request', 'Computed', 'Void']) {
    expect(body, `portal must not show "${staffOnly}"`).not.toContain(staffOnly);
  }

  // vocabulary: a deposit request is called that to the client, and "Retainer" is nowhere
  await expect(page.getByTestId('portal-invoice').filter({ hasText: 'Deposit request' }).first()).toBeVisible();
  // (user-authored line descriptions and scope statements are data - see helpers/vocab.ts; RET-0001's own line
  // text predates the rename and an issued document cannot be edited)
  expect(await retainerHits(page, '[data-testid="portal-invoice-line"], [data-testid="portal-invoice-scope"]')).toEqual([]);
});

// The anon API key is public (it ships in the app bundle); read it off the app's own first REST request.
async function captureApiKey(page: Page): Promise<string> {
  const keyPromise = new Promise<string>(resolve => {
    page.on('request', r => { const k = r.headers()['apikey']; if (k && r.url().includes('/rest/v1/')) resolve(k); });
  });
  await page.reload();
  return keyPromise;
}

// Reads rows with the signed-in user's OWN session (taken from the app's own storage), exactly as the app does.
async function ownRestRead(page: Page, apikey: string, pathAndQuery: string): Promise<{ status: number; rows: unknown[] }> {
  return page.evaluate(async ({ pathAndQuery, apikey }) => {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))!;
    const ref = key.slice(3, -'-auth-token'.length);
    const token = JSON.parse(localStorage.getItem(key)!).access_token;
    const res = await fetch(`https://${ref}.supabase.co/rest/v1/${pathAndQuery}`, { headers: { apikey, Authorization: `Bearer ${token}` } });
    const rows = await res.json();
    return { status: res.status, rows: Array.isArray(rows) ? rows : [rows] };
  }, { pathAndQuery, apikey });
}

test('8.3 client A cannot open another client\'s vehicle - by URL, or through the API with A\'s own session', async ({ page }) => {
  await signInAsClientA(page);
  await expect(page.getByTestId('portal-vehicle').first()).toBeVisible({ timeout: 15000 });

  const apikey = await captureApiKey(page);
  await page.goto(`/vehicle/${OTHER_CLIENTS_VEHICLE_ID}`);
  // since Prompt 43 Stage 4 a foreign vehicle address shows an explicit 'not available' page (journey 17 C covers its wording)
  await expect(page.getByTestId('portal-not-available')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('won-vehicle-page')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/Danmusa|Mohammed/);

  // the API with A's own token: the other client's vehicle, documents and record are all invisible...
  expect((await ownRestRead(page, apikey, `won_vehicles?id=eq.${OTHER_CLIENTS_VEHICLE_ID}&select=id`)).rows).toEqual([]);
  expect((await ownRestRead(page, apikey, `billing_documents?client_id=eq.${OTHER_CLIENT_ID}&select=id`)).rows).toEqual([]);
  expect((await ownRestRead(page, apikey, `clients?id=eq.${OTHER_CLIENT_ID}&select=id`)).rows).toEqual([]);
  // ...while A's own are readable (so an empty answer above is not a broken request)
  expect((await ownRestRead(page, apikey, `won_vehicles?id=in.(${A_VEHICLE_IDS.join(',')})&select=id`)).rows).toHaveLength(2);
});

test('8.4 and the other way round: client B cannot open client A\'s vehicle', async ({ page }) => {
  await signInAsClientB(page);
  await expect(page.getByText(/Abdulrazaq|Your account/i).first()).toBeVisible({ timeout: 15000 });
  const apikey = await captureApiKey(page);
  await page.goto(`/vehicle/${A_VEHICLE_IDS[0]}`);
  await expect(page.getByTestId('won-vehicle-page')).toHaveCount(0);
  expect((await ownRestRead(page, apikey, `won_vehicles?id=in.(${A_VEHICLE_IDS.join(',')})&select=id`)).rows).toEqual([]);
  expect((await ownRestRead(page, apikey, `my_client_record?select=id`)).rows).toHaveLength(1); // B's own record: control
});

test('8.5 the client sees the SAME balance staff see: a fully paid invoice and a paid deposit request owe nothing', async ({ page }) => {
  // INV-0064 (paid in full in two payments) and RET-0001 (a $500 deposit received) are permanent org-4 fixtures.
  // Found by the Stage 4 usability verifier: the portal showed "Balance outstanding $37.34" / "$500.00" for both,
  // because the balance view read billing_applications under the client's own RLS and silently counted zero payments.
  await signInAsClientA(page);
  for (const [num, owed] of [['INV-0064', '$0.00'], ['RET-0001', '$0.00']] as const) {
    const card = page.getByTestId('portal-invoice').filter({ hasText: num }).first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.getByRole('button').first().click();
    await expect(card.getByText('Balance outstanding')).toBeVisible({ timeout: 10000 });
    await expect(card).toContainText(`Balance outstanding${owed}`.replace('Balance outstanding', 'Balance outstanding'));
    expect((await card.innerText()).replace(/\s+/g, '')).toContain(`Balanceoutstanding${owed}`);
  }
});

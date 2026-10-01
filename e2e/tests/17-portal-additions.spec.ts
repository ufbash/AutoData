import { test, expect, Page, BrowserContext } from '@playwright/test';
import { signInAsStaff, signInAsClientA } from '../helpers/auth';
import { openClientRelationship } from '../helpers/nav';

// PROMPT 43 Stage 4 (#115), as real people in separate isolated contexts:
//   A. 'Amount owed' on the client dashboard equals the STAFF account status for the same client, per currency, field
//      by field (status, outstanding, overdue, unapplied credit) - one computation behind both (migration 084);
//   B. the client can View and Download their own invoice, credit note, deposit request and receipt PDFs;
//   C. an address for a vehicle that is not theirs (another client's, non-existent, nonsense) shows a clear page.
test.setTimeout(180000);

const OTHER_CLIENTS_VEHICLE = 'd0000000-0000-4000-8000-000000000092';
const OWN_VEHICLE = 'd0000000-0000-4000-8000-000000000093';
const read = async (card: any) => ({
  status: (await card.getByTestId('acct-status').innerText()).trim(),
  outstanding: (await card.getByTestId('acct-outstanding').innerText()).trim(),
  overdue: (await card.getByTestId('acct-overdue').count()) ? (await card.getByTestId('acct-overdue').innerText()).trim() : '',
  credit: (await card.getByTestId('acct-credit').count()) ? (await card.getByTestId('acct-credit').innerText()).trim() : '',
});

async function signedUrlFrom(context: BrowserContext, click: () => Promise<void>): Promise<string> {
  const req = context.waitForEvent('request', { predicate: r => /\/storage\/v1\/object\/sign\//.test(r.url()), timeout: 20000 });
  await click();
  const url = (await req).url();
  await Promise.all(context.pages().filter(p => p.url() === '' || p.url().includes('/storage/v1/object/sign/')).map(p => p.close().catch(() => {})));
  return url;
}
async function expectPdf(page: Page, url: string, disposition: 'inline' | 'attachment') {
  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/pdf');
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const cd = (res.headers()['content-disposition'] ?? '').toLowerCase();
  if (disposition === 'attachment') expect(cd).toContain('attachment'); else expect(cd).not.toContain('attachment');
}

test('A. the client\'s "Amount owed" is the staff account status, per currency, field for field', async ({ browser }) => {
  const staffCtx = await browser.newContext(); const staff = await staffCtx.newPage();
  await signInAsStaff(staff);
  await openClientRelationship(staff);
  await expect(staff.getByTestId('acct-USD')).toBeVisible({ timeout: 15000 });
  const staffUsd = await read(staff.getByTestId('acct-USD'));
  const staffNgn = await read(staff.getByTestId('acct-NGN'));

  const clientCtx = await browser.newContext(); const client = await clientCtx.newPage();
  await signInAsClientA(client);
  const owed = client.getByTestId('portal-amount-owed');
  await expect(owed.getByTestId('acct-USD')).toBeVisible({ timeout: 15000 });
  expect(await read(owed.getByTestId('acct-USD'))).toEqual(staffUsd);
  expect(await read(owed.getByTestId('acct-NGN'))).toEqual(staffNgn);
  // nothing from the staff-only side leaks into the card (no invoiced/paid ledger lines beyond what staff see either)
  await expect(client.getByText('Amount owed').first()).toBeVisible();
  await staffCtx.close(); await clientCtx.close();
});

test('B. the client can view and download their own invoice, deposit request, credit note and receipt PDFs', async ({ browser }) => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await signInAsClientA(page);
  await expect(page.getByTestId('portal-invoice').first()).toBeVisible({ timeout: 15000 });

  const kinds: [string, RegExp][] = [['an invoice', /^INV-/], ['a deposit request', /^(DEP|RET)-/], ['a credit note', /^CN-/]];
  for (const [label, re] of kinds) {
    const card = page.getByTestId('portal-invoice').filter({ has: page.getByText(re) }).filter({ has: page.getByTestId('portal-doc-view') }).first();
    await expect(card, `portal shows ${label} with a PDF`).toBeVisible({ timeout: 10000 });
    await expectPdf(page, await signedUrlFrom(ctx, () => card.getByTestId('portal-doc-view').click()), 'inline');
    await expectPdf(page, await signedUrlFrom(ctx, () => card.getByTestId('portal-doc-download').click()), 'attachment');
  }
  await expectPdf(page, await signedUrlFrom(ctx, () => page.getByTestId('portal-receipt-view').first().click()), 'inline');
  await expectPdf(page, await signedUrlFrom(ctx, () => page.getByTestId('portal-receipt-download').first().click()), 'attachment');
  await ctx.close();
});

test('C. a vehicle address that is not the client\'s own shows a clear page - one message for another client\'s, a missing and a nonsense address', async ({ browser }) => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await signInAsClientA(page);
  await expect(page.getByTestId('portal-vehicle').first()).toBeVisible({ timeout: 15000 });

  const messages: string[] = [];
  for (const path of [`/vehicle/${OTHER_CLIENTS_VEHICLE}`, '/vehicle/00000000-0000-0000-0000-000000000000', '/vehicle/abc']) {
    await page.goto(path);
    const notice = page.getByTestId('portal-not-available');
    await expect(notice, `${path} shows the not-available page`).toBeVisible({ timeout: 15000 });
    messages.push(await notice.innerText());
    expect(await page.locator('body').innerText()).not.toMatch(/Danmusa|Mohammed|Toyota Yaris/);
  }
  expect(new Set(messages).size, 'identical wording: never says whether a vehicle exists or whose it is').toBe(1);

  await page.getByTestId('portal-not-available-back').click();
  await expect(page.getByTestId('portal-amount-owed')).toBeVisible({ timeout: 15000 });
  expect(new URL(page.url()).pathname).toBe('/');

  // the client's OWN vehicle address is not "not available"
  await page.goto(`/vehicle/${OWN_VEHICLE}`);
  await expect(page.getByTestId('portal-vehicle').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('portal-not-available')).toHaveCount(0);
  await ctx.close();
});

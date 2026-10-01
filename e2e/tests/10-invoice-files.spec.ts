import { test, expect, Page, BrowserContext } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';
import { openClientRelationship } from '../helpers/nav';

// PROMPT 42 Stage 3, journey 10 - the View and Download buttons on an issued invoice and on a receipt (debt #87).
// A click opens a new tab on a signed storage URL; the test captures that URL and requests it with Playwright's
// own HTTP client to prove what the browser would receive: a real PDF, served INLINE for View and as an
// ATTACHMENT for Download.

test.setTimeout(120000);

// A View tab navigates to the signed URL; a Download tab becomes a file download and keeps an empty URL - so the
// URL is taken from the browser's own request to the storage signing path, which both produce.
async function clickAndCaptureUrl(context: BrowserContext, click: () => Promise<void>): Promise<string> {
  const reqPromise = context.waitForEvent('request', { predicate: r => /\/storage\/v1\/object\/sign\//.test(r.url()), timeout: 15000 });
  await click();
  const url = (await reqPromise).url();
  await Promise.all(context.pages().filter(p => p.url() === '' || p.url().includes('/storage/v1/object/sign/')).map(p => p.close().catch(() => {})));
  return url;
}

async function expectPdf(page: Page, url: string, disposition: 'inline' | 'attachment') {
  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/pdf');
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const cd = res.headers()['content-disposition'] ?? '';
  if (disposition === 'attachment') expect(cd.toLowerCase()).toContain('attachment');
  else expect(cd.toLowerCase()).not.toContain('attachment');
}

test('an issued invoice and a receipt each have View (inline PDF) and Download (attachment PDF)', async ({ page, context }) => {
  await signInAsStaff(page);
  await openClientRelationship(page);
  await page.getByTestId('rel-won-vehicles').locator('text=Toyota').first().click();
  const billing = page.getByTestId('section-billing');
  await expect(billing.getByTestId('doc-row').first()).toBeVisible({ timeout: 15000 });

  // an issued invoice that has its PDF
  const row = billing.getByTestId('doc-row').filter({ has: page.getByTestId('doc-view') }).filter({ hasNotText: 'voided' }).first();
  await expect(row).toBeVisible();
  const viewUrl = await clickAndCaptureUrl(context, () => row.getByTestId('doc-view').click());
  await expectPdf(page, viewUrl, 'inline');
  const dlUrl = await clickAndCaptureUrl(context, () => row.getByTestId('doc-download').click());
  await expectPdf(page, dlUrl, 'attachment');

  // a receipt
  const receipt = billing.getByTestId('receipt-view').first();
  await expect(receipt).toBeVisible();
  const rView = await clickAndCaptureUrl(context, () => billing.getByTestId('receipt-view').first().click());
  await expectPdf(page, rView, 'inline');
  const rDl = await clickAndCaptureUrl(context, () => billing.getByTestId('receipt-download').first().click());
  await expectPdf(page, rDl, 'attachment');

  // and the buttons sit on the invoice row itself, not hidden behind another click (the debt-#87 complaint)
  await expect(row.getByTestId('doc-view')).toBeVisible();
  await expect(row.getByTestId('doc-download')).toBeVisible();
});

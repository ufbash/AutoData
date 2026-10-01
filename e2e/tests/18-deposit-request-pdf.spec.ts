import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { signInAsStaff } from '../helpers/auth';
import { openClientRelationship } from '../helpers/nav';

// PROMPT 43 Stage 6 (usability verifier): the deposit-request PDF was still titled "RETAINER INVOICE" after the app, the
// dashboard and the number prefix said "Deposit request". Issues ONE deposit request in org 4 (consumes a DEP- number
// there - synthetic), opens its PDF through the signed link, reads the text and checks the title and the number prefix.
test.setTimeout(150000);

test('a deposit request is called a deposit request on its own PDF, numbered DEP-', async ({ page }) => {
  await signInAsStaff(page);
  await openClientRelationship(page);
  await page.getByTestId('rel-won-vehicles').locator('text=Toyota').first().click();
  const billing = page.getByTestId('section-billing');
  await expect(billing.getByRole('button', { name: 'New deposit request' })).toBeVisible({ timeout: 15000 });
  await billing.getByRole('button', { name: 'New deposit request' }).click();
  const editor = page.locator('.fixed.inset-0.bg-black\\/40');
  await expect(editor).toBeVisible({ timeout: 10000 });
  const i = (await editor.locator('tbody tr').count()) - 1;
  await editor.getByTestId(`line-desc-${i}`).fill('Deposit (journey 18)');
  await editor.getByTestId(`line-rate-${i}`).fill('50');
  await editor.getByTestId(`line-basis-${i}`).fill('Journey 18 PDF title check');
  await expect(editor.getByTestId('editor-issue-btn')).toBeEnabled({ timeout: 15000 });
  await editor.getByTestId('editor-issue-btn').click();
  const number = (await page.getByTestId('confirm-issue-number').textContent())!.trim();
  expect(number).toMatch(/^DEP-\d{4}$/);
  await page.getByTestId('confirm-issue-btn').click();
  await expect(editor).not.toBeVisible({ timeout: 60000 });

  // the new document is on THIS vehicle's list only if it is vehicle-linked; a client-level deposit request is read
  // through the client's Billing list on the relationship page instead
  const url = await (async () => {
    const reqPromise = page.context().waitForEvent('request', { predicate: r => /\/storage\/v1\/object\/sign\//.test(r.url()), timeout: 30000 });
    const row = page.getByTestId('doc-row').filter({ hasText: number });
    if (!(await row.count())) { await page.getByTestId('won-vehicle-back').click(); }
    await page.getByTestId('doc-row').filter({ hasText: number }).first().getByTestId('doc-view').click();
    return (await reqPromise).url();
  })();
  const pdf = await page.request.get(url);
  expect(pdf.status()).toBe(200);
  const text = execFileSync('pdftotext', ['-', '-'], { input: Buffer.from(await pdf.body()), encoding: 'utf8' });
  expect(text).toContain('DEPOSIT REQUEST');
  expect(text).not.toMatch(/RETAINER INVOICE/i);
  expect(text).toContain(number);
});

import { test, expect, Page } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';

// PROMPT 42 Stage 3, journey 5 - record a payment FROM the invoice: partial -> remainder -> settled, each issuing
// a receipt in the same step. Issues its own small invoice (service-fee line) on the Corolla fixture (org 4), so it
// does not depend on any prior state; it never touches the real org.

const COROLLA_VEHICLE_ID = 'd0000000-0000-4000-8000-0000000000a5';
const parse = (t: string) => Number(t.replace(/[^0-9.\-]/g, ''));

async function issueServiceFeeInvoice(page: Page): Promise<string> {
  const billing = page.getByTestId('section-billing');
  await billing.getByRole('button', { name: 'New invoice' }).click();
  const editor = page.locator('.fixed.inset-0.bg-black\\/40');
  await expect(editor).toBeVisible({ timeout: 10000 });
  await editor.getByRole('button', { name: /Import duty.*actual/ }).click();
  await expect(editor.locator('tbody tr')).toHaveCount(1);
  await editor.getByTestId('invoice-scope').fill('Journey 5 verification invoice - service fee.');
  const issueBtn = editor.getByTestId('editor-issue-btn');
  await expect(issueBtn).toBeEnabled({ timeout: 15000 });
  await issueBtn.click();
  const number = (await page.getByTestId('confirm-issue-number').textContent())!.trim();
  await page.getByTestId('confirm-issue-btn').click();
  await expect(editor).not.toBeVisible({ timeout: 60000 });
  return number;
}

test('record payment from the invoice: partial, then remainder, settles it, a receipt each time', async ({ page }) => {
  await signInAsStaff(page);
  await page.goto(`/vehicle/${COROLLA_VEHICLE_ID}`);
  await expect(page.getByTestId('won-vehicle-page')).toBeVisible({ timeout: 10000 });
  const billing = page.getByTestId('section-billing');

  const number = await issueServiceFeeInvoice(page);
  const row = billing.getByTestId('doc-row').filter({ hasText: number });
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole('button').first().click();

  const outstanding = row.getByTestId('doc-outstanding');
  await expect(outstanding).toBeVisible({ timeout: 10000 });
  const total = parse((await outstanding.textContent())!);
  expect(total).toBeGreaterThan(100);

  const receiptsBefore = await billing.getByTestId('receipt-number').count();

  // partial payment of $100
  await row.getByTestId('record-payment-open').click();
  await row.getByTestId('record-payment-amount').fill('100');
  await row.getByTestId('record-payment-submit').click();
  await expect(outstanding).toHaveText(new RegExp(`\\$${(total - 100).toLocaleString('en-US', { minimumFractionDigits: 2 }).replace('.', '\\.')}`), { timeout: 15000 });
  await expect(billing.getByTestId('receipt-number')).toHaveCount(receiptsBefore + 1, { timeout: 10000 });
  // still open for more payment
  await expect(row.getByTestId('record-payment-open')).toBeVisible();

  // remainder (the form pre-fills the outstanding amount)
  await row.getByTestId('record-payment-open').click();
  await expect(row.getByTestId('record-payment-amount')).toHaveValue(String(total - 100));
  await row.getByTestId('record-payment-submit').click();
  await expect(outstanding).toHaveText('$0.00', { timeout: 15000 });
  await expect(billing.getByTestId('receipt-number')).toHaveCount(receiptsBefore + 2, { timeout: 10000 });
  // settled: nothing left to record
  await expect(row.getByTestId('record-payment-open')).toHaveCount(0);
});

test('voiding a receipted, applied payment walks the whole chain (receipt, application, payment) and the balance goes back up', async ({ page }) => {
  // Found by the Stage 4 usability verifier: Void on a payment that had a receipt did nothing visible (the 400 was
  // swallowed), receipts and applications had no Void control, so the payment was stuck for good.
  await signInAsStaff(page);
  await page.goto(`/vehicle/${COROLLA_VEHICLE_ID}`);
  await expect(page.getByTestId('won-vehicle-page')).toBeVisible({ timeout: 10000 });
  const billing = page.getByTestId('section-billing');
  const number = await issueServiceFeeInvoice(page);
  const row = billing.getByTestId('doc-row').filter({ hasText: number });
  await row.getByRole('button').first().click();
  const outstanding = row.getByTestId('doc-outstanding');
  await expect(outstanding).toBeVisible({ timeout: 10000 });
  const total = parse((await outstanding.textContent())!);

  // a UNIQUE amount, so the payment row can only be this test's own (earlier runs leave $450.00 rows behind)
  await row.getByTestId('record-payment-open').click();
  await row.getByTestId('record-payment-amount').fill('77.77');
  await row.getByTestId('record-payment-submit').click();
  await expect(outstanding).toHaveText(`$${(total - 77.77).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, { timeout: 15000 });

  const live = billing.getByTestId('payment-row').filter({ hasText: '$77.77' }).filter({ hasNotText: '(voided)' }).first();
  await expect(live).toBeVisible();
  let promptText = '';
  page.once('dialog', d => { promptText = d.message(); void d.accept('journey 5 reset'); });
  await live.getByTestId('payment-void').click();
  // the dialog says what else it will void, before it does it
  await expect.poll(() => promptText, { timeout: 10000 }).toMatch(/also voids its receipt \(REC-\d+\) and its application to an invoice/);
  // ...and the balance goes back up on the SAME open row, with no reload
  await expect(outstanding).toHaveText(`$${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, { timeout: 20000 });
  await expect(billing.getByTestId('payment-row').filter({ hasText: '$77.77' }).filter({ hasText: '(voided)' }).first()).toBeVisible();

  // reset: the invoice is unpaid again, so it can be voided
  await row.getByTestId('void-open').click();
  await row.getByTestId('void-reason').fill('journey 5 reset');
  await row.getByTestId('void-confirm').click();
  await expect(row).toContainText('voided', { timeout: 15000 });
});

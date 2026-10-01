import { test, expect, Page } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';
import { openClientRelationship } from '../helpers/nav';

// PROMPT 42 Stage 3, journey 6 - the account status on the client page, per currency: Overdue, Outstanding,
// Settled, In credit, and two currencies side by side. Every record the test creates is paid or voided by the
// test itself, so the fixture ends in a known state and the test can be re-run (Debt #101).

const COROLLA_VEHICLE_ID = 'd0000000-0000-4000-8000-0000000000a5';
const parse = (t: string) => Number(t.replace(/[^0-9.\-]/g, ''));

const editorOf = (page: Page) => page.locator('.fixed.inset-0.bg-black\\/40');

async function issueFromEditor(page: Page): Promise<string> {
  const editor = editorOf(page);
  await editor.getByTestId('invoice-scope').fill('Journey 6 verification invoice.');
  const issueBtn = editor.getByTestId('editor-issue-btn');
  await expect(issueBtn).toBeEnabled({ timeout: 15000 });
  await issueBtn.click();
  const number = (await page.getByTestId('confirm-issue-number').textContent())!.trim();
  await page.getByTestId('confirm-issue-btn').click();
  await expect(editor).not.toBeVisible({ timeout: 60000 }); // issue normally takes ~4s; one run saw >15s
  return number;
}

// Opened the way a user does it - from the client page - so Back returns to that page, where the status lives.
const gotoVehicle = async (page: Page) => {
  // already on the client page (after Back)? then just click through; otherwise navigate there first
  if (!(await page.getByTestId('rel-won-vehicles').isVisible())) await openClientRelationship(page);
  await page.getByTestId('rel-won-vehicles').locator('text=Toyota').first().click();
  await expect(page).toHaveURL(new RegExp(`/vehicle/${COROLLA_VEHICLE_ID}`));
  await expect(page.getByTestId('won-vehicle-page')).toBeVisible({ timeout: 10000 });
  return page.getByTestId('section-billing');
};

const statusCard = async (page: Page, currency: 'USD' | 'NGN') => {
  await page.getByTestId('won-vehicle-back').click();
  const card = page.getByTestId(`acct-${currency}`);
  await expect(card).toBeVisible({ timeout: 10000 });
  return card;
};

test.setTimeout(150000);

// Crash-recovery: a run that died part-way leaves an unpaid NGN invoice behind, which would hold the NGN position
// at Outstanding. Void any NGN invoice on this vehicle that still has a balance (staff-level action only).
async function voidLeftoverNgnInvoices(billing: ReturnType<Page['getByTestId']>) {
  await expect(billing.getByRole('button', { name: 'New invoice' })).toBeVisible({ timeout: 15000 }); // list loaded
  const rows = billing.getByTestId('doc-row').filter({ hasText: '₦' }).filter({ hasNotText: 'voided' });
  let i = 0;
  for (let guard = 0; guard < 30 && i < (await rows.count()); guard++) {
    const row = rows.nth(i);
    await row.getByRole('button').first().click();
    const out = row.getByTestId('doc-outstanding');
    await expect(out).toBeVisible({ timeout: 10000 });
    if (parse((await out.textContent())!) <= 0) { // fully paid - cannot be voided, leave it
      await row.getByRole('button').first().click(); i++; continue;
    }
    await row.getByTestId('void-open').click();
    await row.getByTestId('void-reason').fill('journey 6 leftover reset');
    await row.getByTestId('void-confirm').click();
    await expect(rows).toHaveCount((await rows.count()) - 1, { timeout: 15000 });
  }
}

test('overdue: a backdated unpaid invoice raises the USD overdue amount by its balance, voiding it takes it back', async ({ page }) => {
  await signInAsStaff(page);
  const billing = await gotoVehicle(page);
  // the overdue amount BEFORE (0 when the card shows none) - relative, so any leftover from a crashed run is harmless
  const overdueOf = async () => {
    const card = page.getByTestId('acct-USD');
    await expect(card).toBeVisible({ timeout: 10000 });
    const el = card.getByTestId('acct-overdue');
    return (await el.count()) ? parse((await el.textContent())!) : 0;
  };
  await page.getByTestId('won-vehicle-back').click();
  const before = await overdueOf();
  const b1 = await gotoVehicle(page);
  await b1.getByRole('button', { name: 'New invoice' }).click();
  const editor = editorOf(page);
  await editor.getByRole('button', { name: /Import duty.*actual/ }).click();
  // the database refuses a due date before the issue date, so an overdue invoice is a BACKDATED one
  await editor.getByTestId('invoice-due').fill('2026-01-01');
  await expect(editor.getByTestId('due-before-issue-warning')).toBeVisible();
  await expect(editor.getByTestId('editor-issue-btn')).toBeDisabled();
  await editor.getByTestId('invoice-issue-date').fill('2025-12-15');
  await expect(editor.getByTestId('due-before-issue-warning')).toHaveCount(0);
  const number = await issueFromEditor(page);

  // Back to the client page: the status must reflect the invoice just issued WITHOUT a reload
  await page.getByTestId('won-vehicle-back').click();
  const card = page.getByTestId('acct-USD');
  await expect(card.getByTestId('acct-status')).toHaveText('Overdue', { timeout: 10000 });
  await expect.poll(overdueOf, { timeout: 10000 }).toBe(before + 450);

  // reset: void the invoice (unpaid, so voidable) -> the overdue amount returns to where it was
  const b2 = await gotoVehicle(page);
  const row = b2.getByTestId('doc-row').filter({ hasText: number });
  await row.getByRole('button').first().click();
  await row.getByTestId('void-open').click();
  await row.getByTestId('void-reason').fill('journey 6 reset');
  await row.getByTestId('void-confirm').click();
  await expect(row).toContainText('voided', { timeout: 15000 });
  await page.getByTestId('won-vehicle-back').click();
  await expect.poll(overdueOf, { timeout: 10000 }).toBe(before);
});

test('two currencies side by side; NGN goes Outstanding -> Settled -> In credit, then back to Settled', async ({ page }) => {
  await signInAsStaff(page);
  const billing = await gotoVehicle(page);
  await voidLeftoverNgnInvoices(billing);

  // an NGN invoice with one manual line
  await billing.getByRole('button', { name: 'New invoice' }).click();
  const editor = editorOf(page);
  await editor.getByTestId('invoice-currency').selectOption('NGN');
  await editor.getByTestId('invoice-settle').selectOption('NGN');
  await editor.getByRole('button', { name: /Add line/ }).click();
  const n = await editor.locator('tbody tr').count();
  const i = n - 1;
  await editor.getByTestId(`line-desc-${i}`).fill('Local handling');
  await editor.getByTestId(`line-rate-${i}`).fill('1000');
  await editor.getByTestId(`line-basis-${i}`).fill('Journey 6 NGN fixture');
  const number = await issueFromEditor(page);

  // status: both currencies present, NGN Outstanding with the naira sign
  await page.getByTestId('won-vehicle-back').click();
  await expect(page.getByTestId('acct-USD')).toBeVisible({ timeout: 10000 });
  const ngn = page.getByTestId('acct-NGN');
  await expect(ngn).toBeVisible();
  await expect(ngn.getByTestId('acct-status')).toHaveText('Outstanding');
  await expect(ngn.getByTestId('acct-outstanding')).toContainText('₦');
  await expect(page.getByTestId('acct-USD').getByTestId('acct-outstanding')).toContainText('$');

  // pay it in full from the invoice -> NGN Settled
  const b2 = await gotoVehicle(page);
  const row = b2.getByTestId('doc-row').filter({ hasText: number });
  await row.getByRole('button').first().click();
  await row.getByTestId('record-payment-open').click();
  await row.getByTestId('record-payment-submit').click();
  await expect(row.getByTestId('doc-outstanding')).toHaveText('₦0.00', { timeout: 15000 });

  let card = await statusCard(page, 'NGN');
  await expect(card.getByTestId('acct-status')).toHaveText('Settled', { timeout: 10000 });

  // an UNAPPLIED NGN payment -> In credit, with the credit shown
  const b3 = await gotoVehicle(page);
  await b3.getByTestId('pay-toggle').click();
  await b3.getByTestId('pay-amount').fill('500');
  await b3.getByTestId('pay-currency').selectOption('NGN');
  await b3.getByTestId('pay-save').click();
  const pay = b3.getByTestId('payment-row').filter({ hasText: '₦500.00' }).filter({ hasNotText: 'voided' }).first();
  await expect(pay).toBeVisible({ timeout: 15000 });

  card = await statusCard(page, 'NGN');
  await expect(card.getByTestId('acct-status')).toHaveText('In credit', { timeout: 10000 });
  await expect(card.getByTestId('acct-credit')).toContainText('₦500.00');

  // reset: void the unapplied payment -> back to Settled
  const b4 = await gotoVehicle(page);
  page.once('dialog', d => d.accept('journey 6 reset'));
  await b4.getByTestId('payment-row').filter({ hasText: '₦500.00' }).filter({ hasNotText: 'voided' }).first().getByTestId('payment-void').click();
  card = await statusCard(page, 'NGN');
  await expect(card.getByTestId('acct-status')).toHaveText('Settled', { timeout: 10000 });
});

import { test, expect } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';
import { openClientRelationship } from '../helpers/nav';

// PROMPT 43 Stage 0. (a) A deposit request is numbered DEP-, not RET-: the editor's confirmation dialog states the
// number BEFORE it is consumed (this test cancels, so nothing is allocated), and the number already issued
// (RET-0001) stays exactly as issued - numbers are never rewritten. (b) The Basis field says its text is printed on
// the client's invoice (#114). The real org's DEP-0001 is proven by a database peek, because journeys never touch it.

test.setTimeout(120000);
const COROLLA = 'd0000000-0000-4000-8000-0000000000a5';

test('a deposit request is stated as DEP-, RET-0001 is untouched, and Basis says it is printed on the invoice', async ({ page }) => {
  await signInAsStaff(page);
  await openClientRelationship(page);
  await page.getByTestId('rel-won-vehicles').locator('text=Toyota').first().click();
  await expect(page).toHaveURL(new RegExp(COROLLA));
  const billing = page.getByTestId('section-billing');
  await expect(billing.getByRole('button', { name: 'New deposit request' })).toBeVisible({ timeout: 15000 });

  // (RET-0001 is a client-level deposit request, not on this vehicle's Billing list; that it is still RET-0001 is
  //  asserted in journey 8.5, which reads it in the client portal, and by the database ledger in the Stage 0 report.)

  await billing.getByRole('button', { name: 'New deposit request' }).click();
  const editor = page.locator('.fixed.inset-0.bg-black\\/40');
  await expect(editor).toBeVisible({ timeout: 10000 });

  // 0b - the Basis column header says what happens to what is typed there
  await expect(editor.getByTestId('basis-header')).toContainText('Basis (required)');
  await expect(editor.getByTestId('basis-header')).toContainText("Printed on the client's invoice");

  // 0a - fill the one line, ask to issue, read the stated number, then CANCEL (nothing is consumed)
  const i = (await editor.locator('tbody tr').count()) - 1;
  await editor.getByTestId(`line-desc-${i}`).fill('Deposit (journey 13 - cancelled, never issued)');
  await editor.getByTestId(`line-rate-${i}`).fill('100');
  await editor.getByTestId(`line-basis-${i}`).fill('Journey 13 label check');
  const issueBtn = editor.getByTestId('editor-issue-btn');
  await expect(issueBtn).toBeEnabled({ timeout: 15000 });
  await issueBtn.click();
  const stated = page.getByTestId('confirm-issue-number');
  await expect(stated).toBeVisible({ timeout: 10000 });
  await expect(stated).toHaveText(/^DEP-\d{4}$/);
  await expect(stated).not.toHaveText(/^RET-/);
  await page.getByRole('button', { name: 'Cancel' }).last().click();
  await editor.getByRole('button', { name: 'Cancel' }).click();
});

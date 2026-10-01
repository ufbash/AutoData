import { test, expect } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';

// PROMPT 42 Stage 3, journey 4 - browser-verified: add a computed line, edit its figure, confirm it becomes
// staff-entered with the original noted; add an actual as a line; issue; confirm the stated number before
// consuming it. Uses the Honda Civic fixture (093), whose vehicle_price/auction_fees offers genuinely resolve
// live (a recorded winning bid of $1,700; auction_fees actual currently $700 from the prior journey).

const HONDA_VEHICLE_ID = 'd0000000-0000-4000-8000-000000000093';

test('build and issue an invoice: edit a computed line, use an actual as a line, confirm the number before consuming it', async ({ page }) => {
  await signInAsStaff(page);
  await page.goto(`/vehicle/${HONDA_VEHICLE_ID}`);
  await expect(page.getByTestId('won-vehicle-page')).toBeVisible({ timeout: 10000 });

  const billing = page.getByTestId('section-billing');
  await billing.getByRole('button', { name: 'New invoice' }).click();

  const editor = page.locator('.fixed.inset-0.bg-black\\/40');
  await expect(editor).toBeVisible({ timeout: 10000 });

  // add the computed "Vehicle price" offer as a line
  const vehiclePriceOffer = editor.getByRole('button', { name: /Vehicle price/ });
  await expect(vehiclePriceOffer).toBeEnabled({ timeout: 15000 });
  await vehiclePriceOffer.click();
  await expect(editor.getByTestId('line-origin-0')).toHaveText('Computed', { timeout: 10000 });

  // edit its figure - this must convert it to staff-entered, with the original noted
  await editor.getByTestId('line-rate-0').fill('1650');
  await expect(editor.getByTestId('line-basis-0')).toHaveValue(/was \$1,700\.00, computed/, { timeout: 5000 });
  // the Origin cell itself no longer says "Computed"
  await expect(editor.getByTestId('line-origin-0')).not.toContainText('Computed');

  // add the "actual" auction_fees offer as a second line (document_backed or staff_entered depending on whether
  // it carries an uploaded bill - this one doesn't, so it's staff_entered, with a note)
  const auctionFeesOffer = editor.getByRole('button', { name: /Auction fees.*actual/ });
  await expect(auctionFeesOffer).toBeEnabled({ timeout: 10000 });
  await auctionFeesOffer.click();
  await expect(editor.locator('tbody tr')).toHaveCount(2);

  // scope statement is required for a vehicle_purchase invoice
  await editor.getByTestId('invoice-scope').fill('Stage 3 verification invoice - vehicle price and auction fees.');

  // wait for the live preview to settle before issuing
  await expect(editor.getByText('Live preview')).toBeVisible();
  const issueBtn = editor.getByTestId('editor-issue-btn');
  await expect(issueBtn).toBeEnabled({ timeout: 15000 });
  await issueBtn.click();

  // the confirmation dialog states the number BEFORE it's consumed
  const numberSpan = page.getByTestId('confirm-issue-number');
  await expect(numberSpan).toBeVisible({ timeout: 10000 });
  const number = (await numberSpan.textContent())!.trim();
  expect(number).toMatch(/^INV-\d{4}$/);

  await page.getByTestId('confirm-issue-btn').click();
  await expect(editor).not.toBeVisible({ timeout: 60000 });

  // the new document appears in the Billing list with the exact number that was stated before issuing
  await expect(billing.getByText(number, { exact: false })).toBeVisible({ timeout: 15000 });
});

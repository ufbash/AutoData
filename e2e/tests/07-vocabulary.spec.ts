import { test, expect } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';
import { openClientRelationship } from '../helpers/nav';
import { retainerHits } from '../helpers/vocab';

// PROMPT 42 Stage 3, journey 7 - the vocabulary. "Deposit request" and "Supplier bill" are present where they
// belong; "Retainer" appears NOWHERE a user can read it: not in text, not in a tooltip (title), placeholder,
// aria-label, alt, or <option> label, on the client page, the vehicle page, or inside the deposit-request editor.

const COROLLA_VEHICLE_ID = 'd0000000-0000-4000-8000-0000000000a5';

test('vocabulary: Deposit request and Supplier bill present, Retainer absent - client page, vehicle page, deposit editor', async ({ page }) => {
  await signInAsStaff(page);
  await openClientRelationship(page);

  // the detector must be able to FAIL: plant each OLD term (text and tooltip) and expect every one found; plant the
  // LEGITIMATE neighbours ('credit note', 'Credit balance', 'Credited', 'Deposit request') and expect none found
  const OLD = ['Retainer', 'held on account', 'unapplied credit', 'deposit credit', 'In credit', 'a credit of $5'];
  const OK = ['Raise a credit note', 'Credit balance', 'Credited $5', 'Deposit request', 'Commitment fee', 'credit notes'];
  await page.evaluate(({ OLD, OK }) => {
    OLD.forEach((t, i) => { const a = document.createElement('span'); a.className = 'zz-plant'; a.textContent = t; document.body.appendChild(a);
      const b = document.createElement('span'); b.className = 'zz-plant'; b.title = t; document.body.appendChild(b); void i; });
    OK.forEach(t => { const a = document.createElement('span'); a.className = 'zz-plant-ok'; a.textContent = t; document.body.appendChild(a); });
  }, { OLD, OK });
  expect((await retainerHits(page)).length, 'detector finds every old term, as text and as a tooltip').toBe(OLD.length * 2);
  await page.evaluate(() => { document.querySelectorAll('.zz-plant').forEach(e => e.remove()); });
  expect((await retainerHits(page)).length, 'the legitimate neighbours are NOT flagged').toBe(0);
  await page.evaluate(() => { document.querySelectorAll('.zz-plant-ok').forEach(e => e.remove()); });

  expect(await retainerHits(page), 'client relationship page').toEqual([]);

  await page.getByTestId('rel-won-vehicles').locator('text=Toyota').first().click();
  await expect(page.getByTestId('won-vehicle-page')).toBeVisible({ timeout: 10000 });
  const billing = page.getByTestId('section-billing');
  await expect(billing.getByRole('button', { name: 'New deposit request' })).toBeVisible({ timeout: 15000 });

  // "Supplier bill" is a choice in the document-type selector (a <option>, so read it from the select itself)
  const options = await page.locator('select option').allTextContents();
  expect(options).toContain('Supplier bill');
  expect(options.filter(o => /receipt/i.test(o)), 'a bare "Receipt" document type would collide with the client-facing receipt').toEqual([]);

  expect(await retainerHits(page), 'vehicle page (all sections)').toEqual([]);

  // the on-account payment form: its hint says 'credit balance', its purpose option says 'Commitment fee'
  await billing.getByTestId('pay-toggle').click();
  await expect(billing.getByTestId('pay-form-hint')).toContainText('credit balance');
  expect(await page.locator('select option').allTextContents()).toContain('Commitment fee');
  expect(await retainerHits(page), 'payment form').toEqual([]);
  await billing.getByTestId('pay-toggle').click();

  // open the deposit-request editor and check it too
  await billing.getByRole('button', { name: 'New deposit request' }).click();
  const editor = page.locator('.fixed.inset-0.bg-black\\/40');
  await expect(editor).toBeVisible({ timeout: 10000 });
  await expect(editor.getByText(/New deposit request/)).toBeVisible();
  await expect(editor.getByRole('button', { name: /Issue deposit request/ })).toBeVisible();
  // the charge a deposit request asks for is a 'Commitment fee' (the first line is pre-filled with it)
  const first = (await editor.locator('tbody tr').count()) - 1;
  await expect(editor.getByTestId(`line-desc-${first}`)).toHaveValue('Commitment fee');
  expect(await retainerHits(page), 'deposit request editor').toEqual([]);
});

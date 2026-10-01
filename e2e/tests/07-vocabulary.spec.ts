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

  // the detector must be able to FAIL: plant a "Retainer" in text and in a tooltip, expect both found, remove them
  await page.evaluate(() => {
    const a = document.createElement('span'); a.id = 'zz-plant-a'; a.textContent = 'Retainer'; document.body.appendChild(a);
    const b = document.createElement('span'); b.id = 'zz-plant-b'; b.title = 'a retainer tooltip'; document.body.appendChild(b);
  });
  expect((await retainerHits(page)).length, 'detector finds a planted text node and tooltip').toBe(2);
  await page.evaluate(() => { document.getElementById('zz-plant-a')?.remove(); document.getElementById('zz-plant-b')?.remove(); });

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

  // open the deposit-request editor and check it too
  await billing.getByRole('button', { name: 'New deposit request' }).click();
  const editor = page.locator('.fixed.inset-0.bg-black\\/40');
  await expect(editor).toBeVisible({ timeout: 10000 });
  await expect(editor.getByText(/New deposit request/)).toBeVisible();
  await expect(editor.getByRole('button', { name: /Issue deposit request/ })).toBeVisible();
  expect(await retainerHits(page), 'deposit request editor').toEqual([]);
});

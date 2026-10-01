import { test, expect } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';

// "Does every flag that is meant to fire actually fire?" - the answer, in a browser, on org-4 fixtures whose shape is
// known. Born from the sold-twice Camry (4T1DAACK2SU169784) that was stored correctly and flagged nowhere: the
// pre-share rules live inline in a large component, fed by async loads, with no test anywhere. Each case below is a
// flag with a known-positive fixture; a rule that silently stops firing fails here.
//   'ZZ flags active' (active_listings): a flood-damaged car that sold at a prior auction; a clean Corolla (must NOT
//      be flagged); two sightings of the same Civic VIN.
//   'ZZ flags sold' (sold_comps): an odometer rollback (50,000 mi then 30,000 mi); an unconfirmed sale; and the
//      'ZZ run sold twice' fixture is covered in 11-share-link.

test.setTimeout(120000);

test('active run: prior auction history BLOCK, flood CRITICAL, duplicate VIN BLOCK - and the clean car is NOT flagged', async ({ page }) => {
  await signInAsStaff(page);
  await page.getByText('ZZ flags active').first().click();

  const items = page.locator('li');
  await expect(items.filter({ hasText: 'blocked: this vehicle has been to auction before' })).toContainText('has sold at a prior auction', { timeout: 20000 });
  await expect(items.filter({ hasText: 'blocked: this vehicle has been to auction before' })).toContainText('(BLOCK)');
  await expect(items.filter({ hasText: 'flagged CRITICAL: water damage' })).toBeVisible();
  await expect(items.filter({ hasText: 'Duplicate vehicle in run (2 listings)' })).toContainText('(BLOCK)');
  // a BLOCK means sharing is refused outright (no override)
  await expect(page.getByTestId('share-toggle')).toBeDisabled();

  // the clean Corolla carries no badge: absence is not violation
  const clean = page.locator('[id^="listing-"]', { hasText: 'Corolla' }).first();
  await expect(clean).toBeVisible();
  await expect(clean).not.toContainText(/PRIOR AUCTION HISTORY|CRITICAL|Duplicate vehicle|SOLD TWICE/);
  // and the flagged ones carry theirs
  await expect(page.locator('[id^="listing-"]', { hasText: 'Camry' }).first()).toContainText('PRIOR AUCTION HISTORY');
  await expect(page.locator('[id^="listing-"]', { hasText: 'Camry' }).first()).toContainText('CRITICAL');
  await expect(page.locator('[id^="listing-"]', { hasText: 'Civic' }).first()).toContainText('Duplicate vehicle');
});

test('sold run: odometer rollback CRITICAL and unconfirmed-sale WARN fire; neither is mistaken for a repeat sale', async ({ page }) => {
  await signInAsStaff(page);
  await page.getByText('ZZ flags sold').first().click();

  const items = page.locator('li');
  await expect(items.filter({ hasText: 'show odometer rollback across auction appearances' })).toContainText('(CRITICAL)', { timeout: 20000 });
  await expect(items.filter({ hasText: /unconfirmed/i }).first()).toBeVisible();
  // a Not-sold + Sold history is a prior appearance, not a RE-SALE
  await expect(items.filter({ hasText: 'RE-SALES' })).toHaveCount(0);
  await expect(items.filter({ hasText: 'No repeat-sale vehicles in the sold group' })).toBeVisible();
  await expect(page.locator('[id^="listing-"]', { hasText: 'M3' }).first()).toBeVisible();
});

import { test, expect } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';

// PROMPT 43 Stage 2: an ALREADY-SHARED run must warn staff when a rule newly flags a listing on it. Fixture 'ZZ flags
// sold' (org 4): listing ...f5 has an odometer rollback (CRITICAL), ...f6 an unconfirmed sale (WARN).
//   1. exclude the rollback listing, review the WARN, switch sharing ON (the snapshot records what was flagged then);
//   2. no warning yet;
//   3. re-include the rollback listing -> the CRITICAL is NEW since sharing -> a red banner names it;
//   4. the sharing off-switch still works (checks never lock it); everything is put back.
test.setTimeout(150000);

const ROLLBACK = 'd0000000-0000-4000-8000-0000000000f5';
const UNCONFIRMED = 'd0000000-0000-4000-8000-0000000000f6';
const box = (page: any, id: string) => page.locator(`[id="listing-${id}"] input[type="checkbox"]`);

test('a rule that newly flags a listing on a shared run raises a warning on that run', async ({ page }) => {
  await signInAsStaff(page);
  await page.getByText('ZZ flags sold').first().click();
  const toggle = page.getByTestId('share-toggle');
  await expect(toggle).toBeVisible({ timeout: 20000 });

  // known start: sharing off, both listings included
  if (await toggle.isChecked()) { await toggle.click({ force: true }); await expect(toggle).not.toBeChecked({ timeout: 10000 }); }
  if (!(await box(page, ROLLBACK).isChecked())) await box(page, ROLLBACK).check();
  if (!(await box(page, UNCONFIRMED).isChecked())) await box(page, UNCONFIRMED).check();

  try {
    // 1. exclude the CRITICAL listing, review the remaining WARN, share
    await box(page, ROLLBACK).uncheck();
    await expect(page.locator('li', { hasText: 'show odometer rollback' })).toContainText('No odometer rollback detected', { timeout: 10000 }).catch(() => {});
    await page.getByLabel("I've reviewed these warnings").check();
    await expect(toggle).toBeEnabled({ timeout: 10000 });
    await toggle.click({ force: true });
    await expect(toggle).toBeChecked({ timeout: 10000 });

    // 2. nothing new yet
    await expect(page.getByTestId('shared-newly-flagged')).toHaveCount(0);

    // 3. bring the rollback listing back: a CRITICAL that did not exist when sharing was switched on
    await box(page, ROLLBACK).check();
    const banner = page.getByTestId('shared-newly-flagged');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText('SHARED with the client');
    await expect(banner).toContainText('odometer rollback');
    await expect(banner).toContainText('(CRITICAL)');
    // the unconfirmed-sale WARN was already there at share time: it is NOT re-announced
    await expect(banner).not.toContainText('unconfirmed sale status');
    // and the off-switch is still available although the checks now fail
    await expect(toggle).toBeEnabled();
  } finally {
    // put everything back
    if (await toggle.isChecked()) { await toggle.click({ force: true }); await expect(toggle).not.toBeChecked({ timeout: 10000 }); }
    if (!(await box(page, ROLLBACK).isChecked())) await box(page, ROLLBACK).check();
  }
  await expect(page.getByTestId('shared-newly-flagged')).toHaveCount(0);
});

import { test, expect } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';

// PROMPT 42 Stage 3, journey 3 - browser-verified: staff records an actual against a vehicle, supersedes it (by
// voiding and recording again - the UI doesn't offer recording a second one while one is still current; it must
// be voided first, which matches the append-only guard's own message: "void it and record a new one"), voids one
// with a reason; estimate stays visible; variance correct.
//
// Uses the Honda Civic fixture (093), whose auction_fees estimate genuinely resolves live ($797.5, verified
// independently multiple times this session) - unlike Duty (dutyComponent() always abstains, by design, C2 not
// built yet) or the other components on the untouched Corolla fixture, which need a real yard match this minimal
// synthetic sighting doesn't have.
//
// Self-resetting: voids whatever live actual is already there before starting (a prior run may have left one),
// rather than assuming a specific stale value - the same test-suite-repeatability fix as 02-provisioning.spec.ts.

const HONDA_VEHICLE_ID = 'd0000000-0000-4000-8000-000000000093';

test('record, void, and re-record an actual cost; estimate stays visible; variance correct', async ({ page }) => {
  await signInAsStaff(page);
  await page.goto(`/vehicle/${HONDA_VEHICLE_ID}`);
  await expect(page.getByTestId('won-vehicle-page')).toBeVisible({ timeout: 10000 });

  const costs = page.getByTestId('section-costs');
  await expect(costs.locator('text=Auction fees').first()).toBeVisible({ timeout: 15000 });
  await expect(costs.locator('text=$797.5').first()).toBeVisible({ timeout: 15000 }); // the estimate, confirmed present before touching anything

  // ---- ensure a clean starting point: void whatever's already live, if anything
  if (await page.getByTestId('actual-void-auction_fees').isVisible().catch(() => false)) {
    page.once('dialog', d => d.accept('Resetting the fixture before this run'));
    await page.getByTestId('actual-void-auction_fees').click();
    await expect(page.getByTestId('actual-open-auction_fees')).toBeVisible({ timeout: 10000 });
  }

  // ---- record the first actual
  await page.getByTestId('actual-open-auction_fees').click();
  await page.getByTestId('actual-input-amount-auction_fees').fill('645');
  await page.getByTestId('actual-input-note-auction_fees').fill('Stage 3 verification - first actual');
  await page.getByTestId('actual-save-auction_fees').click();
  await expect(page.getByTestId('actual-amount-auction_fees')).toHaveText('$645.00', { timeout: 10000 });
  await expect(page.getByTestId('actual-variance-auction_fees')).toContainText('-$152.50'); // 645 - 797.5
  // the estimate is unaffected by recording an actual
  await expect(costs.locator('text=$797.5').first()).toBeVisible();

  // ---- void it, with a reason
  page.once('dialog', d => d.accept('Stage 3 verification - clearing the way for a fresh actual'));
  await page.getByTestId('actual-void-auction_fees').click();
  await expect(page.getByTestId('actual-open-auction_fees')).toBeVisible({ timeout: 10000 });
  await expect(costs.locator('text=$797.5').first()).toBeVisible(); // still unaffected

  // ---- record a fresh one (append-only ledger still accepts a new entry after a void)
  await page.getByTestId('actual-open-auction_fees').click();
  await page.getByTestId('actual-input-amount-auction_fees').fill('700');
  await page.getByTestId('actual-input-note-auction_fees').fill('Stage 3 verification - fresh actual after void');
  await page.getByTestId('actual-save-auction_fees').click();
  await expect(page.getByTestId('actual-amount-auction_fees')).toHaveText('$700.00', { timeout: 10000 });
  await expect(page.getByTestId('actual-variance-auction_fees')).toContainText('-$97.50'); // 700 - 797.5
});

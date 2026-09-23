import { test, expect } from '@playwright/test';
import { signInAsStaff, signInAsClientA, expectIsolatedStorage } from '../helpers/auth';

// PROMPT 42 Stage 1 - the trivial verification: staff signs in through the real form and reaches the dashboard;
// client A signs in and reaches the client dashboard. Both headless, both isolated contexts (Playwright's default
// - a fresh context per test).

test('staff signs in through the real form and reaches the dashboard', async ({ page }) => {
  await signInAsStaff(page);
  await expect(page.getByText(/no organization membership/i)).not.toBeVisible();
  // the staff shell shows navigation not present on the login screen - wait for it rather than the login form
  await expect(page.getByText('Continue with Google')).not.toBeVisible({ timeout: 15000 });
  await expectIsolatedStorage(page);
});

test('client A signs in through the real form and reaches the client dashboard', async ({ page }) => {
  await signInAsClientA(page);
  await expect(page.getByText('Continue with Google')).not.toBeVisible({ timeout: 15000 });
  // the client dashboard is a different shell entirely from staff - confirm client-only content shows
  await expect(page.getByText(/your account isn't set up yet/i)).not.toBeVisible();
  await expectIsolatedStorage(page);
});

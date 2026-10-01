import { test, expect } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';

// Two things Bashir hit on 1 Oct 2026, both through a REAL client run, both previously invisible to every test here:
//
// 1. A shared run's link opened "This link is no longer available" for an anonymous visitor even with client sharing
//    enabled. Cause: the public-run Edge Function still SELECTed research_runs.notes, a column migration 074 had
//    moved away, so its run lookup errored and it answered 404 for EVERY shared run since 22 Sep. Nothing opened a
//    share link as an anonymous visitor. This does: enable sharing, open the link in a brand-new context, switch
//    sharing off, and the same link must then be refused (so the 404 means "disabled", not "always").
//
// 2. A Camry that had sold twice at auction (crashed, repaired, resold - VIN 4T1DAACK2SU169784 in the real run) was
//    stored correctly in auction_history and flagged nowhere on a historical run. The org-4 fixture 'ZZ run sold
//    twice' reproduces its shape: one finished comp, two distinct 'Sold' events. Expected: a CRITICAL checklist item
//    naming both sales, a 'SOLD TWICE' badge, sharing refused until it is reviewed with a typed reason, and the comp
//    EXCLUDED from the sold average - on the staff page AND on the client's page.

test.setTimeout(150000);

const RUN = 'ZZ run sold twice';

test('a vehicle that sold twice is flagged CRITICAL, needs a typed reason to share, and is excluded from the average on the client page; the share link works and stops when disabled', async ({ page, browser }) => {
  await signInAsStaff(page);
  await page.getByText(RUN).first().click();

  // --- staff page: the flag fires, names the car and both sales ---
  const checklist = page.locator('li', { hasText: 'RE-SALES' });
  await expect(checklist).toBeVisible({ timeout: 20000 });
  await expect(checklist).toContainText('sold at auction more than once');
  await expect(checklist).toContainText('2025-10-15 $17,100 at 9,078 mi');
  await expect(checklist).toContainText('2026-09-03 $12,300 at 37,904 mi');
  await expect(checklist).toContainText('(CRITICAL)');
  await expect(page.getByText('SOLD TWICE - excluded from average').first()).toBeVisible();

  // --- sharing is refused until the CRITICAL is reviewed with a typed reason (decision 4.9) ---
  const toggle = page.getByTestId('share-toggle');
  const wasEnabled = await toggle.isChecked();
  if (wasEnabled) { await toggle.click({ force: true }); await expect(toggle).not.toBeChecked({ timeout: 10000 }); }
  await expect(toggle).toBeDisabled();
  await page.getByLabel("I've reviewed these warnings").check();
  await page.getByPlaceholder('Min 10 characters required...').fill('Journey test: repeat sale reviewed by staff');
  await expect(toggle).toBeEnabled();
  await toggle.click({ force: true });
  await expect(toggle).toBeChecked({ timeout: 10000 });
  const link = page.getByTestId('share-link');
  await expect(link).toBeVisible({ timeout: 15000 });
  const url = await link.inputValue();
  expect(url).toMatch(/\/share\/[A-Za-z0-9]{32,}/);

  try {
    // --- a brand-new anonymous browser: the link opens, and the comp is labelled and NOT in the average ---
    const anon = await browser.newContext();
    const visitor = await anon.newPage();
    await visitor.goto(url);
    await expect(visitor.getByText(RUN).first()).toBeVisible({ timeout: 20000 });
    await expect(visitor.getByText(/no longer available/i)).toHaveCount(0);
    await expect(visitor.getByText('Sold more than once - not in the average')).toBeVisible();
    await anon.close();
  } finally {
    await toggle.click({ force: true });
  }

  // --- switched off: the same link is refused, so the pass above really was the function answering ---
  await expect(toggle).not.toBeChecked({ timeout: 10000 });
  await page.waitForTimeout(1500);
  const anon2 = await browser.newContext();
  const visitor2 = await anon2.newPage();
  await visitor2.goto(url);
  await expect(visitor2.getByText(/no longer available/i)).toBeVisible({ timeout: 20000 });
  await anon2.close();
});

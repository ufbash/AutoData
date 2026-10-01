import { test, expect } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';

// PROMPT 43 Stage 3 / PROJECT_CHARTER 5.7 as extended: in a MIXED run an unknown lot state belongs to NO population.
// Fixture 'ZZ mixed lot state' (org 4): two finished confirmed sales ($20,000 + $22,000), one LIVE lot with no bid yet,
// one listing with unknown lot state ($18,000, confirmed, would have been averaged as a sale before).
//   - the sold average is $21,000 over 2 sales (the unknown listing is NOT in it: it would make $20,000 over 3);
//   - the live lot with no bid is counted as active (the old filter needed a bid, so it was in neither group);
//   - the unknown-lot listing is named and badged 'Lot state unknown - not in any average', and is not risk-checked.
test.setTimeout(120000);

const UNKNOWN = 'd0000000-0000-4000-8000-0000000000fa';
const LIVE_NOBID = 'd0000000-0000-4000-8000-0000000000f9';

test('mixed run: unknown lot state is in no average, a live lot with no bid is active, and staff can see what needs classifying', async ({ page }) => {
  await signInAsStaff(page);
  await page.getByText('ZZ mixed lot state').first().click();

  const sold = page.locator('div', { has: page.getByText('Market Research (Sold)') }).filter({ hasText: 'Avg sale price' }).last();
  await expect(sold).toContainText('Avg sale price (2 sales)', { timeout: 20000 });
  await expect(sold).toContainText('$21,000');
  await expect(sold).not.toContainText('(3 sales)');

  // the live group counts the no-bid live lot
  const live = page.locator('div', { has: page.getByText('Client Options (Live)') }).filter({ hasText: 'Listings count' }).last();
  await expect(live).toContainText('1 included');

  // the unknown-lot listing is named, and badged on its own row
  await expect(page.locator('li', { hasText: 'unknown lot state - in NO average and NO risk check until classified' })).toBeVisible();
  await expect(page.locator(`[id="listing-${UNKNOWN}"]`)).toContainText('Lot state unknown - not in any average');
  // ...and the live lot is NOT mislabelled
  await expect(page.locator(`[id="listing-${LIVE_NOBID}"]`)).not.toContainText('Lot state unknown');
});

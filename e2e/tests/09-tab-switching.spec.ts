import { test, expect, Page } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';
import { openClientRelationship } from '../helpers/nav';

// PROMPT 42 Stage 3, journey 9 - leaving the browser tab and coming back must not reset the app (debt #88: Supabase
// re-emits an auth event on every tab refocus and the app used to answer it by reloading the membership and
// dropping the user on the home dashboard). Two ways in: a REAL second tab brought to the front and back, and the
// page's own visibilitychange events (hidden -> visible), which is exactly what supabase-js listens to.

const COROLLA_VEHICLE_ID = 'd0000000-0000-4000-8000-0000000000a5';

const hideThenShow = async (page: Page) => {
  await page.evaluate(async () => {
    const setVis = (v: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
      Object.defineProperty(document, 'hidden', { value: v === 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); // bubbles: supabase-js listens on window
    };
    setVis('hidden'); await new Promise(r => setTimeout(r, 500)); setVis('visible');
  });
};

test('tab away and back: the client page, an open vehicle page and typed-in state all survive; no membership refetch', async ({ page, context }) => {
  await signInAsStaff(page);
  await openClientRelationship(page);

  // open the vehicle, expand an invoice row and open a payment form with a half-typed amount - UI state that a reset would lose
  await page.getByTestId('rel-won-vehicles').locator('text=Toyota').first().click();
  await expect(page.getByTestId('won-vehicle-page')).toBeVisible({ timeout: 10000 });
  const billing = page.getByTestId('section-billing');
  await expect(billing.getByTestId('doc-row').first()).toBeVisible({ timeout: 15000 });
  await billing.getByTestId('pay-toggle').click();
  await billing.getByTestId('pay-amount').fill('123.45');

  const membershipFetches: string[] = [];
  page.on('request', r => { if (r.url().includes('/rest/v1/memberships')) membershipFetches.push(r.url()); });

  // 1) a REAL other tab: open one in the same context, bring it forward, come back
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await page.waitForTimeout(1500);
  await page.bringToFront();
  await page.waitForTimeout(1500);

  // 2) the page's own hidden -> visible, three times (what supabase-js's refocus handler hears)
  for (let i = 0; i < 3; i++) { await hideThenShow(page); await page.waitForTimeout(700); }
  await other.close();

  // still exactly where we were, with the same state
  await expect(page.getByTestId('won-vehicle-page')).toBeVisible();
  await expect(billing.getByTestId('pay-amount')).toHaveValue('123.45');
  expect(membershipFetches, 'a refocus must not re-run the membership lookup for the same signed-in user').toEqual([]);

  // and Back still lands on the client page it came from (the underlying view was never reset either)
  await page.getByTestId('won-vehicle-back').click();
  await expect(page.getByTestId('rel-won-vehicles')).toBeVisible();
  await hideThenShow(page);
  await page.waitForTimeout(700);
  await expect(page.getByTestId('rel-won-vehicles')).toBeVisible();
});

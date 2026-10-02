import { test, expect } from '@playwright/test';
import { signInAsStaff, signInAsClientA } from '../helpers/auth';

// PROMPT 44 Stage 4 - the small defects logged by the Prompt 43 usability verifier, now fixed, each checked as a person sees it.
//   CLIENT PORTAL: live documents under clear headings, voided ones kept apart; receipts show their amount; the client's OWN
//   /vehicle/<id> address highlights that vehicle; the first load shows a skeleton and a sentence, not a bare spinner.
//   STAFF: no raw enum chip (extension_dom_capture, bidcars, ...), the sold run's panel names what it holds, a live car's
//   price is labelled as what it is.
test.setTimeout(150000);

const OWN_VEHICLE = 'd0000000-0000-4000-8000-000000000093';

test('client portal: clear headings, voided kept apart, receipts show amounts, own vehicle URL highlights it, skeleton on first load', async ({ page }) => {
  await signInAsClientA(page);
  // slow the data requests (after sign-in) so the loading state is observable
  await page.route('**/rest/v1/**', route => { setTimeout(() => { route.continue().catch(() => {}); }, 1500); });
  await page.goto(`/vehicle/${OWN_VEHICLE}`);
  await expect(page.getByTestId('portal-loading')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Loading your account...')).toBeVisible();
  await page.unroute('**/rest/v1/**');

  // the client's OWN vehicle address opens that vehicle: highlighted, labelled, and not the 'not available' page
  await expect(page.getByTestId('portal-vehicle-opened')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="portal-vehicle"][data-highlighted="true"]')).toHaveCount(1);
  await expect(page.getByTestId('portal-not-available')).toHaveCount(0);

  // headings are named and counted; deposit requests and credit notes are separate from invoices
  await expect(page.getByRole('heading', { name: /^Invoices \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Deposit requests \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Credit notes \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Receipts \(\d+\)$/ })).toBeVisible();
  // an invoice number never sits under 'Deposit requests', nor a DEP-/RET- under 'Invoices'
  const invoicesSection = page.getByRole('heading', { name: /^Invoices \(/ }).locator('xpath=..');
  expect(await invoicesSection.innerText()).not.toMatch(/\b(RET|DEP|CN)-\d+/);

  // voided documents are kept apart and collapsed: no voided card is on screen until asked for
  const voidedHeading = page.getByRole('heading', { name: /^Voided documents \(\d+\)$/ });
  await expect(voidedHeading).toBeVisible();
  const liveCards = await page.getByTestId('portal-invoice').count();
  expect(await page.getByText('This document was voided', { exact: false }).count()).toBe(0);
  await page.getByTestId('portal-voided-toggle').click();
  await expect.poll(async () => page.getByTestId('portal-invoice').count()).toBeGreaterThan(liveCards);

  // receipts show their amount
  await expect(page.getByTestId('portal-receipt-amount').first()).toHaveText(/^[$₦][\d,]+\.\d{2}$/);
});

test('staff screens: no raw enum chips, the sold run names its panel, a live car is priced as what it is', async ({ page }) => {
  await signInAsStaff(page);
  await page.getByText('ZZ mixed lot state').first().click();
  await expect(page.getByText('Market Research (Sold)').first()).toBeVisible({ timeout: 20000 });
  // the chips say words, not codes
  const text = await page.locator('body').innerText();
  expect(text.match(/\b(extension_dom_capture|manual_entry|ai_vision|api_import|sold_comps|active_listings)\b/gi) ?? [], 'raw enum tokens on screen').toEqual([]);
  expect(text).toMatch(/captured from the page/i); // chips are uppercased by CSS, so match case-insensitively
  // a live car with no bid yet is labelled as a listed price, never as a sale
  const live = page.locator('[id^="listing-"]', { hasText: 'Camry' }).filter({ hasText: 'Client Options' }).first();
  void live;
  await expect(page.getByText(/listed price \(live, no bid yet\)/i).first()).toBeVisible();
  await expect(page.getByText('Sale / Listed Price')).toHaveCount(0);
  await expect(page.getByText('Unknown loc')).toHaveCount(0);

  // a sold run's panel is headed with what it holds, not 'RUN LISTINGS'
  await page.getByText('Back to Runs').first().click();
  await page.getByText('ZZ run sold twice').first().click();
  await expect(page.getByText(/market research \(sold\)/i).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/not yet available/i)).toHaveCount(0);

  // the "not checkable" line reads as an explanation, not a roadmap note
  await page.getByText('Back to Runs').first().click();
  await page.getByText('ZZ flags active').first().click();
  await expect(page.locator('li', { hasText: 'could not be checked' })).toContainText('only bid.cars records a sales history', { timeout: 20000 });
});

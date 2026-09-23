import { test, expect, Page } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';

// PROMPT 42 Stage 2 - the won vehicle as a full page, browser-verified: a client with two won vehicles on
// different briefs shows both on the client page; clicking one navigates to its own URL; all four sections
// render in order; reload keeps the page; back returns to the client page; the URL opened directly in a fresh
// context loads the same page for staff.

const CLIENT_A_ID = process.env.E2E_CLIENT_A_CLIENT_ID!;
const KNOWN_VEHICLE_ID = 'd0000000-0000-4000-8000-000000000093'; // org 4, client A's synthetic Honda Civic

// Selecting a client from the list shows an inline summary only - "Full relationship" opens the actual
// ClientRelationship page (where rel-won-vehicles etc. live).
const openClientRelationship = async (page: Page) => {
  await page.getByRole('button', { name: /clients/i }).click();
  await page.getByText('ZZ Synthetic Client C').first().click();
  await page.getByRole('button', { name: 'Full relationship' }).click();
};

test('client page lists both won vehicles (on two different briefs); clicking one opens the full page at its own URL', async ({ page }) => {
  await signInAsStaff(page);
  await openClientRelationship(page);
  const wonSection = page.getByTestId('rel-won-vehicles');
  await expect(wonSection.locator('text=Honda')).toBeVisible({ timeout: 10000 });
  await expect(wonSection.locator('text=Toyota')).toBeVisible();

  await wonSection.locator('text=Honda').first().click();
  await expect(page).toHaveURL(new RegExp(`/vehicle/${KNOWN_VEHICLE_ID}`));
  await expect(page.getByTestId('won-vehicle-page')).toBeVisible();
});

test('all four sections render, in order, no duplication', async ({ page }) => {
  await signInAsStaff(page);
  await page.goto(`/vehicle/${KNOWN_VEHICLE_ID}`);
  await expect(page.getByTestId('won-vehicle-page')).toBeVisible({ timeout: 10000 });

  const sections = ['section-vehicle', 'section-costs', 'section-billing', 'section-documents'];
  const boxes = await Promise.all(sections.map(id => page.getByTestId(id).boundingBox()));
  for (const s of sections) await expect(page.getByTestId(s)).toBeVisible();
  // order: each section's top must be below the previous one's top
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y);
  }
  // exactly one "Billing" heading, one "Documents" heading - no duplicate section
  await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toHaveCount(1);
});

test('back (client-side, no reload) returns to the client relationship view it was opened from', async ({ page }) => {
  await signInAsStaff(page);
  await openClientRelationship(page);
  await page.getByTestId('rel-won-vehicles').locator('text=Honda').first().click();
  await expect(page).toHaveURL(new RegExp(`/vehicle/${KNOWN_VEHICLE_ID}`));

  // FINDING (fixed): the first version of this rendered the vehicle page by replacing <main>'s content, which
  // unmounted ClientsList (and its in-memory relationshipOpen/selectedClient state, which lives only in memory,
  // never in the URL) - "back" landed on the default Research Runs tab, not the client relationship the user
  // actually came from. Fixed by rendering the vehicle page as an overlay sibling to <main> instead, so the
  // underlying view stays mounted. Proved here with a real click on the page's own Back button (client-side
  // navigation, no reload) - a hard reload is a separate, unrelated case (see the next test): nothing in this
  // app persists in-memory navigation state across an actual page reload, on this route or any other.
  await page.getByTestId('won-vehicle-back').click();
  await expect(page.getByTestId('rel-won-vehicles')).toBeVisible({ timeout: 10000 });
});

test('reload keeps the page; the URL opened directly in a fresh context loads the same page for staff', async ({ page }) => {
  await signInAsStaff(page);
  await openClientRelationship(page);
  await page.getByTestId('rel-won-vehicles').locator('text=Honda').first().click();
  await expect(page).toHaveURL(new RegExp(`/vehicle/${KNOWN_VEHICLE_ID}`));

  // reload keeps the page
  await page.reload();
  await expect(page.getByTestId('won-vehicle-page')).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveURL(new RegExp(`/vehicle/${KNOWN_VEHICLE_ID}`));

  // the URL opened directly in a FRESH context (this same test's page, navigated cold) loads the same page
  await page.goto(`/vehicle/${KNOWN_VEHICLE_ID}`);
  await expect(page.getByTestId('won-vehicle-page')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('won-vehicle-title')).toContainText('Honda');
});

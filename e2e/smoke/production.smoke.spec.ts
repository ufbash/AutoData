import { test, expect, Page } from '@playwright/test';

// PRODUCTION SMOKE - read-only. Run after EVERY Edge Function deploy and EVERY push: `npm run smoke`.
// Born from the nine-day share-link outage (22 Sep - 1 Oct 2026): a column was moved, `public-run` still read it, every
// client link answered "no longer available", and nothing looked at production until a client did.
//
// WRITES NOTHING. The suite signs in (an auth call, not a data write) and otherwise only loads pages and reads. The
// `no-writes` guard below records every request the browser makes and FAILS the run if any non-read request goes to the
// backend other than the sign-in itself - so "it writes nothing" is checked, not promised. Org 4 synthetic data only.

const BASE = process.env.E2E_SMOKE_BASE_URL ?? 'https://theautodata.com';
const REF = 'xrotvpuainpfdulhfhtt';
const API = `https://${REF}.supabase.co`;
const SHARE = process.env.E2E_SMOKE_SHARE_TOKEN ?? '';
const TRACK = process.env.E2E_SMOKE_TRACK_TOKEN ?? '';

const writes: string[] = [];
const watch = (page: Page) => page.on('request', r => {
  const m = r.method();
  if (['GET', 'HEAD', 'OPTIONS'].includes(m)) return;
  const u = r.url();
  if (!u.startsWith(API)) return;                       // third parties (fonts, analytics) are not the backend
  if (u.includes('/auth/v1/token') || u.includes('/auth/v1/logout')) return; // signing in / out is the whole point
  writes.push(`${m} ${u}`);
});

test.beforeAll(() => {
  expect(SHARE.length, 'E2E_SMOKE_SHARE_TOKEN is missing from e2e/.env.e2e').toBeGreaterThanOrEqual(32);
  expect(TRACK.length, 'E2E_SMOKE_TRACK_TOKEN is missing from e2e/.env.e2e').toBeGreaterThanOrEqual(32);
});

test('1. the login page loads', async ({ page }) => {
  watch(page);
  const res = await page.goto(BASE);
  expect(res?.status()).toBe(200);
  await expect(page.getByText('Continue with Google')).toBeVisible({ timeout: 20000 });
});

test('2. an anonymous share link renders with its listings (page AND the function behind it)', async ({ page, request }) => {
  watch(page);
  // the function directly: 200, the run's name, listings, and no staff-only field
  const api = await request.get(`${API}/functions/v1/public-run?token=${SHARE}`);
  expect(api.status(), 'public-run answered a valid enabled token with something other than 200').toBe(200);
  const body = await api.json();
  expect(body.run.client_name).toBe('ZZ smoke share');
  expect(body.listings.length).toBeGreaterThanOrEqual(3);
  expect(body.run).not.toHaveProperty('notes');
  // the page, as a stranger (a fresh context carries no session)
  await page.goto(`${BASE}/share/${SHARE}`);
  await expect(page.getByText('ZZ smoke share').first()).toBeVisible({ timeout: 25000 });
  await expect(page.getByText(/no longer available/i)).toHaveCount(0);
  await expect(page.getByText('Camry').first()).toBeVisible();
  // and a garbage token is refused (the 404 means something)
  expect((await request.get(`${API}/functions/v1/public-run?token=${'a'.repeat(64)}`)).status()).toBe(404);
});

test('3. the tracking page renders for a valid synthetic token', async ({ page, request }) => {
  watch(page);
  const api = await request.get(`${API}/functions/v1/won-vehicle-tracking?token=${TRACK}`);
  expect(api.status(), 'won-vehicle-tracking answered a valid enabled token with something other than 200').toBe(200);
  await page.goto(`${BASE}/track/${TRACK}`);
  await expect(page.getByText(/no longer available/i)).toHaveCount(0);
  await expect(page.getByText(/Honda|Civic|status|Won|Purchased/i).first()).toBeVisible({ timeout: 25000 });
});

async function signInThroughForm(page: Page, email: string, password: string) {
  await page.goto(BASE);
  await page.getByText('Sign in with email and password instead').click();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForFunction(() => { try { return Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token')); } catch { return false; } }, undefined, { timeout: 20000 });
  await expect(page.getByText('Continue with Google')).not.toBeVisible({ timeout: 20000 });
}

test('4. a synthetic staff account signs in and reaches the staff dashboard', async ({ page }) => {
  watch(page);
  await signInThroughForm(page, process.env.E2E_STAFF_EMAIL!, process.env.E2E_STAFF_PASSWORD!);
  await expect(page.getByRole('button', { name: /clients/i }).first()).toBeVisible({ timeout: 25000 });
  await expect(page.getByText(/Your account isn't set up yet/)).toHaveCount(0);
});

test('5. a synthetic client account signs in and reaches the client dashboard', async ({ page }) => {
  watch(page);
  await signInThroughForm(page, process.env.E2E_CLIENT_A_EMAIL!, process.env.E2E_CLIENT_A_PASSWORD!);
  await expect(page.getByText('ZZ Synthetic Client C').first()).toBeVisible({ timeout: 25000 });
  await expect(page.getByText('Your vehicles')).toBeVisible();
  // a client never lands in the staff app
  await expect(page.getByRole('button', { name: /^clients$/i })).toHaveCount(0);
});

test('6. NOTHING WAS WRITTEN: every backend request in this run was a read (or the sign-in itself)', () => {
  expect(writes, `the smoke suite sent non-read requests to the backend:\n${writes.join('\n')}`).toEqual([]);
});

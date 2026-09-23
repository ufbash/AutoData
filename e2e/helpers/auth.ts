import { Page, expect } from '@playwright/test';

// PROMPT 42 Stage 1 - signs in through the REAL login form (src/components/LoginScreen.tsx's email/password
// fallback), never by writing a session into storage. Each caller gets its own isolated Playwright context, so
// nothing here is shared across tests or with any browser a person uses.
export const signIn = async (page: Page, email: string, password: string) => {
  await page.goto('/');
  await page.getByText('Sign in with email and password instead').click();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
};

export const signInAsStaff = (page: Page) =>
  signIn(page, process.env.E2E_STAFF_EMAIL!, process.env.E2E_STAFF_PASSWORD!);

export const signInAsClientA = (page: Page) =>
  signIn(page, process.env.E2E_CLIENT_A_EMAIL!, process.env.E2E_CLIENT_A_PASSWORD!);

export const signInAsClientB = (page: Page) =>
  signIn(page, process.env.E2E_CLIENT_B_EMAIL!, process.env.E2E_CLIENT_B_PASSWORD!);

// Confirms the harness never touched shared browser storage on the host - a fresh Playwright context has its
// own storage from birth, but this makes the guarantee explicit and checkable in a test's own assertions.
export const expectIsolatedStorage = async (page: Page) => {
  const keys = await page.evaluate(() => Object.keys(localStorage));
  // the app's own auth key is fine (this IS this context's own storage); anything unexpected would signal a leak
  for (const k of keys) expect(k.startsWith('sb-') || k === 'autodata.adminSection' || k === 'autotrend_rates_cache').toBeTruthy();
};

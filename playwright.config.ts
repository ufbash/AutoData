import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// PROMPT 42 Stage 1 - the real browser harness. Every test gets its own isolated context (Playwright's default -
// a fresh browserContext per test file/worker, no storage.json reused across tests, no shared profile). Points at
// the LOCAL dev server, which itself talks to the REAL Supabase project and org 4 - never a mock backend, so a
// passing test means the real RLS/Edge Function stack actually behaved, not that a stub agreed with itself.
dotenv.config({ path: path.resolve(__dirname, 'e2e/.env.e2e') });

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false, // shared org-4 fixtures (won vehicles, invoices) - serialize to avoid cross-test interference
  forbidOnly: !!process.env.CI,
  // 90s, not Playwright's 30s default: every step talks to the real remote Supabase project, and a journey issues
  // invoices/PDFs. Journey 9 failed once in a full-suite run at 30.9s - a timeout, not an assertion (artifacts were
  // overwritten by the next run, so that is the best reading of it, not a proven cause); it then passed 6 times.
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

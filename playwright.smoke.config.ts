import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// PRODUCTION SMOKE (Prompt 43 Stage 5). Read-only checks against the LIVE site after every deploy and every push:
//   npm run smoke
// It uses org-4 SYNTHETIC data only (a share link, a tracking link, two synthetic accounts) and WRITES NOTHING - a test in
// the suite fails the run if the browser sends anything other than a read (see e2e/smoke/production.smoke.spec.ts).
// Credentials/tokens come from the gitignored e2e/.env.e2e, never from the repo.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, 'e2e/.env.e2e') });

export default defineConfig({
  testDir: './e2e/smoke',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_SMOKE_BASE_URL ?? 'https://theautodata.com',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'production', use: { ...devices['Desktop Chrome'] } }],
});

import { Page, expect } from '@playwright/test';

// Clients -> "ZZ Synthetic Client C" -> "Full relationship" (the real ClientRelationship page).
export const openClientRelationship = async (page: Page, name = 'ZZ Synthetic Client C') => {
  await page.getByRole('button', { name: /clients/i }).click();
  await page.getByText(name).first().click();
  await page.getByRole('button', { name: 'Full relationship' }).click();
  await expect(page.getByTestId('rel-won-vehicles')).toBeVisible({ timeout: 10000 });
};

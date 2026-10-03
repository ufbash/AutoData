import { test, expect } from '@playwright/test';
import { signInAsStaff } from '../helpers/auth';

// PROMPT 45 Stage 1 - the staff client page shows the account state plainly: linked / awaiting email confirmation / not provisioned.
// Fixtures (org 4, synthetic): 'ZZ Awaiting Confirmation' has an auth account for its email that is NOT confirmed (it must stay unlinked, no
// membership); 'Mohammed Jamilu Danmusa' (the synthetic org-4 record, no email) has no account; 'ZZ Provisioning Target' is linked.
test.setTimeout(120000);
const stateOf = async (page: any, name: string) => {
  await page.getByRole('button', { name: /clients/i }).click();
  await page.getByText(name).first().click();
  await page.getByRole('button', { name: 'Full relationship' }).click();
  const el = page.getByTestId('account-state');
  await expect(el).toBeVisible({ timeout: 20000 });
  return { state: await el.getAttribute('data-state'), text: (await el.textContent())! };
};

test('the staff page says linked / awaiting email confirmation / not provisioned', async ({ page }) => {
  await signInAsStaff(page);
  const awaiting = await stateOf(page, 'ZZ Awaiting Confirmation');
  expect(awaiting.state).toBe('awaiting_confirmation');
  expect(awaiting.text).toMatch(/awaiting email confirmation/i);
  await page.getByRole('button', { name: 'Back' }).first().click().catch(() => {});
  await page.goto('/');
  const none = await stateOf(page, 'Mohammed Jamilu Danmusa');
  expect(none.state).toBe('not_provisioned');
  expect(none.text).toMatch(/not provisioned/i);
  await page.goto('/');
  const linked = await stateOf(page, 'ZZ Provisioning Target');
  expect(linked.state).toBe('linked');
});

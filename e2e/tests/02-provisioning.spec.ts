import { test, expect } from '@playwright/test';
import { signIn, signInAsStaff } from '../helpers/auth';

// PROMPT 42 Stage 3, journeys 1 and 2 - browser-verified (Prompt 41 rows 2 and 6 were code-path/RPC only).
//
// Self-resetting by design: "ensure revoked" (a staff action, no service-role access needed) is a legitimate way
// to reset this fixture between runs - found and used deliberately after an earlier version of this test left
// the fixture provisioned, which made a second run fail on a stale assumption (a test-suite gap, not a product
// bug: PLAN_TRACKER.md's entry for this stage records it plainly).
//
// A REAL bug found and fixed along the way, not a test-suite one: memberships_select's RLS deliberately lets a
// user read their own membership row even when revoked (so they can at least see they were revoked, rather than
// a silent mystery) - but AuthContext's fetchMembership() query never excluded a revoked row, so a revoked client
// was routed to ClientDashboard exactly like an active one (every actual DATA read inside it was still correctly
// empty, since current_client_id()/user_org_ids() DO filter revoked_at - never a data leak, Decision 20.4 held -
// but the client saw a hollow, confusing empty dashboard instead of the clear "not set up" message). Fixed in
// AuthContext.tsx by filtering revoked_at there too.
//
// Once revoked, a client stays LINKED (clients.user_id is never cleared by revoke - only the membership's
// revoked_at is set), so re-provisioning after a revoke is always the "Reactivate" path, never the email form.

test('the full provisioning lifecycle, ending back where it started: unprovisioned/revoked shows the setup page; staff provisions, revokes, reactivates; the account itself sees each transition', async ({ browser }) => {
  const staffPage = await (await browser.newContext()).newPage();
  await signInAsStaff(staffPage);
  await staffPage.getByRole('button', { name: /clients/i }).click();
  await staffPage.getByText('ZZ Provisioning Target').first().click();
  await staffPage.getByRole('button', { name: 'Full relationship' }).click();

  // ---- ensure a clean starting point: if a prior run left this active, revoke it first (staff action only).
  // ClientAccountStatus's own status fetch is async - an immediate isVisible() check here raced it and read
  // "not active yet" as "not active" (found live, the actual cause of this reset logic's first failure - a
  // test-suite timing bug, not a product one). Wait for the status to actually settle first.
  await expect(staffPage.getByText('Account active').or(staffPage.getByText('Access revoked'))).toBeVisible({ timeout: 10000 });
  if (await staffPage.getByText('Account active').isVisible()) {
    staffPage.once('dialog', d => d.accept('Resetting the fixture before this run'));
    await staffPage.getByRole('button', { name: 'Revoke access' }).click();
    await expect(staffPage.getByText('Access revoked')).toBeVisible({ timeout: 10000 });
  }

  // ---- journey 1: the account itself, revoked/unprovisioned, sees the setup page, never the staff shell
  const accountPage = await (await browser.newContext()).newPage();
  await signIn(accountPage, process.env.E2E_UNPROVISIONED_EMAIL!, process.env.E2E_UNPROVISIONED_PASSWORD!);
  await expect(accountPage.getByText(/your account isn't set up yet/i)).toBeVisible({ timeout: 10000 });
  await expect(accountPage.getByRole('button', { name: /clients/i })).not.toBeVisible();
  await expect(accountPage.getByText(/no organization membership/i)).not.toBeVisible();
  await accountPage.close();

  // ---- journey 2: staff provisions, revokes, reactivates
  // The reset block above left this REVOKED, not unlinked (revoke never clears clients.user_id) - so the
  // provisioning UI shows "Access revoked" + Reactivate, never the email form. Handle both shapes regardless,
  // since a genuinely first-time run (a fresh fixture, never provisioned at all) WOULD show the email form.
  const emailInput = staffPage.getByPlaceholder("client's email");
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(process.env.E2E_UNPROVISIONED_EMAIL!);
    await staffPage.getByRole('button', { name: 'Provision' }).click();
  } else {
    await staffPage.getByRole('button', { name: 'Reactivate' }).click();
  }
  await expect(staffPage.getByText('Account active')).toBeVisible({ timeout: 10000 });

  // the now-active account reaches the client dashboard, not the setup page
  const accountPage2 = await (await browser.newContext()).newPage();
  await signIn(accountPage2, process.env.E2E_UNPROVISIONED_EMAIL!, process.env.E2E_UNPROVISIONED_PASSWORD!);
  await expect(accountPage2.getByText(/your account isn't set up yet/i)).not.toBeVisible({ timeout: 10000 });
  await expect(accountPage2.getByText('Continue with Google')).not.toBeVisible();
  await accountPage2.close();

  staffPage.once('dialog', d => d.accept('Playwright Stage 3 verification'));
  await staffPage.getByRole('button', { name: 'Revoke access' }).click();
  await expect(staffPage.getByText('Access revoked')).toBeVisible({ timeout: 10000 });

  await staffPage.getByRole('button', { name: 'Reactivate' }).click();
  await expect(staffPage.getByText('Account active')).toBeVisible({ timeout: 10000 });

  // ---- leave it revoked, so the next run starts clean without any extra setup
  staffPage.once('dialog', d => d.accept('End of Stage 3 verification - resetting for the next run'));
  await staffPage.getByRole('button', { name: 'Revoke access' }).click();
  await expect(staffPage.getByText('Access revoked')).toBeVisible({ timeout: 10000 });
});

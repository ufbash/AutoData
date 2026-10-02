import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { signInAsStaff } from '../helpers/auth';

// PROMPT 44 adversarial finding #1 - a listing with no recorded lot state is in NO average, so a hand-entered comp could never be
// counted. Staff classify it on its row; the average then moves. Fixture 'ZZ mixed lot state' (org 4): the unknown listing is
// $18,000 confirmed; sold average $21,000 over 2 sales -> classified Finished it joins (3 sales, $20,000). The test puts it back.
test.setTimeout(120000);
const SUPABASE = 'https://xrotvpuainpfdulhfhtt.supabase.co';
const UNKNOWN = 'd0000000-0000-4000-8000-0000000000fa';

test('staff can classify an unknown-state listing; it joins the average; restored afterwards', async ({ page }) => {
  await signInAsStaff(page);
  const apikeyP = new Promise<string>(r => page.on('request', q => { const k = q.headers()['apikey']; if (k && q.url().includes('/rest/v1/')) r(k); }));
  await page.getByText('ZZ mixed lot state').first().click();
  const apikey = await apikeyP;
  const token = await page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.endsWith('-auth-token'))!; return JSON.parse(localStorage.getItem(k)!).access_token as string; });
  const headers = { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const rows = await (await page.request.get(`${SUPABASE}/rest/v1/research_run_listings?id=eq.${UNKNOWN}&select=sighting_id`, { headers })).json();
  const sightingId = rows[0].sighting_id as string;

  const sold = page.locator('div', { has: page.getByText('Market Research (Sold)') }).filter({ hasText: 'Avg sale price' }).last();
  await expect(sold).toContainText('Avg sale price (2 sales)', { timeout: 20000 });
  const select = page.getByTestId(`classify-lot-state-${UNKNOWN}`);
  await expect(select).toBeVisible();
  try {
    await select.selectOption('finished');
    await expect(sold).toContainText('Avg sale price (3 sales)', { timeout: 20000 });
    await expect(page.getByTestId(`classify-lot-state-${UNKNOWN}`)).toHaveCount(0);

    // charter 5.8: what the source recorded is NOT touched; the choice is a separate, attributed row
    const sRow = (await (await page.request.get(`${SUPABASE}/rest/v1/sightings?id=eq.${sightingId}&select=lot_state`, { headers })).json())[0];
    expect(sRow.lot_state).toBe('unknown');
    const cls = await (await page.request.get(`${SUPABASE}/rest/v1/sighting_lot_state_classifications?sighting_id=eq.${sightingId}&select=lot_state,classified_by,classified_at`, { headers })).json();
    expect(cls).toHaveLength(1);
    expect(cls[0].lot_state).toBe('finished');
    expect(cls[0].classified_by).toBeTruthy();
    expect(cls[0].classified_at).toBeTruthy();
    // append-only: staff cannot rewrite or delete the history through the API
    const del = await page.request.delete(`${SUPABASE}/rest/v1/sighting_lot_state_classifications?sighting_id=eq.${sightingId}`, { headers: { ...headers, Prefer: 'return=representation' } });
    expect(del.ok()).toBe(false); // 42501 permission denied: no DELETE grant
    expect((await del.json()).code).toBe('42501');
  } finally {
    // synthetic fixture reset (org 4 only): the table is append-only for staff, so the test clears its own row with the CLI
    execFileSync('supabase', ['db', 'query', '--linked', `delete from sighting_lot_state_classifications where sighting_id='${sightingId}' and org_id='d0000000-0000-4000-8000-000000000040'`], { stdio: 'ignore' });
  }
});

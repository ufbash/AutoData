// Synthetic proof that the completeness check fires. Run: node --experimental-strip-types scripts/testPaginatedRead.mts
// The check has no live positives by construction (a read is complete or it throws), so it is
// exercised against fake page builders that model the failures it exists to catch.
import { fetchAllVerified, assertComplete, PAGE_SIZE } from '../supabase/functions/_shared/paginatedRead.ts';

const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ i: from + i }));
const server = (n: number) => async (from: number, to: number) => ({ data: rows(Math.max(0, Math.min(to + 1, n) - from), from), error: null });
const counts = (n: number | null, error: string | null = null) => async () => ({ count: n, error: error ? { message: error } : null });

let failed = 0;
const expect = async (name: string, run: () => Promise<unknown>, wantThrow: RegExp | null, wantRows?: number) => {
  let threw: Error | null = null, result: unknown;
  try { result = await run(); } catch (e) { threw = e as Error; }
  const ok = wantThrow ? !!threw && wantThrow.test(threw.message) : !threw && (wantRows === undefined || (result as unknown[]).length === wantRows);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${threw ? `  -> ${threw.message}` : `  -> ${(result as unknown[])?.length ?? ''} rows`}`);
};

await expect('complete read over several pages', () => fetchAllVerified('t', server(2500), counts(2500)), null, 2500);
await expect('exact page boundary (2000 rows)', () => fetchAllVerified('t', server(2 * PAGE_SIZE), counts(2 * PAGE_SIZE)), null, 2 * PAGE_SIZE);
await expect('empty table', () => fetchAllVerified('t', server(0), counts(0)), null, 0);
await expect('server caps at 1000, table has 1740 (the debt #68 case)', () => fetchAllVerified('t', async (f) => ({ data: f === 0 ? rows(1000) : [], error: null }), counts(1740)), /incomplete: loaded 1000 of 1740/);
await expect('pages come back short (500) against 1740', () => fetchAllVerified('t', async (f, t) => ({ data: rows(Math.min(500, Math.max(0, 1740 - f)), f), error: null }), counts(1740)), /incomplete: loaded 500 of 1740/);
await expect('rows added mid-read', () => fetchAllVerified('t', server(1000), counts(1001)), /incomplete/);
await expect('page error propagates', () => fetchAllVerified('t', async () => ({ data: null, error: { message: 'boom' } }), counts(1)), /boom/);
await expect('count error fails loud, never passes silently', () => fetchAllVerified('t', server(3), counts(null, 'count boom')), /Failed to verify t: count boom/);
await expect('assertComplete: equal is silent', async () => { assertComplete('t', 5, 5); return []; }, null);
await expect('assertComplete: short throws', async () => { assertComplete('t', 999, 1740); return []; }, /incomplete/);
process.exit(failed ? 1 : 0);

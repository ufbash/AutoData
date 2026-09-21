// PROMPT 36 Stage 2 - the ONE place a "give me all of them" read is implemented, for the frontend
// (imported from src/services) and for the Edge Functions alike. Moved here from
// truckingRatesService.ts (debt #68) so nothing has to write a second one.
//
// WHY IT EXISTS. PostgREST caps every response at the project's max-rows (1,000) and a client-side
// .limit(2000) cannot raise it. A read that means "all of them" and does not page therefore returns a
// silent shortfall - and a shortfall is indistinguishable from real absence. This is the fifth instance
// of that class the project has found (a column missing from a select list, three raw_payload fields
// read from the wrong path, a gated spec rule, and this). The rule that stops it recurring:
//
//   Any read that means "all rows" MUST either page (fetchAllVerified) or, when it is a small
//   per-parent set that is never paged, verify its own count (assertComplete). Loading fewer rows
//   than the server counts is an ERROR, never a result.
//
// No imports and no Deno/browser APIs, so it runs unchanged in Deno, Vite and Node.

export const PAGE_SIZE = 1000;

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface CountResult {
  count: number | null;
  error: { message: string } | null;
}

/** Pages through a query 1,000 rows at a time. `build` MUST apply a stable order (e.g. .order('id')),
 * or pages can overlap or skip rows. Prefer fetchAllVerified, which also checks the total. */
export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/** Throws unless exactly `count` rows were loaded. `count` is null only when the server did not
 * report one, in which case there is nothing to compare against and the read is accepted. */
export function assertComplete(label: string, loaded: number, count: number | null): void {
  if (count !== null && loaded !== count) {
    throw new Error(`${label} incomplete: loaded ${loaded} of ${count} rows`);
  }
}

/** Pages everything, then checks the total against an exact server-side count taken with the SAME
 * filters (`countQuery`). A shortfall throws instead of returning a partial list. */
export async function fetchAllVerified<T>(
  label: string,
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  countQuery: () => PromiseLike<CountResult>
): Promise<T[]> {
  const rows = await fetchAllPages<T>(build);
  const { count, error } = await countQuery();
  if (error) throw new Error(`Failed to verify ${label}: ${error.message}`);
  assertComplete(label, rows.length, count);
  return rows;
}

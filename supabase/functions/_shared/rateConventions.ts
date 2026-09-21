// PROMPT 37 Phase 1 - the conventions the three rate tables (cost_rates, trucking_rates,
// auction_fee_brackets) share, stated once so a reader cannot get one of them wrong.
//
//  * Dated rows. A rate is valid from effective_from; a superseded rate is CLOSED (effective_to set once),
//    never edited or deleted (PROJECT_CHARTER 5.10, enforced by the database since migration 051).
//  * Source. official_tariff | agent_quote | actual_paid, set by a human, never by a model.
//  * Org scoping. Every row carries org_id and is read through RLS.
//  * Currency (Prompt 28 C1d). A row is either usd with no conversion fields, or in another currency with
//    amount_usd / fx_rate / fx_rate_date frozen when a human confirmed it. A reader that needs dollars asks
//    for `usdAmount` - it never reads a raw value column of a non-USD row as though it were dollars.
//  * Provenance. created_at / created_by; every later write to the row is recorded in rate_change_log.

export interface CurrencyBearingRow {
  currency?: string | null;
  amount_usd?: number | string | null;
}

// The dollar figure for a row whose amount lives in `rawValue`. A USD row is its own value; a non-USD row
// must carry its frozen USD equivalent - if it does not, that is an error, never a silent raw figure.
export function usdAmount(row: CurrencyBearingRow, rawValue: number | string, what = 'rate'): number {
  const currency = (row.currency ?? 'usd').toLowerCase();
  if (currency === 'usd') return Number(rawValue);
  if (row.amount_usd === null || row.amount_usd === undefined) {
    throw new Error(`A ${currency.toUpperCase()} ${what} has no frozen USD equivalent - refusing to read its raw figure as dollars`);
  }
  return Number(row.amount_usd);
}

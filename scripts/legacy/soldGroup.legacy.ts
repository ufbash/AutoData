// PROMPT 29 Stage 2 — the single definition of "the sold population" and "does this listing's
// price count toward the sold-comps average".
//
// Closes debt #47, #48, #49, #50. Before this file, three independent implementations existed:
//
//   1. ResearchRunDetail.tsx's displayGroups  — lot_state !== 'active' && current_bid_usd === null
//   2. ResearchRunDetail.tsx's checklist soldList — lot_state === 'finished' alone   (debt #50)
//   3. public-run/index.ts's own filter        — its own copy of the price predicate (debt #47)
//
// These had already diverged in production, and that divergence WAS the Prompt 25 bug: the
// client share page averaged unconfirmed sales for months while the staff page did not. It is
// the only debt item in this register with a proven record of causing a client-facing error.
//
// THIS FILE IS IMPORTED LITERALLY BY BOTH SIDES - it is not a copy kept in sync by hand:
//   - Deno   (supabase/functions/public-run/index.ts)      via "../_shared/soldGroup.ts"
//   - React  (src/components/ResearchRunDetail.tsx)        via the same relative path
// It therefore contains no imports and nothing runtime-specific, so both toolchains can parse
// it unchanged. A folder under supabase/functions/ prefixed with "_" is not deployed as a
// function of its own; it is bundled into whichever functions import it.

/** A listing's shape, reduced to only the fields these rules actually read. */
export interface SoldGroupListing {
  lot_state: string | null;
  current_bid_usd: number | null;
  price_usd: number | null;
  sale_confirmed?: boolean | null;
  logged_via: string | null;
  source_platform: string | null;
}

export type RunType = 'sold_comps' | 'active_listings' | 'mixed';

// --- debt #48: sale_confirmed's null is three different facts, not one ---
//
// Carrying this distinction in reviewers' heads is what let it get mis-recorded once already
// (PLAN_TRACKER.md §4.12 claimed IAAI's sale_confirmed "stays false"; it is always null).
// Naming the cases makes the difference checkable instead of remembered.
export type SaleConfirmation =
  /** sale_confirmed = true. A sales-history mechanism ran and said it sold. */
  | { kind: 'confirmed_sold' }
  /** sale_confirmed = false. A mechanism ran and said it did NOT sell (reserve not met). */
  | { kind: 'confirmed_not_sold' }
  /**
   * null, and no mechanism could ever have set it: this entry method does not parse a
   * sales-history panel at all. Absence here is structural, not doubt - so these rows are
   * NOT excluded from the average (AGENTS.md §4.1, absence is not violation).
   */
  | { kind: 'no_mechanism_for_entry_method'; loggedVia: string }
  /**
   * null, and the platform itself has no sales-history mechanism - permanently. Copart
   * (PLAN_TRACKER.md B2, retired as not-buildable) and IAAI (Prompt 22: no analogous panel).
   * "Unconfirmable by platform", not "suspicious" - but still not a confirmed sale, so it is
   * excluded from the average exactly as before. Distinguished here so the UI can eventually
   * word it differently without a second predicate being invented to do it.
   */
  | { kind: 'platform_has_no_mechanism'; platform: string }
  /**
   * null from a source that DOES have a mechanism (bid.cars via the extension): the panel was
   * checked and did not yield a determinate status. Genuinely inconclusive.
   */
  | { kind: 'inconclusive' };

/**
 * Entry methods that never parse a sales-history panel, so their null is structural.
 *
 * debt #49: 'api_import' is included. It is the fourth value of logged_via_enum (migration
 * 006) and has the same structural property as manual_entry/ai_vision, but was missing from
 * the original carve-out - a landmine for whenever an import path is actually built. Verified
 * 11 Sep 2026 that zero api_import sightings exist, so adding it changes no live figure today.
 */
const ENTRY_METHODS_WITHOUT_MECHANISM = ['manual_entry', 'ai_vision', 'api_import'];

/** Platforms that expose no sales-history data at all, permanently. */
const PLATFORMS_WITHOUT_MECHANISM = ['copart', 'iaai'];

export function classifySaleConfirmation(listing: SoldGroupListing): SaleConfirmation {
  if (listing.sale_confirmed === true) return { kind: 'confirmed_sold' };
  if (listing.sale_confirmed === false) return { kind: 'confirmed_not_sold' };

  const loggedVia = listing.logged_via ?? '';
  if (ENTRY_METHODS_WITHOUT_MECHANISM.includes(loggedVia)) {
    return { kind: 'no_mechanism_for_entry_method', loggedVia };
  }

  const platform = (listing.source_platform ?? '').toLowerCase();
  if (PLATFORMS_WITHOUT_MECHANISM.includes(platform)) {
    return { kind: 'platform_has_no_mechanism', platform };
  }

  return { kind: 'inconclusive' };
}

/**
 * Does this listing's price count toward the sold-comps average and its sample size?
 *
 * Byte-identical in effect to the predicate it replaces (ResearchRunDetail.tsx's getStats and
 * public-run's mirror of it): only 'confirmed_sold' and 'no_mechanism_for_entry_method' count.
 * 'platform_has_no_mechanism' and 'inconclusive' were both previously the same single "null
 * from a scraped source" branch and are both still excluded - splitting them changes what can
 * be SAID about a row, never whether it counts.
 */
export function countsTowardSoldAverage(listing: SoldGroupListing): boolean {
  const confirmation = classifySaleConfirmation(listing);
  return confirmation.kind === 'confirmed_sold' || confirmation.kind === 'no_mechanism_for_entry_method';
}

/**
 * Is this listing part of the sold population for a run of this type?
 *
 * For 'mixed' this is the canonical predicate - the one that governs the average actually
 * displayed and the client-facing page, i.e. the two surfaces whose divergence caused the real
 * Prompt 25 bug. The checklist's old `lot_state === 'finished'` variant (debt #50) now routes
 * through here too; verified 11 Sep 2026 that both predicates select identical rows on every
 * live mixed run, so unifying moved no figure.
 */
export function isInSoldPopulation(listing: SoldGroupListing, runType: RunType): boolean {
  if (runType === 'sold_comps') return true;
  if (runType === 'active_listings') return false;
  return listing.lot_state !== 'active' && listing.current_bid_usd === null;
}

/** Convenience: in the sold population AND its price counts. */
export function countsInSoldAverageForRun(listing: SoldGroupListing, runType: RunType): boolean {
  return isInSoldPopulation(listing, runType) && listing.price_usd !== null && countsTowardSoldAverage(listing);
}

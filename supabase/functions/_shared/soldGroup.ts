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
  /**
   * True when this vehicle (VIN/asset) has sold at auction more than once (auction_history: 2+ distinct 'Sold'
   * events). Derived by the caller from auction_history - optional so a caller that cannot know says nothing, and
   * absence is not violation (AGENTS.md S6): only an explicit `true` changes anything.
   */
  repeat_sale?: boolean | null;
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
  // A vehicle that sold twice (crashed, repaired, resold) is not a like-for-like comp: its price reflects a repair
  // history. Excluded from the average and the count on BOTH sides, because both import this one predicate.
  // (Decided by Bashir 1 Oct 2026: CRITICAL flag AND excluded from the average.)
  if (listing.repeat_sale === true) return false;
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
  // PROJECT_CHARTER 5.7 as extended, applied STRICTLY on every run type (Bashir 1 Oct 2026, Prompt 44 Stage 1a): an unknown
  // lot state belongs to NO population, whatever the run's type. Shown and labelled, in no average and no count.
  if (lotStateUnknown(listing)) return false;
  if (runType === 'sold_comps') return true;
  if (runType === 'active_listings') return false;
  return listing.lot_state !== 'active' && listing.current_bid_usd === null;
}

/** lot_state is null or the literal 'unknown': the capture could not say whether the lot is live or over. */
export function lotStateUnknown(listing: { lot_state: string | null }): boolean {
  return listing.lot_state === null || listing.lot_state === undefined || listing.lot_state === 'unknown';
}

/**
 * Is this listing in the ACTIVE (client-options) population for a run of this type?
 *  - active_listings run: every listing whose lot state is KNOWN (not 'finished' is enforced at attach time). A listing
 *    with an unknown lot state is in no population - but the RULES module still risk-checks it as a precaution, because
 *    'unknown' is not 'safe' (riskRules.ts).
 *  - sold_comps run: none.
 *  - mixed run: lot state decides, and ONLY a lot known to be 'active' is active - regardless of whether a bid
 *    exists (AGENTS.md 4.1: current_bid_usd is not a liveness test; the old live-group filter required a bid, so a
 *    live lot with no bids yet belonged to no group while the risk checks still treated it as active).
 */
export function isInActivePopulation(listing: SoldGroupListing, runType: RunType): boolean {
  if (lotStateUnknown(listing)) return false; // strict, as above
  if (runType === 'active_listings') return true;
  if (runType === 'sold_comps') return false;
  return listing.lot_state === 'active';
}

/** 'unknown' = lot state unknown (mixed run); 'none' = known state but in neither group (e.g. a finished lot that only
 *  carries a bid, which 4.1 says is not a sale). Kept apart so the UI never labels a known lot 'lot state unknown'. */
export type Population = 'sold' | 'active' | 'unknown' | 'none';
/** The one answer to "which group is this listing in", for the staff page, the rules module and public-run alike. */
export function populationOf(listing: SoldGroupListing, runType: RunType): Population {
  if (isInSoldPopulation(listing, runType)) return 'sold';
  if (isInActivePopulation(listing, runType)) return 'active';
  return lotStateUnknown(listing) ? 'unknown' : 'none';
}

/** Convenience: in the sold population AND its price counts. */
export function countsInSoldAverageForRun(listing: SoldGroupListing, runType: RunType): boolean {
  return isInSoldPopulation(listing, runType) && listing.price_usd !== null && countsTowardSoldAverage(listing);
}

/**
 * ATTACH-time eligibility: may this sighting be added to a run of this type? (PROMPT 44 Stage 1e - this used to be a
 * separate copy inside researchService.addListingToRun, the last place outside this file that decided "sold" and "active".)
 *
 * An UNKNOWN lot state is allowed into ANY run: it lands labelled "Lot state unknown" and in no average/count (charter
 * 5.7 as extended). Blocking it would hide a car staff need to classify (charter 5.2) - the rules below only refuse what is
 * positively the wrong kind (a live lot for a market-research run; a finished lot for a client-options run).
 */
export interface AttachCandidate {
  source_platform: string | null;
  lot_state: string | null;
  price_usd: number | null;
  current_bid_usd: number | null;
  sale_confirmed?: boolean | null;
}
export function attachEligibility(c: AttachCandidate, runType: RunType): { ok: true } | { ok: false; message: string } {
  const has = (v: unknown) => v !== null && v !== undefined;
  // An UNKNOWN lot state is allowed into ANY run, whatever else is missing (no price, a bid, a non-auction source): it lands
  // labelled and in no average, never refused (the adversarial verifier found these refusals contradicting the doctrine).
  if (lotStateUnknown(c)) return { ok: true };
  if (runType === 'sold_comps') {
    // a price, no live bid, a lot not known to be live, and a sale not known to have failed
    const ok = has(c.price_usd) && !has(c.current_bid_usd) && c.lot_state !== 'active' && c.sale_confirmed !== false;
    return ok ? { ok: true } : { ok: false, message: 'Only sold or settled listings can be added to a market-research run.' };
  }
  if (runType === 'active_listings') {
    const ok = ['copart', 'bidcars', 'iaai'].includes((c.source_platform ?? '').toLowerCase()) && c.lot_state !== 'finished';
    return ok ? { ok: true } : { ok: false, message: 'Only live auction listings can be added to a client-options run.' };
  }
  // mixed: a sold comp OR a live auction lot (what the Add Captures modal has always offered); anything else is neither
  const sold = attachEligibility(c, 'sold_comps').ok;
  const active = attachEligibility(c, 'active_listings').ok;
  return sold || active ? { ok: true } : { ok: false, message: 'That listing is neither a sold comp nor a live auction lot.' };
}



/**
 * PROMPT 44 / charter 5.8 - store what the source said, derive at read. A staff classification of a listing whose captured
 * lot_state is unknown lives in its own attributed table (sighting_lot_state_classifications) and is NEVER written into
 * sightings.lot_state. The effective state is the captured one when the source recorded it (active/finished), otherwise the
 * latest staff classification, otherwise unknown. One function, so staff page, attach and public-run cannot disagree.
 */
export interface LotStateClassification { lot_state: string; classified_at: string }
export function effectiveLotState(
  captured: string | null | undefined,
  classifications: LotStateClassification[] | undefined,
): { lot_state: string | null; classified: boolean } {
  if (captured === 'active' || captured === 'finished') return { lot_state: captured, classified: false };
  const latest = (classifications ?? [])
    .filter(c => c.lot_state === 'active' || c.lot_state === 'finished')
    .sort((a, b) => (a.classified_at < b.classified_at ? 1 : a.classified_at > b.classified_at ? -1 : 0))[0];
  return latest ? { lot_state: latest.lot_state, classified: true } : { lot_state: captured ?? null, classified: false };
}

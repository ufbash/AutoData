// Comparison-time vocabulary normalisation for spec-match rules (ResearchRunDetail.tsx).
//
// PROJECT_CHARTER.md §5.8: raw at capture, classify at read. This module never touches a
// stored value - it only decides whether two strings that are already stored describe the
// same thing, for the duration of one comparison.
//
// This is an early, narrow slice of the E2 standardisation resolver SCHEMA.md §4 and
// PLAN_TRACKER.md's E1-E5 pipeline anticipate (E1 harvest -> E2 standardisation -> E3 stats ->
// E4 public MVP -> E5 analytics) - built here only for spec-match comparison, not a general
// classifier. If E2 is ever built properly, this should fold into it rather than be rebuilt
// separately alongside it.
//
// An unmapped value is not a match and not an error - it compares as itself. Never invent a
// mapping at runtime; only the groups below are ever treated as synonyms.

type SynonymGroup = string[];

// Built from the live distinct values queried in Prompt 16 Phase 1 (assets.fuel,
// client_briefs.fuel_type), plus near-certain pairs added proactively because the intake form
// already offers them as options even though no live row has one yet (noted per group).
const FUEL_GROUPS: SynonymGroup[] = [
  ['gas', 'gasoline', 'petrol'],       // live: Gas, Gasoline (assets) = petrol (briefs)
  ['diesel'],                          // live on both sides already, no synonym needed
  ['electric'],                        // live in assets.fuel; kept distinct from hybrid
  ['hybrid'],                          // not yet live anywhere - intake form offers it; must not collapse into petrol
  ['flexible fuel'],                   // live in assets.fuel; genuinely distinct, not petrol - left unmapped to petrol deliberately
];

// Built from live assets.exterior_color. No synonym pairs observed in the live 13 colours -
// they are genuinely distinct shades. Grey/Gray added proactively (British spelling never
// appeared but is a near-certain future value).
const COLOUR_GROUPS: SynonymGroup[] = [
  ['gray', 'grey'],
];

// Built from live assets.transmission (Automatic, Manual). Auto/Automatic added proactively -
// not yet observed in either table, but a plausible listing-source abbreviation.
const TRANSMISSION_GROUPS: SynonymGroup[] = [
  ['automatic', 'auto'],
  ['manual'],
];

function canonicalToken(raw: string, groups: SynonymGroup[]): string {
  const v = raw.trim().toLowerCase();
  for (const group of groups) {
    if (group.includes(v)) return group[0];
  }
  return v; // unmapped - compares as itself
}

/**
 * True if `listingValue` and `briefValue` describe the same thing for this vocabulary,
 * preserving the existing substring-containment behaviour (e.g. a "Blue" preference still
 * matches a "Dark blue" listing) - normalisation runs first so wording differences
 * (Gas/Petrol, Gray/Grey, Automatic/Auto) no longer defeat that containment check.
 */
function normalisedIncludes(listingValue: string, briefValue: string, groups: SynonymGroup[]): boolean {
  const listing = canonicalToken(listingValue, groups);
  const brief = canonicalToken(briefValue, groups);
  return listing.includes(brief);
}

export function fuelMatches(listingFuel: string, briefFuelType: string): boolean {
  return normalisedIncludes(listingFuel, briefFuelType, FUEL_GROUPS);
}

export function colourMatches(listingColour: string, briefColour: string): boolean {
  return normalisedIncludes(listingColour, briefColour, COLOUR_GROUPS);
}

export function transmissionMatches(listingTransmission: string, briefTransmission: string): boolean {
  return normalisedIncludes(listingTransmission, briefTransmission, TRANSMISSION_GROUPS);
}

// --- Negative and open preferences (Prompt 16 Phase 3) ---
//
// A brief's free-text preference field can mean three different things, and conflating them is
// what produced "colour differs (Gray vs Any, except White requested)" firing on every listing
// forever: the string "Any, except White" was being compared for equality/containment against
// each listing's colour, which no colour will ever satisfy.

export type ParsedPreference =
  | { kind: 'none' }
  | { kind: 'required'; value: string }
  | { kind: 'exclude'; value: string };

const NONE_PHRASES = ['any', 'either', 'no preference', 'none'];

// Ordered narrowest-shape-first. Built from the one live shape actually observed
// ("Any, except White") plus the obvious variants named in the prompt (apart from, not, no).
const EXCLUSION_PATTERNS: RegExp[] = [
  /^any(?:thing)?,?\s*except\s+(.+)$/i,
  /^any(?:thing)?,?\s*apart from\s+(.+)$/i,
  /^not\s+(.+)$/i,
  /^no\s+(.+)$/i,
];

// If a preference contains one of these words but didn't cleanly match a pattern above, it is
// an attempted exclusion this parser doesn't understand - fall back to "no rule", never to
// treating the whole garbled phrase as a hard required value (that recreates the exact bug
// this module exists to fix).
const EXCLUSION_SIGNAL = /\b(except|apart from|but not)\b/i;

/**
 * Classifies a brief's free-text preference field. Never throws, never guesses a mapping -
 * an unparseable exclusion attempt fails closed to `{ kind: 'none' }` (no rule fires), which is
 * the safe direction: a missed flag is recoverable, a permanent false flag is not.
 */
export function parsePreference(raw: string | null | undefined): ParsedPreference {
  if (raw == null) return { kind: 'none' };
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'none' };
  if (NONE_PHRASES.includes(trimmed.toLowerCase())) return { kind: 'none' };

  for (const pattern of EXCLUSION_PATTERNS) {
    const m = trimmed.match(pattern);
    if (m && m[1] && m[1].trim()) {
      return { kind: 'exclude', value: m[1].trim() };
    }
  }

  if (EXCLUSION_SIGNAL.test(trimmed)) {
    return { kind: 'none' };
  }

  return { kind: 'required', value: trimmed };
}

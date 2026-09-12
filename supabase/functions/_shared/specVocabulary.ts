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

// --- Trim: the class-letter prefix (Prompt 27 Phase 2B) ---
//
// Real bug, found live: on a Mercedes E-Class brief, listings captured as trim "350" and
// "350 4MATIC" both flagged WARN against a brief trim of "E350" - they are the same trim.
// Mercedes (and other German makes) commonly omit the class letter when a listing source
// writes out the trim on its own, since the model field ("E-Class") already carries it. The
// existing containment check (`listing.includes(brief)`) never had a chance: "350" plainly
// does not contain "E350" as a substring.
//
// Not a vocabulary-group problem like Gas/Petrol - there's no fixed synonym list, the letter
// itself is the class marker and it can legitimately be absent on either side. Derived from
// the BRIEF's own model (the class the client actually asked for), never hardcoded to
// "Mercedes" as a string - the same "<Letter>-Class" shape covers C/E/S-Class, and named
// SUV/coupe lines (GLE/GLC/GLS/GLA/GLB/CLA/CLS) are matched directly since their model name
// already IS the class letters, with no separate "Class" suffix to parse off of.
const NAMED_CLASS_MODELS = ['GLE', 'GLC', 'GLS', 'GLA', 'GLB', 'CLA', 'CLS', 'SLC', 'SLK'];

function extractClassLetter(model: string | null | undefined): string | null {
  if (!model) return null;
  const trimmed = model.trim();
  const classSuffixMatch = trimmed.match(/^([A-Za-z])[\s-]*Class\b/i);
  if (classSuffixMatch) return classSuffixMatch[1].toUpperCase();
  const named = NAMED_CLASS_MODELS.find(n => new RegExp(`^${n}\\b`, 'i').test(trimmed));
  return named ?? null;
}

// Strips the class letter only when it directly prefixes a number ("E350" -> "350"), so a
// genuinely different trim word starting with the same letter ("Executive") is never touched -
// it will never match `^<Letter>\d`.
function stripClassLetterPrefix(trim: string, classLetter: string | null): string {
  if (!classLetter) return trim;
  return trim.replace(new RegExp(`^${classLetter}(\\d)`, 'i'), '$1');
}

/**
 * True if `listingTrim` and `briefTrim` describe the same trim once a shared class-letter
 * prefix (derived from the brief's own model, e.g. "E-Class" -> "E") is normalised off both
 * sides. Preserves the existing containment behaviour otherwise (a listing's drivetrain
 * qualifier, e.g. "4MATIC", still matches a brief with none) and is a complete no-op - byte
 * for byte the old behaviour - whenever `briefModel` doesn't resolve to a class letter at all.
 */
export function trimMatches(listingTrim: string, briefTrim: string, briefModel?: string | null): boolean {
  const classLetter = extractClassLetter(briefModel);
  const listing = stripClassLetterPrefix(listingTrim.trim(), classLetter).toLowerCase();
  const brief = stripClassLetterPrefix(briefTrim.trim(), classLetter).toLowerCase();
  return listing.includes(brief);
}

// --- Vehicle identity canonicalization, for fingerprint computation only (Prompt 30 Stage 2,
// debt #46) ---
//
// PROJECT_CHARTER.md §5.8: raw at capture, classify at read. This function, like every other
// one in this file, never touches a stored value - `canonicalizeForFingerprint`'s output feeds
// ONLY into generate_fingerprint's p_model/p_trim arguments when computing a VIN-less identity
// hash. The real captured make/model/trim written to `assets`/`sightings` are never mutated.
//
// Two real cases this closes, found live during Prompt 29's own verification:
// - Mercedes lot 66964556: Copart wrote model "E 250 Bluetec" (trim folded into model, no
//   separate trim field, no hyphen); bid.cars wrote model "E-class" + trim "250 BLUETEC"
//   (properly split). Two different VIN-less fingerprints for the identical physical car.
// - Toyota Yaris lot 62572576: Copart wrote model "Yaris IA BASE" (Toyota's real "iA" submodel
//   marker AND the trim both folded into the model string); bid.cars wrote model "Yaris" + trim
//   "BASE" (the "iA" marker dropped entirely on capture - a bid.cars data-completeness gap this
//   normaliser works around for this shape, not a naming convention it can independently
//   rediscover).
//
// Extends the class-letter concept above rather than building a second, divergent normaliser
// (exactly the failure Prompt 29 Stage 2 spent its own time unwinding for the sold-group
// definition). `extractClassLetterForIdentity` below additionally recognises a bare
// "<Letter> <number>" model (no "Class" word, no hyphen - "E 250" for what bid.cars separately
// spells "E-Class"/"250") - a second, very common way Copart-style listings write a Mercedes
// class model. This wider recognition is used for identity canonicalization ONLY:
// `extractClassLetter`/`trimMatches` above keep their exact original, narrower recognition,
// unchanged - a brief's own model field has never been observed in the bare-letter-number
// shape, and widening spec-match comparison was neither asked for here nor tested.
function extractClassLetterForIdentity(model: string): string | null {
  const classSuffixMatch = model.match(/^([A-Za-z])[\s-]*Class\b/i);
  if (classSuffixMatch) return classSuffixMatch[1].toUpperCase();
  const bareLetterNumber = model.match(/^([A-Za-z])\s+\d/);
  if (bareLetterNumber) return bareLetterNumber[1].toUpperCase();
  const named = NAMED_CLASS_MODELS.find(n => new RegExp(`^${n}\\b`, 'i').test(model));
  return named ?? null;
}

// A short (<= 2 letter) alphabetic token immediately following the recognised base model name is
// treated as a submodel/badge marker rather than the trim itself (e.g. Toyota's real "Yaris iA"
// submodel code) ONLY when at least one more token follows it. When it's the last remaining
// token, it is the only distinguishing information this capture carries, and dropping it would
// risk fusing two genuinely different vehicles - Prompt 30 Stage 2's own named hazard - so it
// survives as the canonical trim instead. This is what keeps a bare "Yaris iA" (nothing else)
// from colliding with a bare "Yaris" (no submodel, no trim) - proven in
// scratchpad/verify_vehicleIdentity.ts, not asserted.
const SUBMODEL_QUALIFIER_MAX_LEN = 2;

export interface CanonicalVehicleIdentity {
  canonicalModel: string;
  canonicalTrim: string;
}

/**
 * Canonicalizes model/trim for FINGERPRINT COMPUTATION ONLY - never for display, never written
 * back to a stored field. Two captures of the same physical car that disagree only in how a
 * source folds trim/submodel information into the model string produce the same canonical
 * (model, trim) pair, and therefore the same VIN-less fingerprint; two captures of genuinely
 * different vehicles do not (see the submodel-qualifier rule above for how that's protected).
 */
export function canonicalizeForFingerprint(
  model: string | null | undefined,
  trim: string | null | undefined
): CanonicalVehicleIdentity {
  const rawModel = (model ?? '').trim();
  const rawTrim = (trim ?? '').trim();

  const classLetter = rawModel ? extractClassLetterForIdentity(rawModel) : null;

  let canonicalModel: string;
  let overflowFromModel: string[];

  if (classLetter) {
    canonicalModel = classLetter;
    const withoutClassSuffix = rawModel.replace(/^([A-Za-z])[\s-]*Class\b/i, '').trim();
    const remainder = withoutClassSuffix !== rawModel
      ? withoutClassSuffix
      : rawModel.replace(/^[A-Za-z]\s+/, '').trim();
    overflowFromModel = remainder.length > 0 ? remainder.split(/\s+/) : [];
  } else {
    const tokens = rawModel.length > 0 ? rawModel.split(/\s+/) : [];
    canonicalModel = tokens[0] ?? '';
    overflowFromModel = tokens.slice(1);
  }

  let canonicalTrim: string;
  if (rawTrim.length > 0) {
    canonicalTrim = rawTrim;
  } else if (
    overflowFromModel.length > 1 &&
    overflowFromModel[0].length <= SUBMODEL_QUALIFIER_MAX_LEN &&
    /^[A-Za-z]+$/.test(overflowFromModel[0])
  ) {
    canonicalTrim = overflowFromModel.slice(1).join(' ');
  } else {
    canonicalTrim = overflowFromModel.join(' ');
  }

  return {
    canonicalModel: canonicalModel.toLowerCase(),
    canonicalTrim: canonicalTrim.toLowerCase(),
  };
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

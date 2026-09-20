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

// PROMPT 33 Stage 1 (vehicle reference vocabulary) - the family/badge bridge.
//
// This isn't a BMW-specific problem - it's the same taxonomy mismatch that produced Prompt 27's
// four E350 false WARNs (E350/E250 vs E-Class), just visible again one level up. A client's brief
// names a FAMILY ("5 Series", "E-Class"); an auction platform and NHTSA's own model catalog both
// deal in BADGES ("535i", "E 250 Bluetec"). Those are two real levels of one taxonomy - pretending
// there is only one is what each of these symptoms has been.
//
// NHTSA's badge-level models (vehicle_reference_models, seeded above) are correct AS BADGES - a
// decoded VIN genuinely is a "535i", not a "5 Series". This table is the deliberate, curated
// bridge: when a brief specifies a FAMILY, it must match any badge in that family; when a brief
// specifies a badge directly ("535i"), it must NOT match a different badge in the same family
// ("520d") - family membership only expands a family-level value, it never loosens an
// already-specific one.
//
// Confirmed via one real VIN decode (WBA5B3C5XGD549035, Stage 2 pre-flight): DecodeVinValues'
// `Series` field returned '5-series' for a decoded `Model` of '535i' - i.e. NHTSA's own decode
// output already knows this distinction and could seed this table automatically once Stage 2's
// decode cache has enough real coverage. Curated by hand for now, grounded in the real BMW badges
// NHTSA returns for the exact years this project has actually captured (2012-2016, 2019, 2022,
// 2024-2025) - not a general BMW taxonomy, only the families actually in production data (19
// real "5 Series" assets, 1 "3 Series", 1 "4 Series"). A family with no curated members here
// falls through to free text, same as `Avatr` - this project does not build a taxonomy for
// manufacturers or families it has never traded.
const MODEL_FAMILIES: Record<string, string[]> = {
  '3 series': ['320i', '328d', '328i', '330e', '330i', '335', '335i', '335is', '340i', 'm3', 'm340i', 'activehybrid 3'],
  '4 series': ['428i', '430i', '435i', '440i', 'm4', 'm440i'],
  '5 series': ['528i', '528xi', '530e', '530i', '535d', '535i', '540d', '540i', '550e', '550i', 'm5', 'm550i', 'activehybrid 5'],
};

/** True if `familyValue` (e.g. a brief's "5 Series") is curated to include `badgeValue` (e.g. a
 * decoded "535i"). Returns false for any family not explicitly curated above - never guesses. */
export function familyIncludesBadge(familyValue: string, badgeValue: string): boolean {
  const family = MODEL_FAMILIES[familyValue.trim().toLowerCase()];
  if (!family) return false;
  return family.includes(badgeValue.trim().toLowerCase());
}

const alnumOnly = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** True if `familyValue` (a brief's own value, e.g. "5 Series") names the same family as
 * `decodedSeries` (vPIC's own `Series` field, e.g. "5-series") once punctuation/casing/spacing
 * differences are normalised away. This is preferred over the hand-curated `MODEL_FAMILIES` table
 * whenever a decode is available: vPIC's `Series` is NHTSA's own authoritative per-VIN answer,
 * not a table a human has to remember to update when next year's badges ship. See
 * `familyIncludesBadge` for the fallback used when a decode has no Series value at all. */
export function familyMatchesDecodedSeries(familyValue: string, decodedSeries: string): boolean {
  return alnumOnly(familyValue) === alnumOnly(decodedSeries);
}

// PROMPT 33 Stage 1 (vehicle reference vocabulary) - explicit make aliases, listed not guessed.
// "ALFA" (3 real assets) does not exact-match NHTSA's official "ALFA ROMEO" - not a data gap
// (NHTSA has the make, Make_ID 493, already seeded into vehicle_reference_makes), just an
// informal abbreviation in a real capture. Deliberately an explicit map, not prefix/substring
// matching: Bashir's own correction was that string-proximity matching is exactly how false
// identity matches get made (the class this project's fingerprinting bugs already come from,
// PLAN_TRACKER.md debt #46) - an alias here must be added by a human who looked at it, checkable
// by eye, never inferred at runtime.
const MAKE_ALIASES: Record<string, string> = {
  'alfa': 'ALFA ROMEO',
  // Prompt 35 - one real brief ("Mercedes" / "E Class") uses the short form; NHTSA's make is
  // MERCEDES-BENZ. Added by Bashir's decision after looking at the row, 20 Sep 2026.
  'mercedes': 'MERCEDES-BENZ',
};

export function resolveMakeAlias(raw: string): string {
  const key = raw.trim().toLowerCase();
  return MAKE_ALIASES[key] ?? raw;
}

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
// PROMPT 33 Stage 3 - decoded-value parameters are optional and additive. When the listing's own
// VIN has been decoded (Stage 2) and vPIC returned a real Model/Trim (not blank - Stage 2's own
// documented limitation, never assumed populated), decoded values are compared instead of the
// platform's raw trim string: a decoded "535i" is a firmer fact than whatever a scraper happened
// to capture. Whenever decoded data is absent for either side, this falls through to the exact
// original raw-string comparison, unchanged - "extend the existing normaliser, do not build a
// second one."
export function trimMatches(
  listingTrim: string,
  briefTrim: string,
  briefModel?: string | null,
  decodedListingModel?: string | null,
  decodedListingTrim?: string | null,
  decodedListingSeries?: string | null
): boolean {
  if (decodedListingModel) {
    const briefModelValue = (briefModel || '').trim();
    // Preference order, deliberate: vPIC's own decoded `Series` (authoritative per-VIN, updates
    // itself as NHTSA's own data does) beats the hand-curated MODEL_FAMILIES table (a fallback
    // for when a decode has no Series value, not the primary source of truth - a curated table
    // nobody updates when next year's badges ship would otherwise become a fourth, silently
    // stale normaliser).
    if (briefModelValue && decodedListingSeries && familyMatchesDecodedSeries(briefModelValue, decodedListingSeries)) return true;
    if (briefModelValue && !decodedListingSeries && familyIncludesBadge(briefModelValue, decodedListingModel)) return true;

    const briefTrimLower = briefTrim.trim().toLowerCase();
    const decodedModelLower = decodedListingModel.trim().toLowerCase();
    if (briefTrimLower && decodedModelLower.includes(briefTrimLower)) return true;
    if (decodedListingTrim && briefTrimLower && decodedListingTrim.trim().toLowerCase().includes(briefTrimLower)) return true;

    // Decoded data was available and none of the above matched - an explicit no-match on the
    // firmer decoded fact, not a fall-through to the raw-string path (which could produce a
    // false match the decode already ruled out, e.g. brief "535i" vs a decoded "520d").
    return false;
  }

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

// --- Title status classification (Prompt 31 Stage 3, debt #58) ---
//
// Until this stage, two independent classifiers existed: `bidHeadroomService.ts`'s
// `classifyTitleStatus` (binary clean|non_clean|unknown, deliberately conservative - built to
// pick a fee-bracket row, where a wrong guess in EITHER direction produces a wrong dollar
// figure) and `ResearchRunDetail.tsx`'s inline 4-way spec-match logic (permissive, built to
// avoid nagging false-alarm WARNs on a brief's titles_accepted preference). They disagreed on
// real, live data - `"Certificate of title (WV)"` classified as clean-equivalent by the
// permissive one, unknown by the conservative one - found and registered as debt #58 by Prompt
// 30's normalizer audit rather than silently discovered later.
//
// These are not measuring different things; they encode different tolerances for the SAME
// thing, and the costs are asymmetric (DECISIONS.md's own reasoning, restated here because it's
// what this classifier is built to enforce): a clean car wrongly classed salvage produces a
// false block - visible, annoying, overridable. A salvage car wrongly classed clean passes
// spec rule 5's titles_accepted gate and can reach a client as a purchase option - a title
// problem is a customs-seizure risk (PROJECT_CHARTER.md §6), not visible until it's too late,
// and not the client's to have chosen. One classifier, taking the MORE SEVERE reading for
// eligibility/blocking purposes, is the only correct resolution - not an average of the two,
// not "pick whichever recognises more text."
//
// A generic "Certificate of Title" (no "Clean"/"Salvage"/etc qualifier) is exactly the case
// this severity choice bites on: it is the LEGAL DOCUMENT NAME for any title, branded or not -
// salvage titles are also, formally, a "certificate of title". Treating the bare phrase as a
// clean signal (the old permissive behaviour) was not a looser tolerance, it was reading a
// generic term as if it were specific. This classifier does not. Blast radius measured against
// real data before this was built: 19 real sightings carry a bare "Certificate of [Vehicle]
// Title" value; 4 of 5 real briefs with `titles_accepted` set include 'Clean'; but the two never
// currently intersect inside an evaluated `active_listings`/`mixed` run with that exact brief
// (the one run where a bare-cert-of-title listing sits alongside a clean-accepting brief is
// `sold_comps`, where spec rule 5 never fires at all - see below) - a real disagreement with,
// today, zero live-blocking impact, not a theoretical one.
export type TitleStatusClass = 'clean' | 'salvage' | 'rebuilt' | 'non_repairable' | 'unknown';

export interface TitleClassification {
  status: TitleStatusClass;
  // Flood is tracked independently of `status`, never folded into it or into general damage
  // classification (PROJECT_CHARTER.md §6) - a flood-branded title is never treated as clean
  // regardless of what other language ("clean title", "certificate of title") appears alongside
  // it, and a caller that cares about flood specifically (vs. just clean/non-clean) can check
  // this flag without it being silently absorbed into "salvage".
  isFloodBranded: boolean;
}

// Deliberately narrow: only an EXPLICIT clean-title phrase counts. A bare "Certificate of
// Title" with no qualifier does not - see the module comment above for why that specific
// generic phrase is the real hazard this severity choice exists to close.
const TITLE_CLEAN_INDICATORS = /\bclean title\b|\bclear\b/i;
const TITLE_NON_REPAIRABLE_INDICATORS = /\bnon[- ]repairable\b|\bjunk\b|\bparts only\b|\bdestruction\b/i;
const TITLE_SALVAGE_INDICATORS = /\bsalvage\b|\bcert(?:ificate)?\s*of\s*salvage\b/i;
const TITLE_REBUILT_INDICATORS = /\brebuilt\b|\breconstruct(?:ed)?\b|reconstrctd/i;
const TITLE_FLOOD_INDICATORS = /\bflood\b/i;

/**
 * The one title-status classifier - both former call sites (the auction-fee bracket lookup and
 * spec rule 5's titles_accepted check) resolve through this. Unrecognised or absent text
 * classifies as 'unknown', never guessed toward 'clean' - the severe reading for anything that
 * isn't unambiguous. Order matters: non_repairable/salvage/rebuilt are checked before clean, so
 * a string carrying both a branding word and the word "title" (nearly all of them do) never
 * accidentally matches on a coincidental clean-adjacent word first.
 */
export function classifyTitleStatus(titleType: string | null | undefined): TitleClassification {
  const isFloodBranded = !!titleType && TITLE_FLOOD_INDICATORS.test(titleType);
  if (!titleType || !titleType.trim()) return { status: 'unknown', isFloodBranded };
  if (TITLE_NON_REPAIRABLE_INDICATORS.test(titleType)) return { status: 'non_repairable', isFloodBranded };
  if (TITLE_SALVAGE_INDICATORS.test(titleType)) return { status: 'salvage', isFloodBranded };
  if (TITLE_REBUILT_INDICATORS.test(titleType)) return { status: 'rebuilt', isFloodBranded };
  if (TITLE_CLEAN_INDICATORS.test(titleType)) return { status: 'clean', isFloodBranded };
  return { status: 'unknown', isFloodBranded };
}

/**
 * Spec rule 5's own question: does this listing's title satisfy a brief's `titles_accepted`
 * list? Severe reading applied here, not inside the classifier itself, so the classifier stays
 * a neutral fact-finder and this function stays the one place eligibility policy lives: an
 * `unknown` classification or a flood brand never silently passes as accepted, regardless of
 * what the brief's list contains - the brief would have to explicitly ask for something this
 * function doesn't yet recognise, which it can't, so the honest answer is "not accepted, needs a
 * human to look," not a guess in either direction.
 */
export function isTitleAccepted(titleType: string | null | undefined, acceptedList: string[]): boolean {
  const { status, isFloodBranded } = classifyTitleStatus(titleType);
  if (status === 'unknown' || isFloodBranded) return false;
  return acceptedList.some(raw => {
    const acc = raw.trim().toLowerCase();
    if (acc === 'clean' || acc === 'clear') return status === 'clean';
    if (acc === 'salvage') return status === 'salvage';
    if (acc === 'rebuilt') return status === 'rebuilt';
    if (acc === 'non_repairable' || acc === 'junk') return status === 'non_repairable';
    return false;
  });
}

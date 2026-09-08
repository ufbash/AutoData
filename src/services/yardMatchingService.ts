// PROMPT 20 Phase 5 - matching a sighting's free-text location to a trucking_rates yard.
//
// Never approximate. PROJECT_CHARTER.md S5.1: abstain and flag rather than guess. An
// unmatched or ambiguous listing must show "trucking not quotable" - no state average, no
// nearest-city fallback. A wrong trucking quote on a client deliverable is the same class of
// error as an invented price (S5.4).

export type MatchStatus = 'matched' | 'unmatched' | 'ambiguous';

export interface MatchResult {
  status: MatchStatus;
  reason: string;
  effectivePlatform: string | null;
  parsedState: string | null; // full state name, as trucking_rates stores it
  parsedCity: string | null;
  yardCandidateCount: number;
  matchedYard?: { yard_state: string; yard_city: string };
}

export interface YardKey {
  auction_platform: string;
  yard_state: string;
  yard_city: string;
  yard_street?: string | null;
}

export interface SightingForMatching {
  id: string;
  source_platform: string;
  source_auction_platform: string | null;
  location: string | null;
}

// Standard USPS state/territory abbreviations. sightings.location carries the abbreviation
// (Copart: "AZ - TUCSON"; bid.cars: "Akron (OH)"); trucking_rates.yard_state carries the full
// name written out by the vendor. Bridging this is required for every single match attempt -
// it is not an edge case.
const STATE_ABBR_TO_NAME: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District Of Columbia',
};

// Known misspellings/variants of a state's full name as it actually appears in
// trucking_rates (a vendor-file typo, not a sightings-side issue) - both the correct and
// the misspelled form must normalise to the same key so matching isn't broken by a typo we
// did not introduce and should not silently "fix" in the stored data (SCHEMA.md - raw at
// capture). Extend this as new vendor files reveal new variants.
const STATE_NAME_ALIASES: Record<string, string> = {
  'NEW HAMPHIRE': 'NEW HAMPSHIRE', // sic, in the Copart sheet of the Nov 2025 vendor file
};

function normalizeStateName(name: string): string {
  const upper = name.trim().toUpperCase().replace(/\s+/g, ' ');
  return STATE_NAME_ALIASES[upper] || upper;
}

// case, whitespace, punctuation only - never collapsing directional suffixes ("East",
// "South", "2") into their base name. "South Boston" and "Boston" are different places;
// "Mobile" and "Mobile South" are different yards. Stripping those would manufacture false
// matches, which is a worse failure than an honest non-match.
function normalizeCity(city: string): string {
  return city.trim().toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
}

// Copart: "AZ - TUCSON", "GA - ATLANTA SOUTH", "Offsite" (no location), "ON - COOKSTOWN"
// (Canadian province - never in trucking_rates, correctly unmatchable).
function parseCopartLocation(location: string): { stateAbbr: string; city: string } | null {
  const match = location.match(/^([A-Za-z]{2})\s*-\s*(.+)$/);
  if (!match) return null;
  return { stateAbbr: match[1].toUpperCase(), city: match[2].trim() };
}

// bid.cars: "Akron (OH)", "Atlanta East (GA)", "ACE - Perris (CA)" (vendor-code prefix -
// kept as part of the city text; it will simply fail to match, which is correct since
// trucking_rates has no such prefix), "Dream Rides ()" (no state - correctly unmatchable).
function parseBidcarsLocation(location: string): { stateAbbr: string; city: string } | null {
  const match = location.match(/^(.+?)\s*\(([A-Za-z]{2})\)\s*$/);
  if (!match) return null;
  const stateAbbr = match[2].toUpperCase();
  if (!stateAbbr) return null;
  return { stateAbbr, city: match[1].trim() };
}

// The auction platform a sighting should be matched against is not always source_platform.
// bid.cars is a resale aggregator, not a yard network - a bidcars sighting's real platform
// is source_auction_platform (copart/iaai), set by the extension from the lot number prefix.
// A direct copart/iaai capture already carries the real platform in source_platform. Anything
// else (manual, or a bidcars row with no resolved source_auction_platform) has no yard
// network to match against at all.
function resolveEffectivePlatform(sighting: SightingForMatching): string | null {
  if (sighting.source_platform === 'copart' || sighting.source_platform === 'iaai') {
    return sighting.source_platform;
  }
  if (sighting.source_platform === 'bidcars') {
    return sighting.source_auction_platform || null;
  }
  return null;
}

function parseLocationForPlatform(sighting: SightingForMatching, effectivePlatform: string): { stateAbbr: string; city: string } | null {
  if (!sighting.location) return null;
  if (sighting.source_platform === 'copart') return parseCopartLocation(sighting.location);
  if (sighting.source_platform === 'bidcars') return parseBidcarsLocation(sighting.location);
  return null;
}

export function matchSightingToYard(sighting: SightingForMatching, yards: YardKey[]): MatchResult {
  const effectivePlatform = resolveEffectivePlatform(sighting);

  if (!effectivePlatform) {
    return {
      status: 'unmatched',
      reason: sighting.source_platform === 'bidcars'
        ? 'bid.cars listing with no resolved underlying auction platform (source_auction_platform is null)'
        : `source "${sighting.source_platform}" has no associated yard network`,
      effectivePlatform: null,
      parsedState: null,
      parsedCity: null,
      yardCandidateCount: 0,
    };
  }

  if (!sighting.location || !sighting.location.trim()) {
    return {
      status: 'unmatched',
      reason: 'no location on the sighting',
      effectivePlatform,
      parsedState: null,
      parsedCity: null,
      yardCandidateCount: 0,
    };
  }

  const parsed = parseLocationForPlatform(sighting, effectivePlatform);
  if (!parsed) {
    return {
      status: 'unmatched',
      reason: `location "${sighting.location}" did not match the expected ${sighting.source_platform} format`,
      effectivePlatform,
      parsedState: null,
      parsedCity: null,
      yardCandidateCount: 0,
    };
  }

  const stateName = STATE_ABBR_TO_NAME[parsed.stateAbbr];
  if (!stateName) {
    return {
      status: 'unmatched',
      reason: `"${parsed.stateAbbr}" is not a recognised US state/territory abbreviation (e.g. a Canadian province)`,
      effectivePlatform,
      parsedState: null,
      parsedCity: normalizeCity(parsed.city),
      yardCandidateCount: 0,
    };
  }

  const normalizedState = normalizeStateName(stateName);
  const normalizedCity = normalizeCity(parsed.city);

  // Rule 1: platform first.
  const platformYards = yards.filter(y => y.auction_platform === effectivePlatform);
  // Rule 2: then state and city, normalised.
  const candidates = platformYards.filter(y =>
    normalizeStateName(y.yard_state) === normalizedState && normalizeCity(y.yard_city) === normalizedCity
  );

  if (candidates.length === 0) {
    return {
      status: 'unmatched',
      reason: `no ${effectivePlatform} yard found for "${normalizedCity}, ${normalizedState}"`,
      effectivePlatform,
      parsedState: normalizedState,
      parsedCity: normalizedCity,
      yardCandidateCount: 0,
    };
  }

  // Rule 3: an ambiguous match is not a match. Every candidate here already shares the same
  // normalised city+state by construction (the filter above), so city/state alone can never
  // distinguish them - the real signal for "two different physical yards that happen to
  // share a city name" is a distinct STREET ADDRESS. (An earlier version of this check
  // compared state+city, which was structurally unreachable - candidates are already
  // guaranteed identical on both, so it could never fire. Caught by testing a synthetic
  // genuine duplicate, not by inspection.)
  const distinctStreets = new Set(
    candidates.map(c => (c.yard_street ? c.yard_street.trim().toUpperCase() : null)).filter((s): s is string => s !== null)
  );
  if (distinctStreets.size > 1) {
    return {
      status: 'ambiguous',
      reason: `${distinctStreets.size} distinct ${effectivePlatform} yards (different street addresses) match "${normalizedCity}, ${normalizedState}"`,
      effectivePlatform,
      parsedState: normalizedState,
      parsedCity: normalizedCity,
      yardCandidateCount: distinctStreets.size,
    };
  }

  return {
    status: 'matched',
    reason: 'matched on platform + normalised city/state',
    effectivePlatform,
    parsedState: normalizedState,
    parsedCity: normalizedCity,
    yardCandidateCount: 1,
    matchedYard: { yard_state: candidates[0].yard_state, yard_city: candidates[0].yard_city },
  };
}

import { supabase } from './supabaseClient';
// PROMPT 33 Stage 3 - "extend the existing normaliser, do not build a second one." specVocabulary.ts
// is pure TS with no Deno-only imports (verified before reuse) - imported directly here rather
// than duplicated, so alias/family logic never diverges between the frontend and the Edge
// Functions that also use it.
import { resolveMakeAlias } from '../../supabase/functions/_shared/specVocabulary';

// PROMPT 33 Stage 3 / Prompt 34 Stage 0A - the vocabulary read path for brief entry.
//
// Prompt 33 seeded vehicle_reference_models only for (make, year) pairs already present in
// `assets` - the right population for verifying coverage against real captured data, the wrong
// one for this picker, which describes a car the client WANTS, not one already captured. A brief
// for a 2020 Lexus RX with no 2020 Lexus asset got an empty dropdown and fell to free text for a
// vehicle vPIC covers completely. Fixed here: on a cache miss, call
// vehicle-reference-models-ondemand (any authenticated staff member, not superadmin-gated - brief
// entry itself isn't) to fetch-and-cache that specific (make, year) pair before falling back to
// free text. Free text stays reserved for genuine source gaps (Avatr-class: no NHTSA record at
// all) and real fetch failures - never the default for an untraded make/year.

export interface ReferenceMake {
  id: string;
  name: string;
}

export interface ReferenceModel {
  id: string;
  name: string;
}

const MAX_YEARS_PER_LOOKUP = 8;

// --- Make tiering (Prompt 35 Stage 3) ---
//
// The make vocabulary is RANKED by evidence, never curated by hand and never filtered. Every make
// stays selectable through search; tiering only decides what is shown by default. A hand-kept
// whitelist would be unmaintainable and arbitrary, and Avatr already proved this vocabulary
// cannot be authoritative - so "hidden" here always means "one keystroke away", never "gone".
//
//   Tier 1  Traded   - appears in assets or briefs; ordered by how often.
//   Tier 2  Current  - has a car/truck/MPV model in a recent model year (probe evidence).
//   Tier 3  Everything else - reachable by typing, not listed by default. Includes makes with no
//           model in any probed year (defunct, or not a car brand - same evidence catches both),
//           makes with only old models, makes not yet probed, and staff-demoted makes.
//
// The tier is derived on read from stored probe evidence plus live traded counts; there is no
// tier column to go stale. This is the one place the rule lives.

export type MakeTier = 1 | 2 | 3;
export type MakeTierReason =
  | 'traded' | 'recent' | 'demoted' | 'zero_models' | 'older_only' | 'unprobed' | 'probe_inconclusive';

export interface TieredMake extends ReferenceMake {
  tier: MakeTier;
  reason: MakeTierReason;
  tradedCount: number;
  demoted: boolean;
  demotedReason: string | null;
}

export interface MakeRowWithEvidence extends ReferenceMake {
  probed_at: string | null;
  car_model_years: number[] | null;
  probe_failed: boolean;
  demoted_at: string | null;
  demoted_reason: string | null;
}

export const RECENT_WINDOW_YEARS = 3;

export function tierMakes(
  makes: MakeRowWithEvidence[],
  tradedByLowerName: Map<string, number>,
  thisYear: number = new Date().getFullYear()
): TieredMake[] {
  return makes.map(m => {
    const tradedCount = tradedByLowerName.get(m.name.trim().toLowerCase()) ?? 0;
    const demoted = m.demoted_at != null;
    const years = m.car_model_years ?? [];
    const base = { id: m.id, name: m.name, tradedCount, demoted, demotedReason: m.demoted_reason };

    // A staff demotion is an explicit human call and wins over everything; still searchable.
    if (demoted) return { ...base, tier: 3 as MakeTier, reason: 'demoted' as MakeTierReason };
    // Real demand outranks the rule: a make somebody actually traded or briefed is never buried
    // by a model-year probe.
    if (tradedCount > 0) return { ...base, tier: 1 as MakeTier, reason: 'traded' as MakeTierReason };
    if (m.probed_at == null) return { ...base, tier: 3 as MakeTier, reason: 'unprobed' as MakeTierReason };
    if (years.some(y => y >= thisYear - RECENT_WINDOW_YEARS)) return { ...base, tier: 2 as MakeTier, reason: 'recent' as MakeTierReason };
    if (years.length > 0) return { ...base, tier: 3 as MakeTier, reason: 'older_only' as MakeTierReason };
    // No model in any probed year. Only counts as evidence when the probe itself succeeded.
    if (m.probe_failed) return { ...base, tier: 3 as MakeTier, reason: 'probe_inconclusive' as MakeTierReason };
    return { ...base, tier: 3 as MakeTier, reason: 'zero_models' as MakeTierReason };
  });
}

const byRank = (a: TieredMake, b: TieredMake) =>
  a.tier - b.tier || b.tradedCount - a.tradedCount || a.name.localeCompare(b.name);

/** What the picker shows before anything is typed: tier 1 then tier 2. Tier 3 is never listed here. */
export const defaultMakeList = (tiered: TieredMake[]): TieredMake[] =>
  tiered.filter(m => m.tier !== 3).sort(byRank);

/** Typeahead across ALL makes, every tier included, best tier first. Nothing is excluded. */
export const searchMakes = (tiered: TieredMake[], query: string): TieredMake[] => {
  const q = query.trim().toLowerCase();
  if (!q) return defaultMakeList(tiered);
  return tiered
    .filter(m => m.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts || byRank(a, b);
    });
};

export const listTieredMakes = async (): Promise<TieredMake[]> => {
  const { data, error } = await supabase
    .from('vehicle_reference_makes')
    .select('id, name, probed_at, car_model_years, probe_failed, demoted_at, demoted_reason')
    .order('name');
  if (error) throw new Error(`Failed to load makes: ${error.message}`);

  // Demand evidence is best-effort: if the counts call fails, the vocabulary must still load
  // (every make remains selectable), just without tier 1.
  const traded = new Map<string, number>();
  const { data: counts, error: countsError } = await supabase.rpc('traded_make_counts');
  if (!countsError) {
    for (const row of (counts || []) as { make_lower: string; n: number }[]) {
      // resolveMakeAlias is the project's one human-reviewed alias table (Prompt 33) - e.g.
      // "alfa" trades as ALFA ROMEO. Nothing fuzzier than that is applied.
      const key = resolveMakeAlias(row.make_lower).trim().toLowerCase();
      traded.set(key, (traded.get(key) ?? 0) + Number(row.n));
    }
  }
  return tierMakes((data || []) as MakeRowWithEvidence[], traded);
};

/** Reversible; never a delete. */
export const setMakeDemoted = async (makeId: string, demoted: boolean, reason?: string): Promise<void> => {
  const { error } = await supabase.rpc('set_make_demoted', {
    p_make_id: makeId, p_demoted: demoted, p_reason: reason ?? null,
  });
  if (error) throw new Error(`Failed to ${demoted ? 'demote' : 'restore'} make: ${error.message}`);
};

const getAuthToken = async (): Promise<string> => {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Please log in to look up vehicle models.');
  return data.session.access_token;
};

const seedYearOnDemand = async (make: string, year: number): Promise<void> => {
  const token = await getAuthToken();
  const projectUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
  try {
    await fetch(`${projectUrl}/functions/v1/vehicle-reference-models-ondemand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ make, year }),
    });
  } catch {
    // A fetch failure here must never block brief entry - the caller falls back to whatever is
    // already cached (possibly nothing), and free text remains available regardless.
  }
};

/** Distinct model names for a make, scoped to a year range. Seeds any year in the range that
 * has no cached models yet (bounded to MAX_YEARS_PER_LOOKUP distinct years, to keep a very wide
 * brief range - e.g. "1999-2025" - from triggering dozens of NHTSA calls; the boundary years are
 * always included so a narrow real answer is never silently dropped). */
export const listReferenceModels = async (
  makeName: string,
  yearMin?: number | null,
  yearMax?: number | null
): Promise<ReferenceModel[]> => {
  const resolvedMake = resolveMakeAlias(makeName);

  const { data: makeRow, error: makeError } = await supabase
    .from('vehicle_reference_makes')
    .select('id')
    .ilike('name', resolvedMake)
    .maybeSingle();
  if (makeError) throw new Error(`Failed to resolve make: ${makeError.message}`);
  if (!makeRow) return [];

  const lo = yearMin ?? yearMax ?? null;
  const hi = yearMax ?? yearMin ?? null;

  if (lo != null && hi != null) {
    const fullRange: number[] = [];
    for (let y = lo; y <= hi; y++) fullRange.push(y);
    const years = fullRange.length <= MAX_YEARS_PER_LOOKUP
      ? fullRange
      : Array.from(new Set([lo, hi, ...fullRange.slice(0, MAX_YEARS_PER_LOOKUP - 2)]));

    const { data: cachedYears, error: cachedYearsError } = await supabase
      .from('vehicle_reference_models')
      .select('model_year')
      .eq('make_id', makeRow.id)
      .in('model_year', years);
    if (cachedYearsError) throw new Error(`Failed to check model cache: ${cachedYearsError.message}`);
    const alreadyCached = new Set((cachedYears || []).map((r: { model_year: number }) => r.model_year));

    const missingYears = years.filter(y => !alreadyCached.has(y));
    await Promise.all(missingYears.map(y => seedYearOnDemand(resolvedMake, y)));
  }

  let query = supabase
    .from('vehicle_reference_models')
    .select('id, name')
    .eq('make_id', makeRow.id);
  if (yearMin != null) query = query.gte('model_year', yearMin);
  if (yearMax != null) query = query.lte('model_year', yearMax);

  const { data, error } = await query.order('name');
  if (error) throw new Error(`Failed to load models: ${error.message}`);

  // Dedupe by name (a model can legitimately repeat across several years).
  const seen = new Map<string, ReferenceModel>();
  for (const row of data || []) {
    if (!seen.has(row.name)) seen.set(row.name, row);
  }
  return Array.from(seen.values());
};

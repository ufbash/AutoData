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

export const listReferenceMakes = async (): Promise<ReferenceMake[]> => {
  const { data, error } = await supabase
    .from('vehicle_reference_makes')
    .select('id, name')
    .order('name');
  if (error) throw new Error(`Failed to load makes: ${error.message}`);
  return data || [];
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

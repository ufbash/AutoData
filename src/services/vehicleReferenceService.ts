import { supabase } from './supabaseClient';
// PROMPT 33 Stage 3 - "extend the existing normaliser, do not build a second one." specVocabulary.ts
// is pure TS with no Deno-only imports (verified before reuse) - imported directly here rather
// than duplicated, so alias/family logic never diverges between the frontend and the Edge
// Functions that also use it.
import { resolveMakeAlias } from '../../supabase/functions/_shared/specVocabulary';

// PROMPT 33 Stage 3 - the vocabulary read path for brief entry. Read-only; nothing here writes
// to vehicle_reference_makes/models (that only ever happens server-side via
// vehicle-reference-seed's service-role key). Free text must always remain possible alongside
// this - see AssetMergePicker-style "not listed" pattern in ClientsList.tsx.

export interface ReferenceMake {
  id: string;
  name: string;
}

export interface ReferenceModel {
  id: string;
  name: string;
}

export const listReferenceMakes = async (): Promise<ReferenceMake[]> => {
  const { data, error } = await supabase
    .from('vehicle_reference_makes')
    .select('id, name')
    .order('name');
  if (error) throw new Error(`Failed to load makes: ${error.message}`);
  return data || [];
};

/** Distinct model names for a make, optionally scoped to a year range. Falls back to every
 * seeded year for that make when no range is given (a brief's year fields are optional). */
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

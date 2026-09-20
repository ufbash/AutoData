// PROMPT 35 - the one NHTSA vPIC model fetch. vehicle-reference-seed, -models-ondemand and
// -make-probe each used to (or would have) carry their own copy of this loop.
//
// Vehicle-type-scoped and deduped by Model_ID, per Prompt 33 Stage 1: raw GetModelsForMakeYear
// with no vehicletype leaks motorcycles/ATVs (Honda, BMW), and NHTSA returns one row per
// body-style variant sharing a Model_ID (the Sprinter appeared 4x for one query).
// The three types mirror the makes seed's filter so both layers agree; "car" alone would drop
// truck-only makers (RAM) that a client can legitimately ask for.

export const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";
export const VEHICLE_TYPES = ["car", "truck", "multipurpose passenger vehicle (mpv)"];

export interface NhtsaModelResult {
  Model_ID: number;
  Model_Name: string;
}

export interface ModelFetchResult {
  models: Map<number, string>;
  failed: boolean;
  error: string | null;
}

// `make` is a name (seed / on-demand, which key on the name) or an NHTSA make id (the probe).
// The id form exists because names containing a period ("INC.", "LTD.") make vPIC's path routing
// 302 to a 404 - a deterministic failure the name endpoint can never get past.
//
// stopAtFirstHit: existence probing only needs to know "is there any model", so it stops after the
// first vehicle type that returns one. The seed and on-demand fetch need the full merged list.
export async function fetchModelsForMakeYear(make: string | number, year: number, stopAtFirstHit = false): Promise<ModelFetchResult> {
  const models = new Map<number, string>();
  let failed = false;
  let error: string | null = null;
  for (const vt of VEHICLE_TYPES) {
    try {
      const path = typeof make === 'number'
        ? `GetModelsForMakeIdYear/makeId/${make}`
        : `GetModelsForMakeYear/make/${encodeURIComponent(make)}`;
      const res = await fetch(`${VPIC_BASE}/${path}/modelyear/${year}/vehicletype/${encodeURIComponent(vt)}?format=json`);
      if (!res.ok) { failed = true; error = `HTTP ${res.status}`; continue; }
      const data = await res.json();
      for (const r of (data.Results ?? []) as NhtsaModelResult[]) models.set(r.Model_ID, r.Model_Name);
      if (stopAtFirstHit && models.size > 0) break;
    } catch (e) {
      failed = true;
      error = (e as Error).message;
    }
  }
  return { models, failed, error };
}

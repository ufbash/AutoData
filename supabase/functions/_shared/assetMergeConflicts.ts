// PROMPT 32 Stage 2 (debt #46) - abstention signals for the merge-candidate detector. A pure
// function on purpose: this is the one thing in the merge feature that MUST be provable with
// synthetic input (the master prompt's own verify requirement #4/#5 - no live positive exists by
// construction, since production data agreed on every candidate pair found), so it cannot live
// only as inline logic inside an Edge Function that can't be unit-exercised directly.

export interface ConflictAsset {
  vin: string | null;
}

export interface ConflictSighting {
  mileage_miles: number | null;
  captured_at: string | null;
}

export interface ConflictAuctionHistoryRow {
  auction_date: string | null;
  auction_platform: string | null;
}

export function detectMergeConflicts(
  survivor: ConflictAsset,
  orphanCandidate: ConflictAsset,
  sightingsSurvivor: ConflictSighting[],
  sightingsOrphan: ConflictSighting[],
  historySurvivor: ConflictAuctionHistoryRow[],
  historyOrphan: ConflictAuctionHistoryRow[]
): string[] {
  // Abstention signals, per the master prompt: conflicting VIN (shouldn't occur by construction
  // in real detection - a VIN-bearing/VIN-less pair only matches on the VIN-less side's own
  // canonical form - checked anyway since detection logic could itself be wrong), incompatible
  // odometer readings (a later, LOWER reading than an earlier one - real odometers only
  // increase), or overlapping auction dates at different locations (two simultaneous physical
  // presences is impossible for one car).
  const reasons: string[] = [];

  if (survivor.vin && orphanCandidate.vin && survivor.vin !== orphanCandidate.vin) {
    reasons.push(`Conflicting VINs: ${survivor.vin} vs ${orphanCandidate.vin}`);
  }

  const allSightings = [
    ...sightingsSurvivor.map((s) => ({ ...s, _side: 'survivor' as const })),
    ...sightingsOrphan.map((s) => ({ ...s, _side: 'orphan' as const })),
  ].filter((s) => s.mileage_miles != null && s.captured_at)
    .sort((a, b) => new Date(a.captured_at as string).getTime() - new Date(b.captured_at as string).getTime());
  for (let i = 1; i < allSightings.length; i++) {
    if ((allSightings[i].mileage_miles as number) < (allSightings[i - 1].mileage_miles as number)) {
      reasons.push(`Odometer went backward over time: ${allSightings[i - 1].mileage_miles} (${allSightings[i - 1]._side}, ${allSightings[i - 1].captured_at}) -> ${allSightings[i].mileage_miles} (${allSightings[i]._side}, ${allSightings[i].captured_at})`);
    }
  }

  const allHistory = [...historySurvivor, ...historyOrphan].filter((h) => h.auction_date && h.auction_platform);
  for (let i = 0; i < allHistory.length; i++) {
    for (let j = i + 1; j < allHistory.length; j++) {
      if (allHistory[i].auction_date === allHistory[j].auction_date && allHistory[i].auction_platform !== allHistory[j].auction_platform) {
        reasons.push(`Same date (${allHistory[i].auction_date}) at two different platforms/locations: ${allHistory[i].auction_platform} vs ${allHistory[j].auction_platform}`);
      }
    }
  }

  return reasons;
}

// A field-level disagreement: both sides have a non-null value, and the values differ. Per
// AGENTS.md §6, one side null and the other populated is NEVER a disagreement - that is unknown-
// data handling, not conflict, and is excluded here at the source. Compared case-insensitively
// only (not a full spec-match normalisation - "Gas" and "Gasoline" will still surface as a
// disagreement) because this function's job is to make sure the reviewer SEES a difference and
// can judge it themselves, not to auto-classify "cosmetic vs real" for them - the master
// prompt's own instruction is "show both and make the reviewer choose. Never silently prefer one
// side," not "decide for them which differences matter."
export interface FieldDisagreement {
  field: string;
  survivorValue: unknown;
  orphanValue: unknown;
}

export function detectFieldDisagreements(
  survivor: Record<string, unknown>,
  orphanCandidate: Record<string, unknown>,
  fields: string[]
): FieldDisagreement[] {
  const disagreements: FieldDisagreement[] = [];
  for (const field of fields) {
    const a = survivor[field];
    const b = orphanCandidate[field];
    if (a === null || a === undefined || b === null || b === undefined) continue;
    const aStr = String(a).trim().toLowerCase();
    const bStr = String(b).trim().toLowerCase();
    if (aStr !== bStr) {
      disagreements.push({ field, survivorValue: a, orphanValue: b });
    }
  }
  return disagreements;
}

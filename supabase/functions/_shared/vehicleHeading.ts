// PROMPT 35 Stage 2 - the single definition of a run's vehicle-first heading and brief
// reference. Moved here from ResearchRuns.tsx (Prompt 23 Phase 2) so the Chrome extension's run
// picker, which cannot import from src/, gets the finished string from list-active-runs instead
// of building a second copy. The frontend imports this same file.

export interface BriefHeadingInput {
  year_min?: number | null;
  year_max?: number | null;
  make?: string | null;
  model?: string | null;
}

// Built only from year_min/year_max/make/model (no trim). Returns null - never an empty string -
// when there is nothing to build from, so the caller's fallback is an explicit branch (Prompt 23:
// real briefs exist where all of these are null).
export function vehicleHeadingFromBrief(brief: BriefHeadingInput | null | undefined): string | null {
  if (!brief) return null;
  const parts: string[] = [];
  if (brief.year_min != null || brief.year_max != null) {
    if (brief.year_min != null && brief.year_max != null) {
      parts.push(brief.year_min === brief.year_max ? `${brief.year_min}` : `${brief.year_min}-${brief.year_max}`);
    } else {
      parts.push(`${brief.year_min ?? brief.year_max}`);
    }
  }
  if (brief.make) parts.push(brief.make);
  if (brief.model) parts.push(brief.model);
  const text = parts.join(' ').trim();
  return text || null;
}

// The "2008-2015 Toyota Yaris" / "Any-Any Any Make Any Model" reference shown beside a client's
// name. Same output the inline JSX copies produce.
export function briefReference(brief: BriefHeadingInput): string {
  return `${brief.year_min || 'Any'}-${brief.year_max || 'Any'} ${brief.make || 'Any Make'} ${brief.model || 'Any Model'}`;
}

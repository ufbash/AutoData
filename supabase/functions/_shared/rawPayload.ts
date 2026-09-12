// PROMPT 30 Stage 1 (debt #55) — the canonical `sightings.raw_payload` shape, and a loud-failure
// accessor so a reader that expects a field it isn't getting can never again silently get `null`.
//
// Root cause this exists to close: `research-capture/index.ts` used to write `raw_payload` as
// `{ ...payload }` — the entire request envelope, whose real values live nested under
// `payload.captured_fields`. Four separate readers (across two prompts) reached for a top-level
// path that never existed there and got a silent `null` forever. Fixing readers one at a time
// treats a writer bug as a reader bug — the fifth field added would reproduce it.
//
// CANONICAL SHAPE (rows written by research-capture from this point on): FLAT. Every
// `captured_fields.<field>` is spread directly onto `raw_payload`'s top level, alongside the
// envelope's own metadata (`source_platform`, `source_url`, `lot_state`, `research_run_id`,
// `raw_dom_snapshot`, `auction_history`, `image_urls`) and any post-hoc stamps
// (`price_usd_conversion_failed`, `attempted_currency`, `asset_fingerprint_outcome`). This is
// the exact same flat-spread convention `app-ingest/index.ts` already uses correctly
// (`{ ...v, record_type, date_listed }`) — one canonical shape system-wide, not two, so a future
// engineer copying "the obvious" `raw.<field>` pattern from one pipeline into the other now gets
// a correct result instead of a silent null.
//
// LEGACY SHAPE (176 real rows written before this change, `logged_via = 'extension_dom_capture'`
// only): NESTED — `raw_payload.captured_fields.<field>`, with the same envelope metadata at the
// top level. Not rewritten by a migration: nothing in the live codebase reads `raw_payload` as a
// query surface for these rows today (every known field has been fixed to read its real
// `sightings` column instead — see PLAN_TRACKER.md debt #55's history and docs/SOLVED.md §27).
// The accessors below handle both shapes transparently so a future reader that does need
// `raw_payload` (archival/debugging only — see the rule below) works uniformly across old and
// new rows without needing to know which shape a given row was written under.
//
// THE RULE, restated: prefer a real `sightings` column over `raw_payload` for anything that has
// one. `raw_payload` is a provenance record of what the extension actually sent, not a query
// surface — every field captured at the extension already has (or should have) a mirrored real
// column, written directly from `captured_fields` at capture time, independent of whatever shape
// `raw_payload` itself takes. Reach into `raw_payload` only for genuinely archival/debug purposes
// (e.g. auditing exactly what a specific historical capture sent), and when you do, use
// `readRawPayloadField`/`requireRawPayloadField` below — never a bare `raw.<field>` — so a typo
// or a field that was never actually captured fails loudly instead of returning a bare `null`
// indistinguishable from a genuinely absent value.

export interface RawPayloadFieldResult {
  /** True if the field exists in the payload, under either the flat or legacy nested shape. */
  present: boolean;
  value: unknown;
}

/**
 * Reads a single captured field off a `raw_payload` value, checking the canonical flat shape
 * first and falling back to the legacy nested `captured_fields.<field>` shape for historical
 * rows. Returns `present: false` (never a bare `null`) when the field genuinely isn't there
 * under either shape — the caller decides what to do with an absent field; this function never
 * pretends "not present" and "present with value null" are the same fact.
 */
export function readRawPayloadField(raw: unknown, field: string): RawPayloadFieldResult {
  if (!raw || typeof raw !== 'object') return { present: false, value: undefined };
  const obj = raw as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(obj, field)) {
    return { present: true, value: obj[field] };
  }

  const captured = obj.captured_fields;
  if (captured && typeof captured === 'object' && Object.prototype.hasOwnProperty.call(captured, field)) {
    return { present: true, value: (captured as Record<string, unknown>)[field] };
  }

  return { present: false, value: undefined };
}

/**
 * Same lookup as `readRawPayloadField`, but throws instead of returning `present: false`. Use
 * this whenever a caller genuinely expects a field to exist (i.e. would otherwise silently treat
 * a typo'd or never-captured field as a legitimate `null`). This is the "make the silent-null
 * failure mode loud" primitive Prompt 30 Stage 1 asks for.
 */
export function requireRawPayloadField(raw: unknown, field: string): unknown {
  const result = readRawPayloadField(raw, field);
  if (!result.present) {
    throw new Error(
      `raw_payload has no field "${field}" under either the flat or legacy captured_fields shape. ` +
      `If this field was never actually captured, read from its real sightings column instead ` +
      `(raw_payload is a provenance record, not a query surface) — do not fall back to a bare null.`
    );
  }
  return result.value;
}

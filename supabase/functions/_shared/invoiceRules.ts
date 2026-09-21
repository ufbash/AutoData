// PROMPT 37 Phase 2 - the rules that decide what an invoice may say, in one pure module (no imports) used by the
// billing Edge Function AND the invoice builder, and mirrored by the database's own check at commit
// (check_generated_invoice in migration 059). The database is the last line; this is the readable first one.
//
// The failure to keep out: a total presented as complete while a cost component is missing. The rule is that every
// one of the six cost components is ACCOUNTED FOR - a line with a real figure, or an explicit exclusion with a reason -
// and an invoice with any exclusion is scope 'partial' and says so on its face. A component that abstains (shipping and
// duty on today's data) is never a zero line and never silently absent.

export const REQUIRED_KINDS = ['vehicle_price', 'auction_fees', 'inland_trucking', 'ocean_freight', 'duty', 'brokerage_fee'] as const;
export type RequiredKind = typeof REQUIRED_KINDS[number];
export type LineKind = RequiredKind | 'all_inclusive_price' | 'other';
export type Hat = 'brokerage' | 'retail';
export type InvoiceCurrency = 'USD' | 'NGN';

export const KIND_LABEL: Record<LineKind, string> = {
  vehicle_price: 'Vehicle price (winning bid)',
  auction_fees: 'Auction fees',
  inland_trucking: 'US inland transport',
  ocean_freight: 'Ocean freight',
  duty: 'Import duty',
  brokerage_fee: 'Brokerage fee',
  all_inclusive_price: 'All-inclusive price',
  other: 'Other',
};

export interface LineInput {
  kind: LineKind;
  description: string;
  amount_usd: number;
  client_visible?: boolean;
  origin: 'computed' | 'staff_entered';
  basis?: string | null;      // required when staff-entered: what the figure rests on
  source_ref?: string | null;
}
export interface ExcludedInput { kind: RequiredKind; reason: string }
export interface InvoiceInput { hat: Hat; currency: InvoiceCurrency; lines: LineInput[]; excluded: ExcludedInput[] }

export interface NormalisedLine extends LineInput { client_visible: boolean; amount_usd: number }
export type Derived =
  | { ok: true; scope: 'complete' | 'partial'; excluded: ExcludedInput[]; lines: NormalisedLine[]; totalUsd: number; missing: RequiredKind[] }
  | { ok: false; errors: string[] };

const cents = (n: number) => Math.round(n * 100 + (n < 0 ? -1e-9 : 1e-9)) / 100;
const isKind = (k: unknown): k is LineKind => typeof k === 'string' && (k === 'all_inclusive_price' || k === 'other' || (REQUIRED_KINDS as readonly string[]).includes(k));
const isRequired = (k: unknown): k is RequiredKind => typeof k === 'string' && (REQUIRED_KINDS as readonly string[]).includes(k);

export function deriveInvoice(input: InvoiceInput): Derived {
  const errors: string[] = [];
  if (input.hat !== 'brokerage' && input.hat !== 'retail') errors.push('The invoice must say which hat it is issued under: brokerage or retail');
  if (input.currency !== 'USD' && input.currency !== 'NGN') errors.push('The invoice currency must be USD or NGN');
  if (!Array.isArray(input.lines) || input.lines.length === 0) errors.push('An invoice needs at least one line');
  if (errors.length) return { ok: false, errors };

  const lines: NormalisedLine[] = input.lines.map((l, i) => {
    if (!isKind(l.kind)) errors.push(`Line ${i + 1}: unknown kind "${l.kind}"`);
    if (typeof l.description !== 'string' || l.description.trim() === '') errors.push(`Line ${i + 1}: a description is required`);
    if (typeof l.amount_usd !== 'number' || !Number.isFinite(l.amount_usd) || l.amount_usd < 0) errors.push(`Line ${i + 1}: the amount must be a number of dollars, zero or more`);
    if (l.origin !== 'computed' && l.origin !== 'staff_entered') errors.push(`Line ${i + 1}: origin must be computed or staff_entered`);
    // A zero is what a silently zeroed, abstaining component looks like. Only a brokerage fee can be a real zero (waived),
    // and then it is staff-entered with its basis; any other component that costs nothing is EXCLUDED with a reason.
    // A computed figure must say where it came from.
    if (Number(l.amount_usd) === 0 && !(l.kind === 'brokerage_fee' && l.origin === 'staff_entered')) errors.push(`Line ${i + 1}: a zero amount is refused - a component with no real figure is excluded with a reason, not zeroed (only a waived brokerage fee may be zero, with its basis)`);
    if (l.origin === 'computed' && (!l.source_ref || String(l.source_ref).trim() === '')) errors.push(`Line ${i + 1}: a computed figure must carry the source it was computed from`);
    if (l.origin === 'staff_entered' && (!l.basis || l.basis.trim() === '')) errors.push(`Line ${i + 1}: a figure entered by staff must state what it rests on (a quote, an agreement, an invoice)`);
    return { ...l, description: String(l.description ?? '').trim(), amount_usd: cents(Number(l.amount_usd)), client_visible: l.client_visible !== false };
  });

  const visible = lines.filter(l => l.client_visible);
  const excluded = (input.excluded ?? []).map(e => ({ kind: e.kind, reason: String(e.reason ?? '').trim() }));
  if (input.hat === 'retail') {
    if (visible.length !== 1 || visible[0].kind !== 'all_inclusive_price') errors.push('A retail invoice shows exactly one client-visible line, the all-inclusive price - cost and margin lines stay internal');
    if (excluded.length) errors.push('A retail invoice states a price, not a cost total: it excludes nothing');
    if (errors.length) return { ok: false, errors };
    const totalUsd = cents(visible.reduce((s, l) => s + l.amount_usd, 0));
    if (!(totalUsd > 0)) return { ok: false, errors: ['The invoice total must be more than zero'] };
    return { ok: true, scope: 'complete', excluded: [], lines, totalUsd, missing: [] };
  }

  // brokerage: transparent
  if (lines.some(l => !l.client_visible || l.kind === 'all_inclusive_price')) errors.push('A brokerage invoice discloses every line: no hidden lines and no all-inclusive price');
  for (const e of excluded) {
    if (!isRequired(e.kind)) errors.push(`Cannot exclude "${e.kind}": only the six cost components can be excluded`);
    else if (e.reason === '') errors.push(`Excluding ${KIND_LABEL[e.kind]} needs a stated reason`);
  }
  const lineKinds = new Set(visible.map(l => l.kind));
  const excludedKinds = new Set(excluded.map(e => e.kind));
  for (const k of excludedKinds) if (lineKinds.has(k)) errors.push(`${KIND_LABEL[k]} is both a line and excluded`);
  const missing = REQUIRED_KINDS.filter(k => !lineKinds.has(k));
  const silent = missing.filter(k => !excludedKinds.has(k));
  for (const k of silent) errors.push(`The invoice is silent about ${KIND_LABEL[k]}: give it a real figure or exclude it with a reason`);
  if (errors.length) return { ok: false, errors };

  const totalUsd = cents(visible.reduce((s, l) => s + l.amount_usd, 0));
  if (!(totalUsd > 0)) return { ok: false, errors: ['The invoice total must be more than zero'] };
  return { ok: true, scope: missing.length === 0 ? 'complete' : 'partial', excluded, lines, totalUsd, missing };
}

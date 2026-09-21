import { supabase } from './supabaseClient';
import { fetchAllVerified } from '../../supabase/functions/_shared/paginatedRead';

// The staff-only client relationship view. research_runs carries an extra permissive read policy, so RLS is
// not the isolation boundary here: EVERY query below is scoped in code by org_id and by the client (directly,
// or through that client's own won vehicle ids), and the loaded rows are then asserted against the scope so a
// leak throws instead of rendering.

export interface RelClient { id: string; org_id: string; full_name: string; email: string | null; phone: string | null; created_at: string; deleted_at: string | null }
export interface RelBrief { id: string; org_id: string; client_id: string; year_min: number | null; year_max: number | null; make: string | null; model: string | null; status: string | null; deposit_received_at: string | null; deleted_at: string | null }
export interface RelRun { id: string; org_id: string; client_id: string; client_brief_id: string | null; client_name: string; run_type: string; status: string; created_at: string }
export interface RelWonVehicle { id: string; org_id: string; client_id: string; brief_id: string | null; run_id: string | null; won_snapshot: Record<string, unknown> | null; promoted_at: string; deleted_at: string | null; currentStatus: string | null }
export interface RelDocument { id: string; org_id: string; won_vehicle_id: string; document_type: string; original_filename: string; uploaded_at: string }
export interface RelBalance { issuance_id: string; invoice_amount: number; paid: number; outstanding: number }
export interface RelInvoice {
  id: string; org_id: string; won_vehicle_id: string; document_id: string | null; invoice_number: string | null; amount: number; currency: string;
  issued_at: string; voided_at: string | null; void_reason: string | null;
  generated: boolean; hat: string | null; scope: string | null; excluded_components: unknown; amount_usd: number | null;
  balance: RelBalance | null;
}
export interface RelPayment { id: string; org_id: string; won_vehicle_id: string; issuance_id: string; amount: number; currency: string; paid_at: string; method: string; reference: string | null; recorded_at: string; voided_at: string | null; void_reason: string | null }
export interface RelReceipt { id: string; org_id: string; won_vehicle_id: string; payment_id: string; document_id: string | null; receipt_number: string; issued_at: string; voided_at: string | null; void_reason: string | null }
export interface RelEmail { id: string; purpose: string; subject: string | null; status: string; created_at: string; maskedRecipient: string; related_table: string }

export interface ClientRelationshipData {
  client: RelClient;
  briefs: RelBrief[];
  runs: RelRun[];
  wonVehicles: RelWonVehicle[];
  documents: RelDocument[];
  invoices: RelInvoice[];
  payments: RelPayment[];
  receipts: RelReceipt[];
  emails: RelEmail[];
  // Tables/views/columns this project's database does not have yet; their sections are empty, not failed.
  pendingSchema: string[];
}

const CHUNK = 50; // .in() ids travel in the URL
const chunk = <T,>(items: T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

type Query = any;
interface OrderBy { col: string; asc?: boolean }

const readAll = <T,>(label: string, table: string, cols: string, apply: (q: Query) => Query, order: OrderBy[], countCol = 'id'): Promise<T[]> =>
  fetchAllVerified<T>(
    label,
    (from, to) => {
      let q = apply(supabase.from(table).select(cols));
      for (const o of order) q = q.order(o.col, { ascending: o.asc ?? true });
      return q.range(from, to);
    },
    () => apply(supabase.from(table).select(countCol, { count: 'exact', head: true })),
  );

// Each chunk of ids is paged and count-verified on its own.
const readChunked = async <T,>(label: string, table: string, cols: string, ids: string[], apply: (q: Query, idChunk: string[]) => Query, order: OrderBy[], countCol = 'id'): Promise<T[]> => {
  const out: T[] = [];
  for (const c of chunk(ids)) out.push(...await readAll<T>(label, table, cols, q => apply(q, c), order, countCol));
  return out;
};

const isMissingRelation = (e: unknown): boolean =>
  /does not exist|could not find the table|schema cache/i.test((e as { message?: string })?.message ?? '');

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

const maskEmail = (email: string | null | undefined): string => {
  if (!email) return 'unknown';
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
};

const assertOrg = (label: string, rows: { org_id?: string }[], orgId: string) => {
  for (const r of rows) if (r.org_id !== orgId) throw new Error(`Isolation check failed: a ${label} row belongs to another organisation`);
};
const assertClient = (label: string, rows: { client_id?: string | null }[], clientId: string) => {
  for (const r of rows) if (r.client_id !== clientId) throw new Error(`Isolation check failed: a ${label} row belongs to another client`);
};
const assertVehicles = (label: string, rows: { won_vehicle_id?: string }[], vehicleIds: Set<string>) => {
  for (const r of rows) if (!r.won_vehicle_id || !vehicleIds.has(r.won_vehicle_id)) throw new Error(`Isolation check failed: a ${label} row belongs to another vehicle`);
};

export const loadClientRelationship = async (orgId: string, clientId: string): Promise<ClientRelationshipData> => {
  if (!orgId || !clientId) throw new Error('A client relationship needs both an organisation and a client.');
  const pendingSchema: string[] = [];
  const optional = async <T,>(name: string, fn: () => Promise<T[]>): Promise<T[]> => {
    try { return await fn(); } catch (e) {
      if (isMissingRelation(e)) { pendingSchema.push(name); return []; }
      throw e;
    }
  };

  const { data: clientRow, error: clientErr } = await supabase
    .from('clients')
    .select('id, org_id, full_name, email, phone, created_at, deleted_at')
    .eq('id', clientId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (clientErr) throw new Error(`Failed to load the client: ${clientErr.message}`);
  if (!clientRow || clientRow.id !== clientId || clientRow.org_id !== orgId) throw new Error('This client does not exist in your organisation.');
  const client = clientRow as RelClient;

  // Briefs and won vehicles are read including soft-deleted rows: email history must still reach their ids.
  const [allBriefs, runs, allVehicles] = await Promise.all([
    readAll<RelBrief>('client briefs', 'client_briefs',
      'id, org_id, client_id, year_min, year_max, make, model, status, deposit_received_at, deleted_at',
      q => q.eq('org_id', orgId).eq('client_id', clientId), [{ col: 'created_at', asc: false }, { col: 'id' }]),
    readAll<RelRun>('research runs', 'research_runs',
      'id, org_id, client_id, client_brief_id, client_name, run_type, status, created_at',
      q => q.eq('org_id', orgId).eq('client_id', clientId).is('deleted_at', null), [{ col: 'created_at', asc: false }, { col: 'id' }]),
    readAll<Omit<RelWonVehicle, 'currentStatus'>>('won vehicles', 'won_vehicles',
      'id, org_id, client_id, brief_id, run_id, won_snapshot, promoted_at, deleted_at',
      q => q.eq('org_id', orgId).eq('client_id', clientId), [{ col: 'promoted_at', asc: false }, { col: 'id' }]),
  ]);
  assertOrg('brief', allBriefs, orgId); assertClient('brief', allBriefs, clientId);
  assertOrg('research run', runs, orgId); assertClient('research run', runs, clientId);
  assertOrg('won vehicle', allVehicles, orgId); assertClient('won vehicle', allVehicles, clientId);

  const briefs = allBriefs.filter(b => !b.deleted_at);
  const liveVehicles = allVehicles.filter(v => !v.deleted_at);
  const vehicleIds = liveVehicles.map(v => v.id);
  const vehicleIdSet = new Set(vehicleIds);
  const briefIdsAll = allBriefs.map(b => b.id);
  const vehicleIdsAll = allVehicles.map(v => v.id);

  const byVehicle = (q: Query, c: string[]) => q.eq('org_id', orgId).in('won_vehicle_id', c);

  const [history, documents, issuances, payments, receipts, balances, briefEmails, vehicleEmails] = await Promise.all([
    // No org_id on this table: reachable only through vehicle ids that were already org+client scoped.
    readChunked<{ won_vehicle_id: string; status: string; changed_at: string }>('won vehicle status history', 'won_vehicle_status_history',
      'id, won_vehicle_id, status, changed_at', vehicleIds, (q, c) => q.in('won_vehicle_id', c), [{ col: 'changed_at' }, { col: 'id' }]),
    readChunked<RelDocument>('won vehicle documents', 'won_vehicle_documents',
      'id, org_id, won_vehicle_id, document_type, original_filename, uploaded_at', vehicleIds,
      (q, c) => byVehicle(q, c).is('deleted_at', null), [{ col: 'uploaded_at', asc: false }, { col: 'id' }]),
    readChunked<any>('invoice issuances', 'won_vehicle_invoice_issuances', '*', vehicleIds, byVehicle, [{ col: 'issued_at', asc: false }, { col: 'id' }]),
    optional('won_vehicle_payments', () => readChunked<RelPayment>('won vehicle payments', 'won_vehicle_payments',
      'id, org_id, won_vehicle_id, issuance_id, amount, currency, paid_at, method, reference, recorded_at, voided_at, void_reason', vehicleIds,
      byVehicle, [{ col: 'paid_at', asc: false }, { col: 'id' }])),
    optional('won_vehicle_receipts', () => readChunked<RelReceipt>('won vehicle receipts', 'won_vehicle_receipts',
      'id, org_id, won_vehicle_id, payment_id, document_id, receipt_number, issued_at, voided_at, void_reason', vehicleIds,
      byVehicle, [{ col: 'issued_at', asc: false }, { col: 'id' }])),
    optional('won_vehicle_invoice_balances', () => readChunked<any>('invoice balances', 'won_vehicle_invoice_balances',
      'issuance_id, org_id, won_vehicle_id, invoice_amount, paid, outstanding', vehicleIds, byVehicle, [{ col: 'issuance_id' }], 'issuance_id')),
    // email_log has no client column: a client's mail is found through its briefs and won vehicles (deleted ones included).
    readChunked<any>('email history (briefs)', 'email_log',
      'id, org_id, purpose, recipient_email, subject, related_table, related_id, status, created_at', briefIdsAll,
      (q, c) => q.eq('org_id', orgId).eq('related_table', 'client_briefs').in('related_id', c), [{ col: 'created_at', asc: false }, { col: 'id' }]),
    readChunked<any>('email history (won vehicles)', 'email_log',
      'id, org_id, purpose, recipient_email, subject, related_table, related_id, status, created_at', vehicleIdsAll,
      (q, c) => q.eq('org_id', orgId).eq('related_table', 'won_vehicles').in('related_id', c), [{ col: 'created_at', asc: false }, { col: 'id' }]),
  ]);

  assertVehicles('status history', history, vehicleIdSet);
  assertOrg('document', documents, orgId); assertVehicles('document', documents, vehicleIdSet);
  assertOrg('invoice', issuances, orgId); assertVehicles('invoice', issuances, vehicleIdSet);
  assertOrg('payment', payments, orgId); assertVehicles('payment', payments, vehicleIdSet);
  assertOrg('receipt', receipts, orgId); assertVehicles('receipt', receipts, vehicleIdSet);
  assertOrg('invoice balance', balances, orgId); assertVehicles('invoice balance', balances, vehicleIdSet);
  const relatedIds = new Set([...briefIdsAll, ...vehicleIdsAll]);
  const emailRows = [...briefEmails, ...vehicleEmails];
  assertOrg('email', emailRows, orgId);
  for (const r of emailRows) if (!relatedIds.has(r.related_id)) throw new Error('Isolation check failed: an email row is not tied to this client');

  // Issuances that predate migration 059 have no `generated` key at all.
  if (issuances.length > 0 && !('generated' in issuances[0]) && !pendingSchema.includes('won_vehicle_invoice_issuances.generated')) {
    pendingSchema.push('won_vehicle_invoice_issuances.generated');
  }

  const balanceByIssuance = new Map<string, RelBalance>();
  for (const b of balances) balanceByIssuance.set(b.issuance_id, { issuance_id: b.issuance_id, invoice_amount: num(b.invoice_amount), paid: num(b.paid), outstanding: num(b.outstanding) });

  const latestStatus = new Map<string, string>();
  for (const h of history) latestStatus.set(h.won_vehicle_id, h.status); // ordered by changed_at ascending

  const seenEmail = new Set<string>();
  const emails: RelEmail[] = [];
  for (const r of emailRows) {
    if (seenEmail.has(r.id)) continue;
    seenEmail.add(r.id);
    emails.push({ id: r.id, purpose: r.purpose, subject: r.subject ?? null, status: r.status, created_at: r.created_at, related_table: r.related_table, maskedRecipient: maskEmail(r.recipient_email) });
  }
  emails.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    client,
    briefs,
    runs,
    wonVehicles: liveVehicles.map(v => ({ ...v, currentStatus: latestStatus.get(v.id) ?? null })),
    documents,
    invoices: issuances.map((i: any): RelInvoice => ({
      id: i.id, org_id: i.org_id, won_vehicle_id: i.won_vehicle_id, document_id: i.document_id ?? null, invoice_number: i.invoice_number ?? null,
      amount: num(i.amount), currency: i.currency, issued_at: i.issued_at, voided_at: i.voided_at ?? null, void_reason: i.void_reason ?? null,
      generated: i.generated === true, hat: i.hat ?? null, scope: i.scope ?? null, excluded_components: i.excluded_components ?? null,
      amount_usd: i.amount_usd === null || i.amount_usd === undefined ? null : Number(i.amount_usd),
      balance: balanceByIssuance.get(i.id) ?? null,
    })),
    payments: payments.map(p => ({ ...p, amount: num(p.amount) })),
    receipts,
    emails,
    pendingSchema,
  };
};

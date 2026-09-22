import { supabase } from './supabaseClient';
import { fetchAllVerified } from '../../supabase/functions/_shared/paginatedRead';
import { STATUS_LABELS, STATUS_SEQUENCE } from './wonVehicleService';
import type { WonVehicleStatus } from './wonVehicleService';

// PROMPT 39 Stage 4 - the client dashboard's ONLY data layer. Every read here goes through the client's OWN RLS
// policies (migrations 066-069): the `my_client_record`/`my_won_vehicles` views (column-restricted - no notes, no
// internal linkage) and the client-scoped SELECT policies on client_briefs, research_runs, won_vehicle_status_history,
// won_vehicle_documents, billing_documents/lines/payments/applications/receipts. Nothing here can read another
// client's row or a hidden retail cost line - that is enforced by the database, not by this file; this file trusts RLS
// and never adds an org_id/client_id filter of its own (the row policies already do it, correctly, once).

export interface MyClientRecord { id: string; org_id: string; full_name: string; email: string | null; phone: string | null; preferred_contact: string | null; created_at: string }
export interface MyBrief { id: string; make: string | null; model: string | null; year_min: number | null; year_max: number | null; status: string; submitted_at: string | null }
export interface MySharedRun { id: string; target_spec: string | null; status: string; run_type: string; created_at: string }
export interface MyWonVehicle { id: string; org_id: string; client_id: string; brief_id: string | null; won_snapshot: Record<string, unknown> | null; promoted_at: string }
export interface MyStatusEvent { won_vehicle_id: string; status: WonVehicleStatus; changed_at: string; is_correction: boolean }
export interface MyDocument { id: string; won_vehicle_id: string; document_type: string; original_filename: string; uploaded_at: string }
export interface MyBillingDoc {
  id: string; doc_type: 'invoice' | 'retainer' | 'credit_note'; invoice_kind: string | null; number_text: string; issue_date: string; due_date: string | null;
  currency: string; settlement_currency: string; fx_rate: number | null; scope_statement: string | null; total: number; voided_at: string | null;
  won_vehicle_id: string | null; external_description: string | null;
}
export interface MyBillingLine { document_id: string; position: number; section: string; description: string; quantity: number; rate: number; discount_amount: number; net_amount: number }
export interface MyBalance { document_id: string; outstanding: number; outstanding_settlement: number | null; applied_payments: number; applied_retainer_credits: number; credit_notes: number }
export interface MyPayment { id: string; amount: number; currency: string; paid_at: string; method: string; purpose: string; voided_at: string | null }
export interface MyReceipt { id: string; receipt_number: string; payment_id: string; issued_at: string; voided_at: string | null; file_id: string | null }

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const getMyClientRecord = async (): Promise<MyClientRecord | null> => {
  const { data, error } = await supabase.from('my_client_record').select('*').maybeSingle();
  if (error) throw new Error(`Failed to load your account: ${error.message}`);
  return data as MyClientRecord | null;
};

export const listMyBriefs = (): Promise<MyBrief[]> =>
  fetchAllVerified<MyBrief>('your briefs',
    (from, to) => supabase.from('client_briefs').select('id, make, model, year_min, year_max, status, submitted_at').order('submitted_at', { ascending: false, nullsFirst: false }).range(from, to),
    () => supabase.from('client_briefs').select('id', { count: 'exact', head: true }));

export const listMySharedRuns = (): Promise<MySharedRun[]> =>
  fetchAllVerified<MySharedRun>('runs shared with you',
    (from, to) => supabase.from('research_runs').select('id, target_spec, status, run_type, created_at').order('created_at', { ascending: false }).range(from, to),
    () => supabase.from('research_runs').select('id', { count: 'exact', head: true }));

export const listMyWonVehicles = (): Promise<MyWonVehicle[]> =>
  fetchAllVerified<MyWonVehicle>('your vehicles',
    (from, to) => supabase.from('my_won_vehicles').select('*').order('promoted_at', { ascending: false }).range(from, to),
    () => supabase.from('my_won_vehicles').select('id', { count: 'exact', head: true }));

export const listMyStatusHistory = (wonVehicleId: string): Promise<MyStatusEvent[]> =>
  fetchAllVerified<MyStatusEvent>('vehicle status history',
    (from, to) => supabase.from('won_vehicle_status_history').select('won_vehicle_id, status, changed_at, is_correction').eq('won_vehicle_id', wonVehicleId).order('changed_at').range(from, to),
    () => supabase.from('won_vehicle_status_history').select('id', { count: 'exact', head: true }).eq('won_vehicle_id', wonVehicleId));

export const listMyDocuments = (wonVehicleId: string): Promise<MyDocument[]> =>
  fetchAllVerified<MyDocument>('your documents',
    (from, to) => supabase.from('won_vehicle_documents').select('id, won_vehicle_id, document_type, original_filename, uploaded_at').eq('won_vehicle_id', wonVehicleId).order('uploaded_at', { ascending: false }).range(from, to),
    () => supabase.from('won_vehicle_documents').select('id', { count: 'exact', head: true }).eq('won_vehicle_id', wonVehicleId));

export const getMyDocumentUrl = async (documentId: string): Promise<string> => {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) throw new Error('Please log in.');
  const projectUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string;
  const res = await fetch(`${projectUrl}/functions/v1/won-vehicle-documents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.session.access_token}` },
    body: JSON.stringify({ mode: 'client_file_url', documentId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `The request failed (${res.status})`);
  return data.url as string;
};

export const listMyBillingDocs = async (): Promise<MyBillingDoc[]> => {
  const rows = await fetchAllVerified<Record<string, unknown>>('your invoices',
    (from, to) => supabase.from('billing_documents')
      .select('id, doc_type, invoice_kind, number_text, issue_date, due_date, currency, settlement_currency, fx_rate, scope_statement, total, voided_at, won_vehicle_id, external_description')
      .order('issue_date', { ascending: false }).range(from, to),
    () => supabase.from('billing_documents').select('id', { count: 'exact', head: true }));
  return rows.map(r => ({ ...r, total: Number(r.total), fx_rate: num(r.fx_rate) })) as MyBillingDoc[];
};

export const listMyBillingLines = (documentId: string): Promise<MyBillingLine[]> =>
  fetchAllVerified<Record<string, unknown>>('invoice lines',
    (from, to) => supabase.from('billing_document_lines').select('document_id, position, section, description, quantity, rate, discount_amount, net_amount').eq('document_id', documentId).order('position').range(from, to),
    () => supabase.from('billing_document_lines').select('id', { count: 'exact', head: true }).eq('document_id', documentId))
    .then(rows => rows.map(r => ({ ...r, quantity: Number(r.quantity), rate: Number(r.rate), discount_amount: Number(r.discount_amount), net_amount: Number(r.net_amount) })) as unknown as Promise<MyBillingLine[]>);

export const getMyBalance = async (documentId: string): Promise<MyBalance | null> => {
  const { data, error } = await supabase.from('billing_document_balances')
    .select('document_id, outstanding, outstanding_settlement, applied_payments, applied_retainer_credits, credit_notes').eq('document_id', documentId).maybeSingle();
  if (error) throw new Error(`Failed to load the balance: ${error.message}`);
  if (!data) return null;
  return { ...data, outstanding: Number(data.outstanding), outstanding_settlement: num(data.outstanding_settlement), applied_payments: Number(data.applied_payments), applied_retainer_credits: Number(data.applied_retainer_credits), credit_notes: Number(data.credit_notes) };
};

export const listMyPayments = (): Promise<MyPayment[]> =>
  fetchAllVerified<Record<string, unknown>>('your payments',
    (from, to) => supabase.from('billing_payments').select('id, amount, currency, paid_at, method, purpose, voided_at').order('paid_at', { ascending: false }).range(from, to),
    () => supabase.from('billing_payments').select('id', { count: 'exact', head: true }))
    .then(rows => rows.map(r => ({ ...r, amount: Number(r.amount) })) as unknown as Promise<MyPayment[]>);

export const listMyReceipts = (): Promise<MyReceipt[]> =>
  fetchAllVerified<MyReceipt>('your receipts',
    (from, to) => supabase.from('billing_receipts').select('id, receipt_number, payment_id, issued_at, voided_at, file_id').order('issued_at', { ascending: false }).range(from, to),
    () => supabase.from('billing_receipts').select('id', { count: 'exact', head: true }));

export const getMyReceiptUrl = async (fileId: string): Promise<string> => {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) throw new Error('Please log in.');
  const projectUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string;
  const res = await fetch(`${projectUrl}/functions/v1/billing`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.session.access_token}` },
    body: JSON.stringify({ mode: 'file_url', fileId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `The request failed (${res.status})`);
  return data.url as string;
};

export { STATUS_LABELS, STATUS_SEQUENCE };
export type { WonVehicleStatus };

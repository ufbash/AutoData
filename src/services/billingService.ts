import { supabase } from './supabaseClient';
import { fetchAllVerified } from '../../supabase/functions/_shared/paginatedRead';
import { computeDocument, discountApplied, centsToDecimal } from '../../supabase/functions/_shared/documentMath';
import type { CalcInput, CalcResult } from '../../supabase/functions/_shared/documentMath';

// PROMPT 40 Stage 2 - the staff-side data layer for the current document engine (Prompt 38/39's `billing` Edge
// Function). Reads go straight through the staff-scoped RLS built in Prompt 39 (unchanged by this file); every
// write goes through `billing`, the only writer. The live preview calls `billing_compute` (the SAME function the
// database uses at commit) via RPC - not a parallel reimplementation - so a preview that differs from what gets
// issued is structurally impossible, not just tested against.

const projectUrl = () => (import.meta as any).env?.VITE_SUPABASE_URL as string;

const call = async (body: Record<string, unknown>): Promise<Record<string, any>> => {
  const { data: session, error } = await supabase.auth.getSession();
  if (error || !session.session) throw new Error('Please log in.');
  const res = await fetch(`${projectUrl()}/functions/v1/billing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.session.access_token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `The request failed (${res.status})`);
  return data;
};

// ---------------------------------------------------------------- types
export type DocType = 'invoice' | 'retainer' | 'credit_note';
export type InvoiceKind = 'vehicle_purchase' | 'retail' | 'repair';
export type Origin = 'computed' | 'document_backed' | 'staff_entered';
export type DiscountType = 'none' | 'percent' | 'fixed';
export type Currency = 'USD' | 'NGN';

export interface TaxCode { code: string; label: string; rate_percent: number }
export interface BillingDefault { code: string; label: string; amount: number; currency: Currency; tax_code: string | null }
export interface OrgProfile { legal_name: string; header_lines: string[]; logo_path: string | null; payment_instructions: string[] | null; footer_notes: string[]; origin_footnotes: boolean }

export interface BillingDoc {
  id: string; doc_type: DocType; invoice_kind: InvoiceKind | null; number_text: string; client_id: string;
  won_vehicle_id: string | null; external_plate: string | null; external_vin: string | null; external_description: string | null;
  reference: string | null; issue_date: string; due_date: string | null; currency: Currency; settlement_currency: Currency;
  fx_rate: number | null; fx_basis: 'agreed' | 'live' | null; credit_for_id: string | null; scope_statement: string | null;
  notes: string | null; subtotal: number; total: number; voided_at: string | null; issued_at: string; file_id: string | null;
}
export interface BillingLine {
  id: string; document_id: string; position: number; section: string; component: string | null; description: string;
  quantity: number; rate: number; discount_type: DiscountType; discount_value: number; net_amount: number;
  tax_code: string | null; client_visible: boolean; origin: Origin; basis: string | null; source_ref: string | null;
}
export interface Balance { document_id: string; total: number; outstanding: number; outstanding_settlement: number | null; applied_payments: number; applied_retainer_credits: number; credit_notes: number }
export interface Payment { id: string; client_id: string; won_vehicle_id: string | null; amount: number; currency: Currency; paid_at: string; method: string; purpose: string; reference: string | null; voided_at: string | null }
export interface PaymentRemaining { payment_id: string; amount: number; currency: Currency; unapplied: number; voided_at: string | null }
export interface Receipt { id: string; payment_id: string; receipt_number: string; issued_at: string; voided_at: string | null; file_id: string | null }
export interface VehicleDoc { id: string; document_type: string; original_filename: string }

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const mapDoc = (r: Record<string, unknown>): BillingDoc => ({ ...(r as any), fx_rate: num(r.fx_rate), subtotal: Number(r.subtotal), total: Number(r.total) });
const mapLine = (r: Record<string, unknown>): BillingLine => ({ ...(r as any), quantity: Number(r.quantity), rate: Number(r.rate), discount_value: Number(r.discount_value), net_amount: Number(r.net_amount) });

// ---------------------------------------------------------------- reference data
export const getOrgProfile = async (orgId: string): Promise<OrgProfile | null> => {
  const { data, error } = await supabase.from('org_billing_profile').select('legal_name, header_lines, logo_path, payment_instructions, footer_notes, origin_footnotes').eq('org_id', orgId).maybeSingle();
  if (error) throw new Error(`Failed to load the org profile: ${error.message}`);
  return data as OrgProfile | null;
};
export const listTaxCodesAsOf = async (orgId: string, date: string): Promise<TaxCode[]> => {
  const { data, error } = await supabase.from('tax_codes').select('code, label, rate_percent, effective_from, effective_to').eq('org_id', orgId).lte('effective_from', date).order('code');
  if (error) throw new Error(`Failed to load tax codes: ${error.message}`);
  return (data ?? []).filter((r: any) => !r.effective_to || r.effective_to >= date).map((r: any) => ({ code: r.code, label: r.label, rate_percent: Number(r.rate_percent) }));
};
export const getBillingDefault = async (orgId: string, code: string, date: string): Promise<BillingDefault | null> => {
  const { data, error } = await supabase.from('billing_defaults').select('code, label, amount, currency, tax_code, effective_from, effective_to').eq('org_id', orgId).eq('code', code).lte('effective_from', date).order('effective_from', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Failed to load the ${code} default: ${error.message}`);
  if (!data || (data.effective_to && data.effective_to < date)) return null;
  return { code: data.code, label: data.label, amount: Number(data.amount), currency: data.currency, tax_code: data.tax_code };
};
export const peekNextNumber = async (orgId: string, docType: DocType): Promise<string> => {
  const { data, error } = await supabase.rpc('peek_next_document_number', { p_org: orgId, p_kind: docType });
  if (error) throw new Error(`Failed to read the next number: ${error.message}`);
  return data as string;
};
export const listVehicleDocuments = async (wonVehicleId: string): Promise<VehicleDoc[]> =>
  fetchAllVerified<VehicleDoc>('vehicle documents',
    (from, to) => supabase.from('won_vehicle_documents').select('id, document_type, original_filename').eq('won_vehicle_id', wonVehicleId).is('deleted_at', null).order('uploaded_at', { ascending: false }).range(from, to),
    () => supabase.from('won_vehicle_documents').select('id', { count: 'exact', head: true }).eq('won_vehicle_id', wonVehicleId).is('deleted_at', null));

// ---------------------------------------------------------------- documents, lines, balances
export const listClientDocuments = async (clientId: string): Promise<BillingDoc[]> => {
  const rows = await fetchAllVerified<Record<string, unknown>>('billing documents',
    (from, to) => supabase.from('billing_documents').select('*').eq('client_id', clientId).order('issue_date', { ascending: false }).range(from, to),
    () => supabase.from('billing_documents').select('id', { count: 'exact', head: true }).eq('client_id', clientId));
  return rows.map(mapDoc);
};
export const listVehicleDocumentsBilling = async (wonVehicleId: string): Promise<BillingDoc[]> => {
  const rows = await fetchAllVerified<Record<string, unknown>>('billing documents',
    (from, to) => supabase.from('billing_documents').select('*').eq('won_vehicle_id', wonVehicleId).order('issue_date', { ascending: false }).range(from, to),
    () => supabase.from('billing_documents').select('id', { count: 'exact', head: true }).eq('won_vehicle_id', wonVehicleId));
  return rows.map(mapDoc);
};
export const listLines = async (documentId: string): Promise<BillingLine[]> => {
  const rows = await fetchAllVerified<Record<string, unknown>>('invoice lines',
    (from, to) => supabase.from('billing_document_lines').select('*').eq('document_id', documentId).order('position').range(from, to),
    () => supabase.from('billing_document_lines').select('id', { count: 'exact', head: true }).eq('document_id', documentId));
  return rows.map(mapLine);
};
export const getBalance = async (documentId: string): Promise<Balance | null> => {
  const { data, error } = await supabase.from('billing_document_balances').select('document_id, total, outstanding, outstanding_settlement, applied_payments, applied_retainer_credits, credit_notes').eq('document_id', documentId).maybeSingle();
  if (error) throw new Error(`Failed to load the balance: ${error.message}`);
  if (!data) return null;
  return { ...data, total: Number(data.total), outstanding: Number(data.outstanding), outstanding_settlement: num(data.outstanding_settlement), applied_payments: Number(data.applied_payments), applied_retainer_credits: Number(data.applied_retainer_credits), credit_notes: Number(data.credit_notes) };
};
export const listClientPayments = async (clientId: string): Promise<Payment[]> => {
  const rows = await fetchAllVerified<Record<string, unknown>>('payments',
    (from, to) => supabase.from('billing_payments').select('*').eq('client_id', clientId).order('paid_at', { ascending: false }).range(from, to),
    () => supabase.from('billing_payments').select('id', { count: 'exact', head: true }).eq('client_id', clientId));
  return rows.map(r => ({ ...(r as any), amount: Number(r.amount) }));
};
export const getPaymentRemaining = async (paymentId: string): Promise<PaymentRemaining | null> => {
  const { data, error } = await supabase.from('billing_payment_remaining').select('payment_id, amount, currency, unapplied, voided_at').eq('payment_id', paymentId).maybeSingle();
  if (error) throw new Error(`Failed to load the payment: ${error.message}`);
  if (!data) return null;
  return { ...data, amount: Number(data.amount), unapplied: Number(data.unapplied) };
};
export const listClientReceipts = async (clientId: string): Promise<Receipt[]> =>
  fetchAllVerified<Receipt>('receipts',
    (from, to) => supabase.from('billing_receipts').select('id, payment_id, receipt_number, issued_at, voided_at, file_id').eq('client_id', clientId).order('issued_at', { ascending: false }).range(from, to),
    () => supabase.from('billing_receipts').select('id', { count: 'exact', head: true }).eq('client_id', clientId));

// ---------------------------------------------------------------- the live preview: the SAME function the database calls at commit
export interface PreviewLine { position: number; section?: string; quantity: number | string; rate: number | string; discount_type?: DiscountType; discount_value?: number | string; tax_code?: string | null }
export const previewTotals = async (orgId: string, issueDate: string, lines: PreviewLine[], invoiceDiscount: { type: DiscountType; value: number }, adjustment: number): Promise<CalcResult & { discountApplied: number }> => {
  const { data, error } = await supabase.rpc('billing_compute', { p: {
    org_id: orgId, issue_date: issueDate, lines,
    invoice_discount: { type: invoiceDiscount.type, value: invoiceDiscount.value }, adjustment,
  } });
  if (error) throw new Error(`Could not compute the totals: ${error.message}`);
  const r = data as any;
  const result: CalcResult = {
    lines: r.lines.map((l: any) => ({ position: l.position, grossCents: Math.round(Number(l.gross_amount) * 100), discountCents: Math.round(Number(l.discount_amount) * 100), netCents: Math.round(Number(l.net_amount) * 100), taxCode: l.tax_code, taxRatePercent: Number(l.tax_rate) })),
    sections: r.sections.map((s: any) => ({ title: s.title, subtotalCents: Math.round(Number(s.subtotal) * 100) })),
    subtotalCents: Math.round(Number(r.subtotal) * 100), lineDiscountTotalCents: Math.round(Number(r.line_discount_total) * 100),
    invoiceDiscountCents: Math.round(Number(r.invoice_discount_amount) * 100),
    taxBreakdown: r.tax_breakdown.map((t: any) => ({ code: t.code, ratePercent: Number(t.rate), baseCents: Math.round(Number(t.base) * 100), amountCents: Math.round(Number(t.amount) * 100) })),
    taxTotalCents: Math.round(Number(r.tax_total) * 100), adjustmentCents: Math.round(Number(r.adjustment) * 100), totalCents: Math.round(Number(r.total) * 100),
  };
  return { ...result, discountApplied: Number(centsToDecimal(discountApplied(result))) };
};
// A pure client-side estimate for instant as-you-type feedback (debounced RPC calls are too slow for every
// keystroke); the RPC result above is what actually gets shown as "the number that will be issued" and is what
// must match on issue - this is only for the live-typing feel, clearly never the number relied on to issue.
export const quickEstimate = (input: CalcInput) => { try { return computeDocument(input); } catch { return null; } };

// ---------------------------------------------------------------- writes (all through `billing`)
export interface EditorLine {
  position: number; section: string; description: string; quantity: number | string; rate: number | string;
  discountType: DiscountType; discountValue: number | string; taxCode: string | null; clientVisible: boolean;
  origin: Origin; basis?: string; sourceDocumentId?: string; component?: string | null;
}
export interface IssueInput {
  docType: DocType; invoiceKind?: InvoiceKind; clientId: string; wonVehicleId?: string;
  externalVehicle?: { plate?: string; vin?: string; description?: string };
  reference?: string; issueDate: string; dueDate?: string; currency: Currency; settlementCurrency: Currency;
  fx?: { basis: 'agreed' | 'live'; rate?: number; source?: string };
  scopeStatement?: string; notes?: string; creditForId?: string;
  invoiceDiscount?: { type: DiscountType; value: number };
  adjustment?: { amount: number; label?: string };
  lines: EditorLine[];
  apply?: { kind: 'payment' | 'retainer_credit'; sourceId: string; amount: number; sourceAmount: number }[];
  idempotencyKey: string;
}
export const issueDocument = (input: IssueInput) => call({ mode: 'issue_document', ...input });
export const recordPayment = (input: { clientId: string; wonVehicleId?: string; amount: number; currency: Currency; paidAt: string; method: string; purpose?: 'deposit' | 'payment'; reference?: string; notes?: string; apply?: { documentId: string; amount: number; sourceAmount: number }[] }) =>
  call({ mode: 'record_payment', ...input });
export const applyToDocument = (input: { kind: 'payment' | 'retainer_credit'; documentId: string; sourceId: string; sourceAmount: number }) =>
  call({ mode: 'apply', ...input });
export const voidRecord = (kind: 'document' | 'payment' | 'application' | 'receipt', id: string, reason: string) => call({ mode: 'void', kind, id, reason });
export const issueReceipt = (paymentId: string) => call({ mode: 'issue_receipt', paymentId });
// `forceDownload` asks the signed URL to carry Content-Disposition: attachment (a real download, saved to disk)
// rather than the default, which the browser opens inline (a view, no file touches disk).
export const getFileUrl = (fileId: string, forceDownload = false) => call({ mode: 'file_url', fileId, download: forceDownload }).then(r => r.url as string);

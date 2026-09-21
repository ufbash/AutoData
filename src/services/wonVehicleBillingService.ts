import { supabase } from './supabaseClient';
import { fetchAllVerified } from '../../supabase/functions/_shared/paginatedRead';
import { REQUIRED_KINDS, KIND_LABEL } from '../../supabase/functions/_shared/invoiceRules';
import type { LineInput, ExcludedInput, Hat, InvoiceCurrency, RequiredKind } from '../../supabase/functions/_shared/invoiceRules';
import { getAuctionFeeComponent, getInlandTruckingComponent, getOceanFreightComponent, getDutyComponent } from './bidHeadroomService';
import type { CostComponent } from './bidHeadroomService';
import type { WonVehicle, WonVehicleContext, WinningBid, WonVehicleDestination } from './wonVehicleService';

// PROMPT 37 Phase 2 - billing for one won vehicle: generated invoices, payments, receipts. Writes go through the
// won-vehicle-billing Edge Function (the only writer); reads go through RLS.

const projectUrl = () => (import.meta as any).env?.VITE_SUPABASE_URL as string;

const call = async (body: Record<string, unknown>): Promise<Record<string, any>> => {
  const { data: session, error } = await supabase.auth.getSession();
  if (error || !session.session) throw new Error('Please log in.');
  const res = await fetch(`${projectUrl()}/functions/v1/won-vehicle-billing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.session.access_token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `The request failed (${res.status})`);
  return data;
};

export interface GeneratedInvoice {
  id: string;
  won_vehicle_id: string;
  document_id: string;
  invoice_number: string;
  amount: number;
  currency: InvoiceCurrency;
  amount_usd: number;
  hat: Hat;
  scope: 'complete' | 'partial';
  excluded_components: { kind: RequiredKind; reason: string }[];
  fx_rate: number | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  recipient: string;
  issued_at: string;
  voided_at: string | null;
  void_reason: string | null;
}
export interface InvoiceBalance { issuance_id: string; invoice_amount: number; paid: number; outstanding: number }
export interface Payment {
  id: string; issuance_id: string; won_vehicle_id: string; amount: number; currency: InvoiceCurrency; paid_at: string;
  method: string; reference: string | null; recorded_at: string; voided_at: string | null; void_reason: string | null;
}
export interface Receipt {
  id: string; payment_id: string; document_id: string; receipt_number: string; issued_at: string; voided_at: string | null; void_reason: string | null;
}
export interface InvoiceLineRow { position: number; kind: string; description: string; amount: number; amount_usd: number; client_visible: boolean; origin: string; basis: string | null }

export interface BillingSnapshot { invoices: GeneratedInvoice[]; balances: Record<string, InvoiceBalance>; payments: Payment[]; receipts: Receipt[] }

export const loadBilling = async (wonVehicleId: string): Promise<BillingSnapshot> => {
  const [invoices, payments, receipts, balances] = await Promise.all([
    fetchAllVerified<GeneratedInvoice>('generated invoices',
      (from, to) => supabase.from('won_vehicle_invoice_issuances').select('*').eq('won_vehicle_id', wonVehicleId).eq('generated', true).order('issued_at', { ascending: false }).order('id').range(from, to),
      () => supabase.from('won_vehicle_invoice_issuances').select('id', { count: 'exact', head: true }).eq('won_vehicle_id', wonVehicleId).eq('generated', true)),
    fetchAllVerified<Payment>('payments',
      (from, to) => supabase.from('won_vehicle_payments').select('*').eq('won_vehicle_id', wonVehicleId).order('recorded_at', { ascending: false }).order('id').range(from, to),
      () => supabase.from('won_vehicle_payments').select('id', { count: 'exact', head: true }).eq('won_vehicle_id', wonVehicleId)),
    fetchAllVerified<Receipt>('receipts',
      (from, to) => supabase.from('won_vehicle_receipts').select('*').eq('won_vehicle_id', wonVehicleId).order('issued_at', { ascending: false }).order('id').range(from, to),
      () => supabase.from('won_vehicle_receipts').select('id', { count: 'exact', head: true }).eq('won_vehicle_id', wonVehicleId)),
    fetchAllVerified<InvoiceBalance>('invoice balances',
      (from, to) => supabase.from('won_vehicle_invoice_balances').select('issuance_id, invoice_amount, paid, outstanding').eq('won_vehicle_id', wonVehicleId).order('issuance_id').range(from, to),
      () => supabase.from('won_vehicle_invoice_balances').select('issuance_id', { count: 'exact', head: true }).eq('won_vehicle_id', wonVehicleId)),
  ]);
  const num = (v: unknown) => Number(v);
  return {
    invoices: invoices.map(i => ({ ...i, amount: num(i.amount), amount_usd: num(i.amount_usd), fx_rate: i.fx_rate === null ? null : num(i.fx_rate) })),
    payments: payments.map(p => ({ ...p, amount: num(p.amount) })),
    receipts,
    balances: Object.fromEntries(balances.map(b => [b.issuance_id, { ...b, invoice_amount: num(b.invoice_amount), paid: num(b.paid), outstanding: num(b.outstanding) }])),
  };
};

export const listInvoiceLines = (issuanceId: string): Promise<InvoiceLineRow[]> =>
  fetchAllVerified<InvoiceLineRow>('invoice lines',
    (from, to) => supabase.from('won_vehicle_invoice_lines').select('position, kind, description, amount, amount_usd, client_visible, origin, basis').eq('issuance_id', issuanceId).order('position').range(from, to),
    () => supabase.from('won_vehicle_invoice_lines').select('id', { count: 'exact', head: true }).eq('issuance_id', issuanceId))
    .then(rows => rows.map(r => ({ ...r, amount: Number(r.amount), amount_usd: Number(r.amount_usd) })));

export const issueInvoice = (input: {
  wonVehicleId: string; hat: Hat; currency: InvoiceCurrency; lines: LineInput[]; excluded: ExcludedInput[];
  recipient: string; notes?: string; idempotencyKey: string;
}) => call({ mode: 'issue_invoice', ...input });

export const recordPayment = (input: { issuanceId: string; amount: number; paidAt: string; method: string; reference?: string; notes?: string }) =>
  call({ mode: 'record_payment', ...input });
export const voidPayment = (paymentId: string, reason: string) => call({ mode: 'void_payment', paymentId, reason });
export const issueReceipt = (paymentId: string) => call({ mode: 'issue_receipt', paymentId });
export const voidReceipt = (receiptId: string, reason: string) => call({ mode: 'void_receipt', receiptId, reason });

// ----------------------------------------------------------------------------------------------- pre-fill
// Which components can honestly be pre-filled. ONLY a component that computes for real is proposed as a line; one that
// abstains, is partial, or rests on an approximation (a fee with no known bid method, a freight range) is NOT pre-filled -
// it is listed as needing a real figure or an explicit exclusion. Nothing here invents a number, and the brokerage fee is
// never pre-filled (its schedule is provisional, DECISIONS 2.5).
export interface PrefillItem {
  kind: RequiredKind;
  label: string;
  state: 'real' | 'needs_figure';
  amountUsd: number | null;
  description: string;
  reason: string | null;       // why it could not be pre-filled
  sourceRef: string | null;
}

const fromComponent = (kind: RequiredKind, c: CostComponent | null, describe: string, exactOnly: { ok: boolean; why: string } = { ok: true, why: '' }, sourceRef: string | null = null): PrefillItem => {
  const label = KIND_LABEL[kind];
  if (!c || c.status !== 'available' || c.amountUsd === null) return { kind, label, state: 'needs_figure', amountUsd: null, description: describe, reason: c?.reason ?? 'not calculated', sourceRef: null };
  if (c.partialReason) return { kind, label, state: 'needs_figure', amountUsd: null, description: describe, reason: `partial: ${c.partialReason}`, sourceRef: null };
  if (!exactOnly.ok) return { kind, label, state: 'needs_figure', amountUsd: null, description: describe, reason: exactOnly.why, sourceRef: null };
  return { kind, label, state: 'real', amountUsd: c.amountUsd, description: describe, reason: null, sourceRef };
};

export const computeInvoicePrefill = async (
  wonVehicle: WonVehicle, context: WonVehicleContext, winningBid: WinningBid | null, destination: WonVehicleDestination | null,
): Promise<PrefillItem[]> => {
  const sighting = context.sighting;
  const sightingForCosts = sighting ? { id: sighting.id, source_platform: sighting.source_platform, source_auction_platform: sighting.source_auction_platform, location: sighting.location } : null;

  const items: PrefillItem[] = [];
  // vehicle price: the RECORDED winning bid only - never the approved-price fallback
  items.push(winningBid
    ? { kind: 'vehicle_price', label: KIND_LABEL.vehicle_price, state: 'real', amountUsd: Number(winningBid.amount_usd), description: 'Vehicle price (winning bid)', reason: null, sourceRef: winningBid.id }
    : { kind: 'vehicle_price', label: KIND_LABEL.vehicle_price, state: 'needs_figure', amountUsd: null, description: 'Vehicle price (winning bid)', reason: 'no winning bid has been recorded', sourceRef: null });

  if (!sightingForCosts) {
    for (const k of ['auction_fees', 'inland_trucking', 'ocean_freight'] as RequiredKind[]) items.push({ kind: k, label: KIND_LABEL[k], state: 'needs_figure', amountUsd: null, description: KIND_LABEL[k], reason: 'the source listing capture is no longer available', sourceRef: null });
  } else {
    const [fees, trucking, freight] = await Promise.all([
      winningBid ? getAuctionFeeComponent({ sighting: sightingForCosts, titleType: sighting!.title_type, referencePriceUsd: Number(winningBid.amount_usd), orgId: wonVehicle.org_id, bidMethod: winningBid.bid_method }) : Promise.resolve(null),
      getInlandTruckingComponent({ sighting: sightingForCosts, destinationPortNormalized: destination?.destination_port ?? null, shippingMethod: destination?.shipping_method ?? null, orgId: wonVehicle.org_id }),
      getOceanFreightComponent(wonVehicle.org_id, destination?.shipping_method ?? null, destination?.destination_port ?? null),
    ]);
    items.push(fromComponent('auction_fees', fees, 'Auction fees (at the recorded winning bid)',
      { ok: !!winningBid && !!winningBid.bid_method, why: !winningBid ? 'no winning bid recorded to price the fee at' : 'the bid method (proxy or live) is not recorded, so the fee is a range, not a figure' }));
    items.push(fromComponent('inland_trucking', trucking, destination ? `US inland transport to ${destination.destination_port} (${destination.shipping_method === 'roro' ? 'RoRo' : 'container'})` : 'US inland transport'));
    // freight from a stored range is an approximation: not pre-filled as an exact figure
    const freightIsRange = !!freight && freight.status === 'available' && /Midpoint of/.test(freight.detail);
    items.push(fromComponent('ocean_freight', freight, destination ? `Ocean freight to ${destination.destination_port}` : 'Ocean freight', { ok: !freightIsRange, why: 'the stored rate is a range, not one figure' }));
  }
  items.push(fromComponent('duty', getDutyComponent(), 'Import duty'));
  items.push({ kind: 'brokerage_fee', label: KIND_LABEL.brokerage_fee, state: 'needs_figure', amountUsd: null, description: 'Brokerage fee', reason: 'the fee schedule is not adopted yet - enter the agreed fee with its basis', sourceRef: null });
  return REQUIRED_KINDS.map(k => items.find(i => i.kind === k)!);
};

import { supabase } from './supabaseClient';

// PROMPT 41 Stage 2 - estimate vs actual. Estimates come from bidHeadroomService (rate tables, computed fresh,
// never stored); actuals are real bills, staff-entered, append-only (won_vehicle_actual_costs, migration 078).
// The actual wins for display and invoicing; the estimate is never overwritten, and the variance between them is
// the clearance-history dataset PROJECT_CHARTER.md §8 ranks as the second-most-defensible asset.

export type ActualComponent = 'auction_fees' | 'inland_trucking' | 'ocean_freight' | 'duty' | 'other';

export interface ActualCost {
  id: string; won_vehicle_id: string; component: ActualComponent; component_label: string | null;
  amount: number; currency: string; amount_usd: number | null; fx_rate: number | null; fx_rate_date: string | null;
  evidence_document_id: string | null; note: string | null;
  offered_to_rates: boolean; offered_to_rates_at: string | null;
  recorded_by: string; recorded_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const mapRow = (r: Record<string, unknown>): ActualCost => ({ ...(r as any), amount: Number(r.amount), amount_usd: num(r.amount_usd), fx_rate: num(r.fx_rate) });

// The current actual per component (the view's own DISTINCT ON already picks the latest non-voided row).
export const listCurrentActuals = async (wonVehicleId: string): Promise<ActualCost[]> => {
  const { data, error } = await supabase.from('won_vehicle_actual_costs_current').select('*').eq('won_vehicle_id', wonVehicleId);
  if (error) throw new Error(`Failed to load actual costs: ${error.message}`);
  return (data ?? []).map(mapRow);
};

// The full history for one component (current + superseded + voided), oldest first - for showing what changed.
export const listActualHistory = async (wonVehicleId: string, component: ActualComponent): Promise<ActualCost[]> => {
  const { data, error } = await supabase.from('won_vehicle_actual_costs').select('*').eq('won_vehicle_id', wonVehicleId).eq('component', component).order('recorded_at');
  if (error) throw new Error(`Failed to load the cost history: ${error.message}`);
  return (data ?? []).map(mapRow);
};

export const recordActualCost = async (input: {
  orgId: string; wonVehicleId: string; component: ActualComponent; componentLabel?: string;
  amount: number; currency: string; amountUsd?: number; fxRate?: number; fxRateDate?: string;
  evidenceDocumentId?: string; note?: string; recordedBy: string;
}): Promise<ActualCost> => {
  const cur = (input.currency || 'usd').toLowerCase();
  const payload: Record<string, unknown> = {
    org_id: input.orgId, won_vehicle_id: input.wonVehicleId, component: input.component,
    component_label: input.component === 'other' ? (input.componentLabel || '').trim() : null,
    amount: input.amount, currency: cur,
    evidence_document_id: input.evidenceDocumentId || null, note: input.note || null, recorded_by: input.recordedBy,
  };
  if (cur !== 'usd') {
    if (!input.amountUsd || !input.fxRate || !input.fxRateDate) throw new Error('A non-USD actual needs its USD equivalent, the rate and the date it was fixed at');
    payload.amount_usd = input.amountUsd; payload.fx_rate = input.fxRate; payload.fx_rate_date = input.fxRateDate;
  }
  const { data, error } = await supabase.from('won_vehicle_actual_costs').insert(payload).select('*').single();
  if (error) throw new Error(`Failed to record the actual cost: ${error.message}`);
  return mapRow(data);
};

export const voidActualCost = async (id: string, voidedBy: string, reason: string): Promise<void> => {
  const { error } = await supabase.from('won_vehicle_actual_costs').update({ voided_at: new Date().toISOString(), voided_by: voidedBy, void_reason: reason }).eq('id', id);
  if (error) throw new Error(`Failed to void: ${error.message}`);
};

// Never automatic - flags the actual for staff to review into the rate tables through the existing
// Admin > Rates review gate; it does not itself write a rate.
export const flagActualForRateReview = async (id: string, byUserId: string): Promise<void> => {
  const { error } = await supabase.from('won_vehicle_actual_costs').update({ offered_to_rates: true, offered_to_rates_at: new Date().toISOString(), offered_to_rates_by: byUserId }).eq('id', id);
  if (error) throw new Error(`Failed to flag for review: ${error.message}`);
};

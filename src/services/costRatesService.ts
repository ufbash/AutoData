import { supabase } from './supabaseClient';

// PROMPT 19 Phase 5/6 - C1. PROJECT_CHARTER.md S5.10: rates are never edited in place. A
// changed rate is a new row with a new effective_from; the superseded row gets an
// effective_to. Nothing here computes a duty or a landed cost - that is C2, explicitly out
// of scope until 10+ assessment notices exist (PLAN_TRACKER.md).

export type CostCategory = 'inland_trucking' | 'ocean_freight' | 'duty_component' | 'service_fee';
export type CostRateBasis = 'cif' | 'cif_plus_prior' | 'import_duty';
export type CostRateUnit = 'percent' | 'usd';
export type CostRateSource = 'official_tariff' | 'agent_quote' | 'actual_paid';

export interface CostRate {
  id: string;
  org_id: string;
  cost_category: CostCategory;
  label: string;
  basis: CostRateBasis | null;
  rate_unit: CostRateUnit;
  rate_value: number;
  rate_value_max: number | null;
  source: CostRateSource;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  created_by: string | null;
}

export const listCostRates = async (orgId: string): Promise<CostRate[]> => {
  const { data, error } = await supabase
    .from('cost_rates')
    .select('*')
    .eq('org_id', orgId)
    .order('cost_category', { ascending: true })
    .order('effective_from', { ascending: false });

  if (error) {
    throw new Error(`Failed to list cost rates: ${error.message}`);
  }
  return data || [];
};

export interface NewCostRateInput {
  cost_category: CostCategory;
  label: string;
  basis: CostRateBasis | null;
  rate_unit: CostRateUnit;
  rate_value: number;
  rate_value_max: number | null;
  source: CostRateSource;
  effective_from: string;
}

export const addCostRate = async (orgId: string, userId: string, input: NewCostRateInput): Promise<CostRate> => {
  const { data, error } = await supabase
    .from('cost_rates')
    .insert({
      org_id: orgId,
      created_by: userId,
      cost_category: input.cost_category,
      label: input.label.trim(),
      basis: input.basis,
      rate_unit: input.rate_unit,
      rate_value: input.rate_value,
      rate_value_max: input.rate_value_max,
      source: input.source,
      effective_from: input.effective_from,
      effective_to: null,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to add cost rate: ${error.message}`);
  }
  return data;
};

// Supersede: close the existing row with effective_to, then insert a fresh row starting the
// next day - never an UPDATE of rate_value/rate_unit/etc on the original row. Two separate
// statements (not a single RPC) so a failure after the close-out is visible as a row stuck
// with no successor, rather than silently invisible inside a transaction only this function
// controls - consistent with the rest of this codebase, which does not wrap multi-step writes
// in database transactions.
export const supersedeCostRate = async (
  orgId: string,
  userId: string,
  oldRateId: string,
  oldRateEffectiveFrom: string,
  newRate: NewCostRateInput
): Promise<{ closed: CostRate; created: CostRate }> => {
  if (newRate.effective_from <= oldRateEffectiveFrom) {
    throw new Error('The new rate must take effect after the superseded rate started.');
  }

  const newEffectiveFromDate = new Date(newRate.effective_from + 'T00:00:00Z');
  const closedEffectiveTo = new Date(newEffectiveFromDate.getTime() - 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data: closed, error: closeError } = await supabase
    .from('cost_rates')
    .update({ effective_to: closedEffectiveTo })
    .eq('id', oldRateId)
    .select('*')
    .single();

  if (closeError) {
    throw new Error(`Failed to close the superseded rate: ${closeError.message}`);
  }

  try {
    const created = await addCostRate(orgId, userId, newRate);
    return { closed, created };
  } catch (err) {
    throw new Error(
      `Superseded rate closed (effective_to=${closedEffectiveTo}) but the replacement failed to save: ${
        err instanceof Error ? err.message : String(err)
      }. The rate now has a gap - add the replacement manually.`
    );
  }
};

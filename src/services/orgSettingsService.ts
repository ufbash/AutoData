import { supabase } from './supabaseClient';

// PROMPT 29 Stage 4 - payment tier as configuration, not a code constant
// (bidHeadroomService.ts:115 used to hardcode PAYMENT_TIER = 'unsecured' as const).
// PROJECT_CHARTER.md §5.10's spirit, applied one level up from a rate row: which SCHEDULE
// applies is itself data, not code, when real-world facts (Copart's answer on whether $400 on
// deposit qualifies as Secured) can change it without a deploy.

export type PaymentTier = 'secured' | 'unsecured';

export interface OrgSettings {
  org_id: string;
  copart_payment_tier: PaymentTier;
  updated_at: string;
  updated_by: string | null;
}

// No evidence supports Secured today (PLAN_TRACKER.md debt #43) - a missing settings row
// (an org that has never touched this screen) defaults to exactly the same value the old
// hardcoded constant used, so this change is a no-op for every org until someone deliberately
// flips it.
export const DEFAULT_PAYMENT_TIER: PaymentTier = 'unsecured';

export const getPaymentTier = async (orgId: string): Promise<PaymentTier> => {
  const { data, error } = await supabase
    .from('org_settings')
    .select('copart_payment_tier')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load org settings: ${error.message}`);
  return (data?.copart_payment_tier as PaymentTier | undefined) ?? DEFAULT_PAYMENT_TIER;
};

export const setPaymentTier = async (orgId: string, userId: string, tier: PaymentTier): Promise<void> => {
  const { error } = await supabase
    .from('org_settings')
    .upsert({ org_id: orgId, copart_payment_tier: tier, updated_by: userId }, { onConflict: 'org_id' });
  if (error) throw new Error(`Failed to save payment tier: ${error.message}`);
};

export const getOrgSettings = async (orgId: string): Promise<OrgSettings | null> => {
  const { data, error } = await supabase
    .from('org_settings')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load org settings: ${error.message}`);
  return data;
};

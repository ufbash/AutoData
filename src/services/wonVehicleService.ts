import { supabase } from './supabaseClient';

// PROMPT 34 Stages 2-3 - won vehicle records, promotion, and status lifecycle. Every write here
// goes through an Edge Function (promotion and status changes are never a direct client-side
// .update() - both need service-role-level RPC calls and, for promotion/correction, a superadmin
// check the client cannot be trusted to enforce itself).

export type WonVehicleStatus =
  | 'won' | 'auction_paid' | 'title_received' | 'picked_up' | 'at_origin_port'
  | 'sailed' | 'arrived' | 'customs_cleared' | 'delivered';

export const STATUS_SEQUENCE: WonVehicleStatus[] = [
  'won', 'auction_paid', 'title_received', 'picked_up', 'at_origin_port',
  'sailed', 'arrived', 'customs_cleared', 'delivered',
];

export const STATUS_LABELS: Record<WonVehicleStatus, string> = {
  won: 'Won',
  auction_paid: 'Auction paid',
  title_received: 'Title received',
  picked_up: 'Picked up from yard',
  at_origin_port: 'At origin port',
  sailed: 'Sailed',
  arrived: 'Arrived (destination port)',
  customs_cleared: 'Customs cleared',
  delivered: 'Delivered',
};

export interface WonVehicle {
  id: string;
  org_id: string;
  client_id: string;
  brief_id: string;
  asset_id: string;
  research_run_listing_id: string;
  run_id: string;
  won_snapshot: Record<string, unknown>;
  promoted_by: string;
  promoted_at: string;
  share_token: string | null;
  share_enabled: boolean;
  deleted_at: string | null;
}

export interface WonVehicleStatusHistoryRow {
  id: string;
  won_vehicle_id: string;
  status: WonVehicleStatus;
  changed_by: string;
  changed_at: string;
  is_correction: boolean;
  correction_reason: string | null;
  created_at: string;
}

const getAuthToken = async (): Promise<string> => {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Please log in.');
  return data.session.access_token;
};

const projectUrl = (): string => (import.meta as any).env?.VITE_SUPABASE_URL;

export const listWonVehiclesForBrief = async (briefId: string): Promise<WonVehicle[]> => {
  const { data, error } = await supabase
    .from('won_vehicles')
    .select('*')
    .eq('brief_id', briefId)
    .is('deleted_at', null)
    .order('promoted_at', { ascending: false });
  if (error) throw new Error(`Failed to list won vehicles: ${error.message}`);
  return data || [];
};

export const getWonVehicle = async (id: string): Promise<WonVehicle | null> => {
  const { data, error } = await supabase
    .from('won_vehicles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load won vehicle: ${error.message}`);
  return data;
};

export const listStatusHistory = async (wonVehicleId: string): Promise<WonVehicleStatusHistoryRow[]> => {
  const { data, error } = await supabase
    .from('won_vehicle_status_history')
    .select('*')
    .eq('won_vehicle_id', wonVehicleId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to load status history: ${error.message}`);
  return data || [];
};

export const promoteListing = async (listingId: string): Promise<string> => {
  const token = await getAuthToken();
  const res = await fetch(`${projectUrl()}/functions/v1/won-vehicle-promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ listingId }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || 'Promotion failed');
  return body.wonVehicleId;
};

export const advanceStatus = async (wonVehicleId: string, newStatus: WonVehicleStatus): Promise<void> => {
  const token = await getAuthToken();
  const res = await fetch(`${projectUrl()}/functions/v1/won-vehicle-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ mode: 'advance', wonVehicleId, newStatus }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || 'Status advance failed');
};

export const correctStatus = async (wonVehicleId: string, newStatus: WonVehicleStatus, reason: string): Promise<void> => {
  const token = await getAuthToken();
  const res = await fetch(`${projectUrl()}/functions/v1/won-vehicle-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ mode: 'correct', wonVehicleId, newStatus, reason }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || 'Status correction failed');
};

export const generateTrackingLink = async (wonVehicleId: string): Promise<WonVehicle> => {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const { data, error } = await supabase
    .from('won_vehicles')
    .update({ share_token: token, share_enabled: true })
    .eq('id', wonVehicleId)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to generate tracking link: ${error.message}`);
  return data;
};

export const revokeTrackingLink = async (wonVehicleId: string): Promise<WonVehicle> => {
  const { data, error } = await supabase
    .from('won_vehicles')
    .update({ share_enabled: false })
    .eq('id', wonVehicleId)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to revoke tracking link: ${error.message}`);
  return data;
};

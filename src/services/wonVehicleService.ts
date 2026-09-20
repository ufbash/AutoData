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

// PROMPT 35 Stage 1 - everything the bought-car view needs that is NOT in the frozen snapshot.
// Purchase figures (price, currency, is_bid, source platform, VIN/make/model/year) come ONLY
// from won_vehicles.won_snapshot and are never read from here. This context exists for three
// different jobs: images (evidence, not a figure), cost INPUTS (yard/title/platform, which the
// snapshot does not carry and which the cost functions require), and provenance links.
//
// Known limit, stated rather than hidden: research-capture updates a sighting in place on
// re-capture, so title_type/location here can drift after approval. The snapshot is what stays
// frozen; these inputs are "as currently captured" and are labelled that way in the view.
export interface WonVehicleContext {
  listing: {
    id: string;
    approved_at: string | null;
    approved_via: string | null;
    sighting_id: string | null;
  } | null;
  sighting: {
    id: string;
    lot_number: string | null;
    title_type: string | null;
    location: string | null;
    source_platform: string;
    source_auction_platform: string | null;
    stored_image_urls: string[] | null;
    image_store_status: string | null;
  } | null;
  run: { id: string; client_name: string; run_type: string; created_at: string } | null;
}

export const getWonVehicleContext = async (wv: WonVehicle): Promise<WonVehicleContext> => {
  const { data: listing, error: lErr } = await supabase
    .from('research_run_listings')
    .select('id, approved_at, approved_via, sighting_id')
    .eq('id', wv.research_run_listing_id)
    .maybeSingle();
  if (lErr) throw new Error(`Failed to load source listing: ${lErr.message}`);

  let sighting: WonVehicleContext['sighting'] = null;
  if (listing?.sighting_id) {
    const { data, error } = await supabase
      .from('sightings')
      .select('id, lot_number, title_type, location, source_platform, source_auction_platform, stored_image_urls, image_store_status')
      .eq('id', listing.sighting_id)
      .maybeSingle();
    if (error) throw new Error(`Failed to load source sighting: ${error.message}`);
    sighting = data as WonVehicleContext['sighting'];
  }

  const { data: run, error: rErr } = await supabase
    .from('research_runs')
    .select('id, client_name, run_type, created_at')
    .eq('id', wv.run_id)
    .maybeSingle();
  if (rErr) throw new Error(`Failed to load source run: ${rErr.message}`);

  return { listing: listing ?? null, sighting, run: run ?? null };
};

// Only stored images (private bucket, signed URL) are ever rendered. Remote image_urls are not
// used as a fallback: images.bid.cars fails CORS (docs/SOLVED.md) and hotlinked URLs expire, so
// a "fallback" there is a broken image waiting to happen. No stored image -> null -> placeholder.
export const signedImagePaths = async (paths: string[]): Promise<Record<string, string>> => {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from('vehicle-images').createSignedUrls(paths, 3600);
  if (error) return {};
  const map: Record<string, string> = {};
  (data || []).forEach(d => { if (!d.error && d.signedUrl && d.path) map[d.path] = d.signedUrl; });
  return map;
};

export const getWonVehicleThumbnails = async (wvs: WonVehicle[]): Promise<Record<string, string | null>> => {
  const result: Record<string, string | null> = {};
  wvs.forEach(w => { result[w.id] = null; });
  if (wvs.length === 0) return result;

  const { data: listings } = await supabase
    .from('research_run_listings')
    .select('id, sighting_id')
    .in('id', wvs.map(w => w.research_run_listing_id));
  const sightingIds = (listings || []).map(l => l.sighting_id).filter(Boolean) as string[];
  if (sightingIds.length === 0) return result;

  const { data: sightings } = await supabase
    .from('sightings')
    .select('id, stored_image_urls')
    .in('id', sightingIds);
  const firstPathBySighting = new Map<string, string>();
  (sightings || []).forEach((s: any) => {
    const p = Array.isArray(s.stored_image_urls) ? s.stored_image_urls[0] : null;
    if (p) firstPathBySighting.set(s.id, p);
  });
  const signed = await signedImagePaths(Array.from(new Set(firstPathBySighting.values())));

  const sightingByListing = new Map((listings || []).map(l => [l.id, l.sighting_id as string | null]));
  wvs.forEach(w => {
    const sid = sightingByListing.get(w.research_run_listing_id);
    const path = sid ? firstPathBySighting.get(sid) : undefined;
    result[w.id] = path ? (signed[path] ?? null) : null;
  });
  return result;
};

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

// --- PROMPT 34 Stage 4 - documents anchored to the won vehicle ---
//
// Reads go through RLS (org members and superadmins only); every write goes through the
// won-vehicle-documents Edge Function, the only path that can create or soft-delete a document.
// Nothing here is ever exposed on the tracking page or behind a share token.

export type WonVehicleDocumentType =
  | 'invoice' | 'receipt' | 'shipping_document' | 'bill_of_lading' | 'title' | 'assessment_notice' | 'other';

export const DOCUMENT_TYPES: { value: WonVehicleDocumentType; label: string }[] = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'shipping_document', label: 'Shipping document' },
  { value: 'bill_of_lading', label: 'Bill of lading' },
  { value: 'title', label: 'Title' },
  { value: 'assessment_notice', label: 'Assessment notice' },
  { value: 'other', label: 'Other' },
];

export const DOCUMENT_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
export const DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;

export interface WonVehicleDocument {
  id: string;
  org_id: string;
  won_vehicle_id: string;
  document_type: WonVehicleDocumentType;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  uploaded_at: string;
  deleted_at: string | null;
}

export const listWonVehicleDocuments = async (
  wonVehicleId: string,
  documentType?: WonVehicleDocumentType
): Promise<WonVehicleDocument[]> => {
  let q = supabase
    .from('won_vehicle_documents')
    .select('*')
    .eq('won_vehicle_id', wonVehicleId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });
  if (documentType) q = q.eq('document_type', documentType);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to list documents: ${error.message}`);
  return (data || []) as WonVehicleDocument[];
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });

export const uploadWonVehicleDocument = async (
  wonVehicleId: string,
  documentType: WonVehicleDocumentType,
  file: File
): Promise<WonVehicleDocument> => {
  if (file.size > DOCUMENT_MAX_BYTES) throw new Error('The file is larger than 8 MB.');
  const token = await getAuthToken();
  const res = await fetch(`${projectUrl()}/functions/v1/won-vehicle-documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      mode: 'upload', wonVehicleId, documentType,
      filename: file.name, mimeType: file.type, fileBase64: await fileToBase64(file),
    }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || 'Upload failed');
  return body.document;
};

export const deleteWonVehicleDocument = async (documentId: string): Promise<void> => {
  const token = await getAuthToken();
  const res = await fetch(`${projectUrl()}/functions/v1/won-vehicle-documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ mode: 'delete', documentId }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || 'Delete failed');
};

// Short-lived signed URL, created under the caller's own session - the bucket's staff-select
// policy decides whether they may have one at all.
export const getWonVehicleDocumentUrl = async (storagePath: string): Promise<string | null> => {
  const { data, error } = await supabase.storage
    .from('won-vehicle-documents')
    .createSignedUrl(storagePath, 300);
  if (error) return null;
  return data?.signedUrl ?? null;
};

// The seam with cost_document_extractions (SCHEMA.md): a rate-extraction document already paired
// to this car's asset (Prompt 29 Stage 6) is read through THAT pairing - no second link is stored.
// It is paired to the car, not to this client's purchase, so the view labels it as such.
export interface PairedCostDocument {
  id: string;
  document_type: string;
  original_filename: string | null;
  storage_path: string;
  asset_paired_at: string | null;
}

export const listAssetPairedCostDocuments = async (assetId: string): Promise<PairedCostDocument[]> => {
  const { data, error } = await supabase
    .from('cost_document_extractions')
    .select('id, document_type, original_filename, storage_path, asset_paired_at')
    .eq('asset_id', assetId)
    .order('asset_paired_at', { ascending: false });
  if (error) throw new Error(`Failed to list paired cost documents: ${error.message}`);
  return (data || []) as PairedCostDocument[];
};

// --- PROMPT 34 Stage 5 - invoice issuance record and the "won" notification ---
//
// An invoice is a PDF uploaded to the vehicle's document store (type 'invoice'); an issuance
// records that it was issued. Amount and currency are staff-entered, never derived. Both are behind
// auth and never appear on the tracking page. Reads go through RLS; writes through Edge Functions.

export type InvoiceChannel = 'email' | 'whatsapp' | 'imessage' | 'other';
export type InvoiceCurrency = 'USD' | 'NGN' | 'EUR' | 'GBP';

export const INVOICE_CHANNELS: { value: InvoiceChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'imessage', label: 'iMessage' },
  { value: 'other', label: 'Other' },
];
export const INVOICE_CURRENCIES: InvoiceCurrency[] = ['USD', 'NGN', 'EUR', 'GBP'];

export interface InvoiceIssuance {
  id: string;
  won_vehicle_id: string;
  document_id: string;
  invoice_number: string | null;
  amount: number;
  currency: InvoiceCurrency;
  channel: InvoiceChannel;
  recipient: string;
  issued_at: string;
  issued_by: string;
  recorded_at: string;
  notes: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export const listInvoiceIssuances = async (wonVehicleId: string): Promise<InvoiceIssuance[]> => {
  const { data, error } = await supabase
    .from('won_vehicle_invoice_issuances')
    .select('*')
    .eq('won_vehicle_id', wonVehicleId)
    .order('issued_at', { ascending: false });
  if (error) throw new Error(`Failed to list invoice issuances: ${error.message}`);
  return (data || []) as InvoiceIssuance[];
};

export interface IssueInvoiceInput {
  wonVehicleId: string;
  documentId: string;
  invoiceNumber?: string;
  amount: number;
  currency: InvoiceCurrency;
  channel: InvoiceChannel;
  recipient: string;
  issuedAt?: string;
  notes?: string;
}

const callFunction = async (name: string, body: unknown): Promise<any> => {
  const token = await getAuthToken();
  const res = await fetch(`${projectUrl()}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
};

export const issueInvoice = async (input: IssueInvoiceInput): Promise<InvoiceIssuance> => {
  const { ok, data } = await callFunction('won-vehicle-invoices', { mode: 'issue', ...input });
  if (!ok || data.error) throw new Error(data.error || 'Could not record the issuance');
  return data.issuance;
};

export const voidInvoiceIssuance = async (issuanceId: string, reason: string): Promise<void> => {
  const { ok, data } = await callFunction('won-vehicle-invoices', { mode: 'void', issuanceId, reason });
  if (!ok || data.error) throw new Error(data.error || 'Could not void the issuance');
};

export interface NotificationPreview {
  to: string | null;
  subject: string;
  text: string;
  trackingUrl: string | null;
  problems: string[];
}

export const previewNotification = async (wonVehicleId: string): Promise<NotificationPreview> => {
  const { ok, data } = await callFunction('won-vehicle-notify', { mode: 'preview', wonVehicleId });
  if (!ok || data.error) throw new Error(data.error || 'Could not render the notification');
  return data;
};

export interface NotificationSendResult { sent: boolean; to: string | null; error?: string }

export const sendNotification = async (
  wonVehicleId: string,
  mode: 'test' | 'send',
  testRecipient?: string
): Promise<NotificationSendResult> => {
  const { data } = await callFunction('won-vehicle-notify', { mode, wonVehicleId, ...(testRecipient ? { testRecipient } : {}) });
  // A failed send is a normal, reported outcome (already recorded in email_log), not a thrown error.
  return { sent: data.sent === true, to: data.to ?? null, error: data.error };
};

export interface NotificationLogRow {
  id: string;
  purpose: string;
  recipient_email: string;
  status: 'sent' | 'failed';
  error_text: string | null;
  created_at: string;
}

export const listNotificationLog = async (wonVehicleId: string): Promise<NotificationLogRow[]> => {
  const { data, error } = await supabase
    .from('email_log')
    .select('id, purpose, recipient_email, status, error_text, created_at')
    .eq('related_table', 'won_vehicles')
    .eq('related_id', wonVehicleId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(`Failed to load the notification log: ${error.message}`);
  return (data || []) as NotificationLogRow[];
};

export const getClientContact = async (clientId: string): Promise<{ full_name: string; email: string | null } | null> => {
  const { data, error } = await supabase.from('clients').select('full_name, email').eq('id', clientId).maybeSingle();
  if (error) throw new Error(`Failed to load the client: ${error.message}`);
  return data;
};

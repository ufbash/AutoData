import { supabase } from './supabaseClient';
import { fetchAllVerified } from '../../supabase/functions/_shared/paginatedRead';

// PROMPT 32 Stage 2 (debt #46) - reviewed asset merge. Detection and confirmation are two
// separate calls on purpose: listing candidates never merges anything by itself, and the
// confirm call always names both asset ids explicitly rather than acting on a stored
// "recommendation" - a human reviewing MergeCandidate.reasons/doNotMerge is the only thing that
// decides whether confirmMerge is ever called. See DECISIONS.md.

export interface AssetRecord {
  id: string;
  org_id: string;
  vin: string | null;
  make: string;
  model: string;
  year: number | null;
  trim: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  origin_status: string | null;
  fingerprint_hash: string;
  body_style: string | null;
  cylinders: number | null;
  engine_type: string | null;
  transmission: string | null;
  fuel: string | null;
  drivetrain: string | null;
  horsepower: number | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  merged_into_asset_id: string | null;
}

export interface AssetSide {
  asset: AssetRecord;
  sightings: Record<string, unknown>[];
  auction_history: Record<string, unknown>[];
}

export interface FieldDisagreement {
  field: string;
  survivorValue: unknown;
  orphanValue: unknown;
}

export interface MergeCandidate {
  survivor: AssetSide;
  orphanCandidate: AssetSide;
  doNotMerge: boolean;
  reasons: string[];
  fieldDisagreements: FieldDisagreement[];
}

const getAuthedFetchArgs = async (): Promise<{ token: string; projectUrl: string }> => {
  const { data: sessionData, error } = await supabase.auth.getSession();
  if (error || !sessionData.session) {
    throw new Error('Please log in to review asset merges.');
  }
  const projectUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
  return { token: sessionData.session.access_token, projectUrl };
};

export const listMergeCandidates = async (): Promise<MergeCandidate[]> => {
  const { token, projectUrl } = await getAuthedFetchArgs();
  const response = await fetch(`${projectUrl}/functions/v1/asset-merge-candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  if (response.status === 403) throw new Error('Asset merge review is restricted to administrators.');
  if (response.status === 401) throw new Error('Please log in to review asset merges.');
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to list merge candidates: ${errText}`);
  }
  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result.candidates;
};

export const confirmMerge = async (survivorId: string, orphanId: string): Promise<Record<string, unknown>> => {
  const { token, projectUrl } = await getAuthedFetchArgs();
  const response = await fetch(`${projectUrl}/functions/v1/asset-merge-confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ survivorId, orphanId }),
  });
  if (response.status === 403) throw new Error('Asset merge is restricted to administrators.');
  if (response.status === 401) throw new Error('Please log in to merge assets.');
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Merge failed: ${errText}`);
  }
  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result.result;
};

export interface MergeDismissal {
  id: string;
  survivor_asset_id: string;
  orphan_asset_id: string;
  reason: string | null;
  decided_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

const postDismiss = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const { token, projectUrl } = await getAuthedFetchArgs();
  const response = await fetch(`${projectUrl}/functions/v1/asset-merge-dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.error || 'The decision could not be recorded.');
  return result;
};

// "These two are NOT the same car" - recorded (who, when, why) and the pair stops being offered.
export const dismissMergeCandidate = (survivorId: string, orphanId: string, reason?: string) =>
  postDismiss({ mode: 'dismiss', survivorId, orphanId, reason });

// A mistaken dismissal is voided with a reason (never deleted), and the pair is offered again.
export const restoreMergeCandidate = (decisionId: string, reason: string) =>
  postDismiss({ mode: 'restore', decisionId, reason });

// Live dismissals, newest first. Read through RLS.
export const listDismissals = (): Promise<MergeDismissal[]> => fetchAllVerified<MergeDismissal>(
  'merge dismissals',
  (from, to) => supabase.from('asset_merge_decisions')
    .select('id, survivor_asset_id, orphan_asset_id, reason, decided_at, voided_at, void_reason')
    .is('voided_at', null).order('decided_at', { ascending: false }).order('id').range(from, to),
  () => supabase.from('asset_merge_decisions').select('id', { count: 'exact', head: true }).is('voided_at', null),
);

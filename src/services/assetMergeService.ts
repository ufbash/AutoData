import { supabase } from './supabaseClient';

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

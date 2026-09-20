import { supabase } from './supabaseClient';
import { CostCategory, CostRateBasis, CostRateUnit, CostRateSource } from './costRatesService';
import { fetchExchangeRates } from './currencyService';

// PROMPT 22 Phase 4 — the review/confirm screen's data layer. Reads/writes
// cost_document_extractions (migration 032) and, only on confirm, writes to the appropriate
// live rate table with a human-set source/effective_from — never anything carried from the
// extraction itself. See supabase/functions/extract-cost-document/index.ts for how rows get
// staged in the first place.

export type DocumentType = 'trucking_quote' | 'shipping_quote' | 'customs_quote' | 'assessment_notice' | 'other';
export type ExtractionStatus = 'pending_review' | 'confirmed' | 'rejected';
export type TargetRateTable = 'cost_rates' | 'trucking_rates' | 'auction_fee_brackets';
export type FieldStatus = 'read' | 'not_present' | 'unreadable';

export interface ExtractedField {
  value: any;
  status: FieldStatus;
}

export interface ExtractedRow {
  suggested_target_table: TargetRateTable;
  fields: Record<string, ExtractedField>;
  cross_check?: string;
  // UI-only, added client-side when editing before confirm — never sent to the server as-is.
  _excluded?: boolean;
}

export interface CostDocumentExtraction {
  id: string;
  org_id: string;
  document_type: DocumentType;
  storage_path: string;
  original_filename: string | null;
  mime_type: string;
  extracted_rows: ExtractedRow[];
  extraction_error: string | null;
  extraction_status: ExtractionStatus;
  target_rate_table: TargetRateTable | null;
  confirmed_row_ids: string[] | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  created_by: string | null;
  // PROMPT 29 Stage 6 (migration 035) — both always human-set, never model-inferred.
  asset_id: string | null;
  asset_paired_by: string | null;
  asset_paired_at: string | null;
  declared_value: number | null;
  declared_value_currency: 'NGN' | 'USD' | 'EUR' | 'GBP' | null;
}

// Pairs an extraction with the specific vehicle it describes. Always a human's own choice made
// in the review screen (e.g. by searching the asset by VIN) — never set from anything the
// extraction itself read off the document. asset_id: null unpairs.
export const setExtractionAsset = async (
  extractionId: string,
  userId: string,
  assetId: string | null
): Promise<void> => {
  const { error } = await supabase
    .from('cost_document_extractions')
    .update({
      asset_id: assetId,
      asset_paired_by: assetId ? userId : null,
      asset_paired_at: assetId ? new Date().toISOString() : null,
    })
    .eq('id', extractionId);
  if (error) throw new Error(`Failed to set asset pairing: ${error.message}`);
};

// Records an assessment notice's own stated declared/assessed value, for later comparison
// against what was actually paid. Purely a place for the figure to land — no comparison or
// duty calculation is computed here or anywhere yet.
export const setDeclaredValue = async (
  extractionId: string,
  value: number | null,
  currency: 'NGN' | 'USD' | 'EUR' | 'GBP' | null
): Promise<void> => {
  const { error } = await supabase
    .from('cost_document_extractions')
    .update({ declared_value: value, declared_value_currency: value != null ? currency : null })
    .eq('id', extractionId);
  if (error) throw new Error(`Failed to set declared value: ${error.message}`);
};

export interface AssetSearchResult {
  id: string;
  vin: string | null;
  make: string;
  model: string;
  year: number | null;
}

export const getAssetById = async (assetId: string): Promise<AssetSearchResult | null> => {
  const { data, error } = await supabase
    .from('assets')
    .select('id, vin, make, model, year')
    .eq('id', assetId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load asset: ${error.message}`);
  return data;
};

// Minimal search for the asset picker — matches VIN (exact/partial) or make/model. Human reads
// the results and picks the one they mean; nothing here is auto-selected.
//
// PROMPT 32 Stage 2 (debt #46) - excludes soft-retired (merged-away) assets, and (migration 046)
// soft-deleted ones. Without this, a
// human pairing a NEW cost document could pick a dead orphan by mistake - its raw fields are
// still intact and would still match a VIN/make/model search - and the document would attach to
// a row nothing else references any more. getAssetById (below) intentionally does NOT filter
// this, since it is also used to display an already-paired document's target, which may
// legitimately be a since-merged asset.
export const searchAssets = async (query: string): Promise<AssetSearchResult[]> => {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from('assets')
    .select('id, vin, make, model, year')
    .is('merged_into_asset_id', null)
    .is('deleted_at', null)
    .or(`vin.ilike.%${q}%,make.ilike.%${q}%,model.ilike.%${q}%`)
    .limit(10);
  if (error) throw new Error(`Failed to search assets: ${error.message}`);
  return data || [];
};

export const listExtractions = async (orgId: string, status?: ExtractionStatus): Promise<CostDocumentExtraction[]> => {
  let q = supabase
    .from('cost_document_extractions')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('extraction_status', status);

  const { data, error } = await q;
  if (error) throw new Error(`Failed to list extractions: ${error.message}`);
  return data || [];
};

export const getSignedDocumentUrl = async (storagePath: string, expiresIn = 3600): Promise<string | null> => {
  const { data, error } = await supabase.storage
    .from('cost-documents')
    .createSignedUrl(storagePath, expiresIn);
  if (error) {
    console.error(`Failed to sign document URL: ${error.message}`);
    return null;
  }
  return data?.signedUrl || null;
};

// base64-encodes the file and calls the staff-only extract-cost-document Edge Function
// (JWT + superadmin, same auth pattern as extract-vehicle-vision). Mirrors the exact fetch
// pattern already used in geminiService.ts's extractVehicleDataFromImages.
export const uploadAndExtract = async (
  orgId: string,
  documentType: DocumentType,
  file: File
): Promise<CostDocumentExtraction> => {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) {
    throw new Error('Please log in to extract a cost document.');
  }
  const token = sessionData.session.access_token;
  const projectUrl = (import.meta as any).env?.VITE_SUPABASE_URL;

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const response = await fetch(`${projectUrl}/functions/v1/extract-cost-document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      org_id: orgId,
      document_type: documentType,
      filename: file.name,
      mime_type: file.type || 'application/octet-stream',
      file_base64: base64,
    }),
  });

  if (response.status === 403) throw new Error('Cost document extraction is restricted to administrators.');
  if (response.status === 401) throw new Error('Please log in to extract a cost document.');
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Extraction failed: ${errText}`);
  }

  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result;
};

export const rejectExtraction = async (extractionId: string, userId: string): Promise<void> => {
  const { error } = await supabase
    .from('cost_document_extractions')
    .update({
      extraction_status: 'rejected',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', extractionId);
  if (error) throw new Error(`Failed to reject extraction: ${error.message}`);
};

// Basic trim/collapse/uppercase normalisation — a defensible baseline, NOT the full
// PORT_ALIASES table the deterministic importer (scripts/lib/truckingRatesParser.mjs) uses.
// Acceptable here because every row is edited/confirmed by a human before it's ever written
// (PLAN_TRACKER.md debt convention: extend the alias table when a real gap is found, never
// guess a correction that isn't explicitly listed).
const normalizePortName = (raw: string): string => raw.trim().replace(/\s+/g, ' ').toUpperCase();

export interface ConfirmInput {
  orgId: string;
  userId: string;
  extractionId: string;
  targetTable: TargetRateTable;
  source: CostRateSource;
  effectiveFrom: string; // YYYY-MM-DD, human-chosen — never carried from the extraction
  // Only the rows the reviewer has not excluded, with their (possibly edited) field values.
  rows: Record<string, any>[];
}

// Writes each included row to the chosen live rate table, then marks the extraction
// confirmed with the resulting row ids — never the other way around, so a partial failure
// here never leaves the extraction claiming a confirmation that didn't actually land.
// PROMPT 28 Stage 2 (C1d) - freeze at confirmation, never recompute at read
// (PROJECT_CHARTER.md S5.10's dated-rate discipline, extended to currency). The FX rate is
// fetched here, once for the whole confirm, never typed by the reviewer; the currency itself
// is the reviewer's own call, read off the source document the extraction guard correctly
// abstained on. A currency this can't resolve a rate for aborts before anything is written -
// currencyService's own convertToUSD has a silent "return the unconverted amount" fallback
// for a missing rate, which is exactly the ~1,395x mispricing class of bug this whole design
// exists to prevent, so it is never reached from here: the rate's presence is checked first.
interface CurrencyFields {
  currency: string;
  amount_usd: number | null;
  fx_rate: number | null;
  fx_rate_date: string | null;
}

const resolveCurrencyFields = (
  rawAmount: number,
  currencyRaw: string | undefined,
  isPercentUnit: boolean,
  rates: Record<string, number> | null,
  fxDate: string
): CurrencyFields => {
  const currency = (currencyRaw || 'usd').toLowerCase();
  // A percentage has no currency dimension to convert - always usd, regardless of what the
  // reviewer selected, since the stored value is a rate, not an amount.
  if (currency === 'usd' || isPercentUnit) {
    return { currency: 'usd', amount_usd: null, fx_rate: null, fx_rate_date: null };
  }
  const code = currency.toUpperCase();
  const rate = rates?.[code];
  if (!rate) {
    throw new Error(`No exchange rate available for currency "${code}" - cannot confirm without a fetched rate.`);
  }
  const amountUsd = Math.round((rawAmount / rate) * 100) / 100;
  return { currency, amount_usd: amountUsd, fx_rate: rate, fx_rate_date: fxDate };
};

export const confirmExtraction = async (input: ConfirmInput): Promise<string[]> => {
  const { orgId, userId, extractionId, targetTable, source, effectiveFrom, rows } = input;
  if (rows.length === 0) throw new Error('At least one row must be included to confirm.');

  const needsRates = rows.some(r => (r.currency || 'usd').toLowerCase() !== 'usd');
  const rates = needsRates ? await fetchExchangeRates() : null;
  const fxDate = new Date().toISOString().slice(0, 10);

  const insertedIds: string[] = [];

  for (const row of rows) {
    if (targetTable === 'cost_rates') {
      const currencyFields = resolveCurrencyFields(Number(row.rate_value), row.currency, row.rate_unit === 'percent', rates, fxDate);
      const { data, error } = await supabase.from('cost_rates').insert({
        org_id: orgId,
        created_by: userId,
        cost_category: row.cost_category as CostCategory,
        label: String(row.label || '').trim(),
        basis: (row.basis || null) as CostRateBasis | null,
        rate_unit: row.rate_unit as CostRateUnit,
        rate_value: Number(row.rate_value),
        rate_value_max: row.rate_value_max != null && row.rate_value_max !== '' ? Number(row.rate_value_max) : null,
        source,
        effective_from: effectiveFrom,
        effective_to: null,
        ...currencyFields,
      }).select('id').single();
      if (error) throw new Error(`Failed to insert cost_rates row ("${row.label}"): ${error.message}`);
      insertedIds.push(data.id);
    } else if (targetTable === 'trucking_rates') {
      const currencyFields = resolveCurrencyFields(Number(row.price), row.currency, false, rates, fxDate);
      const portRaw = String(row.destination_port_raw || '').trim();
      const { data, error } = await supabase.from('trucking_rates').insert({
        org_id: orgId,
        created_by: userId,
        vendor: String(row.vendor || '').trim(),
        auction_platform: row.auction_platform,
        yard_state: String(row.yard_state || '').trim(),
        yard_city: String(row.yard_city || '').trim(),
        yard_street: row.yard_street ? String(row.yard_street).trim() : null,
        destination_port_raw: portRaw,
        destination_port_normalized: normalizePortName(portRaw),
        shipping_method: row.shipping_method,
        price: Number(row.price),
        source,
        effective_from: effectiveFrom,
        effective_to: null,
        ...currencyFields,
      }).select('id').single();
      if (error) throw new Error(`Failed to insert trucking_rates row: ${error.message}`);
      insertedIds.push(data.id);
    } else if (targetTable === 'auction_fee_brackets') {
      const currencyFields = resolveCurrencyFields(Number(row.fee_value), row.currency, row.fee_unit === 'percent', rates, fxDate);
      const { data, error } = await supabase.from('auction_fee_brackets').insert({
        org_id: orgId,
        created_by: userId,
        auction_platform: row.auction_platform,
        member_account: String(row.member_account || '').trim(),
        fee_type: row.fee_type,
        title_status: row.title_status,
        payment_tier: row.payment_tier,
        bid_method: row.bid_method || null,
        bracket_min: Number(row.bracket_min),
        bracket_max: row.bracket_max != null && row.bracket_max !== '' ? Number(row.bracket_max) : null,
        fee_unit: row.fee_unit,
        fee_value: Number(row.fee_value),
        source,
        effective_from: effectiveFrom,
        effective_to: null,
        ...currencyFields,
      }).select('id').single();
      if (error) throw new Error(`Failed to insert auction_fee_brackets row: ${error.message}`);
      insertedIds.push(data.id);
    }
  }

  const { error: updateError } = await supabase
    .from('cost_document_extractions')
    .update({
      extraction_status: 'confirmed',
      target_rate_table: targetTable,
      confirmed_row_ids: insertedIds,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', extractionId);

  if (updateError) {
    throw new Error(
      `${insertedIds.length} row(s) were written to ${targetTable} (ids: ${insertedIds.join(', ')}) but marking the extraction confirmed failed: ${updateError.message}. The rate rows are live; fix the extraction record's status manually.`
    );
  }

  return insertedIds;
};

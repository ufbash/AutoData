import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  listExtractions,
  uploadAndExtract,
  getSignedDocumentUrl,
  confirmExtraction,
  rejectExtraction,
  CostDocumentExtraction,
  DocumentType,
  TargetRateTable,
  ExtractionStatus,
} from '../services/costDocumentExtractionsService';
import { CostRateSource } from '../services/costRatesService';
import { Upload, Loader2, FileText, Check, X, AlertTriangle } from 'lucide-react';

// PROMPT 22 Phase 4 — the review/confirm screen. Editing before confirming is the point
// (the AI's output is a draft); nothing here writes to a rate table until a human explicitly
// confirms, and source/effective_from are always set here, never carried from the extraction.

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  trucking_quote: 'Trucking quote',
  shipping_quote: 'Shipping quote',
  customs_quote: 'Customs quote',
  assessment_notice: 'Assessment notice',
  other: 'Other',
};

const TARGET_TABLE_LABELS: Record<TargetRateTable, string> = {
  cost_rates: 'Cost Rates',
  trucking_rates: 'Trucking Rates',
  auction_fee_brackets: 'Auction Fee Brackets',
};

const SOURCE_LABELS: Record<CostRateSource, string> = {
  official_tariff: 'Official tariff',
  agent_quote: 'Agent quote',
  actual_paid: 'Actual paid',
};

const TABLE_FIELD_ORDER: Record<TargetRateTable, string[]> = {
  cost_rates: ['cost_category', 'label', 'basis', 'rate_unit', 'rate_value', 'rate_value_max'],
  trucking_rates: ['vendor', 'auction_platform', 'yard_state', 'yard_city', 'yard_street', 'destination_port_raw', 'shipping_method', 'price'],
  auction_fee_brackets: ['auction_platform', 'member_account', 'fee_type', 'title_status', 'payment_tier', 'bid_method', 'bracket_min', 'bracket_max', 'fee_unit', 'fee_value'],
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'read') return null;
  if (status === 'not_present') {
    return <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded ml-1">not in document</span>;
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded ml-1 flex items-center gap-1 inline-flex">
      <AlertTriangle className="w-2.5 h-2.5" /> not visible — enter manually
    </span>
  );
};

const UploadPanel: React.FC<{ orgId: string; onUploaded: () => void }> = ({ orgId, onUploaded }) => {
  const [documentType, setDocumentType] = useState<DocumentType>('customs_quote');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!file) { setError('Choose a file first.'); return; }
    setUploading(true);
    setError(null);
    setLastSummary(null);
    try {
      const result: any = await uploadAndExtract(orgId, documentType, file);
      setLastSummary(result.document_summary || null);
      setFile(null);
      onUploaded();
    } catch (err: any) {
      setError(err.message || 'Extraction failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Upload a document for extraction</h3>
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
      {lastSummary && <div className="mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2">Extracted: {lastSummary}</div>}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Document type</label>
          <select value={documentType} onChange={e => setDocumentType(e.target.value as DocumentType)} className="border border-gray-300 rounded-md px-3 py-2 text-sm">
            {(Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]).map(t => (
              <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">File (PDF or image)</label>
          <input type="file" accept=".pdf,image/*,.txt,.csv" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm" />
        </div>
        <button
          onClick={handleUpload}
          disabled={uploading || !file}
          className="flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white text-sm font-bold rounded-lg hover:bg-[#2d2c35] disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {uploading ? 'Extracting (runs the document through two independent passes)…' : 'Upload & Extract'}
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Nothing here writes to a live rate table. This only stages a draft for review below.
      </p>
    </div>
  );
};

interface ReviewRowState {
  included: boolean;
  values: Record<string, string>;
}

const ReviewDetail: React.FC<{
  extraction: CostDocumentExtraction;
  orgId: string;
  userId: string;
  onDone: () => void;
}> = ({ extraction, orgId, userId, onDone }) => {
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [targetTable, setTargetTable] = useState<TargetRateTable>(
    extraction.extracted_rows[0]?.suggested_target_table || 'cost_rates'
  );
  const [source, setSource] = useState<CostRateSource>('agent_quote');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [rowStates, setRowStates] = useState<ReviewRowState[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSignedDocumentUrl(extraction.storage_path).then(setDocUrl);
  }, [extraction.storage_path]);

  useEffect(() => {
    setRowStates(extraction.extracted_rows.map(row => {
      const values: Record<string, string> = {};
      for (const field of TABLE_FIELD_ORDER[targetTable]) {
        const f = row.fields[field];
        values[field] = f && f.status === 'read' && f.value != null ? String(f.value) : '';
      }
      return { included: row.suggested_target_table === targetTable, values };
    }));
  }, [targetTable, extraction]);

  const handleConfirm = async () => {
    setError(null);
    const includedRows = rowStates.filter(r => r.included).map(r => r.values);
    if (includedRows.length === 0) {
      setError('Include at least one row (check the box) to confirm.');
      return;
    }
    setSaving(true);
    try {
      await confirmExtraction({
        orgId, userId, extractionId: extraction.id, targetTable, source, effectiveFrom, rows: includedRows,
      });
      onDone();
    } catch (err: any) {
      setError(err.message || 'Failed to confirm.');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!window.confirm('Reject this extraction? The document and the draft stay on record, but nothing is written to any rate table.')) return;
    setSaving(true);
    setError(null);
    try {
      await rejectExtraction(extraction.id, userId);
      onDone();
    } catch (err: any) {
      setError(err.message || 'Failed to reject.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-gray-200 mt-3 pt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Source document</h4>
        {docUrl ? (
          extraction.mime_type.startsWith('image/') ? (
            <img src={docUrl} alt={extraction.original_filename || 'document'} className="w-full border border-gray-200 rounded-lg" />
          ) : (
            <embed src={docUrl} type={extraction.mime_type} className="w-full h-[500px] border border-gray-200 rounded-lg" />
          )
        ) : (
          <div className="flex items-center justify-center h-48 bg-gray-50 border border-gray-200 rounded-lg text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
      </div>

      <div onClick={e => e.stopPropagation()}>
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Extracted rows — edit before confirming</h4>
        {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

        <div className="flex flex-wrap gap-3 mb-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-1">Confirm into</label>
            <select value={targetTable} onChange={e => setTargetTable(e.target.value as TargetRateTable)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
              {(Object.keys(TARGET_TABLE_LABELS) as TargetRateTable[]).map(t => (
                <option key={t} value={t}>{TARGET_TABLE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-1">Source (human-set)</label>
            <select value={source} onChange={e => setSource(e.target.value as CostRateSource)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
              {(Object.keys(SOURCE_LABELS) as CostRateSource[]).map(s => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-1">Effective from (human-set)</label>
            <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
        </div>

        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {extraction.extracted_rows.map((row, i) => {
            const state = rowStates[i];
            if (!state) return null;
            const shapesMatch = row.suggested_target_table === targetTable;
            return (
              <div key={i} className={`border rounded-lg p-3 ${shapesMatch ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-500">
                    <input
                      type="checkbox"
                      checked={state.included}
                      onChange={e => setRowStates(rs => rs.map((r, j) => j === i ? { ...r, included: e.target.checked } : r))}
                    />
                    Include row {i + 1}
                    {!shapesMatch && <span className="text-amber-600 font-normal normal-case">— extracted as {TARGET_TABLE_LABELS[row.suggested_target_table]} shape, review before including</span>}
                  </label>
                  {row.cross_check && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${row.cross_check === 'agreed' ? 'bg-green-50 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {row.cross_check === 'agreed' ? 'two passes agreed' : row.cross_check.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {TABLE_FIELD_ORDER[targetTable].map(field => {
                    const f = row.fields[field];
                    return (
                      <div key={field}>
                        <label className="block text-[10px] text-gray-500">
                          {field}
                          {f && <StatusBadge status={f.status} />}
                        </label>
                        <input
                          type="text"
                          value={state.values[field] ?? ''}
                          onChange={e => setRowStates(rs => rs.map((r, j) => j === i ? { ...r, values: { ...r.values, [field]: e.target.value } } : r))}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={handleConfirm} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-green-700 text-white text-sm font-bold rounded-lg hover:bg-green-800 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirm selected rows
          </button>
          <button onClick={handleReject} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-700 border border-red-200 text-sm font-bold rounded-lg hover:bg-red-100 disabled:opacity-50">
            <X className="w-4 h-4" /> Reject extraction
          </button>
        </div>
      </div>
    </div>
  );
};

const CostDocumentExtractions: React.FC = () => {
  const { orgId, user, role } = useAuth();
  const [extractions, setExtractions] = useState<CostDocumentExtraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ExtractionStatus>('pending_review');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      setExtractions(await listExtractions(orgId));
    } catch (err: any) {
      setError(err.message || 'Failed to load extractions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [orgId]);

  if (role !== 'superadmin') {
    return (
      <div className="bg-white p-8 rounded-xl shadow-sm border border-[#ba3b46]/20 text-center">
        <h2 className="text-xl font-bold text-[#403f4c] mb-2">Access Restricted</h2>
        <p className="text-gray-500">Cost document extraction is platform data — only a superadmin may review it (PROJECT_CHARTER.md §3).</p>
      </div>
    );
  }

  const filtered = extractions.filter(e => e.extraction_status === tab);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#403f4c]">Cost Document Extraction</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload a customs quote, shipping quote, trucking quote, or assessment notice. AI stages a draft;
          nothing reaches cost_rates, trucking_rates, or auction_fee_brackets until you review and confirm it here.
        </p>
      </div>

      {orgId && <UploadPanel orgId={orgId} onUploaded={load} />}

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      <div className="flex gap-2 mb-4">
        {(['pending_review', 'confirmed', 'rejected'] as ExtractionStatus[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setExpandedId(null); }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === t ? 'bg-[#a58039] text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {t === 'pending_review' ? 'Pending review' : t === 'confirmed' ? 'Confirmed' : 'Rejected'}
            {' '}({extractions.filter(e => e.extraction_status === t).length})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-[#a58039] animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-gray-400 italic">Nothing here yet.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map(extraction => (
            <div key={extraction.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedId(id => id === extraction.id ? null : extraction.id)}>
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-gray-400" />
                  <div>
                    <div className="font-bold text-[#403f4c]">{extraction.original_filename || 'Untitled document'}</div>
                    <div className="text-xs text-gray-500">
                      {DOCUMENT_TYPE_LABELS[extraction.document_type]} · {extraction.extracted_rows.length} row(s) extracted
                      {extraction.extraction_error && <span className="text-red-600"> · extraction failed: {extraction.extraction_error}</span>}
                    </div>
                  </div>
                </div>
                {extraction.extraction_status === 'confirmed' && (
                  <span className="text-xs px-2 py-1 bg-green-50 text-green-700 border border-green-100 rounded">
                    Confirmed into {extraction.target_rate_table} ({extraction.confirmed_row_ids?.length || 0} row(s))
                  </span>
                )}
                {extraction.extraction_status === 'rejected' && (
                  <span className="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded">Rejected</span>
                )}
              </div>

              {expandedId === extraction.id && extraction.extraction_status === 'pending_review' && orgId && user && (
                <ReviewDetail extraction={extraction} orgId={orgId} userId={user.id} onDone={() => { setExpandedId(null); load(); }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CostDocumentExtractions;

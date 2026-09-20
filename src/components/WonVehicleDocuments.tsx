import React, { useEffect, useRef, useState } from 'react';
import { Loader2, FileText, Download, Trash2, Upload } from 'lucide-react';
import {
  WonVehicle, WonVehicleDocument, WonVehicleDocumentType, PairedCostDocument,
  DOCUMENT_TYPES, DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES,
  listWonVehicleDocuments, uploadWonVehicleDocument, deleteWonVehicleDocument,
  getWonVehicleDocumentUrl, listAssetPairedCostDocuments,
} from '../services/wonVehicleService';
import { getSignedDocumentUrl } from '../services/costDocumentExtractionsService';

// PROMPT 34 Stage 4 - the documents for ONE won vehicle, and only that vehicle's. Staff-only,
// behind auth; never rendered on the tracking page. Removing a document is a soft delete - the
// stored file is retained - and is confirmed inline (native confirm() dialogs are avoided).

const TYPE_LABEL = Object.fromEntries(DOCUMENT_TYPES.map(t => [t.value, t.label])) as Record<string, string>;

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const WonVehicleDocuments: React.FC<{ wonVehicle: WonVehicle }> = ({ wonVehicle }) => {
  const [docs, setDocs] = useState<WonVehicleDocument[]>([]);
  const [paired, setPaired] = useState<PairedCostDocument[]>([]);
  const [filterType, setFilterType] = useState<WonVehicleDocumentType | ''>('');
  const [uploadType, setUploadType] = useState<WonVehicleDocumentType>('invoice');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      setDocs(await listWonVehicleDocuments(wonVehicle.id, filterType || undefined));
      // Read-only, via the existing asset pairing. A failure here must not hide the vehicle's own documents.
      listAssetPairedCostDocuments(wonVehicle.asset_id).then(setPaired).catch(() => setPaired([]));
    } catch (e: any) {
      setError(e?.message || 'Failed to load documents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [wonVehicle.id, filterType]);

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > DOCUMENT_MAX_BYTES) { setError('The file is larger than 8 MB.'); return; }
    setBusy(true);
    try {
      await uploadWonVehicleDocument(wonVehicle.id, uploadType, file);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e: any) {
      setError(e?.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const open = async (path: string, bucket: 'vehicle' | 'cost') => {
    setError(null);
    const url = bucket === 'vehicle' ? await getWonVehicleDocumentUrl(path) : await getSignedDocumentUrl(path, 300);
    if (!url) { setError('You do not have access to download this file.'); return; }
    window.open(url, '_blank', 'noopener');
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await deleteWonVehicleDocument(id);
      setConfirmingId(null);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Remove failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="documents-section">
      {error && <div className="text-xs text-[#ba3b46] bg-[#ba3b46]/10 border border-[#ba3b46]/30 rounded p-2 mb-3" data-testid="documents-error">{error}</div>}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={uploadType} onChange={e => setUploadType(e.target.value as WonVehicleDocumentType)} className="text-xs border border-gray-300 rounded px-2 py-1.5" data-testid="upload-type">
          {DOCUMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded bg-[#403f4c] text-white cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
          <input ref={fileRef} type="file" accept={DOCUMENT_ACCEPT} className="hidden" data-testid="upload-input"
            onChange={e => void handleUpload(e.target.files?.[0])} />
        </label>
        <span className="text-[10px] text-gray-400">PDF, PNG, JPEG or WebP, up to 8 MB. Staff only.</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400">Show</span>
          <select value={filterType} onChange={e => setFilterType(e.target.value as WonVehicleDocumentType | '')} className="text-xs border border-gray-300 rounded px-2 py-1" data-testid="filter-type">
            <option value="">All types</option>
            {DOCUMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : docs.length === 0 ? (
        <div className="text-xs text-gray-400 bg-gray-50 rounded p-3" data-testid="documents-empty">
          {filterType ? `No ${TYPE_LABEL[filterType].toLowerCase()} documents for this vehicle.` : 'No documents for this vehicle yet.'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {docs.map(d => (
            <div key={d.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded text-xs" data-testid="document-row">
              <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[#403f4c] truncate">{d.original_filename}</div>
                <div className="text-[10px] text-gray-400">{TYPE_LABEL[d.document_type]} · {formatSize(d.size_bytes)} · {new Date(d.uploaded_at).toLocaleString()}</div>
              </div>
              <button onClick={() => void open(d.storage_path, 'vehicle')} className="p-1.5 bg-white border border-gray-200 rounded hover:bg-gray-100" title="Download"><Download className="w-3.5 h-3.5" /></button>
              {confirmingId === d.id ? (
                <span className="flex items-center gap-1">
                  <button onClick={() => void handleDelete(d.id)} disabled={busy} className="px-2 py-1 bg-[#ba3b46] text-white rounded font-bold" data-testid="confirm-remove">Remove (file is kept)</button>
                  <button onClick={() => setConfirmingId(null)} className="px-2 py-1 bg-gray-100 rounded font-bold">Cancel</button>
                </span>
              ) : (
                <button onClick={() => setConfirmingId(d.id)} className="p-1.5 bg-white border border-gray-200 rounded hover:bg-red-50 text-gray-500" title="Remove" data-testid="remove-document"><Trash2 className="w-3.5 h-3.5" /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {paired.length > 0 && (
        <div className="mt-4" data-testid="paired-cost-documents">
          <div className="text-[11px] font-bold text-gray-500 mb-1">Also paired to this car's asset (rate-extraction documents)</div>
          <div className="text-[10px] text-gray-400 mb-1.5">Paired to the car itself, not to this client's purchase. Read-only; managed under Document Extraction.</div>
          <div className="space-y-1">
            {paired.map(p => (
              <div key={p.id} className="flex items-center gap-3 p-2 bg-amber-50/50 border border-amber-100 rounded text-xs">
                <FileText className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span className="flex-1 truncate">{p.original_filename || 'document'} <span className="text-gray-400">· {p.document_type.replace(/_/g, ' ')}</span></span>
                <button onClick={() => void open(p.storage_path, 'cost')} className="p-1.5 bg-white border border-gray-200 rounded hover:bg-gray-100" title="Download (administrators)"><Download className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WonVehicleDocuments;

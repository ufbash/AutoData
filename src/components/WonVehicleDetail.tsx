import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  WonVehicle, WonVehicleStatusHistoryRow, WonVehicleStatus,
  STATUS_SEQUENCE, STATUS_LABELS,
  listStatusHistory, advanceStatus, correctStatus, generateTrackingLink, revokeTrackingLink,
} from '../services/wonVehicleService';
import { X, Loader2, CheckCircle2, Circle, ExternalLink, Copy, AlertTriangle } from 'lucide-react';

// PROMPT 34 Stage 3 - the staff-side status ladder and correction UI. Forward advance is any
// staff member (one step at a time, enforced by the RPC); correction is superadmin-only and
// always requires a stated reason. The correction trail is shown here (staff-facing) but never
// on the tracking page (client-facing) - "internal error handling isn't client-facing
// information."

const WonVehicleDetail: React.FC<{ wonVehicle: WonVehicle; onClose: () => void; onChanged: () => void }> = ({ wonVehicle, onClose, onChanged }) => {
  const { role } = useAuth();
  const [history, setHistory] = useState<WonVehicleStatusHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correctingTo, setCorrectingTo] = useState<WonVehicleStatus | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await listStatusHistory(wonVehicle.id);
      setHistory(rows);
    } catch (e: any) {
      setError(e?.message || 'Failed to load status history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [wonVehicle.id]);

  useEffect(() => {
    if (wonVehicle.share_enabled && wonVehicle.share_token) {
      setTrackingUrl(`${window.location.origin}/track/${wonVehicle.share_token}`);
    } else {
      setTrackingUrl(null);
    }
  }, [wonVehicle.share_enabled, wonVehicle.share_token]);

  const currentStatus: WonVehicleStatus = (history[history.length - 1]?.status as WonVehicleStatus) || 'won';
  const currentPos = STATUS_SEQUENCE.indexOf(currentStatus);
  const nextStatus = STATUS_SEQUENCE[currentPos + 1];

  const handleAdvance = async () => {
    if (!nextStatus) return;
    setBusy(true);
    setError(null);
    try {
      await advanceStatus(wonVehicle.id, nextStatus);
      await load();
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Advance failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCorrect = async () => {
    if (!correctingTo || !correctionReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await correctStatus(wonVehicle.id, correctingTo, correctionReason.trim());
      setCorrectingTo(null);
      setCorrectionReason('');
      await load();
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Correction failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await generateTrackingLink(wonVehicle.id);
      setTrackingUrl(`${window.location.origin}/track/${updated.share_token}`);
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Failed to generate tracking link.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeLink = async () => {
    setBusy(true);
    setError(null);
    try {
      await revokeTrackingLink(wonVehicle.id);
      setTrackingUrl(null);
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Failed to revoke tracking link.');
    } finally {
      setBusy(false);
    }
  };

  const snapshot = wonVehicle.won_snapshot as any;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100 flex justify-between items-start sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-lg font-bold text-[#403f4c]">
              {snapshot?.year} {snapshot?.make} {snapshot?.model} {snapshot?.trim || ''}
            </h3>
            <div className="text-xs text-gray-500 mt-1">
              Won {new Date(wonVehicle.promoted_at).toLocaleString()} · lot {snapshot?.lot_number || '—'} · {snapshot?.source_platform || ''}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          {error && <div className="text-sm text-[#ba3b46] bg-[#ba3b46]/10 border border-[#ba3b46]/30 rounded-lg p-3">{error}</div>}

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : (
            <>
              <div>
                <h4 className="text-sm font-bold text-gray-700 mb-3">Status</h4>
                <div className="space-y-2">
                  {STATUS_SEQUENCE.map((status, i) => {
                    const reached = i <= currentPos;
                    const firstReached = history.find(h => h.status === status);
                    return (
                      <div key={status} className="flex items-center gap-3">
                        {reached ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" /> : <Circle className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                        <span className={`text-sm flex-1 ${reached ? 'font-medium text-[#403f4c]' : 'text-gray-400'}`}>{STATUS_LABELS[status]}</span>
                        {firstReached && <span className="text-xs text-gray-400">{new Date(firstReached.changed_at).toLocaleDateString()}</span>}
                        {role === 'superadmin' && (
                          <button
                            onClick={() => { setCorrectingTo(status); setCorrectionReason(''); }}
                            className="text-[11px] text-indigo-600 hover:underline"
                          >
                            Correct to this
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {nextStatus && (
                  <button
                    onClick={handleAdvance}
                    disabled={busy}
                    className="mt-4 flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white rounded-lg font-bold hover:bg-[#2d2c35] disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Advance to "{STATUS_LABELS[nextStatus]}"
                  </button>
                )}

                {correctingTo && (
                  <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-amber-800 mb-2">
                      <AlertTriangle className="w-4 h-4" /> Correct status to "{STATUS_LABELS[correctingTo]}"
                    </div>
                    <textarea
                      value={correctionReason}
                      onChange={e => setCorrectionReason(e.target.value)}
                      placeholder="Reason for this correction (required)"
                      className="w-full px-3 py-2 text-sm border border-amber-300 rounded mb-2"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <button onClick={handleCorrect} disabled={busy || !correctionReason.trim()} className="px-3 py-1.5 bg-[#ba3b46] text-white rounded font-bold text-sm disabled:opacity-50">Confirm correction</button>
                      <button onClick={() => setCorrectingTo(null)} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded font-bold text-sm">Cancel</button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-bold text-gray-700 mb-2">Full history (including corrections)</h4>
                <div className="space-y-1 text-xs">
                  {history.map(h => (
                    <div key={h.id} className={`p-2 rounded ${h.is_correction ? 'bg-amber-50' : 'bg-gray-50'}`}>
                      <span className="font-medium">{STATUS_LABELS[h.status as WonVehicleStatus]}</span>
                      {' — '}{new Date(h.changed_at).toLocaleString()}
                      {h.is_correction && <span className="ml-2 text-amber-700 font-bold">CORRECTION</span>}
                      {h.correction_reason && <div className="text-gray-500 mt-0.5">Reason: {h.correction_reason}</div>}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-gray-700 mb-2">Client tracking link</h4>
                <p className="text-xs text-gray-500 mb-2">Status and dates only — no invoice, cost, or documents ever appear here.</p>
                {trackingUrl ? (
                  <div className="flex items-center gap-2">
                    <input readOnly value={trackingUrl} className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded bg-gray-50" />
                    <button onClick={() => navigator.clipboard.writeText(trackingUrl)} className="p-2 bg-gray-100 rounded hover:bg-gray-200"><Copy className="w-4 h-4" /></button>
                    <a href={trackingUrl} target="_blank" rel="noreferrer" className="p-2 bg-gray-100 rounded hover:bg-gray-200"><ExternalLink className="w-4 h-4" /></a>
                    <button onClick={handleRevokeLink} disabled={busy} className="px-3 py-2 bg-[#ba3b46] text-white rounded font-bold text-sm disabled:opacity-50">Revoke</button>
                  </div>
                ) : (
                  <button onClick={handleGenerateLink} disabled={busy} className="px-3 py-2 bg-[#403f4c] text-white rounded font-bold text-sm disabled:opacity-50">Generate tracking link</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default WonVehicleDetail;

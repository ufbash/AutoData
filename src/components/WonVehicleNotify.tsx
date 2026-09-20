import React, { useEffect, useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import {
  WonVehicle, NotificationPreview, NotificationLogRow,
  previewNotification, sendNotification, listNotificationLog,
} from '../services/wonVehicleService';

// PROMPT 34 Stage 5 - the "your vehicle has been won" email. Manual only: nothing sends on
// promotion. The rendered content is shown BEFORE any send. A test goes only to the signed-in
// staff member's own address (chosen server-side, not by this form). Carries the tracking link and
// nothing else. Every attempt - sent or failed - is in email_log and shown below, so a failure is
// visible, not swallowed.

const WonVehicleNotify: React.FC<{ wonVehicle: WonVehicle; refreshKey?: string }> = ({ wonVehicle, refreshKey }) => {
  const [preview, setPreview] = useState<NotificationPreview | null>(null);
  const [log, setLog] = useState<NotificationLogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingSend, setConfirmingSend] = useState(false);

  const loadLog = async () => {
    try { setLog(await listNotificationLog(wonVehicle.id)); } catch (e: any) { setError(e?.message || 'Failed to load the send log.'); }
  };

  useEffect(() => { setPreview(null); setConfirmingSend(false); void loadLog(); }, [wonVehicle.id, refreshKey]);

  const handlePreview = async () => {
    setBusy(true); setError(null); setNotice(null);
    try { setPreview(await previewNotification(wonVehicle.id)); } catch (e: any) { setError(e?.message || 'Could not render the email.'); } finally { setBusy(false); }
  };

  const handleSend = async (mode: 'test' | 'send') => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await sendNotification(wonVehicle.id, mode);
      if (r.sent) setNotice(`Sent to ${r.to}.`);
      else setError(`Not sent${r.to ? ` to ${r.to}` : ''}: ${r.error || 'unknown error'}`);
      setConfirmingSend(false);
      await loadLog();
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="notify-section">
      <div className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Notify the client</div>
      <p className="text-[10px] text-gray-400 mb-2">An email that carries the tracking link only — no invoice, costs or documents. Sent manually; nothing is sent automatically.</p>

      {error && <div className="text-xs text-[#ba3b46] bg-[#ba3b46]/10 border border-[#ba3b46]/30 rounded p-2 mb-2" data-testid="notify-error">{error}</div>}
      {notice && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2 mb-2" data-testid="notify-notice">{notice}</div>}

      <button onClick={() => void handlePreview()} disabled={busy} className="px-3 py-1.5 bg-gray-100 text-xs font-bold rounded hover:bg-gray-200 disabled:opacity-50" data-testid="notify-preview">
        {busy && !preview ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : null} Preview email
      </button>

      {preview && (
        <div className="mt-2 border border-gray-200 rounded-lg p-3 text-xs" data-testid="notify-preview-panel">
          <div><span className="text-gray-400">To:</span> {preview.to || <em>no address on file</em>}</div>
          <div><span className="text-gray-400">Subject:</span> {preview.subject}</div>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-gray-700 bg-gray-50 rounded p-2">{preview.text}</pre>
          {preview.problems.length > 0 && (
            <ul className="mt-2 text-amber-700 list-disc pl-4" data-testid="notify-problems">{preview.problems.map(p => <li key={p}>{p}</li>)}</ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => void handleSend('test')} disabled={busy || !preview.trackingUrl} className="px-3 py-1.5 bg-white border border-gray-300 font-bold rounded disabled:opacity-50" data-testid="notify-test">
              Send a test to my own address
            </button>
            {!confirmingSend ? (
              <button onClick={() => setConfirmingSend(true)} disabled={busy || preview.problems.length > 0} className="px-3 py-1.5 bg-[#403f4c] text-white font-bold rounded disabled:opacity-50" data-testid="notify-send">
                Send to client…
              </button>
            ) : (
              <span className="flex items-center gap-1.5">
                <button onClick={() => void handleSend('send')} disabled={busy} className="px-3 py-1.5 bg-[#ba3b46] text-white font-bold rounded" data-testid="notify-confirm-send">Confirm: email {preview.to}</button>
                <button onClick={() => setConfirmingSend(false)} className="px-3 py-1.5 bg-gray-100 font-bold rounded">Cancel</button>
              </span>
            )}
          </div>
        </div>
      )}

      {log.length > 0 && (
        <div className="mt-3" data-testid="notify-log">
          <div className="text-[10px] font-bold text-gray-500 mb-1">Send log</div>
          {log.map(l => (
            <div key={l.id} className={`text-[11px] p-1.5 rounded mb-1 ${l.status === 'failed' ? 'bg-red-50 text-[#ba3b46]' : 'bg-gray-50 text-gray-600'}`} data-testid="notify-log-row">
              {l.status === 'failed' ? 'FAILED' : 'Sent'}{l.purpose.endsWith('_test') ? ' (test)' : ''} · {l.recipient_email} · {new Date(l.created_at).toLocaleString()}
              {l.error_text && <div className="text-[10px]">{l.error_text}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WonVehicleNotify;

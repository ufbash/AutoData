import React, { useEffect, useState } from 'react';
import {
  WonVehicle, WinningBid, WonVehicleDocument, currentWinningBid,
  listWonVehicleDocuments, recordWinningBid, voidWinningBid,
} from '../services/wonVehicleService';

// Debt #60 - records the price the lot actually hammered at. Staff-entered, USD, never derived and
// never written into the frozen won_snapshot (which holds what the client approved). Shown next to
// the approved price. A new entry supersedes the earlier one (which stays in the history) and then
// needs a note saying why; any entry can be voided with a reason. Nothing is edited or deleted.

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const WonVehicleWinningBid: React.FC<{ wonVehicle: WonVehicle; bids: WinningBid[]; onChanged: () => void }> = ({ wonVehicle, bids, onChanged }) => {
  const current = currentWinningBid(bids);
  const [formOpen, setFormOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [evidenceId, setEvidenceId] = useState('');
  const [method, setMethod] = useState<'' | 'proxy' | 'live'>('');
  const [docs, setDocs] = useState<WonVehicleDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!formOpen && !current?.evidence_document_id) return;
    listWonVehicleDocuments(wonVehicle.id).then(setDocs).catch(() => setDocs([]));
  }, [wonVehicle.id, formOpen, current?.evidence_document_id]);

  const docName = (id: string | null) => (id ? docs.find(d => d.id === id)?.original_filename ?? 'document' : null);
  const approved = (wonVehicle.won_snapshot as any)?.display_price;

  const handleRecord = async () => {
    setBusy(true);
    setError(null);
    try {
      await recordWinningBid({
        wonVehicleId: wonVehicle.id, amountUsd: Number(amount),
        bidMethod: method || undefined, note: note || undefined, evidenceDocumentId: evidenceId || undefined,
      });
      setFormOpen(false); setAmount(''); setNote(''); setEvidenceId(''); setMethod('');
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Could not record the winning bid.');
    } finally {
      setBusy(false);
    }
  };

  const handleVoid = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await voidWinningBid(id, voidReason);
      setVoidingId(null); setVoidReason('');
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Could not void the winning bid.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 p-3 bg-gray-50 rounded-lg" data-testid="winning-bid">
      {error && <div className="text-xs text-[#ba3b46] mb-2" data-testid="winning-bid-error">{error}</div>}

      {current ? (
        <div data-testid="winning-bid-current">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">Winning bid (recorded)</div>
          <div className="text-lg font-bold text-[#403f4c]">{money(current.amount_usd)} <span className="text-xs font-normal text-gray-400">USD</span></div>
          <div className="text-[10px] text-gray-500" data-testid="winning-bid-method">
            Bid method: {current.bid_method ? (current.bid_method === 'proxy' ? 'proxy (max bid)' : 'live') : 'not recorded — bid fee shown as a range'}
          </div>
          <div className="text-[10px] text-gray-500">
            Entered by staff {new Date(current.recorded_at).toLocaleString()}
            {docName(current.evidence_document_id) ? ` · evidence: ${docName(current.evidence_document_id)}` : ' · no evidence document linked'}
            {current.note ? ` · ${current.note}` : ''}
          </div>
          {typeof approved === 'number' && (
            <div className="text-[10px] text-gray-400 mt-0.5">
              Approved price was {money(approved)} ({current.amount_usd === approved ? 'the same' : `${current.amount_usd > approved ? '+' : '-'}${money(Math.abs(current.amount_usd - approved))}`}).
            </div>
          )}
        </div>
      ) : (
        <div data-testid="winning-bid-missing">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">Winning bid</div>
          <div className="text-sm text-amber-700 font-bold">Not recorded yet</div>
          <div className="text-[10px] text-gray-500">Fees are priced at the approved price until the real winning bid is entered.</div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {!formOpen && (
          <button onClick={() => setFormOpen(true)} className="px-2.5 py-1 bg-[#403f4c] text-white text-xs font-bold rounded" data-testid="record-winning-bid">
            {current ? 'Replace…' : 'Record winning bid'}
          </button>
        )}
        {current && voidingId !== current.id && (
          <button onClick={() => { setVoidingId(current.id); setVoidReason(''); }} className="text-[11px] text-[#ba3b46] hover:underline" data-testid="void-winning-bid">Void…</button>
        )}
        {bids.length > 1 && (
          <button onClick={() => setShowHistory(!showHistory)} className="text-[11px] text-indigo-600 hover:underline">{showHistory ? 'Hide' : 'Show'} history ({bids.length})</button>
        )}
      </div>

      {current && voidingId === current.id && (
        <div className="mt-2 flex gap-1.5 items-center text-xs">
          <input value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Reason (required)" className="flex-1 border border-gray-300 rounded px-2 py-1" data-testid="void-bid-reason" />
          <button onClick={() => void handleVoid(current.id)} disabled={busy || !voidReason.trim()} className="px-2 py-1 bg-[#ba3b46] text-white rounded font-bold disabled:opacity-50" data-testid="confirm-void-bid">Void</button>
          <button onClick={() => setVoidingId(null)} className="px-2 py-1 bg-gray-100 rounded font-bold">Cancel</button>
        </div>
      )}

      {formOpen && (
        <div className="mt-2 space-y-2 text-xs" data-testid="winning-bid-form">
          <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Winning bid in USD, e.g. 4250" inputMode="decimal" className="w-full border border-gray-300 rounded px-2 py-1.5" data-testid="bid-amount" />
          <select value={method} onChange={e => setMethod(e.target.value as '' | 'proxy' | 'live')} className="w-full border border-gray-300 rounded px-2 py-1.5" data-testid="bid-method">
            <option value="">Bid method: not known (fee shown as a range)</option>
            <option value="proxy">Proxy bid (a maximum set in advance)</option>
            <option value="live">Live bid</option>
          </select>
          <select value={evidenceId} onChange={e => setEvidenceId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5" data-testid="bid-evidence">
            <option value="">Evidence document (optional — upload it under Documents first)</option>
            {docs.map(d => <option key={d.id} value={d.id}>{d.original_filename}</option>)}
          </select>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder={current ? 'Why is this replacing the earlier bid? (required)' : 'Note (optional)'} className="w-full border border-gray-300 rounded px-2 py-1.5" data-testid="bid-note" />
          <div className="flex gap-2">
            <button onClick={() => void handleRecord()} disabled={busy || !(Number(amount) > 0) || (!!current && !note.trim())} className="px-3 py-1.5 bg-[#403f4c] text-white font-bold rounded disabled:opacity-50" data-testid="submit-winning-bid">{busy ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setFormOpen(false)} className="px-3 py-1.5 bg-gray-100 font-bold rounded">Cancel</button>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="mt-2 space-y-1" data-testid="winning-bid-history">
          {bids.map(b => (
            <div key={b.id} className={`text-[10px] p-1.5 rounded ${b.voided_at ? 'bg-white text-gray-400 line-through' : b.id === current?.id ? 'bg-emerald-50 text-gray-600' : 'bg-white text-gray-500'}`}>
              {money(b.amount_usd)}{b.bid_method ? ` (${b.bid_method})` : ''} · {new Date(b.recorded_at).toLocaleString()}{b.note ? ` · ${b.note}` : ''}
              {b.voided_at ? ` · voided: ${b.void_reason}` : b.id === current?.id ? ' · current' : ' · superseded'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WonVehicleWinningBid;

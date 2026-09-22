import React, { useState } from 'react';
import { Loader2, Check, Flag } from 'lucide-react';
import { ActualCost, ActualComponent, recordActualCost, voidActualCost, flagActualForRateReview } from '../services/actualCostsService';

// PROMPT 41 Stage 2 - the actual, shown beside (never in place of) the estimate above it: estimate/actual/variance,
// each labelled plainly. Recording one is staff-entered, ideally backed by an uploaded bill; the "flag for rate
// review" action never itself writes a rate - staff still does that deliberately, through Admin > Rates.

const money = (n: number, currency = 'USD') => `${currency.toUpperCase() === 'USD' ? '$' : currency.toUpperCase() + ' '}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ActualCostRow: React.FC<{
  orgId: string; wonVehicleId: string; component: ActualComponent; estimateUsd: number | null;
  actual: ActualCost | null; userId: string; onChanged: () => void;
}> = ({ orgId, wonVehicleId, component, estimateUsd, actual, userId, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doRecord = async () => {
    const n = Number(amount);
    if (!n || n <= 0) return;
    setBusy(true); setErr(null);
    try {
      await recordActualCost({ orgId, wonVehicleId, component, amount: n, currency: 'usd', note: note || undefined, recordedBy: userId });
      setOpen(false); setAmount(''); setNote(''); onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const doVoid = async () => {
    if (!actual) return;
    const reason = window.prompt('Reason for voiding this actual cost:');
    if (!reason || !reason.trim()) return;
    setBusy(true); setErr(null);
    try { await voidActualCost(actual.id, userId, reason.trim()); onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const doFlag = async () => {
    if (!actual) return;
    setBusy(true); setErr(null);
    try { await flagActualForRateReview(actual.id, userId); onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const variance = actual && estimateUsd !== null && actual.currency === 'usd' ? actual.amount - estimateUsd : null;

  return (
    <div className="pb-2 pl-3 border-l-2 border-[#a58039]/30 -mt-1 mb-1 text-xs">
      {actual ? (
        <div className="flex items-center justify-between flex-wrap gap-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#a58039]">Actual</span>
            <span className="font-mono">{money(actual.amount, actual.currency)}</span>
            {variance !== null && <span className={variance > 0 ? 'text-red-600' : variance < 0 ? 'text-green-700' : 'text-gray-400'}>({variance > 0 ? '+' : ''}{money(variance)} vs estimate)</span>}
            {actual.note && <span className="text-gray-400">— {actual.note}</span>}
            {actual.offered_to_rates && <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Check className="w-3 h-3" /> flagged for rate review</span>}
          </div>
          <div className="flex items-center gap-2">
            {!actual.offered_to_rates && <button onClick={doFlag} disabled={busy} className="text-[10px] text-gray-500 hover:underline flex items-center gap-0.5"><Flag className="w-3 h-3" /> Flag for rate review</button>}
            <button onClick={doVoid} disabled={busy} className="text-[10px] text-red-600 hover:underline">Void</button>
          </div>
        </div>
      ) : open ? (
        <div className="flex flex-wrap items-center gap-2">
          <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="amount (USD)" className="border rounded px-2 py-1 w-28" />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="note (e.g. IAAI invoice)" className="border rounded px-2 py-1 flex-1 min-w-[10rem]" />
          <button onClick={doRecord} disabled={busy || !amount} className="text-[#a58039] font-bold disabled:opacity-50">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}</button>
          <button onClick={() => setOpen(false)} className="text-gray-400">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="text-gray-400 hover:text-[#a58039] hover:underline">+ Record actual</button>
      )}
      {err && <p className="text-red-600 mt-1">{err}</p>}
    </div>
  );
};

export default ActualCostRow;

import React, { useEffect, useMemo, useState } from 'react';
import {
  WonVehicle, WonVehicleDestination as Destination, DestinationOption, ShippingMethod,
  currentDestination, listDestinationOptions, setDestination, voidDestination,
} from '../services/wonVehicleService';

// Where this won vehicle is going (port + shipping method), saved on the vehicle with who/when and a
// history of earlier choices. It drives the trucking and shipping components; until one is saved
// they abstain rather than assume a port. Options are every destination the current rates can quote,
// ranked by how many rates back them, with the ones THIS yard can quote marked. The rate data still
// carries vendor typos (BATIMORE, PROVDIENCE...), so the count is shown - the real ports lead and the
// typo variants are visibly the minor entries.

const label = (o: { destination_port: string; shipping_method: ShippingMethod }) => `${o.destination_port} (${o.shipping_method})`;

const WonVehicleDestinationPanel: React.FC<{
  wonVehicle: WonVehicle;
  destinations: Destination[];
  quotedFromYard: Set<string>;
  onChanged: () => void;
}> = ({ wonVehicle, destinations, quotedFromYard, onChanged }) => {
  const current = currentDestination(destinations);
  const [options, setOptions] = useState<DestinationOption[]>([]);
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    listDestinationOptions().then(setOptions).catch(e => setError(e?.message || 'Failed to load destinations.'));
  }, []);

  const sorted = useMemo(() => [...options].sort((a, b) => {
    const qa = quotedFromYard.has(`${a.destination_port}|${a.shipping_method}`) ? 0 : 1;
    const qb = quotedFromYard.has(`${b.destination_port}|${b.shipping_method}`) ? 0 : 1;
    return qa - qb || b.rate_count - a.rate_count || a.destination_port.localeCompare(b.destination_port);
  }), [options, quotedFromYard]);

  const handleSave = async () => {
    const [port, method] = choice.split('||');
    setBusy(true); setError(null);
    try {
      await setDestination({ wonVehicleId: wonVehicle.id, port, method: method as ShippingMethod, note: note || undefined });
      setChoice(''); setNote(''); setChanging(false);
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Could not save the destination.');
    } finally { setBusy(false); }
  };

  const handleVoid = async () => {
    if (!current) return;
    setBusy(true); setError(null);
    try {
      await voidDestination(current.id, voidReason);
      setVoiding(false); setVoidReason('');
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Could not void the destination.');
    } finally { setBusy(false); }
  };

  const showPicker = !current || changing;

  return (
    <div className="py-2 border-b border-gray-100" data-testid="destination">
      <div className="text-xs font-bold text-gray-600 mb-1">Destination (drives trucking and shipping)</div>
      {error && <div className="text-[10px] text-[#ba3b46] mb-1" data-testid="destination-error">{error}</div>}

      {current ? (
        <div data-testid="destination-current">
          <div className="text-sm font-bold text-[#403f4c]">{label(current)}</div>
          <div className="text-[10px] text-gray-500">
            Set by staff {new Date(current.set_at).toLocaleString()}{current.note ? ` · ${current.note}` : ''}
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-amber-700" data-testid="destination-missing">
          No destination saved — trucking and shipping cannot be calculated until one is chosen.
        </div>
      )}

      {showPicker && (
        <div className="mt-1.5 space-y-1.5">
          <select value={choice} onChange={e => setChoice(e.target.value)} className="w-full text-xs border border-gray-300 rounded px-2 py-1.5" data-testid="destination-select">
            <option value="">Choose destination port / method…</option>
            {sorted.map(o => {
              const k = `${o.destination_port}|${o.shipping_method}`;
              return (
                <option key={k} value={`${o.destination_port}||${o.shipping_method}`}>
                  {label(o)} — {o.rate_count} rates{quotedFromYard.has(k) ? ' · quoted from this yard' : ''}
                </option>
              );
            })}
          </select>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className="w-full text-xs border border-gray-300 rounded px-2 py-1.5" />
          <div className="flex gap-2">
            <button onClick={() => void handleSave()} disabled={busy || !choice} className="px-3 py-1.5 bg-[#403f4c] text-white text-xs font-bold rounded disabled:opacity-50" data-testid="destination-save">{busy ? 'Saving…' : 'Save destination'}</button>
            {changing && <button onClick={() => setChanging(false)} className="px-3 py-1.5 bg-gray-100 text-xs font-bold rounded">Cancel</button>}
          </div>
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap gap-3 text-[11px]">
        {current && !changing && <button onClick={() => setChanging(true)} className="text-indigo-600 hover:underline" data-testid="destination-change">Change…</button>}
        {current && !voiding && <button onClick={() => setVoiding(true)} className="text-[#ba3b46] hover:underline" data-testid="destination-void">Clear…</button>}
        {destinations.length > 1 && <button onClick={() => setShowHistory(!showHistory)} className="text-indigo-600 hover:underline">{showHistory ? 'Hide' : 'Show'} history ({destinations.length})</button>}
      </div>

      {voiding && (
        <div className="mt-1.5 flex gap-1.5 items-center text-xs">
          <input value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Reason (required)" className="flex-1 border border-gray-300 rounded px-2 py-1" data-testid="destination-void-reason" />
          <button onClick={() => void handleVoid()} disabled={busy || !voidReason.trim()} className="px-2 py-1 bg-[#ba3b46] text-white rounded font-bold disabled:opacity-50" data-testid="destination-confirm-void">Clear</button>
          <button onClick={() => setVoiding(false)} className="px-2 py-1 bg-gray-100 rounded font-bold">Cancel</button>
        </div>
      )}

      {showHistory && (
        <div className="mt-1.5 space-y-1" data-testid="destination-history">
          {destinations.map(d => (
            <div key={d.id} className={`text-[10px] p-1.5 rounded ${d.voided_at ? 'bg-gray-50 text-gray-400 line-through' : d.id === current?.id ? 'bg-emerald-50 text-gray-600' : 'bg-white text-gray-500'}`}>
              {label(d)} · {new Date(d.set_at).toLocaleString()}{d.note ? ` · ${d.note}` : ''}
              {d.voided_at ? ` · cleared: ${d.void_reason}` : d.id === current?.id ? ' · current' : ' · replaced'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WonVehicleDestinationPanel;

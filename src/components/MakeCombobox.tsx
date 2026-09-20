import React, { useState, useRef, useEffect } from 'react';
import { TieredMake, MakeTier, defaultMakeList, searchMakes, setMakeDemoted } from '../services/vehicleReferenceService';

// PROMPT 35 Stage 3 - the brief form's make picker. Before anything is typed it lists tier 1
// (traded) then tier 2 (current); typing searches EVERY make in every tier, so a defunct or
// obscure make is one keystroke away and list length stops mattering. Whatever is typed can
// always be used as-is (free text) - ranking hides, it never blocks (Avatr must stay enterable).

const TIER_LABEL: Record<MakeTier, string> = { 1: 'Traded', 2: 'Current', 3: 'Other' };

const MakeCombobox: React.FC<{
  value: string;
  isVocabulary: boolean | null | undefined;
  makes: TieredMake[];
  loading: boolean;
  onChange: (value: string, isVocabulary: boolean) => void;
  onMakesChanged: () => void;
}> = ({ value, isVocabulary, makes, loading, onChange, onMakesChanged }) => {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const commit = (text: string) => {
    const t = text.trim();
    if (t === '') { onChange('', true); return; }
    const exact = makes.find(m => m.name.toLowerCase() === t.toLowerCase());
    if (exact) onChange(exact.name, true);
    else onChange(t, false);
  };

  const typing = query.trim() !== '' && query !== value;
  const results = typing ? searchMakes(makes, query) : defaultMakeList(makes);
  const hasExact = makes.some(m => m.name.toLowerCase() === query.trim().toLowerCase());

  const toggleDemoted = async (m: TieredMake) => {
    setBusyId(m.id);
    setError(null);
    try {
      await setMakeDemoted(m.id, !m.demoted);
      onMakesChanged();
    } catch (e: any) {
      setError(e?.message || 'Could not update the make.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      ref={boxRef}
      className="relative"
      onBlur={e => {
        // Focus leaving the whole control commits whatever is typed - a make typed in and tabbed
        // away from must not be silently dropped. Option clicks use mousedown+preventDefault, so
        // they never trigger this.
        if (boxRef.current && !boxRef.current.contains(e.relatedTarget as Node | null)) {
          if (query !== value) commit(query);
          setOpen(false);
        }
      }}
    >
      <label className="block text-xs font-medium text-gray-700 mb-1">Make</label>
      <input
        type="text"
        value={query}
        disabled={loading}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(query); setOpen(false); }
          if (e.key === 'Escape') { setOpen(false); setQuery(value); }
        }}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded bg-white disabled:opacity-50"
        placeholder={loading ? 'Loading…' : 'Search makes, e.g. Toyota'}
        data-testid="make-input"
        autoComplete="off"
      />
      {value && isVocabulary === false && (
        <div className="text-[10px] text-amber-600 mt-1">Typed in — not from the make list.</div>
      )}
      {error && <div className="text-[10px] text-[#ba3b46] mt-1">{error}</div>}

      {open && !loading && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg" data-testid="make-options">
          {results.length === 0 && !query.trim() && (
            <div className="px-3 py-2 text-xs text-gray-400">Start typing to search all makes.</div>
          )}
          {results.map(m => (
            <div
              key={m.id}
              className="flex items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer"
              onMouseDown={e => { e.preventDefault(); onChange(m.name, true); setQuery(m.name); setOpen(false); }}
              data-testid="make-option"
            >
              <span className={m.demoted ? 'text-gray-400' : 'text-[#403f4c]'}>{m.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400">
                  {m.demoted ? 'Hidden' : TIER_LABEL[m.tier]}{m.tier === 1 && m.tradedCount > 0 ? ` · ${m.tradedCount}` : ''}
                </span>
                <button
                  type="button"
                  disabled={busyId === m.id}
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); void toggleDemoted(m); }}
                  className="text-[10px] text-indigo-600 hover:underline disabled:opacity-50"
                  title={m.demoted ? 'Show this make in the default list again' : 'Stop listing this make by default (still searchable)'}
                >
                  {m.demoted ? 'Restore' : 'Hide'}
                </button>
              </span>
            </div>
          ))}
          {typing && !hasExact && (
            <div
              className="px-3 py-2 text-sm text-indigo-700 border-t border-gray-100 hover:bg-indigo-50 cursor-pointer"
              onMouseDown={e => { e.preventDefault(); commit(query); setOpen(false); }}
              data-testid="make-free-text"
            >
              Use “{query.trim()}” as typed
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MakeCombobox;

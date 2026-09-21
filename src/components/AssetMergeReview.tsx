import React, { useState, useEffect } from 'react';
import { Loader2, AlertTriangle, GitMerge, Check, X } from 'lucide-react';
import ReviewQueueShell from './ReviewQueueShell';
import { supabase } from '../services/supabaseClient';
import { fetchAllVerified } from '../../supabase/functions/_shared/paginatedRead';
import { listMergeCandidates, confirmMerge, dismissMergeCandidate, restoreMergeCandidate, listDismissals, MergeDismissal, MergeCandidate, AssetSide } from '../services/assetMergeService';

// PROMPT 32 Stage 2 (debt #46) - the review screen. Nothing here merges anything without an
// explicit click on a specific, named pair, after seeing both records in full. A doNotMerge
// candidate's Merge button is disabled, not hidden - the reviewer should see why a candidate
// was flagged, not just that it was.

const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const ASSET_FIELDS: Array<[string, keyof AssetSide['asset']]> = [
  ['VIN', 'vin'], ['Make', 'make'], ['Model', 'model'], ['Year', 'year'], ['Trim', 'trim'],
  ['Exterior color', 'exterior_color'], ['Interior color', 'interior_color'],
  ['Body style', 'body_style'], ['Cylinders', 'cylinders'], ['Engine', 'engine_type'],
  ['Transmission', 'transmission'], ['Fuel', 'fuel'], ['Drivetrain', 'drivetrain'],
  ['Horsepower', 'horsepower'], ['Origin status', 'origin_status'], ['Status', 'status'],
  ['First seen', 'first_seen_at'], ['Last seen', 'last_seen_at'],
];

const AssetSidePanel: React.FC<{ label: string; side: AssetSide; highlight?: boolean }> = ({ label, side, highlight }) => (
  <div className={`flex-1 rounded-lg border p-4 ${highlight ? 'border-[#a58039] bg-[#a58039]/5' : 'border-gray-200 bg-white'}`}>
    <div className="text-xs font-bold uppercase tracking-wide text-[#a58039] mb-2">{label}</div>
    <div className="text-[11px] text-gray-400 mb-3 font-mono">{side.asset.id}</div>
    <table className="w-full text-sm">
      <tbody>
        {ASSET_FIELDS.map(([display, key]) => (
          <tr key={String(key)} className="border-b border-gray-100 last:border-0">
            <td className="py-1 pr-3 text-gray-500 whitespace-nowrap">{display}</td>
            <td className="py-1 font-medium text-[#403f4c]">{fmt(side.asset[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>

    <div className="mt-4">
      <div className="text-xs font-bold text-gray-500 mb-1">Sightings ({side.sightings.length})</div>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {side.sightings.length === 0 && <div className="text-xs text-gray-400">None</div>}
        {side.sightings.map((s: any) => (
          <div key={s.id} className="text-xs bg-gray-50 rounded p-2">
            <div>{s.source_platform} · lot {s.lot_number} · {s.lot_state}</div>
            <div className="text-gray-500">mileage {fmt(s.mileage_miles)} · price {fmt(s.price_usd)} · title {fmt(s.title_type)}</div>
          </div>
        ))}
      </div>
    </div>

    <div className="mt-3">
      <div className="text-xs font-bold text-gray-500 mb-1">Auction history ({side.auction_history.length})</div>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {side.auction_history.length === 0 && <div className="text-xs text-gray-400">None</div>}
        {side.auction_history.map((h: any) => (
          <div key={h.id} className="text-xs bg-gray-50 rounded p-2">
            {h.auction_platform} · {h.auction_date} · {h.status} · bid ${fmt(h.bid_amount_usd)}
          </div>
        ))}
      </div>
    </div>
  </div>
);

const CandidateCard: React.FC<{
  candidate: MergeCandidate;
  onMerged: () => void;
}> = ({ candidate, onMerged }) => {
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The negative decision: these are two different cars. Recorded (who, when, why); the pair stops reappearing.
  const handleDismiss = async () => {
    setMerging(true);
    setError(null);
    try {
      await dismissMergeCandidate(candidate.survivor.asset.id, candidate.orphanCandidate.asset.id, dismissReason);
      onMerged();
    } catch (e: any) {
      setError(e?.message || 'The decision could not be recorded.');
      setMerging(false);
    }
  };

  const handleMerge = async () => {
    setMerging(true);
    setError(null);
    try {
      await confirmMerge(candidate.survivor.asset.id, candidate.orphanCandidate.asset.id);
      onMerged();
    } catch (e: any) {
      setError(e?.message || 'Merge failed.');
    } finally {
      setMerging(false);
      setConfirming(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="font-bold text-[#403f4c]">
          {candidate.survivor.asset.make} {candidate.survivor.asset.model} {candidate.survivor.asset.year}
        </div>
        {candidate.doNotMerge ? (
          <span className="flex items-center gap-1 text-xs font-bold text-[#ba3b46] bg-[#ba3b46]/10 px-2 py-1 rounded">
            <AlertTriangle className="w-3 h-3" /> Do not merge
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-bold text-[#61988e] bg-[#61988e]/10 px-2 py-1 rounded">
            <Check className="w-3 h-3" /> No conflicts found
          </span>
        )}
      </div>

      {candidate.reasons.length > 0 && (
        <div className="mb-4 bg-[#ba3b46]/5 border border-[#ba3b46]/20 rounded-lg p-3">
          <div className="text-xs font-bold text-[#ba3b46] mb-1">Why this was flagged:</div>
          <ul className="text-xs text-[#ba3b46] list-disc pl-4 space-y-0.5">
            {candidate.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {candidate.fieldDisagreements.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="text-xs font-bold text-amber-800 mb-1">
            These two sides disagree on {candidate.fieldDisagreements.length} field{candidate.fieldDisagreements.length > 1 ? 's' : ''} — review each before merging:
          </div>
          <table className="text-xs w-full mt-1">
            <thead>
              <tr className="text-amber-700">
                <th className="text-left pr-3 py-0.5">Field</th>
                <th className="text-left pr-3 py-0.5">Survivor says</th>
                <th className="text-left py-0.5">Orphan says</th>
              </tr>
            </thead>
            <tbody>
              {candidate.fieldDisagreements.map((d) => (
                <tr key={d.field} className="text-amber-900">
                  <td className="pr-3 py-0.5 font-medium">{d.field}</td>
                  <td className="pr-3 py-0.5">{String(d.survivorValue)}</td>
                  <td className="py-0.5">{String(d.orphanValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <AssetSidePanel label="Survivor (VIN-bearing)" side={candidate.survivor} highlight />
        <AssetSidePanel label="Orphan candidate (VIN-less — will be soft-retired)" side={candidate.orphanCandidate} />
      </div>

      {error && <div className="mb-3 text-sm text-[#ba3b46]">{error}</div>}

      {dismissing ? (
        <div className="flex flex-wrap items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3" data-testid="dismiss-confirm">
          <span className="text-sm text-gray-700">Record that these are two different cars? They will not be offered again (you can restore the pair later).</span>
          <input value={dismissReason} onChange={e => setDismissReason(e.target.value)} placeholder="Reason (optional)" className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 min-w-[12rem]" />
          <button onClick={handleDismiss} disabled={merging} className="px-3 py-1.5 bg-[#403f4c] text-white rounded font-bold text-sm hover:bg-[#2d2c35] disabled:opacity-50 flex items-center gap-1">
            {merging ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Confirm: different cars
          </button>
          <button onClick={() => setDismissing(false)} disabled={merging} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded font-bold text-sm hover:bg-gray-200">Cancel</button>
        </div>
      ) : !confirming ? (
        <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setConfirming(true)}
          disabled={candidate.doNotMerge}
          className="flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white rounded-lg font-bold hover:bg-[#2d2c35] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <GitMerge className="w-4 h-4" /> Merge these two records
        </button>
        <button
          onClick={() => setDismissing(true)}
          className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg font-bold hover:bg-gray-50"
          data-testid="dismiss-button"
        >
          <X className="w-4 h-4" /> Not the same car
        </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <span className="text-sm text-amber-800">
            This will move every sighting and auction history row from the orphan onto the survivor,
            and soft-retire the orphan. This cannot be undone from this screen. Proceed?
          </span>
          <button
            onClick={handleMerge}
            disabled={merging}
            className="px-3 py-1.5 bg-[#ba3b46] text-white rounded font-bold text-sm hover:bg-[#a33240] disabled:opacity-50 flex items-center gap-1"
          >
            {merging ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Confirm merge
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={merging}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded font-bold text-sm hover:bg-gray-200"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};

interface AssetBrief { id: string; vin: string | null; make: string; model: string; year: number | null; merged_into_asset_id: string | null; merged_at: string | null }
const assetLabel = (a?: AssetBrief) => a ? `${a.year ?? ''} ${a.make} ${a.model}${a.vin ? ` · ${a.vin}` : ''}`.trim() : 'unknown asset';

const AssetMergeReview: React.FC = () => {
  const [tab, setTab] = useState<'pending' | 'dismissed' | 'merged'>('pending');
  const [candidates, setCandidates] = useState<MergeCandidate[]>([]);
  const [dismissals, setDismissals] = useState<MergeDismissal[]>([]);
  const [merged, setMerged] = useState<AssetBrief[]>([]);
  const [labels, setLabels] = useState<Record<string, AssetBrief>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreReason, setRestoreReason] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [cands, dis, mergedRows] = await Promise.all([
        listMergeCandidates(),
        listDismissals(),
        fetchAllVerified<AssetBrief>(
          'merged assets',
          (from, to) => supabase.from('assets').select('id, vin, make, model, year, merged_into_asset_id, merged_at').not('merged_into_asset_id', 'is', null).order('merged_at', { ascending: false }).order('id').range(from, to),
          () => supabase.from('assets').select('id', { count: 'exact', head: true }).not('merged_into_asset_id', 'is', null),
        ),
      ]);
      setCandidates(cands);
      setDismissals(dis);
      setMerged(mergedRows);
      // Names for the assets a dismissal or merge points at (a few dozen at most; fetched in chunks).
      const ids = Array.from(new Set([...dis.flatMap(d => [d.survivor_asset_id, d.orphan_asset_id]), ...mergedRows.map(m => m.merged_into_asset_id!)]));
      const found: Record<string, AssetBrief> = {};
      for (let i = 0; i < ids.length; i += 50) {
        const { data, error: e } = await supabase.from('assets').select('id, vin, make, model, year, merged_into_asset_id, merged_at').in('id', ids.slice(i, i + 50));
        if (e) throw new Error(e.message);
        (data || []).forEach((a: any) => { found[a.id] = a; });
      }
      setLabels(found);
    } catch (e: any) {
      setError(e?.message || 'Failed to load merge candidates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const restore = async (id: string) => {
    setError(null);
    try {
      await restoreMergeCandidate(id, restoreReason);
      setRestoringId(null);
      setRestoreReason('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not restore the pair.');
    }
  };

  return (
    <ReviewQueueShell
      testId="merge-queue"
      title="Asset Merges"
      description="Two assets whose canonical fingerprints match are candidates - nothing merges until you confirm one below, and a pair you say is two different cars is remembered and not offered again."
      tabs={[
        { key: 'pending', label: 'Pending review', count: candidates.length },
        { key: 'dismissed', label: 'Dismissed', count: dismissals.length },
        { key: 'merged', label: 'Merged', count: merged.length },
      ]}
      activeTab={tab}
      onTab={k => setTab(k as 'pending' | 'dismissed' | 'merged')}
      onRefresh={load}
      loading={loading}
      error={error}
      empty={tab === 'pending' ? 'No merge candidates found.' : tab === 'dismissed' ? 'No pairs have been dismissed.' : 'No assets have been merged.'}
      isEmpty={(tab === 'pending' ? candidates : tab === 'dismissed' ? dismissals : merged).length === 0}
    >
      {tab === 'pending' && (
        <div className="space-y-6">
          {candidates.map(c => (
            <CandidateCard key={`${c.survivor.asset.id}-${c.orphanCandidate.asset.id}`} candidate={c} onMerged={load} />
          ))}
        </div>
      )}
      {tab === 'dismissed' && (
        <div className="space-y-2">
          {dismissals.map(d => (
            <div key={d.id} className="bg-white border border-gray-200 rounded-lg p-3 text-sm" data-testid="dismissal-row">
              <div className="font-bold text-[#403f4c]">{assetLabel(labels[d.survivor_asset_id])} <span className="font-normal text-gray-400">and</span> {assetLabel(labels[d.orphan_asset_id])}</div>
              <div className="text-xs text-gray-500">Dismissed {new Date(d.decided_at).toLocaleString()}{d.reason ? ` - ${d.reason}` : ''}</div>
              {restoringId === d.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input value={restoreReason} onChange={e => setRestoreReason(e.target.value)} placeholder="Why restore this pair? (required)" className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 min-w-[12rem]" />
                  <button onClick={() => restore(d.id)} disabled={!restoreReason.trim()} className="px-3 py-1 bg-[#403f4c] text-white rounded text-sm font-bold disabled:opacity-40">Restore</button>
                  <button onClick={() => setRestoringId(null)} className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-sm font-bold">Cancel</button>
                </div>
              ) : (
                <button onClick={() => { setRestoringId(d.id); setRestoreReason(''); }} className="mt-2 text-xs font-bold text-[#a58039] hover:underline">Restore - offer this pair again</button>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'merged' && (
        <div className="space-y-2">
          {merged.map(m => (
            <div key={m.id} className="bg-white border border-gray-200 rounded-lg p-3 text-sm" data-testid="merged-row">
              <div className="font-bold text-[#403f4c]">{assetLabel(m)}</div>
              <div className="text-xs text-gray-500">Merged {m.merged_at ? new Date(m.merged_at).toLocaleString() : ''} into {assetLabel(labels[m.merged_into_asset_id!])}</div>
            </div>
          ))}
        </div>
      )}
    </ReviewQueueShell>
  );
};

export default AssetMergeReview;

import React, { useState, useEffect } from 'react';
import { platformLabel } from '../utils/enumLabels';
import { useAuth } from '../contexts/AuthContext';
import {
  WonVehicle, WonVehicleStatusHistoryRow, WonVehicleStatus, WonVehicleContext,
  STATUS_SEQUENCE, STATUS_LABELS,
  listStatusHistory, advanceStatus, correctStatus, generateTrackingLink, revokeTrackingLink,
  getWonVehicleContext, signedImagePaths, listWinningBids, currentWinningBid, WinningBid, listDestinations, currentDestination, WonVehicleDestination,
} from '../services/wonVehicleService';
import { makeThumbnail } from '../utils/thumbnail';
import WonVehicleCosts from './WonVehicleCosts';
import WonVehicleDocuments from './WonVehicleDocuments';
import BillingSection from './BillingSection';
import WonVehicleNotify from './WonVehicleNotify';
import WonVehicleWinningBid from './WonVehicleWinningBid';
import { ArrowLeft, Loader2, CheckCircle2, Circle, ExternalLink, Copy, AlertTriangle, ImageOff } from 'lucide-react';

// PROMPT 42 Stage 2 - the won vehicle as a full page with its own URL, not a modal (Bashir's first request in
// Prompt 41, dropped by that prompt's own ranking - not optional here). Retired: the fixed inset overlay, the
// close button, and the separate "Invoice records (uploaded PDFs)" section (WonVehicleInvoices.tsx) - that was
// Phase 2's own invoice-issuance tracker, superseded by BillingSection's real issued documents; keeping both
// would have been exactly the duplication this stage warns against. WonVehicleInvoices.tsx itself is untouched
// (Phase 2's tables stay legacy-readable, same reasoning as the rest of that retirement) - it is simply not
// mounted on this page any more.
//
// Four fixed sections, in order, nothing duplicated: Vehicle (identity, photos, stage/history, destination),
// Costs (estimate vs actual), Billing (BillingSection, scoped to this vehicle), Documents (grouped by category).
// The interactive destination selector stays inside Costs, where it functionally lives (changing it recomputes
// the freight estimate live) - Vehicle shows the same fact as a plain read-only summary line, not a second
// interactive control, so nothing is duplicated in the sense that matters (one place to CHANGE a fact).

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-sm font-bold text-gray-700 mb-3 pb-1 border-b border-gray-100">{children}</h4>
);
const PageSection: React.FC<{ title: string; children: React.ReactNode; testId: string }> = ({ title, children, testId }) => (
  <section className="bg-white border border-gray-200 rounded-xl p-6 mb-5" data-testid={testId}>
    <h3 className="text-base font-bold text-[#403f4c] mb-4 pb-2 border-b-2 border-[#a58039]/20">{title}</h3>
    {children}
  </section>
);

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">{label}</div>
    <div className="text-sm text-[#403f4c]">{value || '—'}</div>
  </div>
);

const APPROVED_VIA_LABELS: Record<string, string> = {
  client: 'Client, via the run link',
  staff_relayed: 'Staff-relayed on the client\'s behalf',
};

const WonVehicleDetail: React.FC<{ wonVehicle: WonVehicle; onBack: () => void; onChanged: () => void; onOpenRun?: (runId: string) => void }> = ({ wonVehicle, onBack, onChanged, onOpenRun }) => {
  const { role } = useAuth();
  const [history, setHistory] = useState<WonVehicleStatusHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correctingTo, setCorrectingTo] = useState<WonVehicleStatus | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);
  const [context, setContext] = useState<WonVehicleContext | null>(null);
  const [winningBids, setWinningBids] = useState<WinningBid[]>([]);
  const loadWinningBids = () => listWinningBids(wonVehicle.id).then(setWinningBids).catch(e => setError(e?.message || 'Failed to load the winning bid.'));
  useEffect(() => { void loadWinningBids(); }, [wonVehicle.id]);
  const [destinations, setDestinations] = useState<WonVehicleDestination[]>([]);
  const loadDestinations = () => listDestinations(wonVehicle.id).then(setDestinations).catch(e => setError(e?.message || 'Failed to load the destination.'));
  useEffect(() => { void loadDestinations(); }, [wonVehicle.id]);
  const [images, setImages] = useState<string[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      try {
        const ctx = await getWonVehicleContext(wonVehicle);
        if (cancelled) return;
        setContext(ctx);
        const paths = ctx.sighting?.stored_image_urls || [];
        const signed = await signedImagePaths(paths);
        const urls = paths.map(p => signed[p]).filter(Boolean);
        if (!cancelled) setImages(urls);
        let next = 0;
        const worker = async () => {
          while (!cancelled && next < urls.length) {
            const u = urls[next++];
            try {
              const t = await makeThumbnail(u);
              if (cancelled) { URL.revokeObjectURL(t); return; }
              created.push(t);
              setThumbs(prev => ({ ...prev, [u]: t }));
            } catch {
              if (!cancelled) setThumbs(prev => ({ ...prev, [u]: u }));
            }
          }
        };
        await Promise.all([worker(), worker()]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load purchase context.');
      }
    })();
    return () => { cancelled = true; created.forEach(u => URL.revokeObjectURL(u)); };
  }, [wonVehicle.id]);

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
  const dest = currentDestination(destinations);

  return (
    <div className="max-w-4xl mx-auto pb-12" data-testid="won-vehicle-page">
      <button onClick={onBack} className="text-sm font-bold text-[#a58039] hover:underline mb-4 flex items-center gap-1" data-testid="won-vehicle-back">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="mb-2">
        <h1 className="text-xl font-bold text-[#403f4c]" data-testid="won-vehicle-title">
          {snapshot?.year} {snapshot?.make} {snapshot?.model} {snapshot?.trim || ''}
        </h1>
        <div className="text-xs text-gray-500 mt-1">Won {new Date(wonVehicle.promoted_at).toLocaleString()}</div>
      </div>

      {error && <div className="text-sm text-[#ba3b46] bg-[#ba3b46]/10 border border-[#ba3b46]/30 rounded-lg p-3 mb-4">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {/* ---------------------------------------------------------------- 1. Vehicle */}
          <PageSection title="Vehicle" testId="section-vehicle">
            <SectionTitle>Identity</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <Field label="Year" value={snapshot?.year} />
              <Field label="Make" value={snapshot?.make} />
              <Field label="Model" value={snapshot?.model} />
              <Field label="Trim" value={snapshot?.trim} />
              <Field label="VIN" value={snapshot?.vin} />
              <Field label="Lot number" value={snapshot?.lot_number || (context?.sighting?.lot_number ? `${context.sighting.lot_number} (from listing)` : null)} />
              <Field label="Source platform" value={platformLabel(snapshot?.source_platform as string | null)} />
              <Field label="Destination" value={dest ? `${dest.destination_port} (${dest.shipping_method === 'roro' ? 'RoRo' : 'container'}) — set below, under Costs` : 'Not set yet — set below, under Costs'} />
            </div>
            {images.length > 0 ? (
              <div className="grid grid-cols-4 gap-2 mb-4" data-testid="won-gallery">
                {images.filter(u => !brokenImages.has(u)).map(u => (
                  thumbs[u]
                    ? <img key={u} src={thumbs[u]} alt="" decoding="async" className="w-full h-20 object-cover rounded bg-gray-100"
                        onError={() => setBrokenImages(prev => new Set(prev).add(u))} />
                    : <div key={u} className="w-full h-20 rounded bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded p-3 mb-4" data-testid="won-gallery-empty">
                <ImageOff className="w-4 h-4" /> No stored images for this vehicle
                {context?.sighting?.image_store_status ? ` (image status: ${context.sighting.image_store_status})` : ''}.
              </div>
            )}

            <SectionTitle>Purchase</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-2">
              <Field
                label={snapshot?.is_bid ? 'Approved bid' : 'Approved price'}
                value={snapshot?.display_price != null ? `${Number(snapshot.display_price).toLocaleString()} ${snapshot?.listed_currency || ''}` : null}
              />
              <Field label="Date won" value={new Date(wonVehicle.promoted_at).toLocaleDateString()} />
              <Field label="Platform" value={platformLabel(snapshot?.source_platform as string | null)} />
              <Field label="Captured" value={snapshot?.captured_at ? new Date(snapshot.captured_at).toLocaleString() : null} />
              <Field label="Sale date" value={snapshot?.sale_date} />
            </div>
            <p className="text-[10px] text-gray-400 mb-2">
              Frozen at approval — these figures do not change if the listing is re-captured. The winning bid below is a separate entry, made by staff after the auction.
            </p>
            <WonVehicleWinningBid wonVehicle={wonVehicle} bids={winningBids} onChanged={() => void loadWinningBids()} />

            <div className="mt-5">
              <SectionTitle>Stage and history</SectionTitle>
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
                        <button onClick={() => { setCorrectingTo(status); setCorrectionReason(''); }} className="text-[11px] text-indigo-600 hover:underline">
                          Correct to this
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {nextStatus && (
                <button onClick={handleAdvance} disabled={busy} data-testid="advance-status"
                  className="mt-4 flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white rounded-lg font-bold hover:bg-[#2d2c35] disabled:opacity-50">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Advance to "{STATUS_LABELS[nextStatus]}"
                </button>
              )}

              {correctingTo && (
                <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-amber-800 mb-2">
                    <AlertTriangle className="w-4 h-4" /> Correct status to "{STATUS_LABELS[correctingTo]}"
                  </div>
                  <textarea value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} placeholder="Reason for this correction (required)"
                    className="w-full px-3 py-2 text-sm border border-amber-300 rounded mb-2" rows={2} />
                  <div className="flex gap-2">
                    <button onClick={handleCorrect} disabled={busy || !correctionReason.trim()} className="px-3 py-1.5 bg-[#ba3b46] text-white rounded font-bold text-sm disabled:opacity-50">Confirm correction</button>
                    <button onClick={() => setCorrectingTo(null)} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded font-bold text-sm">Cancel</button>
                  </div>
                </div>
              )}

              <div className="mt-4">
                <h5 className="text-xs font-bold text-gray-500 mb-2">Full history (including corrections)</h5>
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
            </div>

            <div className="mt-5">
              <SectionTitle>Provenance</SectionTitle>
              <div className="text-xs space-y-1 text-gray-600" data-testid="provenance">
                <div>
                  Source run:{' '}
                  {context?.run ? (
                    onOpenRun ? (
                      <button onClick={() => onOpenRun(context.run!.id)} className="text-[#a58039] font-bold hover:underline">
                        {context.run.client_name} · {context.run.run_type.replace('_', ' ')} · {new Date(context.run.created_at).toLocaleDateString()}
                      </button>
                    ) : `${context.run.client_name}`
                  ) : '—'}
                </div>
                <div>Source listing: <span className="font-mono text-[11px]">{wonVehicle.research_run_listing_id}</span> (inside the run above)</div>
                <div>
                  Approval that authorised the bid:{' '}
                  {context?.listing?.approved_at
                    ? `${APPROVED_VIA_LABELS[context.listing.approved_via || ''] || context.listing.approved_via || 'unknown route'}, ${new Date(context.listing.approved_at).toLocaleString()}`
                    : '—'}
                </div>
                <div>Promoted to won: {new Date(wonVehicle.promoted_at).toLocaleString()}</div>
              </div>
            </div>

            <div className="mt-5">
              <h5 className="text-xs font-bold text-gray-500 mb-2">Client tracking link</h5>
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

            <div className="mt-5">
              <WonVehicleNotify wonVehicle={wonVehicle} refreshKey={trackingUrl ?? 'none'} />
            </div>
          </PageSection>

          {/* ---------------------------------------------------------------- 2. Costs */}
          <PageSection title="Costs" testId="section-costs">
            {context ? (
              <WonVehicleCosts wonVehicle={wonVehicle} context={context} winningBidUsd={currentWinningBid(winningBids)?.amount_usd ?? null}
                winningBidMethod={currentWinningBid(winningBids)?.bid_method ?? null} winningBidKey={currentWinningBid(winningBids)?.id ?? 'none'}
                destination={dest} destinations={destinations} onDestinationChanged={() => void loadDestinations()} />
            ) : <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>}
          </PageSection>

          {/* ---------------------------------------------------------------- 3. Billing */}
          <PageSection title="Billing" testId="section-billing">
            <BillingSection orgId={wonVehicle.org_id} clientId={wonVehicle.client_id} wonVehicle={wonVehicle} context={context}
              winningBid={currentWinningBid(winningBids)} destination={dest} scopedToVehicle />
          </PageSection>

          {/* ---------------------------------------------------------------- 4. Documents */}
          <PageSection title="Documents" testId="section-documents">
            <WonVehicleDocuments wonVehicle={wonVehicle} />
          </PageSection>
        </>
      )}
    </div>
  );
};

export default WonVehicleDetail;

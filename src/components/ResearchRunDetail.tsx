import React, { useState, useEffect } from 'react';
import { briefReference } from '../../supabase/functions/_shared/vehicleHeading.ts';
import { useAuth } from '../contexts/AuthContext';
import {
  getRun,
  listRunListings,
  updateRun,
  setListingIncluded,
  reorderListings,
  removeListingFromRun,
  rotateShareToken,
  storeImagesForRun,
  getSignedImageUrls,
  softDeleteRun,
  listAuctionHistoryForAssets,
  listVinDecodesForVins,
  DecodedVehicle,
  recordStaffApproval,
  ResearchRun,
  RunListing,
  AuctionHistoryRecord,
  ClientBrief,
  deleteSighting,
  getShareFlagSnapshot,
  saveShareFlagSnapshot
} from '../services/researchService';
import { deriveAuctionHistoryFlags, AuctionHistoryFlags } from '../utils/auctionHistoryFlags';
import { evaluateRun, listingBadges as moduleListingBadges, flagKeys, newlyFlagged, RuleItem } from '../../supabase/functions/_shared/riskRules.ts';
// PROMPT 29 Stage 2 - the one definition of the sold population, imported literally (not
// copied) by both this component and the public-run Edge Function. See that file's header for
// why it lives under supabase/functions/_shared/ and how both toolchains parse it.
import { countsTowardSoldAverage, isInSoldPopulation, populationOf } from '../../supabase/functions/_shared/soldGroup.ts';
import AddCapturesModal from './AddCapturesModal';
import VehicleDetailModal from './VehicleDetailModal';
import AuctionCountdown from './AuctionCountdown';
import { ArrowLeft, Edit2, Check, ArrowUp, ArrowDown, Plus, Trash2, Loader2, Link as LinkIcon, Copy, RefreshCw, ImageIcon, GripVertical, AlertTriangle, X, Info, CheckCircle2, PhoneCall, DollarSign } from 'lucide-react';
import ListingCostBreakdown from './ListingCostBreakdown';
import { promoteListing } from '../services/wonVehicleService';

interface ResearchRunDetailProps {
  runId: string;
  onBack: () => void;
  onOpenClient?: (clientId: string, briefId?: string) => void;
}

const ResearchRunDetail: React.FC<ResearchRunDetailProps> = ({ runId, onBack, onOpenClient }) => {
  const { orgId, user, role } = useAuth();
  
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [listings, setListings] = useState<RunListing[]>([]);
  const [auctionHistoryFlags, setAuctionHistoryFlags] = useState<Map<string, AuctionHistoryFlags>>(new Map());
  const [auctionHistoryRows, setAuctionHistoryRows] = useState<Map<string, AuctionHistoryRecord[]>>(new Map());
  // the unresolved flags that existed when sharing was switched on (null = never recorded); drives the shared-run warning
  const [shareSnapshot, setShareSnapshot] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeListing, setActiveListing] = useState<RunListing | null>(null);

  // Edit states
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  
  // Image Storage
  const [storingImages, setStoringImages] = useState(false);
  const [signedThumbnails, setSignedThumbnails] = useState<Record<string, string>>({});
  
  // PROMPT 33 Stage 3 - decoded VIN data for spec matching (trimMatches), keyed by VIN.
  const [decodedByVin, setDecodedByVin] = useState<Map<string, DecodedVehicle>>(new Map());

  // PROMPT 34 Stage 2 - promotion to a won vehicle.
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const handlePromote = async (listing: RunListing) => {
    setPromoting(true);
    setPromoteError(null);
    try {
      await promoteListing(listing.id);
      await loadData();
    } catch (e: any) {
      setPromoteError(e?.message || 'Promotion failed.');
    } finally {
      setPromoting(false);
    }
  };

  // Checklist states
  const [warningsReviewed, setWarningsReviewed] = useState(false);
  const [criticalOverrideReason, setCriticalOverrideReason] = useState('');
  const [pulseListingId, setPulseListingId] = useState<string | null>(null);

  // Delete states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);


  const loadData = async () => {
    try {
      const [r, l] = await Promise.all([
        getRun(runId),
        listRunListings(runId)
      ]);
      setRun(r);
      setListings(l);

      const assetIds = l.map(listing => listing.asset_id).filter((id): id is string => !!id);
      const historyByAsset = await listAuctionHistoryForAssets(assetIds);
      const vins = l.map(listing => listing.vin).filter((v): v is string => !!v);
      const decodedVinMap = await listVinDecodesForVins(vins);
      setDecodedByVin(decodedVinMap);
      const flagsMap = new Map<string, AuctionHistoryFlags>();
      l.forEach(listing => {
        if (listing.asset_id) {
          flagsMap.set(listing.asset_id, deriveAuctionHistoryFlags(historyByAsset.get(listing.asset_id)));
        }
      });
      setAuctionHistoryFlags(flagsMap);
      setAuctionHistoryRows(historyByAsset);
      try { setShareSnapshot(await getShareFlagSnapshot(runId)); } catch { setShareSnapshot(null); }

      if (r) {
        setNameInput(r.client_name);
        setNotesInput(r.notes || '');
        setCriticalOverrideReason(r.critical_override_reason || '');
      }

      // Fetch signed urls for thumbnails
      const paths = l.map(listing => listing.stored_image_urls?.[0]).filter(Boolean) as string[];
      if (paths.length > 0) {
        try {
          const signed = await getSignedImageUrls(paths);
          const map: Record<string, string> = {};
          signed.forEach(s => map[s.path] = s.signedUrl);
          setSignedThumbnails(map);
        } catch (e) {
          console.error('Failed to load signed thumbnails', e);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [runId]);

  const handleUpdate = async (patch: Partial<ResearchRun>) => {
    try {
      const updated = await updateRun(runId, patch);
      setRun(updated);
    } catch (err: any) {
      alert(err.message || 'Failed to update');
    }
  };

  const handleNameSave = () => {
    if (nameInput.trim() && nameInput !== run?.client_name) {
      handleUpdate({ client_name: nameInput.trim() });
    }
    setEditingName(false);
  };

  const handleNotesBlur = () => {
    if (notesInput !== (run?.notes || '')) {
      handleUpdate({ notes: notesInput.trim() || null });
    }
  };

  const handleCopyLink = () => {
    if (!run) return;
    const url = `${window.location.origin}/share/${run.share_token}`;
    navigator.clipboard.writeText(url)
      .then(() => alert('Link copied to clipboard!'))
      .catch(() => alert('Failed to copy link'));
  };

  const handleRotateToken = async () => {
    if (!confirm('Are you sure? The old link will immediately stop working.')) return;
    try {
      const newToken = await rotateShareToken(runId);
      setRun(prev => prev ? { ...prev, share_token: newToken } : null);
    } catch (err: any) {
      alert(err.message || 'Failed to rotate token');
    }
  };

  const handleToggleIncluded = async (listingId: string, included: boolean) => {
    // Optimistic update
    setListings(prev => prev.map(l => l.id === listingId ? { ...l, included } : l));
    try {
      await setListingIncluded(listingId, included);
      setWarningsReviewed(false); // reset checklist when listings change
    } catch (err: any) {
      alert(err.message || 'Failed to update listing');
      // Revert
      setListings(prev => prev.map(l => l.id === listingId ? { ...l, included: !included } : l));
    }
  };

  // PROMPT 19 Phase 4 - staff cannot approve on the client's behalf; this only records
  // that the client already approved by phone/WhatsApp, and relays it. approved_via
  // marks it 'staff_relayed' server-side (recordStaffApproval), never collapsed with a
  // real client-made approval.
  const handleRecordApproval = async (listing: RunListing) => {
    if (!user?.id) return;
    const vehicleLabel = `${listing.year || ''} ${listing.make} ${listing.model} ${listing.trim || ''}`.trim();
    if (!confirm(`Record that the client already approved this vehicle (${vehicleLabel}) through another channel - e.g. a phone call or WhatsApp? This will be marked as staff-recorded, not client-made, and cannot be undone from here.`)) return;
    try {
      await recordStaffApproval(runId, listing, user.id);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to record approval');
    }
  };

  // PROMPT 21 Phase 4 - collapsed by default, per listing, active listings only. Purely
  // local UI state - never persisted, this is a display toggle, not a data change.
  const [expandedCostListingIds, setExpandedCostListingIds] = useState<Set<string>>(new Set());

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      handleDragEnd();
      return;
    }
    const nextListings = [...listings];
    const [removed] = nextListings.splice(draggedIndex, 1);
    nextListings.splice(dropIndex, 0, removed);
    setListings(nextListings);
    handleDragEnd();
    try {
      await reorderListings(runId, nextListings.map(l => l.id));
    } catch (err: any) {
      alert(err.message || 'Failed to reorder');
      loadData();
    }
  };

  const handleRemove = async (listingId: string) => {
    if (!confirm('Remove this listing from the run? (It will remain in the unified ledger).')) return;
    try {
      await removeListingFromRun(listingId);
      setListings(prev => prev.filter(l => l.id !== listingId));
      setWarningsReviewed(false); // reset checklist
    } catch (err: any) {
      alert(err.message || 'Failed to remove listing');
    }
  };

  const handleDeleteCapturePermanent = async (listingId: string, sightingId: string, assetId: string, make: string, model: string, year: number | null) => {
    const confirmed = window.confirm(`Delete ${year || ''} ${make} ${model} permanently? This removes it from the ledger and from any research runs. This cannot be undone.`);
    if (!confirmed) return;
    
    // Optimistic remove
    setListings(prev => prev.filter(l => l.id !== listingId));
    setWarningsReviewed(false);

    try {
      await deleteSighting(sightingId, assetId);
    } catch (err: any) {
      alert(err.message || 'Failed to delete sighting permanently');
      loadData(); // revert optimistic
    }
  };

  const handleStoreImages = async () => {
    setStoringImages(true);
    try {
      await storeImagesForRun(runId);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to store images');
    } finally {
      setStoringImages(false);
    }
  };

  const handleDeleteRun = async () => {
    if (!user || run?.client_name !== deleteConfirmName) return;
    setDeleting(true);
    try {
      await softDeleteRun(runId, user.id);
      onBack();
    } catch (err: any) {
      alert(err.message || 'Failed to delete run');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#a58039]" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="bg-red-50 text-red-600 p-6 rounded-xl border border-red-100 text-center">
        <p className="font-semibold">{error || 'Run not found'}</p>
        <button onClick={onBack} className="mt-4 text-sm underline">Go Back</button>
      </div>
    );
  }

  // A vehicle that sold at auction more than once (crash, repair, resale) is not a like-for-like comp. The flag is
  // derived from auction_history and merged onto the listing HERE, once, so every consumer below - the sold average,
  // the group composition and the pre-share checklist - reads the same fact through the shared predicate.
  const listingsWithHistory = listings.map(l => (l.asset_id && auctionHistoryFlags.get(l.asset_id)?.repeatSale) ? { ...l, repeat_sale: true } : l);
  const includedListings = listingsWithHistory.filter(l => l.included);
  const includedCount = includedListings.length;
  const approvedListing = listings.find(l => l.approved_at);

  // PROMPT 28 Stage 1 - range composition is derived from the exact same includePrice
  // membership as the average itself (not a second definition of "the sold group" - debt #50
  // already flags three of those, this isn't a fourth), so the disclosure can never drift from
  // what the average actually counted. year_min/year_max unset on the brief means no range was
  // stated at all - nothing to disclose, not "everything out of range." A comp with no year is
  // unknown, not out of range (AGENTS.md S4.1 - absence is not violation).
  const getStats = (list: RunListing[], isSoldGroup: boolean, brief?: ClientBrief | null) => {
    let tP = 0, pC = 0, minP = Infinity, maxP = -Infinity, tM = 0, mC = 0;
    let rangeInCount = 0, rangeOutCount = 0, rangeUnknownCount = 0;
    const rangeStated = isSoldGroup && !!brief && (brief.year_min != null || brief.year_max != null);
    list.forEach(l => {
      // PROMPT 29 Stage 2 - the inline predicate that used to live here is now the shared
      // definition in supabase/functions/_shared/soldGroup.ts, imported literally by both this
      // component and public-run. Same rule, one copy (debt #47/#50).
      const includePrice = isSoldGroup ? countsTowardSoldAverage(l) : true;

      const p = l.price_usd;
      if (p !== null && includePrice) {
        tP += p; pC++;
        if (p < minP) minP = p;
        if (p > maxP) maxP = p;
        if (rangeStated) {
          if (l.year == null) {
            rangeUnknownCount++;
          } else {
            const belowMin = brief!.year_min != null && l.year < brief!.year_min;
            const aboveMax = brief!.year_max != null && l.year > brief!.year_max;
            if (belowMin || aboveMax) rangeOutCount++; else rangeInCount++;
          }
        }
      }
      if (l.mileage_miles !== null) {
        tM += l.mileage_miles; mC++;
      }
    });
    return {
      avgPrice: pC > 0 ? tP / pC : null,
      minPrice: pC > 0 ? minP : null,
      maxPrice: pC > 0 ? maxP : null,
      priceCount: pC,
      avgMileage: mC > 0 ? tM / mC : null,
      count: list.length,
      rangeStated,
      rangeInCount,
      rangeOutCount,
      rangeUnknownCount,
    };
  };

  const isMixed = run.run_type === 'mixed';
  const isSoldComps = run.run_type === 'sold_comps';
  const isActiveListings = run.run_type === 'active_listings';

  // PROMPT 29 Stage 2 - sold-group membership now comes from the shared definition; the
  // live-group filter stays as-is (it is the complement in practice, and is not one of the
  // three divergent sold-group definitions this stage unified).
  const displayGroups = isMixed
    ? [
        { label: "Market Research (Sold)", stats: getStats(includedListings.filter(l => isInSoldPopulation(l, 'mixed')), true, run.client_brief), type: 'sold' },
        { label: "Client Options (Live)", stats: getStats(includedListings.filter(l => populationOf(l, 'mixed') === 'active'), false), type: 'active' }
      ]
    : [
        { label: "Run Listings", stats: getStats(includedListings, isSoldComps, run.client_brief), type: isSoldComps ? 'sold' : 'active' }
      ];

  // Pre-Share Checklist - PROMPT 43 Stage 2: every rule lives in ONE pure, unit-tested module
  // (supabase/functions/_shared/riskRules.ts), shared with public-run. This component only feeds it and renders it.
  // The repeat-sale flag is merged inside the module, from the same history flags.
  const checklistItems: RuleItem[] = evaluateRun({
    runType: run.run_type as any,
    brief: run.client_brief as any,
    listings: includedListings as any,
    historyFlags: auctionHistoryFlags,
    historyRows: auctionHistoryRows as any,
    decoded: decodedByVin as any,
  });

  const hasBlocks = checklistItems.some(i => i.type === 'BLOCK' && !i.passed);
  const hasCriticals = checklistItems.some(i => i.type === 'CRITICAL' && !i.passed);
  const hasWarnings = checklistItems.some(i => i.type === 'WARN' && !i.passed);
  const canShare = !hasBlocks && 
    (!hasCriticals || (warningsReviewed && criticalOverrideReason.trim().length >= 10)) &&
    (!hasWarnings || warningsReviewed);

  // Per-listing badges come from the module's registry. An item whose rule is not registered is shown as a loud
  // 'UNLABELLED FLAG (...)' - never dropped (the old if/else chain silently skipped any id it did not recognise).
  // An ALREADY-SHARED run that a rule now flags (a new rule, a re-capture, a changed listing) must not stay quietly
  // shared: say so, name what is new, and point at the off-switch.
  const newFlags = run.share_enabled ? newlyFlagged(checklistItems, shareSnapshot, !!(run.critical_override_reason && run.critical_override_reason.trim())) : [];
  const listingBadges = moduleListingBadges(checklistItems);
  const scrollToOffender = (ids: string[]) => {
    if (ids.length === 0) return;
    const firstId = ids[0];
    const el = document.getElementById(`listing-${firstId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPulseListingId(firstId);
      setTimeout(() => setPulseListingId(null), 2000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button 
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-[#403f4c] transition-colors font-medium"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Runs
      </button>

      {/* Header Card */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/20">
        <div className="flex flex-col md:flex-row justify-between gap-6 mb-6">
          <div className="flex-1">
            {editingName ? (
              <div className="flex items-center gap-2 mb-2">
                <input 
                  type="text" 
                  autoFocus
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onBlur={handleNameSave}
                  onKeyDown={e => e.key === 'Enter' && handleNameSave()}
                  className="text-2xl font-bold border-b-2 border-[#a58039] focus:outline-none bg-transparent"
                />
                <button onClick={handleNameSave} className="text-green-600 p-1 hover:bg-green-50 rounded"><Check className="w-5 h-5"/></button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2 group">
                <h2 className="text-2xl font-bold text-[#403f4c]">{run.client_name}</h2>
                <button 
                  onClick={() => setEditingName(true)} 
                  className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-[#a58039] p-1"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            )}
            
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>Created {new Date(run.created_at).toLocaleDateString()}</span>
              {run.client && (
                <span>
                  For{' '}
                  <button
                    onClick={() => onOpenClient?.(run.client!.id, run.client_brief?.id)}
                    className="font-bold text-[#a58039] hover:underline"
                  >
                    {run.client.full_name}
                  </button>
                  {run.client_brief && (
                    <>
                      {' · Brief: '}
                      <button
                        onClick={() => onOpenClient?.(run.client!.id, run.client_brief!.id)}
                        className="font-bold text-[#a58039] hover:underline"
                      >
                        {briefReference(run.client_brief)}
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={run.status}
                onChange={(e) => handleUpdate({ status: e.target.value as any })}
                className="bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-[#a58039] focus:border-[#a58039] block w-full p-2.5 font-medium"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Run Type</label>
              <select
                value={run.run_type}
                onChange={(e) => {
                  if (confirm('Changing run type may make some existing listings ineligible for this run. Continue?')) {
                    handleUpdate({ run_type: e.target.value as any });
                  }
                }}
                className="bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-[#a58039] focus:border-[#a58039] block w-full p-2.5 font-medium"
              >
                <option value="active_listings">Client Options</option>
                <option value="sold_comps">Market Research</option>
                <option value="mixed">Both (Mixed)</option>
              </select>
            </div>
          </div>
        </div>

        {approvedListing && (
          <div className={`mb-6 p-4 rounded-lg border ${approvedListing.approved_via === 'client' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
            <h3 className={`text-sm font-bold mb-2 flex items-center gap-2 ${approvedListing.approved_via === 'client' ? 'text-green-800' : 'text-blue-800'}`}>
              {approvedListing.approved_via === 'client' ? <CheckCircle2 className="w-4 h-4" /> : <PhoneCall className="w-4 h-4" />}
              {approvedListing.approved_via === 'client' ? 'Client-approved vehicle' : 'Approval recorded by staff (relayed)'}
            </h3>
            <div className="text-sm text-gray-700">
              <span className="font-medium">{approvedListing.year} {approvedListing.make} {approvedListing.model} {approvedListing.trim || ''}</span>
              {' — '}approved {new Date(approvedListing.approved_at!).toLocaleString()}
              {approvedListing.approved_via === 'staff_relayed' && ' · relayed from the client, not made by the client directly'}
            </div>
            {approvedListing.approved_snapshot && (
              <div className="mt-2 text-xs text-gray-500 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
                <div><span className="text-gray-400">Shown VIN:</span> {(approvedListing.approved_snapshot as any).vin || '—'}</div>
                <div><span className="text-gray-400">Shown price:</span> {(approvedListing.approved_snapshot as any).display_price != null ? `$${Number((approvedListing.approved_snapshot as any).display_price).toLocaleString()}${(approvedListing.approved_snapshot as any).is_bid ? ' (bid)' : ''}` : '—'}</div>
                <div><span className="text-gray-400">Shown auction date:</span> {(approvedListing.approved_snapshot as any).sale_date ? new Date((approvedListing.approved_snapshot as any).sale_date).toLocaleDateString() : '—'}</div>
                <div><span className="text-gray-400">Source:</span> {(approvedListing.approved_snapshot as any).source_platform || '—'}</div>
              </div>
            )}

            {/* PROMPT 34 Stage 2 - promotion, superadmin only. The listing itself is never
                touched beyond the won_vehicle_id/won_at marker set by the promotion RPC. */}
            <div className="mt-3 pt-3 border-t border-gray-200/60">
              {approvedListing.won_vehicle_id ? (
                <div className="flex items-center gap-2 text-sm text-emerald-700 font-medium">
                  <CheckCircle2 className="w-4 h-4" /> Won — promoted {approvedListing.won_at ? new Date(approvedListing.won_at).toLocaleString() : ''}
                </div>
              ) : role === 'superadmin' ? (
                <button
                  onClick={() => handlePromote(approvedListing)}
                  disabled={promoting}
                  className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  {promoting ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Mark as Won
                </button>
              ) : null}
              {promoteError && <div className="mt-2 text-sm text-[#ba3b46]">{promoteError}</div>}
            </div>
          </div>
        )}

        {run.client_brief && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-sm font-bold text-gray-700 mb-2">Linked Buying Brief Requirements</h3>
            {run.run_type === 'sold_comps' && (
              <div className="mb-3 flex items-start gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>Spec matching applies to active-listings runs only. This brief is stored with the run but no spec rules will run against it.</span>
              </div>
            )}
            {run.client_brief.status === 'pending_review' && (
              <div className="mb-3 flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>This brief is pending staff review. It is not driving any spec-match flags below until approved.</span>
              </div>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {run.client_brief.year_min || run.client_brief.year_max ? (
                <div><span className="text-gray-500">Year:</span> {run.client_brief.year_min || 'Any'} - {run.client_brief.year_max || 'Any'}</div>
              ) : null}
              {run.client_brief.max_mileage ? (
                <div><span className="text-gray-500">Max Mileage:</span> {run.client_brief.max_mileage.toLocaleString()} mi</div>
              ) : null}
              {run.client_brief.condition_required && run.client_brief.condition_required !== 'either' ? (
                <div><span className="text-gray-500">Condition:</span> {run.client_brief.condition_required === 'run_and_drive' ? 'Run & Drive' : run.client_brief.condition_required}</div>
              ) : null}
              {run.client_brief.titles_accepted && run.client_brief.titles_accepted.length > 0 ? (
                <div><span className="text-gray-500">Titles:</span> {run.client_brief.titles_accepted.join(', ')}</div>
              ) : null}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
          <textarea
            value={notesInput}
            onChange={e => setNotesInput(e.target.value)}
            onBlur={handleNotesBlur}
            placeholder="Click to add internal notes..."
            className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#a58039] min-h-[80px]"
          />
        </div>
      </div>

      {/* Sharing Panel */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/20">
        
        {/* PRE-SHARE CHECKLIST */}
        <div className="mb-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
          <h4 className="text-sm font-bold text-[#403f4c] mb-3">Pre-Share Checklist</h4>
          <ul className="space-y-2 text-sm">
            {checklistItems.map((item, i) => {
              if (item.type === 'INFO') {
                return (
                  <li key={i} className="flex items-start gap-2 text-blue-700">
                    <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span
                      className={item.offenderIds.length > 0 ? 'cursor-pointer hover:underline' : ''}
                      onClick={() => scrollToOffender(item.offenderIds)}
                    >
                      {item.message}
                    </span>
                  </li>
                );
              }
              if (item.passed) {
                return (
                  <li key={i} className="flex items-start gap-2 text-green-600">
                    <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> {item.message}
                  </li>
                );
              }
              const isBlock = item.type === 'BLOCK';
              return (
                <li key={i} className={`flex items-start gap-2 ${isBlock ? 'text-red-600' : 'text-yellow-600'}`}>
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span
                    className={item.offenderIds.length > 0 ? 'cursor-pointer hover:underline' : ''}
                    onClick={() => scrollToOffender(item.offenderIds)}
                  >
                    {item.message} ({item.type})
                  </span>
                </li>
              );
            })}
          </ul>
          
          {(hasWarnings || hasCriticals) && !hasBlocks && (
            <div className="mt-4 space-y-4">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                <input 
                  type="checkbox"
                  checked={warningsReviewed}
                  onChange={e => setWarningsReviewed(e.target.checked)}
                  className="rounded text-[#a58039] focus:ring-[#a58039]"
                />
                I've reviewed these warnings
              </label>

              {hasCriticals && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason for sharing despite critical warnings (recorded):
                  </label>
                  <textarea
                    value={criticalOverrideReason}
                    onChange={e => setCriticalOverrideReason(e.target.value)}
                    placeholder="Min 10 characters required..."
                    className="w-full bg-white border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#a58039] min-h-[60px]"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {newFlags.length > 0 && (
          <div data-testid="shared-newly-flagged" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <div className="font-bold mb-1">This run is SHARED with the client, and {newFlags.length === 1 ? 'a flag is' : `${newFlags.length} flags are`} new since sharing was switched on.</div>
            <ul className="list-disc ml-5">
              {Array.from(new Map(newFlags.map(f => [f.item.id, f.item])).values()).map(item => (
                <li key={item.id}>{item.message} ({item.type})</li>
              ))}
            </ul>
            <div className="mt-1 text-xs">Review it and, if the client should not see this yet, turn sharing off below.</div>
          </div>
        )}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <LinkIcon className={`w-5 h-5 ${canShare ? 'text-[#a58039]' : 'text-gray-400'}`} />
            <h3 className="text-lg font-bold text-[#403f4c]">Client Sharing</h3>
          </div>
          <label className={`relative inline-flex items-center ${(canShare || run.share_enabled) ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <input 
              type="checkbox" 
              data-testid="share-toggle"
              className="sr-only peer" 
              checked={run.share_enabled}
              // Turning sharing OFF must always be possible. A run that is already shared and then acquires a block or
              // an unreviewed CRITICAL (a new rule, a re-capture) used to have its off-switch disabled too - the one
              // control that stops a client seeing it was the one the checks locked.
              disabled={!canShare && !run.share_enabled}
              onChange={(e) => {
                const checked = e.target.checked;
                const patch: Partial<ResearchRun> = { share_enabled: checked };
                if (checked && hasCriticals) {
                  patch.critical_override_reason = criticalOverrideReason.trim();
                  patch.critical_override_by = user?.id || null;
                  patch.critical_override_at = new Date().toISOString();
                }
                handleUpdate(patch);
                // what is flagged RIGHT NOW was reviewed (and, for CRITICALs, overridden with a reason) by this act;
                // anything flagged later is NEW and will raise the shared-run warning
                if (checked && orgId) {
                  const keys = flagKeys(checklistItems).map(f => f.key);
                  saveShareFlagSnapshot(runId, orgId, keys).then(() => setShareSnapshot(keys)).catch(err => console.error('share flag snapshot not saved', err));
                }
              }}
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#a58039]"></div>
            <span className="ml-3 text-sm font-medium text-gray-700">
              {run.share_enabled ? (canShare ? 'Enabled' : 'Enabled - has unresolved checks (turn off to stop sharing)') : (!canShare ? 'Blocked by checks' : 'Disabled')}
            </span>
          </label>
        </div>
        
        {run.share_enabled && (
          <div className="animate-in fade-in slide-in-from-top-2">
            <div className="flex gap-2">
              <input 
                type="text" 
                readOnly 
                data-testid="share-link"
                value={`${window.location.origin}/share/${run.share_token}`}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 focus:outline-none"
              />
              <button 
                onClick={handleCopyLink}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors flex items-center gap-2"
              >
                <Copy className="w-4 h-4" /> Copy link
              </button>
              <button 
                onClick={handleRotateToken}
                className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Rotate link
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Listings Table */}
      <div className="bg-white rounded-xl shadow-sm border border-[#a58039]/20 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h3 className="text-lg font-bold text-[#403f4c] flex items-center gap-2 mb-2">
              Run Listings ({includedCount} of {listings.length} included)
            </h3>
            
            {/* Dynamic Summary Bar */}
            <div className="flex flex-col gap-4">
              {displayGroups.map((group, i) => (
                <div key={i} className="flex gap-4 flex-wrap border-l-4 border-[#a58039] pl-3 py-1">
                  <div className="w-full text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">{group.label}</div>
                  
                  {group.type === 'sold' && (
                    <div className="bg-white px-4 py-2 rounded-lg border border-gray-100 shadow-sm text-sm min-w-[140px]">
                      <div className="text-gray-500 text-xs mb-1">Avg sale price ({group.stats.priceCount} sales)</div>
                      <div className="font-bold text-[#403f4c]">
                        {group.stats.avgPrice !== null ? `$${Math.round(group.stats.avgPrice).toLocaleString()}` : '—'}
                      </div>
                    </div>
                  )}

                  {/* PROMPT 28 Stage 1 - disclosure, never a WARN: labels/counts an out-of-range
                      comp as market-history information, per PROJECT_CHARTER.md S5.1 ("widen
                      bands and say so"), while S5.6 still forbids treating it as a spec defect -
                      the comp is never excluded from the average or count above. Rendered only
                      when the brief actually states a range; a brief with none has nothing to
                      disclose (S4.1 - absence is not violation). */}
                  {group.type === 'sold' && group.stats.rangeStated && (
                    <div className="bg-blue-50 px-4 py-2 rounded-lg border border-blue-100 text-sm min-w-[220px]">
                      <div className="text-blue-700 text-xs mb-1 font-medium">Sample vs. requested year range</div>
                      <div className="font-bold text-blue-900 text-sm">
                        {group.stats.rangeInCount} inside{group.stats.rangeOutCount > 0 ? `, ${group.stats.rangeOutCount} outside` : ''}
                        {group.stats.rangeUnknownCount > 0 ? ` (${group.stats.rangeUnknownCount} unknown year)` : ''}
                      </div>
                    </div>
                  )}

                  {group.type === 'active' && (
                    <div className="bg-white px-4 py-2 rounded-lg border border-gray-100 shadow-sm text-sm min-w-[140px]">
                      <div className="text-gray-500 text-xs mb-1">Listings count</div>
                      <div className="font-bold text-[#403f4c]">
                        {group.stats.count} included
                      </div>
                    </div>
                  )}

                  <div className="bg-white px-4 py-2 rounded-lg border border-gray-100 shadow-sm text-sm min-w-[140px]">
                    <div className="text-gray-500 text-xs mb-1">
                      {group.type === 'active' ? 'Current bid range (live, provisional)' : 'Min / Max Price'}
                    </div>
                    <div className="font-bold text-[#403f4c]">
                      {group.stats.priceCount > 0 ? `$${Math.round(group.stats.minPrice!).toLocaleString()} / $${Math.round(group.stats.maxPrice!).toLocaleString()}` : '—'}
                    </div>
                  </div>
                  
                  <div className="bg-white px-4 py-2 rounded-lg border border-gray-100 shadow-sm text-sm min-w-[140px]">
                    <div className="text-gray-500 text-xs mb-1">Avg Mileage</div>
                    <div className="font-bold text-[#403f4c]">
                      {group.stats.avgMileage !== null ? `${Math.round(group.stats.avgMileage).toLocaleString()} mi` : '—'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
          </div>
          <div className="flex items-center justify-between w-full mt-2">
            <div className="flex items-center gap-2">
              <button 
                onClick={handleStoreImages}
                disabled={storingImages}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-[#403f4c] rounded-lg font-bold hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {storingImages ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                Store Images
              </button>
              <button 
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white rounded-lg font-bold hover:bg-[#2d2c35] transition-colors"
              >
                <Plus className="w-4 h-4" /> Add captures
              </button>
            </div>
            {role === 'superadmin' && (
              <button
                onClick={() => setShowDeleteModal(true)}
                className="flex items-center gap-2 px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete run
              </button>
            )}
          </div>
        </div>

        {listings.length === 0 ? (
          <div className="p-12 text-center text-gray-500 bg-white">
            <ImageIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No listings yet. Use 'Add captures' to attach vehicles you've captured.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-center w-24">Order</th>
                  <th className="px-4 py-3 text-center w-16" title="Included in client view">Inc.</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Value / Bid</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {listings.map((listing, index) => (
                  <React.Fragment key={listing.id}>
                  <tr
                    id={`listing-${listing.id}`}
                    draggable={true}
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    onClick={() => setActiveListing(listing)}
                    className={`transition-all cursor-pointer ${!listing.included ? 'opacity-60' : ''} ${dragOverIndex === index ? 'border-t-2 border-[#a58039]' : ''} ${listingBadges.get(listing.id)?.some(b => b.type === 'BLOCK' || b.type === 'CRITICAL') ? 'bg-red-50 hover:bg-red-100' : listingBadges.get(listing.id)?.some(b => b.type === 'WARN') ? 'bg-yellow-50 hover:bg-yellow-100' : 'bg-white hover:bg-gray-50'} ${pulseListingId === listing.id ? 'animate-pulse ring-2 ring-[#a58039] z-10 relative' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div 
                        className="flex items-center justify-center gap-2 cursor-grab active:cursor-grabbing opacity-50 hover:opacity-100 transition-opacity"
                        onClick={e => e.stopPropagation()}
                      >
                        <GripVertical className="w-5 h-5 text-gray-400" />
                        <span className="w-4 text-center text-xs font-medium text-gray-500">{index + 1}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input 
                        type="checkbox"
                        checked={listing.included}
                        onClick={e => e.stopPropagation()}
                        onChange={e => handleToggleIncluded(listing.id, e.target.checked)}
                        className="rounded text-[#a58039] focus:ring-[#a58039] w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className={`px-4 py-3 border-l-4 ${listingBadges.get(listing.id)?.some(b => b.type === 'BLOCK' || b.type === 'CRITICAL') ? 'border-red-500' : listingBadges.get(listing.id)?.some(b => b.type === 'WARN') ? 'border-yellow-500' : 'border-transparent'}`}>
                      <div className="flex items-start gap-3">
                        <div className="w-16 h-12 flex-shrink-0 bg-gray-200 rounded overflow-hidden">
                          {listing.stored_image_urls?.[0] && signedThumbnails[listing.stored_image_urls[0]] ? (
                            <img 
                              src={signedThumbnails[listing.stored_image_urls[0]]} 
                              alt="thumbnail" 
                              className="w-full h-full object-cover" 
                            />
                          ) : listing.image_urls?.[0] ? (
                            <img 
                              src={listing.image_urls[0]} 
                              alt="thumbnail" 
                              className="w-full h-full object-cover" 
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                const div = document.createElement('div');
                                div.className = 'w-full h-full flex items-center justify-center bg-gray-200 text-[10px] text-gray-500 font-medium text-center leading-tight p-1';
                                div.innerText = `${listing.year || ''} ${listing.make} ${listing.model}`.trim();
                                e.currentTarget.parentNode?.appendChild(div);
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                              <ImageIcon className="w-5 h-5" />
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-[#403f4c]">
                            {listing.year} {listing.make} {listing.model} {listing.trim || ''}
                          </div>
                          {listing.approved_at && (
                            <div
                              className={`inline-flex items-center gap-1 mt-1.5 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold whitespace-nowrap border ${
                                listing.approved_via === 'client'
                                  ? 'bg-green-100 text-green-700 border-green-200'
                                  : 'bg-blue-100 text-blue-700 border-blue-200'
                              }`}
                              title={
                                listing.approved_via === 'client'
                                  ? `Client approved via the share page on ${new Date(listing.approved_at).toLocaleString()}`
                                  : `Staff recorded a client approval relayed through another channel, on ${new Date(listing.approved_at).toLocaleString()}`
                              }
                            >
                              {listing.approved_via === 'client' ? <CheckCircle2 className="w-3 h-3" /> : <PhoneCall className="w-3 h-3" />}
                              {listing.approved_via === 'client' ? 'Client approved' : 'Approved (relayed)'} · {new Date(listing.approved_at).toLocaleDateString()}
                            </div>
                          )}
                          {(listingBadges.get(listing.id) || []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {listingBadges.get(listing.id)!.map((b, bi) => (
                                <span key={bi} className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold whitespace-nowrap ${(b.type === 'BLOCK' || b.type === 'CRITICAL') ? 'bg-red-100 text-red-700 border border-red-200' : b.type === 'INFO' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}`}>
                                  {b.text}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                            <div>{listing.mileage_miles ? `${listing.mileage_miles.toLocaleString()} mi` : 'Unk. mileage'}</div>
                            <div className="flex items-center gap-2">
                              {listing.damage_type && <span>{listing.damage_type}</span>}
                              {listing.title_type && <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] uppercase font-bold">{listing.title_type}</span>}
                              
                              {listing.image_store_status === 'complete' && <span className="text-green-600 font-bold text-[10px] uppercase">stored ({listing.stored_image_urls?.length})</span>}
                              {listing.image_store_status === 'partial' && <span className="text-amber-600 font-bold text-[10px] uppercase">partial ({listing.stored_image_urls?.length})</span>}
                              {listing.image_store_status === 'failed' && <span className="text-red-600 font-bold text-[10px] uppercase">failed</span>}
                              {!listing.image_store_status && <span className="text-gray-400 font-bold text-[10px] uppercase">not stored</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-[#403f4c]">
                          <span className="text-gray-500 text-xs block mb-0.5">
                            {listing.price_usd !== null 
                              ? (listing.current_bid_usd !== null ? 'Current bid' : 'Sale / Listed Price') 
                              : 'No Price'}
                          </span>
                          {listing.price_usd !== null 
                            ? `$${listing.price_usd.toLocaleString()}`
                            : '—'}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1.5">
                        <div className="flex gap-2">
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded text-[10px] font-bold uppercase whitespace-nowrap">
                            {listing.source_platform}
                          </span>
                          <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-100 rounded text-[10px] font-bold uppercase whitespace-nowrap">
                            {listing.logged_via}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {listing.location || 'Unknown loc'}
                        </div>
                        {(run.run_type === 'active_listings' || run.run_type === 'mixed') && (
                          <div className="pt-1 border-t border-gray-100">
                            <AuctionCountdown saleDateText={listing.sale_date || null} />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {!approvedListing && listing.included && listing.lot_state !== 'finished' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRecordApproval(listing);
                            }}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Record that the client approved this vehicle by phone/WhatsApp"
                          >
                            <PhoneCall className="w-4 h-4" />
                          </button>
                        )}
                        {role === 'superadmin' && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCapturePermanent(listing.id, listing.sighting_id, listing.asset_id, listing.make, listing.model, listing.year);
                            }}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Delete capture permanently"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        {/* PROMPT 26 - widened from "active listings only": a finished listing
                            now reaches this too. "What did this car actually cost" validates
                            the fee model against reality; headroom itself still abstains on a
                            sold car (ListingCostBreakdown/computeBidHeadroom), but the cost
                            components render. Leaving this unreachable for finished listings
                            would have been the same failure as this session's vacuously-true
                            zero - a branch nothing can reach. */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedCostListingIds(prev => {
                              const next = new Set(prev);
                              if (next.has(listing.id)) next.delete(listing.id); else next.add(listing.id);
                              return next;
                            });
                          }}
                          className={`p-2 rounded transition-colors ${expandedCostListingIds.has(listing.id) ? 'text-[#a58039] bg-[#a58039]/10' : 'text-gray-400 hover:text-[#a58039] hover:bg-[#a58039]/10'}`}
                          title="Landed cost & bid headroom (internal only)"
                        >
                          <DollarSign className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemove(listing.id);
                          }}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Remove from run"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedCostListingIds.has(listing.id) && orgId && (
                    <tr>
                      <td colSpan={6} className="px-4 pb-3 bg-white" onClick={e => e.stopPropagation()}>
                        <ListingCostBreakdown orgId={orgId} listing={listing} maxBudgetUsd={run.client_brief?.max_budget_usd} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAddModal && orgId && (
        <AddCapturesModal
          runId={runId}
          runType={run.run_type}
          orgId={orgId}
          existingSightingIds={listings.map(l => l.sighting_id)}
          onClose={() => setShowAddModal(false)}
          onAdded={loadData}
        />
      )}

      {activeListing && (
        <VehicleDetailModal
          listing={activeListing}
          onClose={() => setActiveListing(null)}
          showInternalFields={true}
        />
      )}

      {showDeleteModal && run && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              Delete Research Run
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              This will softly delete the run. Sharing will be disabled immediately. 
              The run is recoverable for 30 days. Attached listings are <strong>NOT</strong> deleted from the ledger.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type <strong>{run.client_name}</strong> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmName}
                onChange={e => setDeleteConfirmName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                placeholder={run.client_name}
              />
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button 
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 text-gray-600 font-bold hover:bg-gray-100 rounded-lg transition-colors"
                disabled={deleting}
              >
                Cancel
              </button>
              <button 
                onClick={handleDeleteRun}
                disabled={deleteConfirmName !== run.client_name || deleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResearchRunDetail;

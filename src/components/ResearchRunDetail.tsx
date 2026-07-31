import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  getRun, 
  listRunListings, 
  updateRun, 
  setListingIncluded, 
  reorderListings, 
  removeListingFromRun, 
  rotateShareToken,
  ResearchRun,
  RunListing
} from '../services/researchService';
import AddCapturesModal from './AddCapturesModal';
import VehicleDetailModal from './VehicleDetailModal';
import { ArrowLeft, Edit2, Check, ArrowUp, ArrowDown, Plus, Trash2, Loader2, Link as LinkIcon, Copy, RefreshCw, ImageIcon, GripVertical, AlertTriangle } from 'lucide-react';

interface ResearchRunDetailProps {
  runId: string;
  onBack: () => void;
}

const ResearchRunDetail: React.FC<ResearchRunDetailProps> = ({ runId, onBack }) => {
  const { orgId } = useAuth();
  
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [listings, setListings] = useState<RunListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeListing, setActiveListing] = useState<RunListing | null>(null);

  // Edit states
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  
  // Checklist states
  const [warningsReviewed, setWarningsReviewed] = useState(false);
  const [pulseListingId, setPulseListingId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [r, l] = await Promise.all([
        getRun(runId),
        listRunListings(runId)
      ]);
      setRun(r);
      setListings(l);
      if (r) {
        setNameInput(r.client_name);
        setNotesInput(r.notes || '');
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

  const includedListings = listings.filter(l => l.included);
  const includedCount = includedListings.length;

  const getStats = (list: RunListing[]) => {
    let tP = 0, pC = 0, minP = Infinity, maxP = -Infinity, tM = 0, mC = 0;
    list.forEach(l => {
      const p = l.price_usd;
      if (p !== null) {
        tP += p; pC++;
        if (p < minP) minP = p;
        if (p > maxP) maxP = p;
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
      count: list.length
    };
  };

  const isMixed = run.run_type === 'mixed';
  const isSoldComps = run.run_type === 'sold_comps';
  const isActiveListings = run.run_type === 'active_listings';

  const displayGroups = isMixed 
    ? [
        { label: "Market Research (Sold)", stats: getStats(includedListings.filter(l => l.lot_state !== 'active' && l.current_bid_usd === null)), type: 'sold' },
        { label: "Client Options (Live)", stats: getStats(includedListings.filter(l => l.lot_state !== 'finished' && l.current_bid_usd !== null)), type: 'active' }
      ]
    : [
        { label: "Run Listings", stats: getStats(includedListings), type: isSoldComps ? 'sold' : 'active' }
      ];

  // Pre-Share Checklist
  const checklistItems: { id: string, type: 'BLOCK' | 'WARN', message: string, offenderIds: string[], passed: boolean }[] = [];

  // 1. Zero listings (BLOCK)
  checklistItems.push({
    id: 'zero_listings',
    type: 'BLOCK',
    message: includedCount === 0 ? 'Zero included listings.' : 'At least one listing included',
    offenderIds: [],
    passed: includedCount > 0
  });

  // 2. Duplicate vehicle (BLOCK)
  const duplicateOffenders: string[] = [];
  const vinToIds = new Map<string, string[]>();
  includedListings.forEach(l => {
    if (l.vin) {
      if (!vinToIds.has(l.vin)) vinToIds.set(l.vin, []);
      vinToIds.get(l.vin)!.push(l.id);
    }
  });
  vinToIds.forEach((ids) => {
    if (ids.length > 1) duplicateOffenders.push(...ids);
  });
  checklistItems.push({
    id: 'duplicate',
    type: 'BLOCK',
    message: duplicateOffenders.length > 0 ? `Duplicate vehicle in run (${duplicateOffenders.length} listings)` : 'No duplicate vehicles',
    offenderIds: duplicateOffenders,
    passed: duplicateOffenders.length === 0
  });

  // 5. No price (WARN)
  const noPriceOffenders = includedListings.filter(l => l.price_usd === null).map(l => l.id);
  checklistItems.push({
    id: 'no_price',
    type: 'WARN',
    message: noPriceOffenders.length > 0 ? `No USD price (${noPriceOffenders.length} listings)` : 'All listings have a USD price',
    offenderIds: noPriceOffenders,
    passed: noPriceOffenders.length === 0
  });

  // 6. Non-insurance seller (WARN)
  const nonInsuranceOffenders = includedListings.filter(l => l.seller_type && /non-insurance/i.test(l.seller_type)).map(l => l.id);
  checklistItems.push({
    id: 'non_insurance',
    type: 'WARN',
    message: nonInsuranceOffenders.length > 0 ? `Non-insurance seller (${nonInsuranceOffenders.length} listings)` : 'No non-insurance sellers',
    offenderIds: nonInsuranceOffenders,
    passed: nonInsuranceOffenders.length === 0
  });

  if (isSoldComps || isMixed) {
    const soldList = isMixed ? includedListings.filter(l => l.lot_state !== 'active' && l.current_bid_usd === null) : includedListings;
    const soldStats = getStats(soldList);
    
    // 3. Limited sample (WARN)
    const limitedSample = soldStats.priceCount > 0 && soldStats.priceCount < 3;
    checklistItems.push({
      id: 'limited_sample',
      type: 'WARN',
      message: limitedSample ? `Market research average is based on only ${soldStats.priceCount} sales. Limited sample.` : 'Sufficient sample size',
      offenderIds: [],
      passed: !limitedSample
    });

    // 4. Different model (WARN)
    const counts: Record<string, string[]> = {};
    soldList.forEach(l => {
      const key = `${l.make} ${l.model}`;
      if (!counts[key]) counts[key] = [];
      counts[key].push(l.id);
    });
    const keys = Object.keys(counts);
    let differentModelOffenders: string[] = [];
    let diffMsg = 'Models are consistent';
    
    if (keys.length > 1) {
      let maxCount = -1;
      let majorityKey = keys[0];
      keys.forEach(k => {
        if (counts[k].length > maxCount) {
          maxCount = counts[k].length;
          majorityKey = k;
        }
      });
      keys.forEach(k => {
        if (k !== majorityKey) {
          differentModelOffenders.push(...counts[k]);
        }
      });
      const compStr = Object.entries(counts).map(([k, ids]) => `${ids.length}× ${k}`).join(', ');
      diffMsg = `Market research contains mixed models: ${compStr} (${differentModelOffenders.length} listings)`;
    }

    checklistItems.push({
      id: 'different_model',
      type: 'WARN',
      message: diffMsg,
      offenderIds: differentModelOffenders,
      passed: differentModelOffenders.length === 0
    });
  }

  const hasBlocks = checklistItems.some(i => i.type === 'BLOCK' && !i.passed);
  const hasWarnings = checklistItems.some(i => i.type === 'WARN' && !i.passed);
  const canShare = !hasBlocks && (!hasWarnings || warningsReviewed);

  const listingBadges = new Map<string, { type: 'BLOCK' | 'WARN', text: string }[]>();
  checklistItems.filter(i => !i.passed).forEach(item => {
    item.offenderIds.forEach(id => {
      if (!listingBadges.has(id)) listingBadges.set(id, []);
      let text = '';
      if (item.id === 'duplicate') text = 'Duplicate vehicle';
      else if (item.id === 'no_price') text = 'No price';
      else if (item.id === 'non_insurance') text = 'Non-insurance seller';
      else if (item.id === 'different_model') text = 'Different model';
      if (text) {
        listingBadges.get(id)!.push({ type: item.type, text });
      }
    });
  });
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
          
          {hasWarnings && !hasBlocks && (
            <label className="flex items-center gap-2 mt-4 text-sm font-medium text-gray-700 cursor-pointer">
              <input 
                type="checkbox"
                checked={warningsReviewed}
                onChange={e => setWarningsReviewed(e.target.checked)}
                className="rounded text-[#a58039] focus:ring-[#a58039]"
              />
              I've reviewed these warnings
            </label>
          )}
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <LinkIcon className={`w-5 h-5 ${canShare ? 'text-[#a58039]' : 'text-gray-400'}`} />
            <h3 className="text-lg font-bold text-[#403f4c]">Client Sharing</h3>
          </div>
          <label className={`relative inline-flex items-center ${canShare ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <input 
              type="checkbox" 
              className="sr-only peer" 
              checked={run.share_enabled}
              disabled={!canShare}
              onChange={(e) => handleUpdate({ share_enabled: e.target.checked })}
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#a58039]"></div>
            <span className="ml-3 text-sm font-medium text-gray-700">
              {run.share_enabled ? 'Enabled' : (!canShare ? 'Blocked by checks' : 'Disabled')}
            </span>
          </label>
        </div>
        
        {run.share_enabled && (
          <div className="animate-in fade-in slide-in-from-top-2">
            <div className="flex gap-2">
              <input 
                type="text" 
                readOnly 
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
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white rounded-lg font-bold hover:bg-[#2d2c35] transition-colors self-start mt-2"
          >
            <Plus className="w-4 h-4" /> Add captures
          </button>
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
                  <tr 
                    id={`listing-${listing.id}`}
                    key={listing.id} 
                    draggable={true}
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    onClick={() => setActiveListing(listing)}
                    className={`transition-all cursor-pointer ${!listing.included ? 'opacity-60' : ''} ${dragOverIndex === index ? 'border-t-2 border-[#a58039]' : ''} ${listingBadges.get(listing.id)?.some(b => b.type === 'BLOCK') ? 'bg-red-50 hover:bg-red-100' : listingBadges.get(listing.id)?.some(b => b.type === 'WARN') ? 'bg-yellow-50 hover:bg-yellow-100' : 'bg-white hover:bg-gray-50'} ${pulseListingId === listing.id ? 'animate-pulse ring-2 ring-[#a58039] z-10 relative' : ''}`}
                  >
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-2 cursor-grab active:cursor-grabbing opacity-50 hover:opacity-100 transition-opacity">
                        <GripVertical className="w-5 h-5 text-gray-400" />
                        <span className="w-4 text-center text-xs font-medium text-gray-500">{index + 1}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <input 
                        type="checkbox"
                        checked={listing.included}
                        onChange={e => handleToggleIncluded(listing.id, e.target.checked)}
                        className="rounded text-[#a58039] focus:ring-[#a58039] w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className={`px-4 py-3 border-l-4 ${listingBadges.get(listing.id)?.some(b => b.type === 'BLOCK') ? 'border-red-500' : listingBadges.get(listing.id)?.some(b => b.type === 'WARN') ? 'border-yellow-500' : 'border-transparent'}`} onClick={e => e.stopPropagation()}>
                      <div className="flex items-start gap-3">
                        <div className="w-16 h-12 flex-shrink-0 bg-gray-200 rounded overflow-hidden">
                          {listing.image_urls?.[0] ? (
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
                          {(listingBadges.get(listing.id) || []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {listingBadges.get(listing.id)!.map((b, bi) => (
                                <span key={bi} className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold whitespace-nowrap ${b.type === 'BLOCK' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}`}>
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
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <button 
                        onClick={() => handleRemove(listing.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Remove from run"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
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
    </div>
  );
};

export default ResearchRunDetail;

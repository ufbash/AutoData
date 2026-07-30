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
import { ArrowLeft, Edit2, Check, ArrowUp, ArrowDown, Plus, Trash2, Loader2, Link as LinkIcon, Copy, RefreshCw, ImageIcon, GripVertical } from 'lucide-react';

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

  let totalPrice = 0;
  let priceCount = 0;
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  let totalMileage = 0;
  let mileageCount = 0;

  includedListings.forEach(l => {
    const price = l.current_bid_usd ?? l.listed_price ?? null;
    if (price !== null) {
      totalPrice += price;
      priceCount++;
      if (price < minPrice) minPrice = price;
      if (price > maxPrice) maxPrice = price;
    }
    if (l.mileage_miles !== null) {
      totalMileage += l.mileage_miles;
      mileageCount++;
    }
  });

  const avgPrice = priceCount > 0 ? totalPrice / priceCount : null;
  const avgMileage = mileageCount > 0 ? totalMileage / mileageCount : null;

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
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <LinkIcon className="w-5 h-5 text-[#a58039]" />
            <h3 className="text-lg font-bold text-[#403f4c]">Client Sharing</h3>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              className="sr-only peer" 
              checked={run.share_enabled}
              onChange={(e) => handleUpdate({ share_enabled: e.target.checked })}
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#a58039]"></div>
            <span className="ml-3 text-sm font-medium text-gray-700">{run.share_enabled ? 'Enabled' : 'Disabled'}</span>
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
        <p className="text-xs text-gray-500 mt-3 italic">This link will become live when the client view ships (S2).</p>
      </div>

      {/* Listings Table */}
      <div className="bg-white rounded-xl shadow-sm border border-[#a58039]/20 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h3 className="text-lg font-bold text-[#403f4c] flex items-center gap-2">
              Run Listings
            </h3>
            <p className="text-sm text-gray-500 mt-1">{includedCount} of {listings.length} listings included.</p>
            <div className="flex gap-4 mt-3 flex-wrap">
              <div className="bg-white px-4 py-2 rounded-lg border border-gray-100 shadow-sm text-sm">
                <div className="text-gray-500 text-xs mb-1">Avg price ({priceCount} included with price)</div>
                <div className="font-bold text-[#403f4c]">
                  {avgPrice !== null ? `$${Math.round(avgPrice).toLocaleString()}` : '—'}
                </div>
              </div>
              <div className="bg-white px-4 py-2 rounded-lg border border-gray-100 shadow-sm text-sm">
                <div className="text-gray-500 text-xs mb-1">Min / Max Price</div>
                <div className="font-bold text-[#403f4c]">
                  {priceCount > 0 ? `$${Math.round(minPrice).toLocaleString()} / $${Math.round(maxPrice).toLocaleString()}` : '—'}
                </div>
              </div>
              <div className="bg-white px-4 py-2 rounded-lg border border-gray-100 shadow-sm text-sm">
                <div className="text-gray-500 text-xs mb-1">Avg Mileage</div>
                <div className="font-bold text-[#403f4c]">
                  {avgMileage !== null ? `${Math.round(avgMileage).toLocaleString()} mi` : '—'}
                </div>
              </div>
            </div>
          </div>
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white rounded-lg font-bold hover:bg-[#2d2c35] transition-colors"
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
                    key={listing.id} 
                    draggable={true}
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    onClick={() => setActiveListing(listing)}
                    className={`hover:bg-gray-50 transition-colors cursor-pointer ${!listing.included ? 'opacity-60' : ''} ${dragOverIndex === index ? 'border-t-2 border-[#a58039] bg-orange-50/50' : ''}`}
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
                    <td className="px-4 py-3">
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
                            {listing.current_bid_usd !== null ? 'Current bid' : 'Listed price'}
                          </span>
                          {(listing.current_bid_usd ?? listing.listed_price) !== null 
                            ? `${listing.listed_currency && listing.listed_currency !== 'USD' && listing.current_bid_usd === null ? listing.listed_currency + ' ' : '$'}${(listing.current_bid_usd ?? listing.listed_price!).toLocaleString()}`
                            : '—'}
                        </div>
                        {listing.estimated_retail_value_usd !== null && (
                          <div className="text-xs text-gray-500 mt-1">Est retail: ${listing.estimated_retail_value_usd.toLocaleString()}</div>
                        )}
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

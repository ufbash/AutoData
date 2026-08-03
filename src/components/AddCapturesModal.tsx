import React, { useState, useEffect } from 'react';
import { AvailableSighting, listAvailableSightings, attachSightingToRun } from '../services/researchService';
import { Loader2, X, Search, Image as ImageIcon } from 'lucide-react';

interface AddCapturesModalProps {
  runId: string;
  runType: string;
  orgId: string;
  existingSightingIds: string[];
  onClose: () => void;
  onAdded: () => void;
}

const AddCapturesModal: React.FC<AddCapturesModalProps> = ({ runId, runType, orgId, existingSightingIds, onClose, onAdded }) => {
  const [sightings, setSightings] = useState<AvailableSighting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 250);
    return () => clearTimeout(handler);
  }, [search]);

  useEffect(() => {
    const fetchSightings = async () => {
      setLoading(true);
      try {
        const data = await listAvailableSightings(orgId, existingSightingIds, 60, offset);
        if (data.length < 60) setHasMore(false);
        
        const isFinished = (l: any) => l.lot_state === 'finished';
        const isAuctionSource = (l: any) => ['copart','bidcars','iaai'].includes(l.source_platform);
        const hasValue = (v: any) => v !== null && v !== undefined;

        const eligibleActive = (l: any) => isAuctionSource(l) && !isFinished(l);
        const eligibleSold = (l: any) => hasValue(l.price_usd) && !hasValue(l.current_bid_usd) && l.lot_state !== 'active';
        const eligibleMixed = (l: any) => eligibleActive(l) || eligibleSold(l);

        const eligibleData = data.filter(s => {
          if (runType === 'sold_comps') {
            return eligibleSold(s);
          } else if (runType === 'active_listings') {
            return eligibleActive(s);
          }
          return eligibleMixed(s);
        });
        
        setSightings(prev => offset === 0 ? eligibleData : [...prev, ...eligibleData]);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch available captures');
      } finally {
        setLoading(false);
      }
    };
    fetchSightings();
  }, [orgId, existingSightingIds, offset]);

  const filteredSightings = sightings.filter(s => {
    if (!debouncedSearch) return true;
    const term = debouncedSearch.toLowerCase();
    return (
      s.make.toLowerCase().includes(term) ||
      s.model.toLowerCase().includes(term) ||
      (s.lot_number && s.lot_number.toLowerCase().includes(term)) ||
      s.source_platform.toLowerCase().includes(term)
    );
  });

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleAddSelected = async () => {
    if (selectedIds.size === 0) return;
    setAdding(true);
    try {
      const ids: string[] = Array.from(selectedIds);
      // Sequentially add to preserve order implicitly, or just run all
      for (const id of ids) {
        await attachSightingToRun(orgId, runId, id);
      }
      onAdded();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Failed to add captures');
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-6 max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-xl font-bold text-[#403f4c]">Add Captures</h3>
            <p className="text-sm text-gray-500">
              Select previously captured vehicles to add to this research run.
              {runType === 'sold_comps' && ' Showing sold or settled lots only — this is a market-research run.'}
              {runType === 'active_listings' && ' Showing live auction listings only — this is a client-options run.'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#ba3b46] transition-colors p-2">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Search & Actions */}
        <div className="flex flex-col sm:flex-row justify-between gap-4 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search make, model, lot..."
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#a58039] bg-gray-50"
            />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-gray-600">
              {selectedIds.size} selected
            </span>
            <button
              onClick={handleAddSelected}
              disabled={selectedIds.size === 0 || adding}
              className="flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white rounded-lg font-bold hover:bg-[#2d2c35] transition-colors disabled:opacity-50"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add selected'}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg bg-gray-50 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-[#a58039]" />
            </div>
          ) : error ? (
            <div className="p-8 text-center text-red-600">{error}</div>
          ) : filteredSightings.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <ImageIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No available captures found.</p>
            </div>
          ) : (
            <>
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-500 uppercase bg-gray-100 sticky top-0 z-10 border-b border-gray-200">
                  <tr>
                  <th className="px-4 py-3 w-12 text-center">
                    <input 
                      type="checkbox"
                      className="rounded text-[#a58039] focus:ring-[#a58039]"
                      checked={filteredSightings.length > 0 && selectedIds.size === filteredSightings.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(new Set(filteredSightings.map(s => s.sighting_id)));
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Platform</th>
                  <th className="px-4 py-3 text-right">Captured</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredSightings.map(s => {
                  const isChecked = selectedIds.has(s.sighting_id);
                  return (
                    <tr 
                      key={s.sighting_id} 
                      className={`hover:bg-gray-50 cursor-pointer transition-colors ${isChecked ? 'bg-orange-50/50' : ''}`}
                      onClick={() => toggleSelection(s.sighting_id)}
                    >
                      <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="checkbox"
                          className="rounded text-[#a58039] focus:ring-[#a58039] cursor-pointer"
                          checked={isChecked}
                          onChange={() => toggleSelection(s.sighting_id)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 flex-shrink-0 bg-gray-200 rounded overflow-hidden">
                            {s.image_urls?.[0] ? (
                              <img 
                                src={s.source_platform === 'copart' && s.image_urls[0].includes('_ful.jpg') ? s.image_urls[0].replace('_ful.jpg', '_thb.jpg') : s.image_urls[0]} 
                                alt="thumbnail" 
                                className="w-full h-full object-cover" 
                                loading="lazy"
                                decoding="async"
                                width={48}
                                height={48}
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  const div = document.createElement('div');
                                  div.className = 'w-full h-full flex items-center justify-center bg-gray-200 text-[10px] text-gray-500 font-medium text-center leading-tight p-1';
                                  div.innerText = `${s.year || ''} ${s.make} ${s.model}`.trim();
                                  e.currentTarget.parentNode?.appendChild(div);
                                }}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400">
                                <ImageIcon className="w-4 h-4" />
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-[#403f4c]">
                              {s.year} {s.make} {s.model} {s.trim || ''}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {s.mileage_miles ? `${s.mileage_miles.toLocaleString()} mi` : 'Unk. mileage'} • 
                              {s.damage_type ? ` ${s.damage_type}` : ' Unk. damage'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium uppercase">
                          {s.source_platform}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">
                        {new Date(s.captured_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            
            {hasMore && !search && (
              <div className="p-4 flex justify-center bg-white border-t border-gray-100">
                <button 
                  onClick={() => setOffset(prev => prev + 60)}
                  disabled={loading}
                  className="px-6 py-2 bg-gray-100 text-[#403f4c] font-bold rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load more'}
                </button>
              </div>
            )}
          </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddCapturesModal;

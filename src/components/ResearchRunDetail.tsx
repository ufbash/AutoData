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
  storeImagesForRun,
  getSignedImageUrls,
  softDeleteRun,
  listAuctionHistoryForAssets,
  ResearchRun,
  RunListing,
  AuctionHistoryRecord,
  deleteSighting
} from '../services/researchService';
import { deriveAuctionHistoryFlags, AuctionHistoryFlags } from '../utils/auctionHistoryFlags';
import { parsePreference, colourMatches, transmissionMatches, fuelMatches } from '../utils/specVocabulary';
import AddCapturesModal from './AddCapturesModal';
import VehicleDetailModal from './VehicleDetailModal';
import AuctionCountdown from './AuctionCountdown';
import { ArrowLeft, Edit2, Check, ArrowUp, ArrowDown, Plus, Trash2, Loader2, Link as LinkIcon, Copy, RefreshCw, ImageIcon, GripVertical, AlertTriangle, X, Info } from 'lucide-react';

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
      const flagsMap = new Map<string, AuctionHistoryFlags>();
      l.forEach(listing => {
        if (listing.asset_id) {
          flagsMap.set(listing.asset_id, deriveAuctionHistoryFlags(historyByAsset.get(listing.asset_id)));
        }
      });
      setAuctionHistoryFlags(flagsMap);
      setAuctionHistoryRows(historyByAsset);

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

  const includedListings = listings.filter(l => l.included);
  const includedCount = includedListings.length;

  const getStats = (list: RunListing[], isSoldGroup: boolean) => {
    let tP = 0, pC = 0, minP = Infinity, maxP = -Infinity, tM = 0, mC = 0;
    list.forEach(l => {
      let includePrice = true;
      if (isSoldGroup) {
        if (l.sale_confirmed === false) {
          includePrice = false;
        } else if (l.sale_confirmed === null && !['manual_entry', 'ai_vision'].includes(l.logged_via)) {
          includePrice = false;
        }
      }

      const p = l.price_usd;
      if (p !== null && includePrice) {
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
        { label: "Market Research (Sold)", stats: getStats(includedListings.filter(l => l.lot_state !== 'active' && l.current_bid_usd === null), true), type: 'sold' },
        { label: "Client Options (Live)", stats: getStats(includedListings.filter(l => l.lot_state !== 'finished' && l.current_bid_usd !== null), false), type: 'active' }
      ]
    : [
        { label: "Run Listings", stats: getStats(includedListings, isSoldComps), type: isSoldComps ? 'sold' : 'active' }
      ];

  // Pre-Share Checklist
  const CRITICAL_KEYWORDS = [
    'mechanical', // MC
    'water', // WA/flood
    'flood', // WA/flood
    'burn', // BN/BE/BI
    'damage history', // DH
    'partial', // PR
    'rejected', // RJ
    'undercarriage', // UN
    'unknown', // UK
    'frame', // FD
    'rollover', // RO
    'stripped', // ST
    'all over', // AO
    'biohaz', // BC
    'chemical', // BC equivalent
    'missing', // VI/VN/VP
    'altered', // VI/VN/VP
    'replaced vin', // VI/VN/VP
    'vin', // VI/VN/VP
    'storm' // Ambiguous
  ];

  const checklistItems: { id: string, type: 'BLOCK' | 'CRITICAL' | 'WARN' | 'INFO', message: string, offenderIds: string[], passed: boolean }[] = [];

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

  if (isActiveListings || isMixed) {
    const activeList = isMixed ? includedListings.filter(l => l.lot_state !== 'finished') : includedListings;
    
    const criticalByReason = new Map<string, string[]>();
    activeList.forEach(l => {
      const dmg = ((l.damage_type || '') + ' ' + (l.secondary_damage || '')).trim().toLowerCase();
      
      let matchedKeyword = '';
      for (const kw of CRITICAL_KEYWORDS) {
        if (dmg.includes(kw)) {
          matchedKeyword = kw;
          break;
        }
      }
      
      const reasons: string[] = [];
      if (matchedKeyword) {
        reasons.push(matchedKeyword === 'storm' ? 'ambiguous storm damage' : `${matchedKeyword} damage`);
      } else if (!l.damage_type || l.damage_type.trim() === '') {
        reasons.push('unknown damage');
      }
      
      if (l.runs_and_drives !== true) {
        reasons.push('not confirmed run-and-drive');
      }
      
      reasons.forEach(r => {
        if (!criticalByReason.has(r)) criticalByReason.set(r, []);
        criticalByReason.get(r)!.push(l.id);
      });
    });

    criticalByReason.forEach((ids, reason) => {
      checklistItems.push({
        id: `critical_${reason.replace(/\s+/g, '_')}`,
        type: 'CRITICAL',
        message: `${ids.length} listing(s) flagged CRITICAL: ${reason}.`,
        offenderIds: ids,
        passed: false
      });
    });

    // SPEC MATCH RULES
    // A pending_review brief (client self-submitted, not yet staff-approved) must not drive
    // flags - that is the entire reason review is mandatory (Prompt 15 Phase 6). Only an
    // approved brief (or a legacy brief with no status column value at all, from before this
    // concept existed) gates spec matching.
    const brief = run.client_brief && run.client_brief.status !== 'pending_review' ? run.client_brief : null;
    if (brief) {
      const specCritical = new Map<string, string[]>();
      const specWarn = new Map<string, string[]>();

      const addSpecRule = (map: Map<string, string[]>, reason: string, id: string) => {
        if (!map.has(reason)) map.set(reason, []);
        map.get(reason)!.push(id);
      };

      activeList.forEach(l => {
        // CRITICAL rules
        if (brief.max_mileage != null && l.mileage_miles != null && l.mileage_miles > brief.max_mileage) {
          addSpecRule(specCritical, `exceeds requested maximum mileage (${l.mileage_miles.toLocaleString()} vs ${brief.max_mileage.toLocaleString()} max)`, l.id);
        }
        if (brief.year_min != null && l.year != null && l.year < brief.year_min) {
          addSpecRule(specCritical, `below minimum year (${l.year} vs ${brief.year_min} min)`, l.id);
        }
        if (brief.year_max != null && l.year != null && l.year > brief.year_max) {
          addSpecRule(specCritical, `above maximum year (${l.year} vs ${brief.year_max} max)`, l.id);
        }
        if (brief.condition_required != null && brief.condition_required !== 'either' && brief.condition_required === 'run_and_drive') {
          if (l.runs_and_drives !== true) {
            addSpecRule(specCritical, `does not meet condition: Run and Drive`, l.id);
          }
        }
        if (brief.titles_accepted != null && brief.titles_accepted.length > 0 && l.title_type != null) {
          const title = l.title_type.toLowerCase();
          let matched = false;
          for (const accepted of brief.titles_accepted) {
            const acc = accepted.toLowerCase();
            let validTokens = [acc];
            if (acc === 'clean' || acc === 'clear') validTokens = ['clean', 'clear', 'certificate of title', 'original'];
            else if (acc === 'salvage') validTokens = ['salvage'];
            else if (acc === 'rebuilt') validTokens = ['rebuilt', 'reconstructed'];
            else if (acc === 'non_repairable' || acc === 'junk') validTokens = ['non-repairable', 'junk', 'parts', 'destruction'];
            
            if (validTokens.some(t => title.includes(t))) {
              matched = true;
              break;
            }
          }
          if (!matched) {
            addSpecRule(specCritical, `title type not accepted (${l.title_type} vs [${brief.titles_accepted.join(',')}])`, l.id);
          }
        }

        // WARN rules
        // colour/transmission/fuel_type go through parsePreference (Any/Either/blank -> no
        // rule; "Any, except X" -> flag only on a match to the excluded value; anything else
        // -> a required value) and the vocabulary matchers (Gas/Petrol, Gray/Grey,
        // Automatic/Auto) so wording differences no longer read as mismatches. Prompt 16 -
        // previously these compared the raw brief string directly, so a negative preference
        // like "Any, except White" matched nothing, ever, and "petrol" never matched "Gas".
        if (l.exterior_color != null) {
          const colourPref = parsePreference(brief.colour_preference);
          if (colourPref.kind === 'exclude') {
            if (colourMatches(l.exterior_color, colourPref.value)) {
              addSpecRule(specWarn, `colour excluded (${l.exterior_color} matches "${colourPref.value}", which was excluded)`, l.id);
            }
          } else if (colourPref.kind === 'required') {
            if (!colourMatches(l.exterior_color, colourPref.value)) {
              addSpecRule(specWarn, `colour differs (${l.exterior_color} vs ${colourPref.value} requested)`, l.id);
            }
          }
        }
        if (l.transmission != null) {
          const transmissionPref = parsePreference(brief.transmission);
          if (transmissionPref.kind === 'exclude') {
            if (transmissionMatches(l.transmission, transmissionPref.value)) {
              addSpecRule(specWarn, `transmission excluded (${l.transmission} matches "${transmissionPref.value}", which was excluded)`, l.id);
            }
          } else if (transmissionPref.kind === 'required') {
            if (!transmissionMatches(l.transmission, transmissionPref.value)) {
              addSpecRule(specWarn, `transmission differs (${l.transmission} vs ${transmissionPref.value} requested)`, l.id);
            }
          }
        }
        if (l.fuel != null) {
          const fuelPref = parsePreference(brief.fuel_type);
          if (fuelPref.kind === 'exclude') {
            if (fuelMatches(l.fuel, fuelPref.value)) {
              addSpecRule(specWarn, `fuel type excluded (${l.fuel} matches "${fuelPref.value}", which was excluded)`, l.id);
            }
          } else if (fuelPref.kind === 'required') {
            if (!fuelMatches(l.fuel, fuelPref.value)) {
              addSpecRule(specWarn, `fuel type differs (${l.fuel} vs ${fuelPref.value} requested)`, l.id);
            }
          }
        }
        if (brief.trim != null && brief.trim !== '' && brief.trim.toLowerCase() !== 'either' && l.trim != null) {
          if (!l.trim.toLowerCase().includes(brief.trim.toLowerCase())) {
            addSpecRule(specWarn, `trim differs (${l.trim} vs ${brief.trim} requested)`, l.id);
          }
        }
      });

      specCritical.forEach((ids, reason) => {
        checklistItems.push({
          id: `spec_critical_${Math.random()}`,
          type: 'CRITICAL',
          message: `${ids.length} listing(s) flagged CRITICAL: ${reason}.`,
          offenderIds: ids,
          passed: false
        });
      });

      specWarn.forEach((ids, reason) => {
        checklistItems.push({
          id: `spec_warn_${Math.random()}`,
          type: 'WARN',
          message: `${ids.length} listing(s) flagged WARN: ${reason}.`,
          offenderIds: ids,
          passed: false
        });
      });
    }

    // A2 Rule 1 — prior auction history (HARD BLOCK, active portion only, never overridable)
    // A2 Rule 3 — not checkable (INFO, never rendered as a clean pass)
    const priorAuctionByDetail = new Map<string, string[]>();
    const notCheckableOffenders: string[] = [];
    activeList.forEach(l => {
      const flags = l.asset_id ? auctionHistoryFlags.get(l.asset_id) : undefined;
      if (!flags || !flags.checkable) {
        notCheckableOffenders.push(l.id);
        return;
      }
      if (flags.hasPriorAuctionHistory) {
        const rows = (l.asset_id && auctionHistoryRows.get(l.asset_id)) || [];
        const dates = rows
          .map(r => r.auction_date)
          .filter((d): d is string => !!d)
          .sort();
        const dateText = dates.length > 0 ? dates.join(', ') : 'date unknown';
        const detail = `has been to auction before (${flags.appearanceCount} prior appearance${flags.appearanceCount === 1 ? '' : 's'}: ${dateText})`;
        if (!priorAuctionByDetail.has(detail)) priorAuctionByDetail.set(detail, []);
        priorAuctionByDetail.get(detail)!.push(l.id);
      }
    });

    if (priorAuctionByDetail.size === 0) {
      checklistItems.push({
        id: 'prior_auction_history',
        type: 'BLOCK',
        message: 'No prior auction history detected',
        offenderIds: [],
        passed: true
      });
    } else {
      priorAuctionByDetail.forEach((ids, detail) => {
        checklistItems.push({
          id: `prior_auction_history_${detail}`,
          type: 'BLOCK',
          message: `${ids.length} listing(s) blocked: this vehicle ${detail}.`,
          offenderIds: ids,
          passed: false
        });
      });
    }

    checklistItems.push({
      id: 'prior_auction_not_checkable',
      type: 'INFO',
      message: notCheckableOffenders.length > 0
        ? `Prior auction history not checkable for this source (${notCheckableOffenders.length} listing(s)) — bid.cars Sales History coverage only, Copart not yet available.`
        : 'Prior auction history checked for all listings',
      offenderIds: notCheckableOffenders,
      passed: notCheckableOffenders.length === 0
    });
  }

  // A2 Rule 2 — odometer rollback (CRITICAL, all run types including sold_comps, overridable).
  // A data-integrity rule, not client protection: applies regardless of run_type.
  const odometerRollbackOffenders: string[] = [];
  includedListings.forEach(l => {
    const flags = l.asset_id ? auctionHistoryFlags.get(l.asset_id) : undefined;
    if (flags?.checkable && flags.odometerRollback) {
      odometerRollbackOffenders.push(l.id);
    }
  });
  checklistItems.push({
    id: 'odometer_rollback',
    type: 'CRITICAL',
    message: odometerRollbackOffenders.length > 0
      ? `${odometerRollbackOffenders.length} listing(s) show odometer rollback across auction appearances — recorded mileage decreased between appearances, meaning the record may not describe the vehicle it claims to.`
      : 'No odometer rollback detected',
    offenderIds: odometerRollbackOffenders,
    passed: odometerRollbackOffenders.length === 0
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
    const soldList = isMixed ? includedListings.filter(l => l.lot_state === 'finished') : includedListings;
    const soldStats = getStats(soldList, true);
    
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

    // A1b — population coherence (WARN). sale_confirmed says "is this a real sale?" but not
    // "is this the same kind of price, from the same population?" Mixing US auction results
    // with non-auction prices (dealer asking prices, manual entries) in one average compares
    // different markets. Does not touch the average - flag only.
    const US_AUCTION_SOURCES = ['copart', 'bidcars', 'iaai'];
    let usAuctionCount = 0;
    let nonAuctionCount = 0;
    let unknownCount = 0;
    const nonAuctionOffenders: string[] = [];
    const unknownSourceOffenders: string[] = [];
    soldList.forEach(l => {
      const sp = l.source_platform ? l.source_platform.toLowerCase() : null;
      if (!sp) {
        unknownCount++;
        unknownSourceOffenders.push(l.id);
      } else if (US_AUCTION_SOURCES.includes(sp)) {
        usAuctionCount++;
      } else {
        nonAuctionCount++;
        nonAuctionOffenders.push(l.id);
      }
    });
    const populationMixed = usAuctionCount > 0 && nonAuctionCount > 0;
    let populationMsg = 'Comps are from a single population';
    if (populationMixed) {
      populationMsg = `Average mixes ${usAuctionCount} US auction comp${usAuctionCount === 1 ? '' : 's'} with ${nonAuctionCount} non-auction comp${nonAuctionCount === 1 ? '' : 's'}; these are different markets.`;
      if (unknownCount > 0) {
        populationMsg += ` ${unknownCount} listing${unknownCount === 1 ? '' : 's'} with unknown source platform excluded from this comparison.`;
      }
    }
    checklistItems.push({
      id: 'population_mismatch',
      type: 'WARN',
      message: populationMsg,
      offenderIds: populationMixed ? nonAuctionOffenders : [],
      passed: !populationMixed
    });

    // A1b (Prompt 15) — report unknown source_platform even when the mismatch warn above
    // doesn't fire. An all-unknown (or single-known-population-plus-unknown) run previously
    // showed nothing at all, reading as a clean single-population average. INFO, not a warn:
    // this states what is knowable, not a fault. Suppressed when the warn already fires and
    // mentions the same unknown count, so it is never reported twice.
    if (unknownCount > 0 && !populationMixed) {
      checklistItems.push({
        id: 'population_unknown',
        type: 'INFO',
        message: `${unknownCount} listing${unknownCount === 1 ? '' : 's'} with unknown source platform — excluded from the population comparison above, not counted as auction or non-auction.`,
        offenderIds: unknownSourceOffenders,
        passed: false
      });
    }

    // Unconfirmed Sale (WARN)
    const unconfirmedSaleOffenders = soldList.filter(l => l.sale_confirmed === null && !['manual_entry', 'ai_vision'].includes(l.logged_via)).map(l => l.id);
    checklistItems.push({
      id: 'unconfirmed_sale',
      type: 'WARN',
      message: unconfirmedSaleOffenders.length > 0 ? `${unconfirmedSaleOffenders.length} of ${soldList.length} included listings have unconfirmed sale status and are excluded from the average below.` : 'All sold listings are confirmed',
      offenderIds: unconfirmedSaleOffenders,
      passed: unconfirmedSaleOffenders.length === 0
    });
  }

  const hasBlocks = checklistItems.some(i => i.type === 'BLOCK' && !i.passed);
  const hasCriticals = checklistItems.some(i => i.type === 'CRITICAL' && !i.passed);
  const hasWarnings = checklistItems.some(i => i.type === 'WARN' && !i.passed);
  const canShare = !hasBlocks && 
    (!hasCriticals || (warningsReviewed && criticalOverrideReason.trim().length >= 10)) &&
    (!hasWarnings || warningsReviewed);

  const listingBadges = new Map<string, { type: 'BLOCK' | 'CRITICAL' | 'WARN' | 'INFO', text: string }[]>();
  checklistItems.filter(i => !i.passed).forEach(item => {
    item.offenderIds.forEach(id => {
      if (!listingBadges.has(id)) listingBadges.set(id, []);
      let text = '';
      if (item.id === 'duplicate') text = 'Duplicate vehicle';
      else if (item.id === 'no_price') text = 'No price';
      else if (item.id === 'non_insurance') text = 'Non-insurance seller';
      else if (item.id === 'different_model') text = 'Different model';
      else if (item.id === 'population_mismatch') text = 'Population mismatch';
      else if (item.id === 'population_unknown') text = 'Unknown source';
      else if (item.id === 'unconfirmed_sale') text = 'Unconfirmed sale';
      else if (item.id.startsWith('critical_')) text = 'CRITICAL';
      else if (item.id.startsWith('spec_critical_')) text = 'SPEC CRITICAL';
      else if (item.id.startsWith('spec_warn_')) text = 'SPEC WARN';
      else if (item.id.startsWith('prior_auction_history')) text = 'PRIOR AUCTION HISTORY';
      else if (item.id === 'prior_auction_not_checkable') text = 'History not checkable';
      else if (item.id === 'odometer_rollback') text = 'Odometer rollback';
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
                        {run.client_brief.year_min || 'Any'}-{run.client_brief.year_max || 'Any'} {run.client_brief.make || 'Any Make'} {run.client_brief.model || 'Any Model'}
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
              onChange={(e) => {
                const checked = e.target.checked;
                const patch: Partial<ResearchRun> = { share_enabled: checked };
                if (checked && hasCriticals) {
                  patch.critical_override_reason = criticalOverrideReason.trim();
                  patch.critical_override_by = user?.id || null;
                  patch.critical_override_at = new Date().toISOString();
                }
                handleUpdate(patch);
              }}
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
                  <tr 
                    id={`listing-${listing.id}`}
                    key={listing.id} 
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

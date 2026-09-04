import React, { useState, useEffect, useCallback, ErrorInfo, ReactNode, useMemo } from 'react';
import { RunListing } from '../services/researchService';
import { X, ExternalLink, Image as ImageIcon, CheckCircle, XCircle, ChevronLeft, ChevronRight } from 'lucide-react';

// Fix 2: Helper to derive small image variants
function toThumbUrl(url: string): string {
  if (/_ful\.jpg$/i.test(url)) return url.replace(/_ful\.jpg$/i, '_thb.jpg');
  return url;
}

// -- Error Boundary (Fix 4) --
class ModalErrorBoundary extends React.Component<{children: ReactNode}, {hasError: boolean}> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("VehicleDetailModal crashed:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-white p-8 rounded-xl shadow-2xl flex flex-col items-center justify-center text-center max-w-sm">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <XCircle className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Display Error</h3>
            <p className="text-gray-500 mb-6">Could not display full details due to a data format issue.</p>
            <button 
              onClick={() => {
                window.location.reload();
              }}
              className="px-4 py-2 bg-gray-200 text-gray-800 font-bold rounded-lg hover:bg-gray-300"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

export interface DisplayListing {
  notes?: string;
  
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  vin?: string | null;
  body_style?: string | null;
  engine_type?: string | null;
  cylinders?: number | null;
  horsepower?: number | null;
  transmission?: string | null;
  drivetrain?: string | null;
  fuel?: string | null;
  exterior_color?: string | null;

  mileage_miles?: number | null;
  odometer_brand?: string | null;
  damage_type?: string | null;
  secondary_damage?: string | null;
  title_type?: string | null;
  location?: string | null;
  has_key?: any;
  runs_and_drives?: any;
  engine_starts?: any;
  transmission_engages?: any;
  highlights?: any;
  current_bid_usd?: number | null;
  listed_price?: number | null;
  listed_currency?: string | null;
  estimated_retail_value_usd?: number | null;
  image_urls?: string[];
  source_platform?: string;
  
  source_url?: string;
  logged_via?: string;
  lot_number?: string | null;
  captured_at?: string;
  sale_date?: string | null;
}

// -- Main Component --
interface VehicleDetailModalProps {
  listing: DisplayListing;
  onClose: () => void;
  showInternalFields?: boolean;
}

const VehicleDetailModalContent: React.FC<VehicleDetailModalProps> = ({ 
  listing, 
  onClose, 
  showInternalFields = false 
}) => {
  const [mainImageIdx, setMainImageIdx] = useState(0);

  // Defensive type checks
  const safeImages = Array.isArray(listing.image_urls) ? listing.image_urls : [];
  
  // Fix 5: memoize thumbnails
  const thumbUrls = useMemo(() => safeImages.map(url => toThumbUrl(url)), [safeImages]);
  
  const rawHighlights = listing.highlights as unknown;
  const safeHighlights = typeof rawHighlights === 'string' ? rawHighlights : '';

  const safeYear = typeof listing.year === 'number' ? listing.year.toString() : '';
  const safeMake = typeof listing.make === 'string' ? listing.make : 'Unknown';
  const safeModel = typeof listing.model === 'string' ? listing.model : 'Unknown';
  const safeTrim = typeof listing.trim === 'string' ? listing.trim : '';
  const title = `${safeYear} ${safeMake} ${safeModel} ${safeTrim}`.trim();

  const price = typeof listing.listed_price === 'number' ? listing.listed_price : null;
  const currentBid = typeof listing.current_bid_usd === 'number' ? listing.current_bid_usd : null;
  const displayPrice = currentBid ?? price;
  const isBid = currentBid !== null;
  const retailValue = typeof listing.estimated_retail_value_usd === 'number' ? listing.estimated_retail_value_usd : null;
  const mileage = typeof listing.mileage_miles === 'number' ? listing.mileage_miles : null;

  const parseBool = (val: any): boolean | null => {
    if (val === true || val === 'true' || val === 'Yes' || val === 'yes' || val === 'YES') return true;
    if (val === false || val === 'false' || val === 'No' || val === 'no' || val === 'NO') return false;
    return null;
  };
  
  const hasKey = parseBool(listing.has_key as unknown);
  const engineStarts = parseBool(listing.engine_starts as unknown);
  const runsAndDrives = parseBool(listing.runs_and_drives as unknown);
  const transmissionEngages = parseBool(listing.transmission_engages as unknown);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowLeft' && safeImages.length > 1) {
      setMainImageIdx((prev) => (prev > 0 ? prev - 1 : safeImages.length - 1));
    } else if (e.key === 'ArrowRight' && safeImages.length > 1) {
      setMainImageIdx((prev) => (prev < safeImages.length - 1 ? prev + 1 : 0));
    }
  }, [onClose, safeImages.length]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalStyle;
    };
  }, [handleKeyDown]);

  // Fix 4: Preload adjacent images
  useEffect(() => {
    if (safeImages.length > 1) {
      const preload = (u?: string) => { 
        if (u) { 
          const i = new window.Image(); 
          i.src = u; 
        } 
      };
      // Next image
      preload(safeImages[mainImageIdx < safeImages.length - 1 ? mainImageIdx + 1 : 0]);
      // Previous image
      preload(safeImages[mainImageIdx > 0 ? mainImageIdx - 1 : safeImages.length - 1]);
    }
  }, [mainImageIdx, safeImages]);

  const handlePrevImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMainImageIdx((prev) => (prev > 0 ? prev - 1 : safeImages.length - 1));
  };

  const handleNextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMainImageIdx((prev) => (prev < safeImages.length - 1 ? prev + 1 : 0));
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div 
      // Fix 1: Removed backdrop-blur-sm, fade-in animations, bumped to bg-black/70
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 md:p-6 bg-black/70"
      onClick={handleBackdropClick}
    >
      <div className="bg-white sm:rounded-xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] max-w-5xl flex flex-col overflow-hidden relative">
        {/* Header */}
        <div className="flex justify-between items-center p-4 sm:p-5 border-b border-gray-100 bg-gray-50/50 flex-shrink-0">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#403f4c]">{title}</h2>
            <div className="flex gap-2 text-sm text-gray-500 mt-1 flex-wrap">
              {typeof listing.vin === 'string' && listing.vin && <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs">{listing.vin}</span>}
              {typeof listing.location === 'string' && listing.location && <span>{listing.location}</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-full hover:bg-red-50">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Fix 1: Added will-change-transform to the scroll container */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col lg:flex-row gap-6 lg:gap-8 will-change-transform">
          {/* Left Column: Gallery */}
          <div className="w-full lg:w-1/2 space-y-4 flex flex-col">
            <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center relative group">
              {safeImages.length > 0 ? (
                <>
                  <img 
                    src={safeImages[mainImageIdx] || safeImages[0]}  
                    alt="Vehicle main" 
                    className="w-full h-full object-contain bg-black/5" 
                    referrerPolicy="no-referrer"
                    decoding="async" // Fix 3: decoding="async" for main image (no lazy loading)
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const parent = e.currentTarget.parentNode as HTMLElement;
                      let errorDiv = parent.querySelector('.img-error');
                      if (!errorDiv) {
                        const div = document.createElement('div');
                        div.className = 'img-error w-full h-full flex flex-col items-center justify-center text-gray-400 bg-gray-100 absolute inset-0';
                        div.innerHTML = `<svg class="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg><span class="text-sm font-medium">Image unavailable</span>`;
                        parent.appendChild(div);
                      }
                    }}
                  />
                  {safeImages.length > 1 && (
                    <>
                      <button 
                        onClick={handlePrevImage}
                        className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 text-white p-2 rounded-full opacity-0 sm:group-hover:opacity-100 transition-opacity focus:opacity-100"
                        title="Previous Image (Left Arrow)"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={handleNextImage}
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 text-white p-2 rounded-full opacity-0 sm:group-hover:opacity-100 transition-opacity focus:opacity-100"
                        title="Next Image (Right Arrow)"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                      <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs font-bold px-2 py-1 rounded">
                        {mainImageIdx + 1} / {safeImages.length}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="text-gray-400 flex flex-col items-center">
                  <ImageIcon className="w-12 h-12 mb-2 opacity-50" />
                  <span className="text-sm font-medium">No images</span>
                </div>
              )}
            </div>
            
            {safeImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                {safeImages.map((url, idx) => (
                  <button 
                    key={url || idx}
                    onClick={() => setMainImageIdx(idx)}
                    className={`flex-shrink-0 w-20 h-16 rounded-md overflow-hidden border-2 transition-all relative bg-gray-100 ${mainImageIdx === idx ? 'border-[#a58039]' : 'border-transparent opacity-70 hover:opacity-100'}`}
                  >
                    <img 
                      src={thumbUrls[idx]} 
                      alt={`Thumbnail ${idx + 1}`} 
                      className="w-full h-full object-cover" 
                      referrerPolicy="no-referrer" 
                      loading="lazy"    // Fix 3
                      decoding="async"  // Fix 3
                      width="80"        // Fix 3
                      height="64"       // Fix 3
                      onError={(e) => {
                        const img = e.currentTarget;
                        // Fix 2: If the thumbnail fails, fall back to the original full URL once
                        if (img.src !== url) {
                          img.src = url;
                          return;
                        }
                        
                        img.style.display = 'none';
                        const parent = img.parentNode as HTMLElement;
                        if (!parent.querySelector('svg')) {
                          const svg = document.createElement('div');
                          svg.className = 'absolute inset-0 flex items-center justify-center text-gray-300';
                          svg.innerHTML = `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`;
                          parent.appendChild(svg);
                        }
                      }}
                    />
                  </button>
                ))}
              </div>
            )}

            {typeof listing.notes === 'string' && listing.notes.trim() && (
              <div className="bg-yellow-50/50 border border-yellow-100 p-4 rounded-lg mt-4">
                <h4 className="text-xs font-bold text-yellow-800 uppercase tracking-wider mb-2">Curator Notes</h4>
                <p className="text-sm text-yellow-900 whitespace-pre-wrap">{listing.notes}</p>
              </div>
            )}
          </div>

          {/* Right Column: Specs */}
          <div className="w-full lg:w-1/2 space-y-6">
            
            {/* Value & Platform */}
            <div className="bg-gray-50 rounded-xl p-4 sm:p-5 border border-gray-100 flex flex-wrap gap-4 sm:gap-6 justify-between items-center">
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1">
                  {isBid ? 'Current Bid' : 'Listed Price'}
                </span>
                <span className="text-2xl sm:text-3xl font-bold text-[#403f4c]">
                  {displayPrice !== null ? 
                    `${typeof listing.listed_currency === 'string' && listing.listed_currency !== 'USD' && !isBid ? listing.listed_currency + ' ' : '$'}${displayPrice.toLocaleString()}` 
                    : '—'}
                </span>
              </div>
              {retailValue !== null && (
                <div className="text-right">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1">Est. Retail</span>
                  <span className="text-lg sm:text-xl font-semibold text-green-700">${retailValue.toLocaleString()}</span>
                </div>
              )}
              
              <div className="w-full h-px bg-gray-200 my-1 sm:my-2"></div>
              
              <div className="flex w-full justify-between items-center">
                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-md text-xs font-bold uppercase tracking-wider">
                  {typeof listing.source_platform === 'string' && listing.source_platform ? listing.source_platform : 'Unknown'}
                </span>
                {showInternalFields && typeof listing.source_url === 'string' && listing.source_url && (
                  <a href={listing.source_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-[#a58039] hover:underline font-medium">
                    View Original <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 sm:gap-x-6 gap-y-4">
              <SpecItem label="Mileage" value={mileage !== null ? `${mileage.toLocaleString()} mi` : null} />
              <SpecItem label="Title Type" value={listing.title_type} />
              <SpecItem label="Damage" value={listing.damage_type} />
              <SpecItem label="Sec. Damage" value={listing.secondary_damage} />
              
              <SpecItem label="Body Style" value={listing.body_style} />
              <SpecItem label="Exterior Color" value={listing.exterior_color} />
              
              <SpecItem label="Engine" value={listing.engine_type} />
              <SpecItem label="Cylinders" value={typeof listing.cylinders === 'number' ? listing.cylinders.toString() : null} />
              <SpecItem label="Transmission" value={listing.transmission} />
              <SpecItem label="Drivetrain" value={listing.drivetrain} />
              <SpecItem label="Fuel" value={listing.fuel} />
              <SpecItem label="Horsepower" value={typeof listing.horsepower === 'number' ? listing.horsepower.toString() : null} />
            </div>

            {/* Condition indicators */}
            {(hasKey !== null || engineStarts !== null || runsAndDrives !== null || transmissionEngages !== null) && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100">
                <ConditionIndicator label="Keys" state={hasKey} />
                <ConditionIndicator label="Starts" state={engineStarts} />
                <ConditionIndicator label="Drives" state={runsAndDrives} />
                <ConditionIndicator label="Transmission" state={transmissionEngages} />
              </div>
            )}

            {safeHighlights && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Highlights</h4>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-1 bg-green-50 text-green-700 border border-green-100 rounded text-xs font-medium">
                    {safeHighlights}
                  </span>
                </div>
              </div>
            )}

            {showInternalFields && (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg text-xs text-gray-500 space-y-2 border border-gray-100">
                <h4 className="font-bold text-gray-700 uppercase tracking-wider mb-2">Internal Metadata</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="font-medium text-gray-600">Lot/Stock:</span> {typeof listing.lot_number === 'string' && listing.lot_number ? listing.lot_number : '—'}</div>
                  <div><span className="font-medium text-gray-600">Logged Via:</span> {typeof listing.logged_via === 'string' && listing.logged_via ? listing.logged_via : '—'}</div>
                  <div><span className="font-medium text-gray-600">Captured At:</span> {typeof listing.captured_at === 'string' && listing.captured_at ? new Date(listing.captured_at).toLocaleString() : '—'}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const SpecItem = ({ label, value }: { label: string, value: any }) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
};

const ConditionIndicator = ({ label, state }: { label: string, state: boolean | null }) => {
  if (state !== true && state !== false) return null;
  return (
    <div className="flex items-center gap-1.5 text-sm font-medium">
      {state ? (
        <CheckCircle className="w-4 h-4 text-green-500" />
      ) : (
        <XCircle className="w-4 h-4 text-red-500" />
      )}
      <span className={state ? 'text-gray-900' : 'text-gray-500'}>{label}</span>
    </div>
  );
}

export default function VehicleDetailModal(props: VehicleDetailModalProps) {
  return (
    <ModalErrorBoundary>
      <VehicleDetailModalContent {...props} />
    </ModalErrorBoundary>
  );
}

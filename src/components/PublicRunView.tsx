import React, { useState, useEffect } from 'react';
import { Loader2, Calendar, MapPin, AlertTriangle, FileText, Info } from 'lucide-react';
import VehicleDetailModal, { DisplayListing } from './VehicleDetailModal';
import AuctionCountdown from './AuctionCountdown';

interface PublicRunViewProps {
  token: string;
}

interface PublicRunData {
  run: {
    client_name: string;
    notes?: string;
    created_at: string;
    run_type: 'sold_comps' | 'active_listings' | 'mixed';
  };
  listings: any[];
  stats?: {
    avg_price_usd: number | null;
    min_price_usd: number | null;
    max_price_usd: number | null;
    priced_count: number;
    total_count: number;
    avg_mileage: number | null;
  };
}

const PublicRunView: React.FC<PublicRunViewProps> = ({ token }) => {
  const [data, setData] = useState<PublicRunData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeListing, setActiveListing] = useState<any | null>(null);


  const fetchRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const baseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${baseUrl}/functions/v1/public-run?token=${token}`);
      
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("This link is no longer available. Please contact Caplimo for an updated link.");
        }
        throw new Error("Failed to load vehicle research.");
      }
      
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRun();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F0EDDE] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-[#a58039] animate-spin mx-auto mb-4" />
          <p className="text-[#403f4c] font-medium">Loading research run...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#F0EDDE] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-[#403f4c] mb-2">Unavailable</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button 
            onClick={fetchRun}
            className="px-6 py-2 bg-[#a58039] text-white font-bold rounded-lg hover:bg-[#8e6e31] transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const { run, listings, stats } = data;

  const renderListing = (listing: any, index: number, isSold: boolean) => {
    const title = `${listing.year || ''} ${listing.make || ''} ${listing.model || ''} ${listing.trim || ''}`.trim();
    const imgs = Array.isArray(listing.image_urls) ? listing.image_urls : [];
    
    // Default to the original price logic to fallback gracefully
    const currentBid = typeof listing.current_bid_usd === 'number' ? listing.current_bid_usd : null;
    const listedPrice = typeof listing.listed_price === 'number' ? listing.listed_price : null;
    
    const displayPrice = listing.price_usd !== null && listing.price_usd !== undefined ? listing.price_usd : (currentBid ?? listedPrice);
    const isBid = currentBid !== null;
    const currency = listing.listed_currency && listing.listed_currency !== 'USD' && !isBid ? listing.listed_currency + ' ' : '$';

    return (
      <div 
        key={index} 
        onClick={() => setActiveListing(listing)}
        className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md hover:border-[#a58039]/50 transition-all cursor-pointer group flex flex-col"
      >
        {isSold ? (
          <div className="grid grid-cols-2 grid-rows-2 gap-0.5 aspect-[4/3] bg-gray-100 overflow-hidden relative">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="relative w-full h-full bg-gray-200">
                {imgs[i] ? (
                  <img 
                    src={imgs[i]} 
                    alt={title}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-300">
                    <span className="text-[10px] font-medium">No Image</span>
                  </div>
                )}
              </div>
            ))}
            {listing.sale_date && (
              <div className="absolute top-2 left-2 bg-black/70 text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm backdrop-blur-sm">
                Sold: {new Date(listing.sale_date).toLocaleDateString()}
              </div>
            )}
          </div>
        ) : (
          <div className="aspect-[4/3] bg-gray-100 relative overflow-hidden">
            {imgs[0] ? (
              <img 
                src={imgs[0]} 
                alt={title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                referrerPolicy="no-referrer"
                loading={index === 0 ? 'eager' : 'lazy'}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-50">
                <span className="text-xs font-medium">No Image</span>
              </div>
            )}
            {isBid && (
              <div className="absolute top-3 right-3 bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded shadow-sm">
                Auction
              </div>
            )}
          </div>
        )}
        
        <div className="p-5 flex-1 flex flex-col">
          <h3 className="text-lg font-bold text-[#403f4c] leading-tight mb-3 line-clamp-2">{title || 'Unknown Vehicle'}</h3>
          
          <div className="mb-4">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-0.5">
              {isSold ? 'Final Sale Price' : (isBid ? 'Current Bid' : 'Listed Price')}
            </span>
            <span className="text-2xl font-bold text-[#a58039]">
              {displayPrice !== null ? `${currency}${Math.round(displayPrice).toLocaleString()}` : '—'}
            </span>
            {listing.captured_at && !isSold && (
              <span className="text-[10px] text-gray-400 block mt-0.5">
                As of {new Date(listing.captured_at).toLocaleDateString()}
              </span>
            )}
          </div>

          {!isSold && (
            <div className="mb-4 p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <AuctionCountdown saleDateText={listing.sale_date || null} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 font-medium mt-auto pb-3 border-b border-gray-100">
            {listing.mileage_miles !== null && listing.mileage_miles !== undefined && (
              <span className="whitespace-nowrap">{listing.mileage_miles.toLocaleString()} mi</span>
            )}
            {listing.damage_type && (
              <>
                <span className="text-gray-300">•</span>
                <span className="whitespace-nowrap truncate max-w-[100px]" title={listing.damage_type}>{listing.damage_type}</span>
              </>
            )}
            {listing.title_type && (
              <>
                <span className="text-gray-300">•</span>
                <span className="whitespace-nowrap truncate max-w-[100px]" title={listing.title_type}>{listing.title_type}</span>
              </>
            )}
            {listing.location && (
              <>
                <span className="text-gray-300">•</span>
                <span className="flex items-center gap-0.5 whitespace-nowrap truncate max-w-[120px]" title={listing.location}>
                  <MapPin className="w-3 h-3" /> {listing.location}
                </span>
              </>
            )}
          </div>

          {listing.notes && (
            <div className="mt-3 text-sm text-gray-600 line-clamp-2 italic border-l-2 border-[#a58039]/30 pl-2">
              "{listing.notes}"
            </div>
          )}
        </div>
      </div>
    );
  };

  const soldListings = listings.filter(l => l.current_bid_usd === null);
  const activeLivListings = listings.filter(l => l.current_bid_usd !== null);

  return (
    <div className="min-h-screen bg-[#F0EDDE] text-[#403f4c] font-sans pb-20">
      <header className="bg-white/90 backdrop-blur-md border-b border-[#a58039]/20 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4">
          <h1 className="text-xl sm:text-2xl font-bold text-[#a58039]">
            {run.run_type === 'sold_comps' ? 'Market Research' : (run.run_type === 'active_listings' ? 'Client Options' : 'Vehicle Research')}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500 font-medium">
            <span>Prepared for: <strong className="text-[#403f4c]">{run.client_name}</strong></span>
            <span className="hidden sm:inline text-gray-300">•</span>
            <span className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              {new Date(run.created_at).toLocaleDateString()}
            </span>
            <span className="hidden sm:inline text-gray-300">•</span>
            <span className="bg-[#F0EDDE] text-[#a58039] px-2 py-0.5 rounded-md text-xs font-bold">
              {listings.length} {listings.length === 1 ? 'Vehicle' : 'Vehicles'}
            </span>
          </div>
        </div>
      </header>
      
      {/* Staleness Disclaimer */}
      <div className="bg-orange-50 border-b border-orange-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2.5 flex items-start sm:items-center gap-2 text-xs font-medium text-orange-800">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 sm:mt-0" />
          <p>
            This data is a snapshot in time. Live listings may have ended, sold, or changed price since capture. Sold comps represent historical final prices and do not guarantee future results.
          </p>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 mt-8 space-y-10">
        {run.notes && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/10 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-[#a58039]"></div>
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Curator Notes
            </h3>
            <p className="text-gray-700 whitespace-pre-wrap">{run.notes}</p>
          </div>
        )}

        {(run.run_type === 'sold_comps' || run.run_type === 'mixed') && stats && (
          <div className="bg-gradient-to-br from-[#403f4c] to-[#2d2c35] p-6 rounded-xl shadow-lg text-white">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Market Averages (Based on {stats.priced_count} sales)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="text-xs text-gray-400 mb-1">Avg Sale Price</div>
                <div className="text-2xl font-bold text-[#a58039]">
                  {stats.avg_price_usd !== null ? `$${Math.round(stats.avg_price_usd).toLocaleString()}` : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Price Range</div>
                <div className="text-lg font-bold">
                  {stats.priced_count > 0 ? `$${Math.round(stats.min_price_usd!).toLocaleString()} - $${Math.round(stats.max_price_usd!).toLocaleString()}` : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Avg Mileage</div>
                <div className="text-lg font-bold">
                  {stats.avg_mileage !== null ? `${Math.round(stats.avg_mileage).toLocaleString()} mi` : '—'}
                </div>
              </div>
            </div>
          </div>
        )}

        {run.run_type === 'mixed' && (
          <div className="space-y-12">
            <div>
              <h2 className="text-xl font-bold text-[#403f4c] mb-6 flex items-center gap-2 border-b border-gray-200 pb-2">
                Client Options (Live)
                <span className="text-xs font-bold bg-[#a58039] text-white px-2 py-0.5 rounded-full">{activeLivListings.length}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
                {activeLivListings.map((l, i) => renderListing(l, i, false))}
              </div>
              {activeLivListings.length === 0 && <p className="text-gray-500 italic">No live options included.</p>}
            </div>

            <div>
              <h2 className="text-xl font-bold text-[#403f4c] mb-6 flex items-center gap-2 border-b border-gray-200 pb-2">
                Market Research (Sold)
                <span className="text-xs font-bold bg-[#a58039] text-white px-2 py-0.5 rounded-full">{soldListings.length}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
                {soldListings.map((l, i) => renderListing(l, i, true))}
              </div>
              {soldListings.length === 0 && <p className="text-gray-500 italic">No sold comps included.</p>}
            </div>
          </div>
        )}

        {run.run_type === 'active_listings' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
            {listings.map((l, i) => renderListing(l, i, false))}
          </div>
        )}

        {run.run_type === 'sold_comps' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
            {listings.map((l, i) => renderListing(l, i, true))}
          </div>
        )}

      </main>

      <footer className="mt-16 py-8 text-center text-sm text-gray-400 font-medium">
        <p>Prepared by Caplimo · AutoData</p>
        <p className="mt-1 text-xs opacity-70">{new Date().getFullYear()}</p>
      </footer>

      {activeListing && (
        <VehicleDetailModal
          listing={activeListing}
          onClose={() => setActiveListing(null)}
          showInternalFields={false}
        />
      )}
    </div>
  );
};

export default PublicRunView;

import React, { useState, useEffect } from 'react';
import { Loader2, Calendar, MapPin, AlertTriangle, FileText } from 'lucide-react';
import VehicleDetailModal, { DisplayListing } from './VehicleDetailModal';

interface PublicRunViewProps {
  token: string;
}

interface PublicRunData {
  run: {
    client_name: string;
    notes?: string;
    created_at: string;
  };
  listings: DisplayListing[];
}

const PublicRunView: React.FC<PublicRunViewProps> = ({ token }) => {
  const [data, setData] = useState<PublicRunData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeListing, setActiveListing] = useState<DisplayListing | null>(null);

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

  const { run, listings } = data;

  return (
    <div className="min-h-screen bg-[#F0EDDE] text-[#403f4c] font-sans pb-20">
      <header className="bg-white/90 backdrop-blur-md border-b border-[#a58039]/20 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4">
          <h1 className="text-xl sm:text-2xl font-bold text-[#a58039]">Vehicle Research</h1>
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

      <main className="max-w-5xl mx-auto px-4 sm:px-6 mt-8 space-y-8">
        {run.notes && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/10 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-[#a58039]"></div>
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Curator Notes
            </h3>
            <p className="text-gray-700 whitespace-pre-wrap">{run.notes}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
          {listings.map((listing, index) => {
            const title = `${listing.year || ''} ${listing.make || ''} ${listing.model || ''} ${listing.trim || ''}`.trim();
            const mainImg = Array.isArray(listing.image_urls) && listing.image_urls.length > 0 ? listing.image_urls[0] : null;
            
            const currentBid = typeof listing.current_bid_usd === 'number' ? listing.current_bid_usd : null;
            const listedPrice = typeof listing.listed_price === 'number' ? listing.listed_price : null;
            const price = currentBid ?? listedPrice;
            const isBid = currentBid !== null;
            const currency = listing.listed_currency && listing.listed_currency !== 'USD' && !isBid ? listing.listed_currency + ' ' : '$';

            return (
              <div 
                key={index} 
                onClick={() => setActiveListing(listing)}
                className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md hover:border-[#a58039]/50 transition-all cursor-pointer group flex flex-col"
              >
                <div className="aspect-[4/3] bg-gray-100 relative overflow-hidden">
                  {mainImg ? (
                    <img 
                      src={mainImg} 
                      alt={title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      referrerPolicy="no-referrer"
                      loading={index === 0 ? 'eager' : 'lazy'}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const p = e.currentTarget.parentNode as HTMLElement;
                        if (!p.querySelector('svg')) {
                          const div = document.createElement('div');
                          div.className = 'absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-50';
                          div.innerHTML = `<svg class="w-10 h-10 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg><span class="text-xs font-medium">No Image</span>`;
                          p.appendChild(div);
                        }
                      }}
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
                
                <div className="p-5 flex-1 flex flex-col">
                  <h3 className="text-lg font-bold text-[#403f4c] leading-tight mb-3 line-clamp-2">{title || 'Unknown Vehicle'}</h3>
                  
                  <div className="mb-4">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-0.5">
                      {isBid ? 'Current Bid' : 'Price'}
                    </span>
                    <span className="text-2xl font-bold text-[#a58039]">
                      {price !== null ? `${currency}${price.toLocaleString()}` : '—'}
                    </span>
                  </div>

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
          })}
        </div>
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

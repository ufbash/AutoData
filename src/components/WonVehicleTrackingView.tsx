import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, Circle, Car } from 'lucide-react';

// PROMPT 34 Stage 3 - the tokenized client-facing tracking page. PROJECT_CHARTER.md §7: status
// and tracking only, no login. This component renders EXACTLY what won-vehicle-tracking returns
// - no invoice, cost, fee, or document field exists in that response to render even if this
// component tried to.

interface TrackingLadderItem {
  status: string;
  label: string;
  reached: boolean;
  at: string | null;
}

interface TrackingData {
  current_status: string;
  current_status_label: string;
  ladder: TrackingLadderItem[];
}

const WonVehicleTrackingView: React.FC<{ token: string }> = ({ token }) => {
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const baseUrl = import.meta.env.VITE_SUPABASE_URL;
        const res = await fetch(`${baseUrl}/functions/v1/won-vehicle-tracking?token=${token}`);
        if (!res.ok) {
          throw new Error(res.status === 404 ? "This tracking link is no longer available." : "Failed to load tracking status.");
        }
        setData(await res.json());
      } catch (err: any) {
        setError(err.message || "An unexpected error occurred.");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [token]);

  return (
    <div className="min-h-screen bg-[#F0EDDE] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-[#a58039] p-2 rounded-lg"><Car className="w-6 h-6 text-white" /></div>
          <div>
            <h1 className="text-xl font-bold text-[#a58039]">AutoData</h1>
            <span className="text-[10px] font-semibold text-[#403f4c] tracking-[0.2em] uppercase">by caplimo</span>
          </div>
        </div>

        {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}
        {error && <div className="text-sm text-[#ba3b46] bg-[#ba3b46]/10 border border-[#ba3b46]/30 rounded-lg p-4">{error}</div>}

        {data && (
          <>
            <div className="mb-6">
              <div className="text-xs text-gray-500 uppercase font-bold">Current status</div>
              <div className="text-lg font-bold text-[#403f4c]">{data.current_status_label}</div>
            </div>
            <div className="space-y-3">
              {data.ladder.map(item => (
                <div key={item.status} className="flex items-center gap-3">
                  {item.reached ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" /> : <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />}
                  <span className={`text-sm flex-1 ${item.reached ? 'font-medium text-[#403f4c]' : 'text-gray-400'}`}>{item.label}</span>
                  {item.at && <span className="text-xs text-gray-400">{new Date(item.at).toLocaleDateString()}</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default WonVehicleTrackingView;

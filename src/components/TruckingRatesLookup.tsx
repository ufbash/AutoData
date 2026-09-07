import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  searchTruckingYards,
  listPortsForYard,
  getInternalView,
  getEstimatorView,
  formatEstimatorSummary,
  YardSummary,
  PortSummary,
  InternalView,
  EstimatorView,
} from '../services/truckingRatesService';
import { Loader2, Search, History } from 'lucide-react';

const SOURCE_LABELS: Record<string, string> = {
  official_tariff: 'Official tariff',
  agent_quote: 'Agent quote',
  actual_paid: 'Actual paid',
};

// PROMPT 20 Phase 4 - a staff-visible display of the two views over trucking_rates.
// Deliberately read-only and standalone: not wired into research runs or the public share
// page (that is a separate decision), and no add/edit UI here - rates arrive via the
// importer (Phase 3), not manual entry, so there is nothing to create or supersede from
// this screen.
const TruckingRatesLookup: React.FC = () => {
  const { orgId, role } = useAuth();
  const [query, setQuery] = useState('');
  const [yards, setYards] = useState<YardSummary[]>([]);
  const [selectedYard, setSelectedYard] = useState<YardSummary | null>(null);
  const [ports, setPorts] = useState<PortSummary[]>([]);
  const [selectedPort, setSelectedPort] = useState<PortSummary | null>(null);
  const [internalView, setInternalView] = useState<InternalView | null>(null);
  const [estimatorView, setEstimatorView] = useState<EstimatorView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    const timer = setTimeout(async () => {
      try {
        setYards(await searchTruckingYards(orgId, query));
      } catch (err: any) {
        setError(err.message);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [orgId, query]);

  const handleSelectYard = async (yard: YardSummary) => {
    setSelectedYard(yard);
    setSelectedPort(null);
    setInternalView(null);
    setEstimatorView(null);
    if (!orgId) return;
    try {
      setPorts(await listPortsForYard(orgId, yard.auction_platform, yard.yard_state, yard.yard_city));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSelectPort = async (port: PortSummary) => {
    setSelectedPort(port);
    if (!orgId || !selectedYard) return;
    setLoading(true);
    setError(null);
    try {
      const [iv, ev] = await Promise.all([
        getInternalView(orgId, selectedYard.auction_platform, selectedYard.yard_state, selectedYard.yard_city, port.destination_port_normalized, port.shipping_method),
        getEstimatorView(orgId, selectedYard.auction_platform, selectedYard.yard_state, selectedYard.yard_city, port.destination_port_normalized, port.shipping_method),
      ]);
      setInternalView(iv);
      setEstimatorView(ev);
    } catch (err: any) {
      setError(err.message || 'Failed to load rates.');
    } finally {
      setLoading(false);
    }
  };

  if (role !== 'superadmin') {
    return (
      <div className="bg-white p-8 rounded-xl shadow-sm border border-[#ba3b46]/20 text-center">
        <h2 className="text-xl font-bold text-[#403f4c] mb-2">Access Restricted</h2>
        <p className="text-gray-500">Trucking rates are platform data — only a superadmin may view them.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#403f4c]">Trucking Rates</h1>
        <p className="text-sm text-gray-500 mt-1">
          Imported vendor rate sheets, one row per vendor/platform/yard/port/method. Not yet wired into research runs or the public share page.
        </p>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Search yard (city or state)</label>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. Birmingham"
              className="w-full border border-gray-300 rounded-md pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
            {yards.map((y, i) => (
              <button
                key={i}
                onClick={() => handleSelectYard(y)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${selectedYard === y ? 'bg-[#a58039]/10' : ''}`}
              >
                <span className="font-bold uppercase text-[10px] text-purple-700 mr-2">{y.auction_platform}</span>
                {y.yard_city}, {y.yard_state}
              </button>
            ))}
            {yards.length === 0 && <div className="px-3 py-4 text-sm text-gray-400 text-center">No yards found.</div>}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Destination / method</label>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {!selectedYard && <div className="px-3 py-4 text-sm text-gray-400 text-center">Select a yard first.</div>}
            {selectedYard && ports.length === 0 && <div className="px-3 py-4 text-sm text-gray-400 text-center">No ports found for this yard.</div>}
            {ports.map((p, i) => (
              <button
                key={i}
                onClick={() => handleSelectPort(p)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${selectedPort === p ? 'bg-[#a58039]/10' : ''}`}
              >
                <span className="font-bold uppercase text-[10px] text-blue-700 mr-2">{p.shipping_method}</span>
                {p.destination_port_normalized}
                {p.destination_port_raw.toUpperCase() !== p.destination_port_normalized && (
                  <span className="text-gray-400 text-xs"> (raw: "{p.destination_port_raw}")</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="md:col-span-1">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-[#a58039] animate-spin" />
            </div>
          )}
          {!loading && estimatorView && selectedYard && selectedPort && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wide mb-2">Estimator View</h3>
              <p className="text-sm text-blue-900">
                {formatEstimatorSummary(selectedYard.yard_city, selectedPort.destination_port_normalized, estimatorView)}
              </p>
              {estimatorView.sampleSize === 1 && (
                <p className="text-xs text-blue-700 mt-1 italic">Single quote — shown explicitly as sample size 1, not presented as a market rate.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {!loading && internalView && selectedYard && selectedPort && (
        <div className="mt-6">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
            Internal View — {selectedYard.yard_city}, {selectedYard.yard_state} ({selectedYard.auction_platform}) → {selectedPort.destination_port_normalized} ({selectedPort.shipping_method})
          </h2>

          {internalView.current.length === 0 ? (
            <p className="text-gray-400 italic mb-4">No currently-effective rate for this combination.</p>
          ) : (
            <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden mb-4">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2">Vendor</th>
                  <th className="text-left px-3 py-2">Price</th>
                  <th className="text-left px-3 py-2">Effective from</th>
                  <th className="text-left px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {internalView.current.map(r => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium">{r.vendor}</td>
                    <td className="px-3 py-2 font-bold text-[#a58039]">${r.price.toLocaleString()}</td>
                    <td className="px-3 py-2 text-gray-500">{r.effective_from}</td>
                    <td className="px-3 py-2 text-gray-500">{SOURCE_LABELS[r.source] || r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {internalView.history.length > 0 && (
            <>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <History className="w-3.5 h-3.5" /> History — Superseded ({internalView.history.length})
              </h3>
              <table className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg overflow-hidden opacity-70">
                <tbody className="divide-y divide-gray-200">
                  {internalView.history.map(r => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium">{r.vendor}</td>
                      <td className="px-3 py-2 text-gray-600">${r.price.toLocaleString()}</td>
                      <td className="px-3 py-2 text-gray-500">{r.effective_from} → {r.effective_to}</td>
                      <td className="px-3 py-2 text-gray-500">{SOURCE_LABELS[r.source] || r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default TruckingRatesLookup;

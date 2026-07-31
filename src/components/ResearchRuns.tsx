import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listRuns, createRun, ResearchRun } from '../services/researchService';
import { Plus, Users, Loader2, Search, Calendar, ChevronRight, Car } from 'lucide-react';

interface ResearchRunsProps {
  onOpenRun: (runId: string) => void;
}

const ResearchRuns: React.FC<ResearchRunsProps> = ({ onOpenRun }) => {
  const { orgId, orgLoading } = useAuth();
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newRunType, setNewRunType] = useState<'sold_comps' | 'active_listings' | 'mixed'>('active_listings');
  const [newNotes, setNewNotes] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (orgLoading) return;
    if (!orgId) {
      setError("No organization membership — contact an administrator");
      setLoading(false);
      return;
    }

    const fetchRuns = async () => {
      try {
        const data = await listRuns(orgId);
        setRuns(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load research runs');
      } finally {
        setLoading(false);
      }
    };

    fetchRuns();
  }, [orgId, orgLoading]);

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !newClientName.trim()) return;

    setCreating(true);
    try {
      const newRun = await createRun(orgId, {
        client_name: newClientName.trim(),
        run_type: newRunType,
        notes: newNotes.trim() || undefined,
      });
      setRuns([newRun, ...runs]);
      setShowNewForm(false);
      setNewClientName('');
      setNewRunType('active_listings');
      setNewNotes('');
      onOpenRun(newRun.id);
    } catch (err: any) {
      alert(err.message || 'Failed to create run');
    } finally {
      setCreating(false);
    }
  };

  if (orgLoading || loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#a58039]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-600 p-6 rounded-xl border border-red-100 text-center">
        <p className="font-semibold">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-[#403f4c]">Research Runs</h2>
        <button
          onClick={() => setShowNewForm(!showNewForm)}
          className="flex items-center gap-2 px-4 py-2 bg-[#a58039] text-[#F0EDDE] rounded-lg font-bold hover:bg-[#8c6b2e] transition-colors"
        >
          <Plus className="w-4 h-4" /> New Research Run
        </button>
      </div>

      {showNewForm && (
        <form onSubmit={handleCreateRun} className="bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/20 animate-in fade-in">
          <h3 className="text-lg font-bold text-[#403f4c] mb-4">Create New Run</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client Name *</label>
              <input
                type="text"
                required
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#a58039]"
                placeholder="e.g. Acme Corp"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Run Type *</label>
              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input type="radio" name="runType" value="sold_comps" checked={newRunType === 'sold_comps'} onChange={(e) => setNewRunType(e.target.value as any)} className="mt-1 text-[#a58039] focus:ring-[#a58039]" />
                  <div>
                    <div className="font-bold text-[#403f4c]">Market research</div>
                    <div className="text-sm text-gray-500">What have these sold for?</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input type="radio" name="runType" value="active_listings" checked={newRunType === 'active_listings'} onChange={(e) => setNewRunType(e.target.value as any)} className="mt-1 text-[#a58039] focus:ring-[#a58039]" />
                  <div>
                    <div className="font-bold text-[#403f4c]">Client options</div>
                    <div className="text-sm text-gray-500">Which should we buy?</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input type="radio" name="runType" value="mixed" checked={newRunType === 'mixed'} onChange={(e) => setNewRunType(e.target.value as any)} className="mt-1 text-[#a58039] focus:ring-[#a58039]" />
                  <div>
                    <div className="font-bold text-[#403f4c]">Both</div>
                    <div className="text-sm text-gray-500">Mix of live listings and market comps</div>
                  </div>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
              <textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#a58039]"
                rows={3}
                placeholder="Optional notes about this research request"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowNewForm(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || !newClientName.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white rounded-md font-bold hover:bg-[#2d2c35] transition-colors disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Run'}
              </button>
            </div>
          </div>
        </form>
      )}

      {runs.length === 0 ? (
        <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 text-center">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No research runs yet</h3>
          <p className="text-gray-500">Create your first research run to start tracking vehicles for a client.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {runs.map(run => (
            <div
              key={run.id}
              onClick={() => onOpenRun(run.id)}
              className="bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/20 hover:border-[#a58039]/60 hover:shadow-md transition-all cursor-pointer group flex flex-col h-full"
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-bold text-lg text-[#403f4c] group-hover:text-[#a58039] transition-colors line-clamp-2 mb-2">
                  {run.client_name}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap font-medium ${
                    run.status === 'active' ? 'bg-green-100 text-green-700' :
                    run.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                    run.status === 'archived' ? 'bg-gray-100 text-gray-700' :
                    'bg-yellow-100 text-yellow-700' // draft
                  }`}>
                    {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                  </span>
                  <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-full whitespace-nowrap font-medium">
                    {run.run_type === 'sold_comps' ? 'Market Research' : run.run_type === 'active_listings' ? 'Client Options' : 'Mixed'}
                  </span>
                </div>
              </div>
              
              <div className="flex-1">
                {run.notes && (
                  <p className="text-sm text-gray-500 line-clamp-2 mb-4">{run.notes}</p>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1" title="Included Listings">
                    <Car className="w-4 h-4" /> {run.listing_count || 0}
                  </span>
                  <span className="flex items-center gap-1" title="Created Date">
                    <Calendar className="w-4 h-4" /> {new Date(run.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${run.share_enabled ? 'bg-green-500' : 'bg-gray-300'}`} title={`Sharing ${run.share_enabled ? 'On' : 'Off'}`} />
                  <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-[#a58039] transition-colors" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ResearchRuns;

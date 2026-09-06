import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listRuns, createRun, listDeletedRuns, restoreRun, listClients, listClientBriefs, ResearchRun, Client, ClientBrief } from '../services/researchService';
import { Plus, Users, Loader2, Search, Calendar, ChevronRight, Car } from 'lucide-react';

interface ResearchRunsProps {
  onOpenRun: (runId: string) => void;
  initialClientId?: string | null;
  initialBriefId?: string | null;
  onConsumedInitialClient?: () => void;
  onOpenClient?: (clientId: string, briefId?: string) => void;
}

const ResearchRuns: React.FC<ResearchRunsProps> = ({ onOpenRun, initialClientId, initialBriefId, onConsumedInitialClient, onOpenClient }) => {
  const { orgId, orgLoading, role, user } = useAuth();
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedRuns, setDeletedRuns] = useState<ResearchRun[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newRunType, setNewRunType] = useState<'sold_comps' | 'active_listings' | 'mixed'>('active_listings');
  const [newNotes, setNewNotes] = useState('');
  
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [briefs, setBriefs] = useState<ClientBrief[]>([]);
  const [selectedBriefId, setSelectedBriefId] = useState<string>('');

  const [creating, setCreating] = useState(false);
  const [depositOverrideReason, setDepositOverrideReason] = useState('');

  const INTERNAL_CLIENT_NAME = 'Internal / Market Research';
  const selectedClientObj = clients.find(c => c.id === selectedClientId) || null;
  const depositMissing = !!selectedClientObj && selectedClientObj.full_name !== INTERNAL_CLIENT_NAME && !selectedClientObj.deposit_received_at;

  // Read via ref, not as a reactive effect dependency, below: clearing initialBriefId after
  // it's consumed would otherwise change the brief-fetch effect's own dependency array,
  // re-firing it and hitting its unconditional setSelectedBriefId('') reset at the top -
  // wiping out the very selection just applied (Prompt 17 Phase 3).
  const initialBriefIdRef = useRef(initialBriefId);
  useEffect(() => { initialBriefIdRef.current = initialBriefId; }, [initialBriefId]);

  useEffect(() => {
    if (orgLoading) return;
    if (!orgId) {
      setError("No organization membership — contact an administrator");
      setLoading(false);
      return;
    }

    const fetchRunsAndClients = async () => {
      try {
        const [runsData, clientsData] = await Promise.all([
          listRuns(orgId),
          listClients(orgId)
        ]);
        setRuns(runsData);
        setClients(clientsData);
      } catch (err: any) {
        setError(err.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchRunsAndClients();
  }, [orgId, orgLoading]);

  useEffect(() => {
    // Always clear the brief selection on any client change - a brief carries a client_id of
    // its own, and a stale selection from a previously-selected client must never survive a
    // client switch (it would silently apply a different client's spec rules to this run).
    setSelectedBriefId('');
    if (!orgId || !selectedClientId) {
      setBriefs([]);
      return;
    }
    const fetchBriefs = async () => {
      try {
        const b = await listClientBriefs(orgId, selectedClientId);
        setBriefs(b);
        // Pre-fill from a brief's "New research run" action (Prompt 17 Phase 3) - only once
        // the fetched list confirms this brief actually belongs to the selected client, so a
        // stale or mismatched id can never be applied (the same client_id/client_brief_id
        // mismatch guard Prompt 11 established elsewhere).
        const pendingBriefId = initialBriefIdRef.current;
        if (pendingBriefId && b.some(br => br.id === pendingBriefId)) {
          setSelectedBriefId(pendingBriefId);
        }
      } catch (err) {
        console.error(err);
      } finally {
        // Only clear the parent's pending pre-fill once this fetch (the one triggered by that
        // very pre-fill) has resolved and had its chance to apply the brief selection above.
        // initialBriefId is deliberately not a dependency of this effect: clearing it after
        // use would otherwise change this effect's own dependency array, re-firing it and
        // hitting the unconditional setSelectedBriefId('') reset above - wiping out the very
        // selection just applied (Prompt 17 Phase 3).
        if (initialClientId && selectedClientId === initialClientId) {
          onConsumedInitialClient?.();
        }
      }
    };
    fetchBriefs();
  }, [orgId, selectedClientId]);

  useEffect(() => {
    if (!initialClientId || clients.length === 0) return;
    const c = clients.find(c => c.id === initialClientId);
    if (c) {
      setSelectedClientId(c.id);
      setNewClientName(c.full_name);
      setShowNewForm(true);
    }
  }, [initialClientId, clients]);

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !newClientName.trim()) return;
    if (!selectedClientId) {
      alert('Please select a client. Every research run must belong to a client — use "Internal / Market Research" for internal work.');
      return;
    }

    setCreating(true);
    try {
      const newRun = await createRun(orgId, {
        client_name: newClientName.trim(),
        run_type: newRunType,
        notes: newNotes.trim() || undefined,
        client_id: selectedClientId,
        client_brief_id: selectedBriefId || undefined,
        client: selectedClientObj,
        depositOverrideReason: role === 'superadmin' ? depositOverrideReason : undefined,
        overrideBy: user?.id
      });
      setRuns([newRun, ...runs]);
      setShowNewForm(false);
      setNewClientName('');
      setNewRunType('active_listings');
      setNewNotes('');
      setSelectedClientId('');
      setSelectedBriefId('');
      setDepositOverrideReason('');
      onOpenRun(newRun.id);
    } catch (err: any) {
      alert(err.message || 'Failed to create run');
      setCreating(false);
    }
  };

  const handleToggleDeleted = async () => {
    const nextState = !showDeleted;
    setShowDeleted(nextState);
    if (nextState && orgId) {
      setDeletedLoading(true);
      try {
        const d = await listDeletedRuns(orgId);
        setDeletedRuns(d);
      } catch (err: any) {
        alert(err.message || 'Failed to load deleted runs');
      } finally {
        setDeletedLoading(false);
      }
    }
  };

  const handleRestore = async (runId: string) => {
    try {
      await restoreRun(runId);
      setDeletedRuns(prev => prev.filter(r => r.id !== runId));
      // Refresh active runs
      if (orgId) {
        const data = await listRuns(orgId);
        setRuns(data);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to restore run');
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
        <div className="flex items-center gap-3">
          {role === 'superadmin' && (
            <button
              onClick={handleToggleDeleted}
              className={`text-sm font-bold transition-colors ${showDeleted ? 'text-red-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {showDeleted ? 'Hide deleted' : 'Show deleted'}
            </button>
          )}
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="flex items-center gap-2 px-4 py-2 bg-[#a58039] text-[#F0EDDE] rounded-lg font-bold hover:bg-[#8c6b2e] transition-colors"
          >
            <Plus className="w-4 h-4" /> New Research Run
          </button>
        </div>
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
              <p className="text-xs text-gray-500 mt-1">This is the display name on the share page.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-100 pt-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Link to Client *</label>
                <select
                  required
                  value={selectedClientId}
                  onChange={(e) => {
                    setSelectedClientId(e.target.value);
                    if (e.target.value) {
                      const c = clients.find(c => c.id === e.target.value);
                      if (c && !newClientName) setNewClientName(c.full_name);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#a58039]"
                >
                  <option value="">-- Select a client --</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.full_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Link to Buying Brief (Optional)</label>
                <select
                  value={selectedBriefId}
                  onChange={(e) => setSelectedBriefId(e.target.value)}
                  disabled={!selectedClientId}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#a58039] disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">{selectedClientId ? '-- No brief link --' : '-- Select a client first --'}</option>
                  {briefs.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.year_min || 'Any'}-{b.year_max || 'Any'} {b.make || 'Any Make'} {b.model || 'Any Model'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {depositMissing && (
              <div className="border border-red-200 bg-red-50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-bold text-red-700">
                  No commitment fee recorded for {selectedClientObj?.full_name}.
                </p>
                <p className="text-sm text-red-600">
                  Per the deposit policy, a research run cannot start until the client's
                  commitment fee has landed. Mark the deposit received on their client record,
                  or select a different client.
                </p>
                {role === 'superadmin' && (
                  <div className="pt-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Superadmin override reason (recorded, min 10 characters):
                    </label>
                    <textarea
                      value={depositOverrideReason}
                      onChange={e => setDepositOverrideReason(e.target.value)}
                      placeholder="e.g. Deposit confirmed via WhatsApp, not yet logged"
                      className="w-full bg-white border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#a58039] min-h-[60px]"
                    />
                  </div>
                )}
              </div>
            )}

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
                disabled={
                  creating || !newClientName.trim() || !selectedClientId ||
                  (depositMissing && (role !== 'superadmin' || depositOverrideReason.trim().length < 10))
                }
                className="flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white rounded-md font-bold hover:bg-[#2d2c35] transition-colors disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Run'}
              </button>
            </div>
          </div>
        </form>
      )}

      {showDeleted ? (
        deletedLoading ? (
          <div className="flex justify-center items-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-[#a58039]" />
          </div>
        ) : deletedRuns.length === 0 ? (
          <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">No deleted runs</h3>
            <p className="text-gray-500">Deleted runs are permanently removed after 30 days.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {deletedRuns.map(run => {
              const daysRemaining = 30 - Math.floor((new Date().getTime() - new Date(run.deleted_at!).getTime()) / (1000 * 3600 * 24));
              return (
                <div key={run.id} className="bg-red-50 p-4 rounded-xl border border-red-100 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-red-900 line-clamp-1">{run.client_name}</h3>
                    <p className="text-sm text-red-700">
                      Deleted on {new Date(run.deleted_at!).toLocaleDateString()} • {Math.max(0, daysRemaining)} days remaining until permanent deletion
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestore(run.id)}
                    className="px-4 py-2 bg-white text-red-700 font-bold rounded-lg border border-red-200 hover:bg-red-100 transition-colors whitespace-nowrap"
                  >
                    Restore
                  </button>
                </div>
              );
            })}
          </div>
        )
      ) : runs.length === 0 ? (
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
                <div>
                  <h3 className="font-bold text-lg text-[#403f4c] group-hover:text-[#a58039] transition-colors line-clamp-2 mb-1">
                    {run.client_name}
                  </h3>
                  {run.client && (
                    <div className="text-xs text-gray-500 mb-2">
                      For{' '}
                      <button
                        onClick={(e) => { e.stopPropagation(); onOpenClient?.(run.client!.id, run.client_brief?.id); }}
                        className="font-bold text-[#a58039] hover:underline"
                      >
                        {run.client.full_name}
                      </button>
                      {run.client_brief && (
                        <>
                          {' · Brief: '}
                          <button
                            onClick={(e) => { e.stopPropagation(); onOpenClient?.(run.client!.id, run.client_brief!.id); }}
                            className="font-bold text-[#a58039] hover:underline"
                          >
                            {run.client_brief.year_min || 'Any'}-{run.client_brief.year_max || 'Any'} {run.client_brief.make || 'Any Make'} {run.client_brief.model || 'Any Model'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
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

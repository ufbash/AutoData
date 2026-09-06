import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listClients, createClient, updateClient, softDeleteClient, listClientBriefs, createClientBrief, updateClientBrief, softDeleteClientBrief, Client, ClientBrief, listRuns, ResearchRun, listDeletedClients, listDeletedClientBriefs, restoreClient, restoreClientBrief, generateBriefLink, revokeBriefLink, approveBrief, createBriefWithIntakeLink } from '../services/researchService';
import { Plus, Loader2, Users, FileText, ChevronRight, Check, AlertTriangle, Trash2, Edit2, X, Archive, RefreshCw, Car, Copy, Link as LinkIcon } from 'lucide-react';

// --- Brief Form Component ---
const BriefForm = ({ 
  initialData = { quantity: 1 }, 
  onSubmit, 
  onCancel, 
  isSubmitting 
}: { 
  initialData?: Partial<ClientBrief>, 
  onSubmit: (data: Partial<ClientBrief>) => void, 
  onCancel: () => void, 
  isSubmitting: boolean 
}) => {
  const [formData, setFormData] = useState<Partial<ClientBrief>>(initialData);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-50 p-6 rounded-xl border border-gray-200 mb-6 space-y-4">
      <div className="flex justify-between items-center mb-2">
        <h4 className="font-bold text-gray-800">{initialData.id ? 'Edit Buying Brief' : 'Create Buying Brief'}</h4>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Make</label>
          <input type="text" value={formData.make || ''} onChange={e => setFormData({...formData, make: e.target.value})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="e.g. Toyota" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Model</label>
          <input type="text" value={formData.model || ''} onChange={e => setFormData({...formData, model: e.target.value})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="e.g. Camry" />
        </div>
        
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Trim</label>
          <input type="text" value={formData.trim || ''} onChange={e => setFormData({...formData, trim: e.target.value})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="e.g. SE, XLE" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
          <input type="number" min="1" value={formData.quantity || 1} onChange={e => setFormData({...formData, quantity: parseInt(e.target.value) || 1})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" />
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Min Year</label>
            <input type="number" value={formData.year_min || ''} onChange={e => setFormData({...formData, year_min: parseInt(e.target.value) || undefined})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="2015" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Max Year</label>
            <input type="number" value={formData.year_max || ''} onChange={e => setFormData({...formData, year_max: parseInt(e.target.value) || undefined})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="2020" />
          </div>
        </div>
        
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Max Mileage</label>
          <input type="number" value={formData.max_mileage || ''} onChange={e => setFormData({...formData, max_mileage: parseInt(e.target.value) || undefined})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="100000" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Transmission</label>
          <select value={formData.transmission || 'either'} onChange={e => setFormData({...formData, transmission: e.target.value === 'either' ? 'either' : e.target.value as any})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded bg-white">
            <option value="either">Either / No preference</option>
            <option value="automatic">Automatic</option>
            <option value="manual">Manual</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Fuel Type</label>
          <select value={formData.fuel_type || 'either'} onChange={e => setFormData({...formData, fuel_type: e.target.value === 'either' ? 'either' : e.target.value as any})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded bg-white">
            <option value="either">Either / No preference</option>
            <option value="petrol">Petrol</option>
            <option value="diesel">Diesel</option>
            <option value="hybrid">Hybrid</option>
            <option value="electric">Electric</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Condition Required</label>
          <select value={formData.condition_required || 'either'} onChange={e => setFormData({...formData, condition_required: e.target.value === 'either' ? 'either' : e.target.value as any})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded bg-white">
            <option value="either">Either / No preference</option>
            <option value="run_and_drive">Run and Drive</option>
            <option value="starts_needs_work">Starts, Needs Work</option>
            <option value="non_running">Non-Running</option>
            <option value="salvage_only">Salvage Only</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Exterior Colour Preference</label>
          <input type="text" value={formData.colour_preference || ''} onChange={e => setFormData({...formData, colour_preference: e.target.value})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="e.g. Black, White" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Interior Preference</label>
          <input type="text" value={formData.interior_preference || ''} onChange={e => setFormData({...formData, interior_preference: e.target.value})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="e.g. Leather, Black" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Max Budget (USD)</label>
          <input type="number" value={formData.max_budget_usd || ''} onChange={e => setFormData({...formData, max_budget_usd: parseFloat(e.target.value) || undefined})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="e.g. 15000" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Max Bid (USD)</label>
          <input type="number" value={formData.max_bid_usd || ''} onChange={e => setFormData({...formData, max_bid_usd: parseFloat(e.target.value) || undefined})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="e.g. 12000" />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Titles Accepted (comma separated)</label>
          <input type="text" value={formData.titles_accepted?.join(', ') || ''} onChange={e => {
            const vals = e.target.value.split(',').map(v => v.trim()).filter(Boolean);
            setFormData({...formData, titles_accepted: vals.length > 0 ? vals : undefined});
          }} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="clean, salvage" />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Additional Notes</label>
          <textarea value={formData.additional_notes || ''} onChange={e => setFormData({...formData, additional_notes: e.target.value})} rows={2} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="Any other requirements..." />
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onCancel} className="text-sm px-4 py-2 text-gray-500 hover:bg-gray-200 rounded font-bold">Cancel</button>
        <button type="submit" disabled={isSubmitting} className="text-sm px-4 py-2 bg-[#a58039] text-white rounded font-bold disabled:opacity-50">
          {isSubmitting ? 'Saving...' : (initialData.id ? 'Save Changes' : 'Create Brief')}
        </button>
      </div>
    </form>
  );
};

// --- Client Edit Form Component ---
const ClientEditForm = ({
  client,
  onSubmit,
  onCancel,
  isSubmitting
}: {
  client: Client,
  onSubmit: (data: Partial<Client>) => void,
  onCancel: () => void,
  isSubmitting: boolean
}) => {
  const [formData, setFormData] = useState<Partial<Client>>(client);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 border-b border-gray-100 bg-gray-50/50 space-y-4">
      <div className="flex justify-between items-center mb-2">
        <h4 className="font-bold text-gray-800">Edit Client</h4>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Full Name / Company</label>
          <input type="text" value={formData.full_name || ''} onChange={e => setFormData({...formData, full_name: e.target.value})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={formData.email || ''} onChange={e => setFormData({...formData, email: e.target.value || undefined})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="e.g. client@example.com" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
          <input type="text" value={formData.phone || ''} onChange={e => setFormData({...formData, phone: e.target.value || undefined})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="e.g. +234..." />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Preferred Contact</label>
          <select value={formData.preferred_contact || ''} onChange={e => setFormData({...formData, preferred_contact: (e.target.value || undefined) as Client['preferred_contact']})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded">
            <option value="">No preference</option>
            <option value="phone">Phone</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Assigned Agent</label>
          <input type="text" value={formData.assigned_agent || ''} onChange={e => setFormData({...formData, assigned_agent: e.target.value || undefined})} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={formData.notes || ''} onChange={e => setFormData({...formData, notes: e.target.value || undefined})} rows={2} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-sm px-4 py-2 text-gray-500 hover:bg-gray-200 rounded font-bold">Cancel</button>
        <button type="submit" disabled={isSubmitting} className="text-sm px-4 py-2 bg-[#a58039] text-white rounded font-bold disabled:opacity-50">
          {isSubmitting ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
};

interface ClientsListProps {
  onOpenRun?: (runId: string) => void;
  onNewRunForClient?: (clientId: string, briefId?: string) => void;
  initialClientId?: string | null;
  initialBriefId?: string | null;
  onConsumedInitialSelection?: () => void;
}

export const ClientsList: React.FC<ClientsListProps> = ({ onOpenRun, onNewRunForClient, initialClientId, initialBriefId, onConsumedInitialSelection }) => {
  const { orgId, orgLoading, role, user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedClients, setDeletedClients] = useState<Client[]>([]);
  const [deletedBriefs, setDeletedBriefs] = useState<ClientBrief[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [briefs, setBriefs] = useState<ClientBrief[]>([]);
  const [briefsLoading, setBriefsLoading] = useState(false);
  const [allRuns, setAllRuns] = useState<ResearchRun[]>([]);

  // New Client Form
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);

  // Edit Client Form
  const [editingClient, setEditingClient] = useState(false);
  const [savingClient, setSavingClient] = useState(false);

  // Brief Forms and Views
  const [showNewBriefForm, setShowNewBriefForm] = useState(false);
  const [creatingBrief, setCreatingBrief] = useState(false);
  const [editingBriefId, setEditingBriefId] = useState<string | null>(null);
  const [selectedBriefId, setSelectedBriefId] = useState<string | null>(null);
  const [briefLinkBusy, setBriefLinkBusy] = useState(false);
  const [briefLinkCopied, setBriefLinkCopied] = useState(false);
  const [generatingIntakeLink, setGeneratingIntakeLink] = useState(false);
  const [confirmingGenerateLink, setConfirmingGenerateLink] = useState(false);
  const [freshIntakeLink, setFreshIntakeLink] = useState<ClientBrief | null>(null);
  const [freshLinkCopied, setFreshLinkCopied] = useState(false);

  // Deletion logic
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'client' | 'brief', id: string, name: string } | null>(null);

  useEffect(() => {
    if (orgLoading) return;
    if (!orgId) {
      setError("No organization membership");
      setLoading(false);
      return;
    }

    const loadClientsAndRuns = async () => {
      try {
        const [cData, rData] = await Promise.all([
          listClients(orgId),
          listRuns(orgId)
        ]);
        setClients(cData);
        setAllRuns(rData);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadClientsAndRuns();
  }, [orgId, orgLoading]);

  useEffect(() => {
    if (!initialClientId || clients.length === 0) return;
    const applySelection = async () => {
      let target = clients.find(c => c.id === initialClientId) || null;
      if (!target && orgId) {
        // A run can still point at a soft-deleted client (must render, not crash) - it won't
        // be in the active clients list, so fall back to the deleted-clients lookup rather
        // than silently failing to open the hub.
        try {
          const dc = await listDeletedClients(orgId);
          target = dc.find(c => c.id === initialClientId) || null;
        } catch (err) {
          console.error(err);
        }
      }
      if (target) {
        setSelectedClient(target);
        if (initialBriefId) setSelectedBriefId(initialBriefId);
      }
      onConsumedInitialSelection?.();
    };
    applySelection();
  }, [initialClientId, clients]);

  useEffect(() => {
    if (!orgId || !selectedClient) return;
    const loadBriefs = async () => {
      setBriefsLoading(true);
      setShowNewBriefForm(false);
      setSelectedBriefId(null);
      setEditingBriefId(null);
      try {
        const data = await listClientBriefs(orgId, selectedClient.id);
        setBriefs(data);
      } catch (err: any) {
        console.error(err);
      } finally {
        setBriefsLoading(false);
      }
    };
    loadBriefs();
  }, [orgId, selectedClient]);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !newClientName.trim()) return;

    setCreatingClient(true);
    try {
      const c = await createClient(orgId, { full_name: newClientName.trim() });
      setClients([c, ...clients]);
      setShowNewClientForm(false);
      setNewClientName('');
      setSelectedClient(c);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreatingClient(false);
    }
  };

  const handleUpdateClient = async (patch: Partial<Client>) => {
    if (!selectedClient) return;
    setSavingClient(true);
    try {
      const c = await updateClient(selectedClient.id, patch);
      setClients(clients.map(cl => cl.id === c.id ? c : cl));
      setSelectedClient(c);
      setEditingClient(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingClient(false);
    }
  };

  const handleCreateBrief = async (data: Partial<ClientBrief>) => {
    if (!orgId || !selectedClient) return;
    setCreatingBrief(true);
    try {
      const b = await createClientBrief(orgId, selectedClient.id, {
        ...data,
        quantity: data.quantity || 1,
        transmission: data.transmission === 'either' ? 'either' : data.transmission,
        fuel_type: data.fuel_type === 'either' ? 'either' : data.fuel_type,
        condition_required: data.condition_required === 'either' ? 'either' : data.condition_required,
      });
      setBriefs([b, ...briefs]);
      setShowNewBriefForm(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreatingBrief(false);
    }
  };

  const handleUpdateBrief = async (data: Partial<ClientBrief>) => {
    if (!editingBriefId) return;
    setCreatingBrief(true);
    try {
      const b = await updateClientBrief(editingBriefId, {
        ...data,
        transmission: data.transmission === 'either' ? 'either' : data.transmission,
        fuel_type: data.fuel_type === 'either' ? 'either' : data.fuel_type,
        condition_required: data.condition_required === 'either' ? 'either' : data.condition_required,
      });
      setBriefs(briefs.map(br => br.id === editingBriefId ? b : br));
      setEditingBriefId(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreatingBrief(false);
    }
  };


  const handleToggleDeleted = async () => {
    const nextState = !showDeleted;
    setShowDeleted(nextState);
    if (nextState && orgId) {
      setDeletedLoading(true);
      try {
        const [dc, db] = await Promise.all([
          listDeletedClients(orgId),
          listDeletedClientBriefs(orgId)
        ]);
        setDeletedClients(dc);
        setDeletedBriefs(db);
      } catch (err: any) {
        alert(err.message || 'Failed to load deleted records');
      } finally {
        setDeletedLoading(false);
      }
    }
  };

  const handleRestoreClient = async (id: string) => {
    try {
      await restoreClient(id);
      setDeletedClients(prev => prev.filter(c => c.id !== id));
      if (orgId) {
        const data = await listClients(orgId);
        setClients(data);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to restore client');
    }
  };

  const handleRestoreBrief = async (id: string) => {
    try {
      await restoreClientBrief(id);
      setDeletedBriefs(prev => prev.filter(b => b.id !== id));
      if (orgId && selectedClient) {
        const data = await listClientBriefs(orgId, selectedClient.id);
        setBriefs(data);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to restore brief');
    }
  };

  const handleDelete = async () => {
    if (!user || !deleteTarget || deleteConfirmName !== deleteTarget.name) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === 'client') {
        await softDeleteClient(deleteTarget.id, user.id);
        setClients(clients.filter(c => c.id !== deleteTarget.id));
        if (selectedClient?.id === deleteTarget.id) setSelectedClient(null);
      } else {
        await softDeleteClientBrief(deleteTarget.id, user.id);
        setBriefs(briefs.filter(b => b.id !== deleteTarget.id));
        if (selectedBriefId === deleteTarget.id) setSelectedBriefId(null);
      }
      setShowDeleteModal(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading || orgLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-[#a58039]" /></div>;
  }

  if (error) {
    return <div className="p-6 text-red-600 bg-red-50 rounded-lg">{error}</div>;
  }

  // Also check deletedBriefs: a soft-deleted brief's runs must still be reachable from the
  // deleted-items view, and this is the same lookup the brief-detail render below uses.
  const selectedBrief = selectedBriefId ? (briefs.find(b => b.id === selectedBriefId) || deletedBriefs.find(b => b.id === selectedBriefId)) : null;
  const val = (v: any) => (v === null || v === undefined || v === '') ? 'No preference' : v;
  const isSelectedBriefEditing = editingBriefId === selectedBriefId && selectedBriefId !== null;

  return (
    <div className="flex flex-col md:flex-row gap-6 h-[calc(100vh-8rem)]">
      {/* Left side: Clients List */}
      <div className="w-full md:w-1/3 bg-white rounded-xl shadow-sm border border-[#a58039]/20 flex flex-col overflow-hidden">
        
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h2 className="text-lg font-bold text-[#403f4c] flex items-center gap-2">
            <Users className="w-5 h-5" /> Clients
          </h2>
          <div className="flex gap-1">
            {role === 'superadmin' && (
              <button 
                onClick={handleToggleDeleted}
                className={`p-1 rounded ${showDeleted ? 'bg-gray-200 text-gray-800' : 'text-gray-400 hover:bg-gray-100'}`}
                title="View deleted records"
              >
                <Archive className="w-5 h-5" />
              </button>
            )}
            <button 
              onClick={() => setShowNewClientForm(!showNewClientForm)}
              className="p-1 text-[#a58039] hover:bg-[#a58039]/10 rounded"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>


        {showNewClientForm && (
          <form onSubmit={handleCreateClient} className="p-4 border-b border-gray-100 bg-gray-50">
            <input 
              type="text" 
              autoFocus
              placeholder="Full Name / Company" 
              value={newClientName}
              onChange={e => setNewClientName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded mb-2"
              required
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewClientForm(false)} className="text-sm px-3 py-1 text-gray-500 font-bold">Cancel</button>
              <button type="submit" disabled={creatingClient} className="text-sm px-3 py-1 bg-[#a58039] text-white rounded font-bold disabled:opacity-50">
                {creatingClient ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        )}


        <div className="flex-1 overflow-y-auto">
          {showDeleted ? (
            deletedLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : deletedClients.length === 0 && deletedBriefs.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">No deleted records in the last 30 days.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {deletedClients.map(c => (
                  <div key={'c_'+c.id} className="p-4 bg-red-50 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-gray-900 line-through">{c.full_name}</div>
                      <div className="text-xs text-gray-500">Deleted {new Date(c.deleted_at!).toLocaleDateString()}</div>
                    </div>
                    <button onClick={() => handleRestoreClient(c.id)} className="text-sm font-bold text-gray-600 hover:text-green-600 flex items-center gap-1">
                      <RefreshCw className="w-4 h-4" /> Restore
                    </button>
                  </div>
                ))}
                {deletedBriefs.map(b => (
                  <div
                    key={'b_'+b.id}
                    onClick={() => {
                      // A deleted brief's runs must still be reachable. deletedBriefs spans
                      // the whole org, not just the currently selected client, so switch to
                      // its owning client (active or itself soft-deleted) before selecting it.
                      const owner = clients.find(c => c.id === b.client_id) || deletedClients.find(c => c.id === b.client_id) || null;
                      if (owner) setSelectedClient(owner);
                      setSelectedBriefId(b.id);
                    }}
                    className="p-4 bg-orange-50 hover:bg-orange-100 cursor-pointer flex items-center justify-between transition-colors"
                  >
                    <div>
                      <div className="font-medium text-gray-900 line-through">Brief: {b.year_min||'Any'}-{b.year_max||'Any'} {b.make||'Any'} {b.model||'Any'}</div>
                      <div className="text-xs text-gray-500">Deleted {new Date(b.deleted_at!).toLocaleDateString()}</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleRestoreBrief(b.id); }} className="text-sm font-bold text-gray-600 hover:text-green-600 flex items-center gap-1">
                      <RefreshCw className="w-4 h-4" /> Restore
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            clients.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">No clients yet.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {clients.map(c => (
                  <div 
                    key={c.id} 
                    onClick={() => { setSelectedClient(c); setFreshIntakeLink(null); setConfirmingGenerateLink(false); }}
                    className={`p-4 cursor-pointer hover:bg-gray-50 flex items-center justify-between ${selectedClient?.id === c.id ? 'bg-[#a58039]/5 border-l-4 border-[#a58039]' : 'border-l-4 border-transparent'}`}
                >
                  <div className="font-medium text-gray-900">{c.full_name}</div>
                  <div className="flex items-center gap-2">
                    {role === 'superadmin' && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'client', id: c.id, name: c.full_name }); setDeleteConfirmName(''); setShowDeleteModal(true); }}
                        className="text-gray-300 hover:text-red-500 transition-colors p-1"
                        title="Delete Client"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <ChevronRight className={`w-4 h-4 ${selectedClient?.id === c.id ? 'text-[#a58039]' : 'text-gray-300'}`} />
                  </div>
                </div>
              ))}
            </div>
          )
          )}
        </div>
      </div>

      {/* Right side: Client Detail & Briefs */}
      <div className="w-full md:w-2/3 bg-white rounded-xl shadow-sm border border-[#a58039]/20 flex flex-col overflow-hidden">
        {!selectedClient ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
            <FileText className="w-16 h-16 mb-4 opacity-20" />
            <p>Select a client to view their buying briefs</p>
          </div>
        ) : selectedBriefId && selectedBrief && !isSelectedBriefEditing ? (
          <div className="flex flex-col h-full">
            <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex justify-between items-start">
              <div>
                <button onClick={() => setSelectedBriefId(null)} className="text-sm font-bold text-[#a58039] hover:underline mb-2 flex items-center gap-1">
                  ← Back to Briefs
                </button>
                <h2 className="text-2xl font-bold text-[#403f4c] flex items-center gap-3">
                  {selectedBrief.year_min || 'Any'}-{selectedBrief.year_max || 'Any'} {selectedBrief.make || 'Any Make'} {selectedBrief.model || 'Any Model'}
                  {selectedBrief.status === 'pending_review' && (
                    <span className="bg-amber-100 text-amber-800 border border-amber-200 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide">Pending review</span>
                  )}
                </h2>
                <div className="text-sm text-gray-500 mt-1">For {selectedClient.full_name}</div>
                {selectedClient.full_name !== 'Internal / Market Research' && !selectedBrief.deleted_at && (
                  <label className="flex items-center gap-2 mt-3 cursor-pointer w-fit">
                    <input
                      type="checkbox"
                      checked={!!selectedBrief.deposit_received_at}
                      onChange={async (e) => {
                        const patch: Partial<ClientBrief> = e.target.checked
                          ? { deposit_received_at: new Date().toISOString(), deposit_recorded_by: user?.id || null }
                          : { deposit_received_at: null, deposit_recorded_by: null };
                        const b = await updateClientBrief(selectedBrief.id, patch);
                        setBriefs(briefs.map(br => br.id === b.id ? b : br));
                      }}
                      className="rounded text-[#a58039] focus:ring-[#a58039]"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      Commitment fee deposit received
                      {selectedBrief.deposit_received_at && (
                        <span className="text-gray-400 font-normal"> ({new Date(selectedBrief.deposit_received_at).toLocaleDateString()})</span>
                      )}
                    </span>
                  </label>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedBrief.deleted_at ? (
                  <span className="text-sm font-bold text-orange-600 px-3 py-1.5 bg-orange-50 rounded-lg">Deleted brief (view only)</span>
                ) : (
                  <>
                    {selectedBrief.status === 'pending_review' && (
                      <button
                        onClick={async () => {
                          const b = await approveBrief(selectedBrief.id);
                          setBriefs(briefs.map(br => br.id === b.id ? b : br));
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg font-bold hover:bg-green-700 transition-colors"
                      >
                        <Check className="w-4 h-4" /> Approve
                      </button>
                    )}
                    <button
                      onClick={() => onNewRunForClient?.(selectedClient.id, selectedBrief.id)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-[#403f4c] text-white text-sm rounded-lg font-bold hover:bg-[#2d2c35] transition-colors"
                    >
                      <Plus className="w-4 h-4" /> New research run
                    </button>
                    <button onClick={() => setEditingBriefId(selectedBrief.id)} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg font-bold hover:bg-gray-200 transition-colors">
                      <Edit2 className="w-4 h-4" /> Edit
                    </button>
                    {role === 'superadmin' && (
                      <button
                        onClick={() => {
                          const name = `${selectedBrief.year_min || 'Any'}-${selectedBrief.year_max || 'Any'} ${selectedBrief.make || 'Any Make'} ${selectedBrief.model || 'Any Model'}`;
                          setDeleteTarget({ type: 'brief', id: selectedBrief.id, name });
                          setDeleteConfirmName('');
                          setShowDeleteModal(true);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 bg-red-50 text-red-600 text-sm rounded-lg font-bold hover:bg-red-100 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">Vehicle Specification</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Make</div>
                    <div className="font-medium">{val(selectedBrief.make)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Model</div>
                    <div className="font-medium">{val(selectedBrief.model)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Trim</div>
                    <div className="font-medium">{val(selectedBrief.trim)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Year Range</div>
                    <div className="font-medium">{selectedBrief.year_min || 'Any'} - {selectedBrief.year_max || 'Any'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Max Mileage</div>
                    <div className="font-medium">{selectedBrief.max_mileage ? `${selectedBrief.max_mileage.toLocaleString()} mi` : 'No preference'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Condition</div>
                    <div className="font-medium capitalize">
                      {selectedBrief.condition_required === 'run_and_drive' ? 'Run & Drive' : val(selectedBrief.condition_required)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Transmission</div>
                    <div className="font-medium capitalize">{val(selectedBrief.transmission)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Fuel Type</div>
                    <div className="font-medium capitalize">{val(selectedBrief.fuel_type)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Titles Accepted</div>
                    <div className="font-medium capitalize">{selectedBrief.titles_accepted?.length ? selectedBrief.titles_accepted.join(', ') : 'No preference'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Exterior Colour</div>
                    <div className="font-medium">{val(selectedBrief.colour_preference)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Interior Preference</div>
                    <div className="font-medium">{val(selectedBrief.interior_preference)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Quantity Needed</div>
                    <div className="font-medium">{selectedBrief.quantity}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Max Budget</div>
                    <div className="font-medium">{selectedBrief.max_budget_usd ? `$${selectedBrief.max_budget_usd.toLocaleString()}` : 'No preference'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Max Bid</div>
                    <div className="font-medium">{selectedBrief.max_bid_usd ? `$${selectedBrief.max_bid_usd.toLocaleString()}` : 'No preference'}</div>
                  </div>
                </div>
              </div>

              {selectedBrief.additional_notes && (
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2 border-b pb-2">Additional Notes</h3>
                  <p className="text-gray-700 whitespace-pre-wrap">{selectedBrief.additional_notes}</p>
                </div>
              )}

              {selectedBrief.submitted_at && (
                <div className={`p-3 rounded-lg border text-sm ${selectedBrief.confirmation_sent_at ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                  <div className="font-bold mb-0.5">
                    {selectedBrief.confirmation_sent_at ? 'Confirmation email sent' : 'Confirmation email not sent'}
                  </div>
                  <div className="text-xs">
                    {selectedBrief.confirmation_sent_at
                      ? `Sent ${new Date(selectedBrief.confirmation_sent_at).toLocaleString()}`
                      : selectedClient.email
                        ? `Delivery did not complete to ${selectedClient.email} — no further detail is available from here.`
                        : 'This client has no email on file, so there was nothing to send to.'}
                  </div>
                </div>
              )}

              {!selectedBrief.deleted_at && (
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2 flex items-center gap-2">
                    <LinkIcon className="w-4 h-4 text-[#a58039]" /> Client Intake Link
                  </h3>
                  <p className="text-sm text-gray-500 mb-3">
                    Send this link to the client so they can fill in their own vehicle requirements. No login required.
                  </p>
                  {selectedBrief.share_enabled && selectedBrief.share_token ? (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          readOnly
                          value={`${window.location.origin}/intake/${selectedBrief.share_token}`}
                          className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 focus:outline-none"
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/intake/${selectedBrief.share_token}`);
                            setBriefLinkCopied(true);
                            setTimeout(() => setBriefLinkCopied(false), 2000);
                          }}
                          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors flex items-center gap-2"
                        >
                          <Copy className="w-4 h-4" /> {briefLinkCopied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <button
                        onClick={async () => {
                          setBriefLinkBusy(true);
                          try {
                            const b = await revokeBriefLink(selectedBrief.id);
                            setBriefs(briefs.map(br => br.id === b.id ? b : br));
                          } finally {
                            setBriefLinkBusy(false);
                          }
                        }}
                        disabled={briefLinkBusy}
                        className="text-sm text-red-600 font-medium hover:underline disabled:opacity-50"
                      >
                        Revoke link
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={async () => {
                        setBriefLinkBusy(true);
                        try {
                          const b = await generateBriefLink(selectedBrief.id);
                          setBriefs(briefs.map(br => br.id === b.id ? b : br));
                        } finally {
                          setBriefLinkBusy(false);
                        }
                      }}
                      disabled={briefLinkBusy}
                      className="flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white text-sm rounded-lg font-bold hover:bg-[#2d2c35] transition-colors disabled:opacity-50"
                    >
                      {briefLinkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />} Generate link
                    </button>
                  )}
                </div>
              )}

              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">Linked Research Runs</h3>
                <div className="space-y-3">
                  {allRuns.filter(r => r.client_brief_id === selectedBrief.id).length === 0 ? (
                    <div className="text-gray-500 text-sm">No research runs are currently linked to this brief.</div>
                  ) : (
                    allRuns.filter(r => r.client_brief_id === selectedBrief.id).map(r => (
                      <div
                        key={r.id}
                        onClick={() => onOpenRun?.(r.id)}
                        className="flex justify-between items-center p-3 bg-gray-50 hover:bg-white hover:border-[#a58039] border border-gray-100 rounded-lg cursor-pointer transition-colors group"
                      >
                        <div>
                          <div className="font-bold text-[#403f4c] group-hover:text-[#a58039] transition-colors">{r.client_name}</div>
                          <div className="text-xs text-gray-500 mt-1 flex items-center gap-3">
                            <span className="capitalize">{r.run_type.replace('_', ' ')}</span>
                            <span className="flex items-center gap-1"><Car className="w-3 h-3" /> {r.listing_count || 0}</span>
                            <span>{new Date(r.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 text-xs font-bold rounded uppercase ${
                            r.status === 'active' ? 'bg-green-100 text-green-800' :
                            r.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                            'bg-gray-200 text-gray-700'
                          }`}>
                            {r.status}
                          </span>
                          <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-[#a58039] transition-colors" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : editingClient ? (
          <ClientEditForm
            client={selectedClient}
            onSubmit={handleUpdateClient}
            onCancel={() => setEditingClient(false)}
            isSubmitting={savingClient}
          />
        ) : (
          <>
            <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold text-[#403f4c]">{selectedClient.full_name}</h2>
                <div className="text-sm text-gray-500 mt-1">Client since {new Date(selectedClient.created_at).toLocaleDateString()}</div>
                {(selectedClient.email || selectedClient.phone) && (
                  <div className="text-sm text-gray-500 mt-1">{[selectedClient.email, selectedClient.phone].filter(Boolean).join(' · ')}</div>
                )}
              </div>
              <button onClick={() => setEditingClient(true)} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg font-bold hover:bg-gray-200 transition-colors">
                <Edit2 className="w-4 h-4" /> Edit
              </button>
            </div>

            <div className="p-6 flex justify-between items-center border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                Buying Briefs
              </h3>
              {!showNewBriefForm && !isSelectedBriefEditing && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConfirmingGenerateLink(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm rounded-lg font-bold hover:bg-gray-50"
                  >
                    <LinkIcon className="w-4 h-4 text-[#a58039]" /> Generate intake link
                  </button>
                  <button
                    onClick={() => setShowNewBriefForm(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[#403f4c] text-white text-sm rounded-lg font-bold hover:bg-[#2d2c35]"
                  >
                    <Plus className="w-4 h-4" /> New Brief
                  </button>
                </div>
              )}
            </div>

            {confirmingGenerateLink && (
              // Prompt 18 Phase 3: opening this confirmation must not itself create anything -
              // the brief is created only by the "Generate" click below, never by getting here.
              // Cancelling leaves no trace at all, since nothing has been written yet.
              <div className="mx-6 mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-sm text-gray-700 mb-3">
                  Generate a blank intake link for <b>{selectedClient.full_name}</b>? This creates
                  a new, empty vehicle request they can fill in themselves.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!orgId || !selectedClient) return;
                      setGeneratingIntakeLink(true);
                      try {
                        const b = await createBriefWithIntakeLink(orgId, selectedClient.id);
                        setBriefs([b, ...briefs]);
                        setFreshIntakeLink(b);
                        setFreshLinkCopied(false);
                        setConfirmingGenerateLink(false);
                      } catch (err: any) {
                        alert(err.message);
                      } finally {
                        setGeneratingIntakeLink(false);
                      }
                    }}
                    disabled={generatingIntakeLink}
                    className="flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white text-sm rounded-lg font-bold hover:bg-[#2d2c35] disabled:opacity-50"
                  >
                    {generatingIntakeLink ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Generate
                  </button>
                  <button
                    onClick={() => setConfirmingGenerateLink(false)}
                    disabled={generatingIntakeLink}
                    className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {freshIntakeLink && (
              <div className="mx-6 mt-4 p-4 bg-[#a58039]/5 border border-[#a58039]/30 rounded-lg">
                <div className="flex justify-between items-start mb-2">
                  <p className="text-sm font-bold text-[#403f4c]">Blank intake link ready to send</p>
                  <button onClick={() => setFreshIntakeLink(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/intake/${freshIntakeLink.share_token}`}
                    className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/intake/${freshIntakeLink.share_token}`);
                      setFreshLinkCopied(true);
                      setTimeout(() => setFreshLinkCopied(false), 2000);
                    }}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors flex items-center gap-2"
                  >
                    <Copy className="w-4 h-4" /> {freshLinkCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-6">
              {showNewBriefForm && (
                <BriefForm 
                  onSubmit={handleCreateBrief} 
                  onCancel={() => setShowNewBriefForm(false)} 
                  isSubmitting={creatingBrief} 
                />
              )}

              {isSelectedBriefEditing && selectedBrief && (
                <BriefForm 
                  initialData={selectedBrief}
                  onSubmit={handleUpdateBrief} 
                  onCancel={() => { setEditingBriefId(null); setSelectedBriefId(selectedBrief.id); }} 
                  isSubmitting={creatingBrief} 
                />
              )}

              {briefsLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
              ) : briefs.length === 0 && !showNewBriefForm ? (
                <div className="text-center text-gray-500 py-12">No briefs found for this client.</div>
              ) : !showNewBriefForm && !isSelectedBriefEditing && (
                <div className="space-y-4">
                  {briefs.map(b => (
                    <div key={b.id} onClick={() => setSelectedBriefId(b.id)} className="bg-white border border-gray-200 hover:border-[#a58039] rounded-lg p-5 shadow-sm cursor-pointer transition-colors group">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h4 className="font-bold text-gray-900 text-lg group-hover:text-[#a58039] transition-colors flex items-center gap-2">
                            {b.year_min || 'Any'}-{b.year_max || 'Any'} {b.make || 'Any Make'} {b.model || 'Any Model'}
                            {b.status === 'pending_review' && (
                              <span className="bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">Pending review</span>
                            )}
                          </h4>
                          <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                            Created {new Date(b.created_at).toLocaleDateString()}
                            <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">{allRuns.filter(r => r.client_brief_id === b.id).length} Runs</span>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-[#a58039] transition-colors" />
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                        <div>
                          <div className="text-xs text-gray-500">Condition</div>
                          <div className="text-sm font-medium capitalize">{val(b.condition_required === 'run_and_drive' ? 'Run & Drive' : b.condition_required)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Max Mileage</div>
                          <div className="text-sm font-medium">{b.max_mileage ? `${b.max_mileage.toLocaleString()} mi` : 'Any'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Transmission</div>
                          <div className="text-sm font-medium capitalize">{val(b.transmission)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Titles</div>
                          <div className="text-sm font-medium capitalize">{b.titles_accepted?.length ? b.titles_accepted.join(', ') : 'Any'}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </div>
          </>
        )}
      </div>

      {/* Soft Delete Confirmation Modal */}
      {showDeleteModal && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              Delete {deleteTarget.type === 'client' ? 'Client' : 'Buying Brief'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              This will softly delete the {deleteTarget.type}. The record is retained in the database but hidden from the UI.
              {deleteTarget.type === 'client' && ' Active runs and briefs will BLOCK this action.'}
              {deleteTarget.type === 'brief' && ' Active research runs using this brief will NOT be broken.'}
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type <strong>{deleteTarget.name}</strong> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmName}
                onChange={e => setDeleteConfirmName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                placeholder={deleteTarget.name}
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
                onClick={handleDelete}
                disabled={deleteConfirmName !== deleteTarget.name || deleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientsList;

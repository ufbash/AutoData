import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  listCostRates,
  addCostRate,
  supersedeCostRate,
  CostRate,
  CostCategory,
  CostRateBasis,
  CostRateUnit,
  CostRateSource,
  NewCostRateInput,
} from '../services/costRatesService';
import { Loader2, Plus, RefreshCw, History } from 'lucide-react';

const CATEGORY_LABELS: Record<CostCategory, string> = {
  inland_trucking: 'US Inland Trucking',
  ocean_freight: 'Ocean Freight',
  duty_component: 'Duty Component',
  service_fee: 'Service Fee',
};

const BASIS_LABELS: Record<CostRateBasis, string> = {
  cif: 'CIF',
  cif_plus_prior: 'CIF + prior components',
  import_duty: 'Import Duty line',
};

const SOURCE_LABELS: Record<CostRateSource, string> = {
  official_tariff: 'Official tariff',
  agent_quote: 'Agent quote',
  actual_paid: 'Actual paid',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): NewCostRateInput => ({
  cost_category: 'inland_trucking',
  label: '',
  basis: null,
  rate_unit: 'usd',
  rate_value: 0,
  rate_value_max: null,
  source: 'agent_quote',
  effective_from: todayIso(),
});

interface RateFormProps {
  initial: NewCostRateInput;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (input: NewCostRateInput) => Promise<void>;
}

// Shared by both "Add a rate" and "Supersede" - a supersede is nothing more than this same
// form pre-filled, submitted through supersedeCostRate instead of addCostRate. No separate
// edit-in-place path exists anywhere in this component, by design.
const RateForm: React.FC<RateFormProps> = ({ initial, submitLabel, onCancel, onSubmit }) => {
  const [form, setForm] = useState<NewCostRateInput>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.label.trim()) {
      setError('Label is required.');
      return;
    }
    if (!form.effective_from) {
      setError('Effective-from date is required.');
      return;
    }
    if (!(form.rate_value >= 0)) {
      setError('Rate value must be a number.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err: any) {
      setError(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cost category</label>
          <select
            value={form.cost_category}
            onChange={e => {
              const cost_category = e.target.value as CostCategory;
              setForm(f => ({ ...f, cost_category, basis: cost_category === 'duty_component' ? f.basis : null }));
            }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            {(Object.keys(CATEGORY_LABELS) as CostCategory[]).map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
          <input
            type="text"
            value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
            placeholder="e.g. Tier 1 (FL, MA, RI, NJ, MD, CT, DE), RoRo, Import Duty..."
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>

        {form.cost_category === 'duty_component' && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Basis</label>
            <select
              value={form.basis ?? ''}
              onChange={e => setForm(f => ({ ...f, basis: (e.target.value || null) as CostRateBasis | null }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              <option value="">Select basis...</option>
              {(Object.keys(BASIS_LABELS) as CostRateBasis[]).map(b => (
                <option key={b} value={b}>{BASIS_LABELS[b]}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Rate unit</label>
          <select
            value={form.rate_unit}
            onChange={e => setForm(f => ({ ...f, rate_unit: e.target.value as CostRateUnit }))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="usd">USD</option>
            <option value="percent">Percent</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Rate value {form.rate_unit === 'percent' ? '(%)' : '($)'}
          </label>
          <input
            type="number"
            step="0.01"
            value={form.rate_value}
            onChange={e => setForm(f => ({ ...f, rate_value: parseFloat(e.target.value) || 0 }))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Rate value max <span className="text-gray-400">(optional — for a range)</span>
          </label>
          <input
            type="number"
            step="0.01"
            value={form.rate_value_max ?? ''}
            onChange={e => setForm(f => ({ ...f, rate_value_max: e.target.value === '' ? null : parseFloat(e.target.value) }))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
          <select
            value={form.source}
            onChange={e => setForm(f => ({ ...f, source: e.target.value as CostRateSource }))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            {(Object.keys(SOURCE_LABELS) as CostRateSource[]).map(s => (
              <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Effective from</label>
          <input
            type="date"
            value={form.effective_from}
            onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-[#a58039] text-white text-sm font-bold rounded-lg hover:bg-[#8e6e31] disabled:opacity-50"
        >
          {saving ? 'Saving...' : submitLabel}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-bold rounded-lg hover:bg-gray-200 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

const CostRatesAdmin: React.FC = () => {
  const { orgId, user, role } = useAuth();
  const [rates, setRates] = useState<CostRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [supersedingId, setSupersedingId] = useState<string | null>(null);

  const load = async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      setRates(await listCostRates(orgId));
    } catch (err: any) {
      setError(err.message || 'Failed to load cost rates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [orgId]);

  if (role !== 'superadmin') {
    return (
      <div className="bg-white p-8 rounded-xl shadow-sm border border-[#ba3b46]/20 text-center">
        <h2 className="text-xl font-bold text-[#403f4c] mb-2">Access Restricted</h2>
        <p className="text-gray-500">Cost rates are platform data — only a superadmin may manage them (PROJECT_CHARTER.md §3).</p>
      </div>
    );
  }

  const current = rates.filter(r => !r.effective_to);
  const superseded = rates
    .filter(r => r.effective_to)
    .sort((a, b) => (b.effective_to! < a.effective_to! ? -1 : 1));

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#403f4c]">Cost Rates</h1>
          <p className="text-sm text-gray-500 mt-1">
            US inland trucking, ocean freight, duty components, and the service fee — dated, never edited in place.
            No landed-cost calculation reads these yet (blocked on 10+ assessment notices, see PLAN_TRACKER.md C2).
          </p>
        </div>
        <button
          onClick={() => { setShowAddForm(v => !v); setSupersedingId(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-[#403f4c] text-white text-sm font-bold rounded-lg hover:bg-[#2d2c35]"
        >
          <Plus className="w-4 h-4" /> Add a Rate
        </button>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      {showAddForm && (
        <div className="mb-6">
          <RateForm
            initial={emptyForm()}
            submitLabel="Add Rate"
            onCancel={() => setShowAddForm(false)}
            onSubmit={async (input) => {
              if (!orgId || !user?.id) throw new Error('Not authenticated.');
              await addCostRate(orgId, user.id, input);
              setShowAddForm(false);
              await load();
            }}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-[#a58039] animate-spin" />
        </div>
      ) : (
        <>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Current Rates ({current.length})</h2>
          {current.length === 0 ? (
            <p className="text-gray-400 italic mb-8">No rates entered yet. This is expected — no rates are seeded; enter real figures as they become known.</p>
          ) : (
            <div className="space-y-2 mb-8">
              {current.map(rate => (
                <div key={rate.id} className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold uppercase tracking-wide px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-100 rounded">
                          {CATEGORY_LABELS[rate.cost_category]}
                        </span>
                        {rate.basis && (
                          <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded">
                            Basis: {BASIS_LABELS[rate.basis]}
                          </span>
                        )}
                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                          {SOURCE_LABELS[rate.source]}
                        </span>
                      </div>
                      <div className="mt-1 font-bold text-[#403f4c]">{rate.label}</div>
                      <div className="text-sm text-gray-600">
                        {rate.rate_unit === 'percent' ? `${rate.rate_value}%` : `$${rate.rate_value.toLocaleString()}`}
                        {rate.rate_value_max != null && (
                          rate.rate_unit === 'percent'
                            ? ` – ${rate.rate_value_max}%`
                            : ` – $${rate.rate_value_max.toLocaleString()}`
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Effective from {rate.effective_from}</div>
                    </div>
                    <button
                      onClick={() => { setSupersedingId(rate.id); setShowAddForm(false); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-[#a58039] border border-[#a58039]/40 rounded-lg hover:bg-[#a58039]/10 whitespace-nowrap"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Supersede
                    </button>
                  </div>

                  {supersedingId === rate.id && (
                    <div className="mt-3">
                      <RateForm
                        initial={{
                          cost_category: rate.cost_category,
                          label: rate.label,
                          basis: rate.basis,
                          rate_unit: rate.rate_unit,
                          rate_value: rate.rate_value,
                          rate_value_max: rate.rate_value_max,
                          source: rate.source,
                          effective_from: todayIso(),
                        }}
                        submitLabel="Supersede Rate"
                        onCancel={() => setSupersedingId(null)}
                        onSubmit={async (input) => {
                          if (!orgId || !user?.id) throw new Error('Not authenticated.');
                          await supersedeCostRate(orgId, user.id, rate.id, rate.effective_from, input);
                          setSupersedingId(null);
                          await load();
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {superseded.length > 0 && (
            <>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                <History className="w-4 h-4" /> History — Superseded Rates ({superseded.length})
              </h2>
              <div className="space-y-2 opacity-70">
                {superseded.map(rate => (
                  <div key={rate.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold uppercase tracking-wide px-2 py-0.5 bg-gray-200 text-gray-600 rounded">
                        {CATEGORY_LABELS[rate.cost_category]}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-500 rounded">Superseded</span>
                    </div>
                    <div className="mt-1 font-medium text-gray-600">{rate.label}</div>
                    <div className="text-sm text-gray-500">
                      {rate.rate_unit === 'percent' ? `${rate.rate_value}%` : `$${rate.rate_value.toLocaleString()}`}
                      {rate.rate_value_max != null && (
                        rate.rate_unit === 'percent' ? ` – ${rate.rate_value_max}%` : ` – $${rate.rate_value_max.toLocaleString()}`
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {rate.effective_from} → {rate.effective_to}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default CostRatesAdmin;

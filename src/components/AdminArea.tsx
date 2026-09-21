import React, { useState } from 'react';
import { DollarSign, Truck, Receipt, FileText, GitMerge } from 'lucide-react';
import CostRatesAdmin from './CostRatesAdmin';
import TruckingRatesLookup from './TruckingRatesLookup';
import FeeSchedulesAdmin from './FeeSchedulesAdmin';
import CostDocumentExtractions from './CostDocumentExtractions';
import AssetMergeReview from './AssetMergeReview';

// PROMPT 37 Phase 1 - ONE admin entry with two kinds of screen, grouped by what they are:
//   Rates          - reference data the cost calculations read (cost rates, trucking rates, fee schedules).
//   Review queues  - human gates on incoming data: something arrives, a human confirms or rejects, the
//                    decision is recorded (document extraction, asset merges).
// Superadmin only; App.tsx gates the whole area once, and the server-side gates on each function are unchanged.

type Section = 'cost-rates' | 'trucking-rates' | 'fee-schedules' | 'extractions' | 'merges';

const GROUPS: { title: string; items: { key: Section; label: string; icon: React.ReactNode }[] }[] = [
  {
    title: 'Rates',
    items: [
      { key: 'cost-rates', label: 'Cost Rates', icon: <DollarSign className="w-4 h-4" /> },
      { key: 'trucking-rates', label: 'Trucking Rates', icon: <Truck className="w-4 h-4" /> },
      { key: 'fee-schedules', label: 'Fee schedules and accounts', icon: <Receipt className="w-4 h-4" /> },
    ],
  },
  {
    title: 'Review queues',
    items: [
      { key: 'extractions', label: 'Document Extraction', icon: <FileText className="w-4 h-4" /> },
      { key: 'merges', label: 'Asset Merges', icon: <GitMerge className="w-4 h-4" /> },
    ],
  },
];

const STORAGE_KEY = 'autodata.adminSection';
const isSection = (v: unknown): v is Section => GROUPS.some(g => g.items.some(i => i.key === v));
const readRemembered = (): Section => {
  try { const v = localStorage.getItem(STORAGE_KEY); if (isSection(v)) return v; } catch { /* storage unavailable: fine */ }
  return 'cost-rates';
};

const AdminArea: React.FC = () => {
  const [section, setSection] = useState<Section>(readRemembered);
  const choose = (s: Section) => {
    setSection(s);
    try { localStorage.setItem(STORAGE_KEY, s); } catch { /* not required */ }
  };

  return (
    <div className="flex flex-col md:flex-row gap-6" data-testid="admin-area">
      <nav className="md:w-56 flex-shrink-0" aria-label="Admin sections">
        {GROUPS.map(g => (
          <div key={g.title} className="mb-5" data-testid={`admin-group-${g.title.toLowerCase().replace(/\s+/g, '-')}`}>
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5 px-2">{g.title}</div>
            {g.items.map(i => (
              <button
                key={i.key}
                onClick={() => choose(i.key)}
                aria-current={section === i.key ? 'page' : undefined}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-left mb-0.5 transition-all ${section === i.key ? 'bg-[#a58039] text-[#F0EDDE] shadow-sm' : 'text-[#403f4c] hover:text-[#a58039] hover:bg-[#F0EDDE]'}`}
                data-testid={`admin-nav-${i.key}`}
              >
                {i.icon} {i.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex-1 min-w-0">
        {section === 'cost-rates' && <CostRatesAdmin />}
        {section === 'trucking-rates' && <TruckingRatesLookup />}
        {section === 'fee-schedules' && <FeeSchedulesAdmin />}
        {section === 'extractions' && <CostDocumentExtractions />}
        {section === 'merges' && <AssetMergeReview />}
      </div>
    </div>
  );
};

export default AdminArea;

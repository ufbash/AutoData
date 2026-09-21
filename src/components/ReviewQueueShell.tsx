import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

// PROMPT 37 Phase 1 - the shared frame for the admin "review queues" (Document Extraction, Asset Merges):
// something arrives, a human confirms or rejects, the decision is recorded. Both queues get the same
// header, the same status tabs with counts, the same refresh, error and empty states, so they look and
// behave alike. The queue supplies its own rows and its own confirm/reject actions; the shell owns none of
// the data and none of the decisions.

export interface QueueTab {
  key: string;
  label: string;
  count: number | null;
}

const ReviewQueueShell: React.FC<{
  title: string;
  description: React.ReactNode;
  tabs: QueueTab[];
  activeTab: string;
  onTab: (key: string) => void;
  onRefresh: () => void;
  loading: boolean;
  error: string | null;
  headerExtra?: React.ReactNode; // e.g. an upload panel that belongs above the tabs
  empty: string;                 // shown when the active tab has no rows
  isEmpty: boolean;
  children: React.ReactNode;
  testId?: string;
}> = ({ title, description, tabs, activeTab, onTab, onRefresh, loading, error, headerExtra, empty, isEmpty, children, testId }) => (
  <div className="max-w-6xl mx-auto" data-testid={testId}>
    <div className="flex items-start justify-between mb-5 gap-4">
      <div>
        <h1 className="text-2xl font-bold text-[#403f4c]">{title}</h1>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      </div>
      <button onClick={onRefresh} disabled={loading} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 flex-shrink-0">
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
      </button>
    </div>

    {headerExtra}

    {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3" data-testid="queue-error">{error}</div>}

    <div className="flex gap-2 mb-4" role="tablist">
      {tabs.map(t => (
        <button
          key={t.key}
          role="tab"
          aria-selected={activeTab === t.key}
          onClick={() => onTab(t.key)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${activeTab === t.key ? 'bg-[#a58039] text-white' : 'bg-gray-100 text-gray-600'}`}
          data-testid={`queue-tab-${t.key}`}
        >
          {t.label}{t.count !== null ? ` (${t.count})` : ''}
        </button>
      ))}
    </div>

    {loading && isEmpty ? (
      <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-[#a58039] animate-spin" /></div>
    ) : isEmpty ? (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">{empty}</div>
    ) : (
      children
    )}
  </div>
);

export default ReviewQueueShell;

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { useBillingChangeCounter } from '../utils/billingEvents';

// PROMPT 41 Stage 4 - the account position, per currency, read straight from client_account_status (migration
// 079) - derived, never stored, so it can never disagree with an invoice's own balance by construction.

interface Row {
  currency: string; total_invoiced: number; total_paid: number; total_credited: number;
  outstanding: number; overdue: number; unapplied_credit: number;
  status: 'settled' | 'outstanding' | 'overdue' | 'in_credit';
}

const money = (n: number, currency: string) => `${currency.toUpperCase() === 'USD' ? '$' : currency.toUpperCase() === 'NGN' ? '₦' : currency.toUpperCase() + ' '}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_STYLE: Record<Row['status'], { label: string; cls: string }> = {
  settled: { label: 'Settled', cls: 'bg-gray-100 text-gray-600' },
  outstanding: { label: 'Outstanding', cls: 'bg-amber-100 text-amber-700' },
  overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-700' },
  in_credit: { label: 'In credit', cls: 'bg-green-100 text-green-700' },
};

const ClientAccountStatusSummary: React.FC<{ clientId: string }> = ({ clientId }) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const billingTick = useBillingChangeCounter();

  useEffect(() => {
    let cancelled = false;
    supabase.from('client_account_status').select('*').eq('client_id', clientId)
      .then(({ data, error }) => { if (cancelled) return; if (error) setErr(error.message); else setRows((data ?? []) as Row[]); });
    return () => { cancelled = true; };
  }, [clientId, billingTick]);

  if (err) return <p className="text-xs text-red-600">{err}</p>;
  if (!rows) return <Loader2 className="w-4 h-4 animate-spin text-[#a58039]" />;
  if (rows.length === 0) return <p className="text-xs text-gray-400">No invoices yet.</p>;

  return (
    <div className="flex flex-wrap gap-3">
      {rows.map(r => {
        const s = STATUS_STYLE[r.status];
        return (
          <div key={r.currency} data-testid={`acct-${r.currency.toUpperCase()}`} className="border border-gray-200 rounded-lg p-3 min-w-[13rem]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-gray-500">{r.currency.toUpperCase()}</span>
              <span data-testid="acct-status" className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
            </div>
            <div data-testid="acct-outstanding" className="text-lg font-bold text-[#403f4c]">{money(r.outstanding, r.currency)}</div>
            <div className="text-[10px] text-gray-400">outstanding{r.overdue > 0 && <span data-testid="acct-overdue" className="text-red-600 font-semibold"> · {money(r.overdue, r.currency)} overdue</span>}</div>
            {r.unapplied_credit > 0 && <div data-testid="acct-credit" className="text-[10px] text-green-700 mt-0.5">{money(r.unapplied_credit, r.currency)} unapplied credit</div>}
            <div className="text-[10px] text-gray-400 mt-1">Invoiced {money(r.total_invoiced, r.currency)} · Paid {money(r.total_paid, r.currency)} · Credited {money(r.total_credited, r.currency)}</div>
          </div>
        );
      })}
    </div>
  );
};

export default ClientAccountStatusSummary;

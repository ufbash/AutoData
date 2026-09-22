import React, { useEffect, useState } from 'react';
import { Loader2, Car, FileText, Receipt as ReceiptIcon, CheckCircle2, Circle, LogOut, Download } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getMyClientRecord, listMyBriefs, listMySharedRuns, listMyWonVehicles, listMyStatusHistory, listMyDocuments,
  getMyDocumentUrl, listMyBillingDocs, listMyBillingLines, getMyBalance, listMyReceipts, getMyReceiptUrl,
  STATUS_LABELS, STATUS_SEQUENCE,
} from '../services/clientPortalService';
import type {
  MyClientRecord, MyBrief, MySharedRun, MyWonVehicle, MyStatusEvent, MyDocument, MyBillingDoc, MyBillingLine, MyBalance, MyReceipt,
} from '../services/clientPortalService';

// PROMPT 39 Stage 4 - the client's first (and only) view. Everything here reads through the client's own RLS policies
// (clientPortalService.ts) - this component adds no filtering of its own, and it renders no field that service doesn't
// return. Nothing here ever calls a staff Edge Function or reads a staff-only table; the honesty doctrine that governs
// every invoice (PROJECT_CHARTER, DECISIONS 19) applies to what a client sees just as much as to what staff issue.

const money = (n: number, currency: string) => `${currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : currency + ' '}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ddmmyyyy = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '—');

const Section: React.FC<{ title: string; children: React.ReactNode; icon?: React.ReactNode }> = ({ title, children, icon }) => (
  <div className="bg-white rounded-xl shadow-sm border border-[#e8e2d0] p-5 mb-5">
    <h2 className="text-sm font-semibold text-[#5c4a2f] mb-3 flex items-center gap-2">{icon}{title}</h2>
    {children}
  </div>
);

const StatusLadder: React.FC<{ vehicleId: string; history: MyStatusEvent[] }> = ({ history }) => {
  const reached = new Set(history.map(h => h.status));
  const currentIdx = history.length ? STATUS_SEQUENCE.indexOf(history[history.length - 1].status) : -1;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {STATUS_SEQUENCE.map((s, i) => {
        const ev = history.find(h => h.status === s);
        const done = reached.has(s);
        return (
          <div key={s} className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${done ? 'bg-[#a58039]/10 border-[#a58039] text-[#5c4a2f]' : 'border-[#e8e2d0] text-[#9a9184]'}`}>
            {done ? <CheckCircle2 className="w-3.5 h-3.5 text-[#a58039]" /> : <Circle className="w-3.5 h-3.5" />}
            <span>{STATUS_LABELS[s]}</span>
            {ev && <span className="text-[10px] text-[#9a9184]">{ddmmyyyy(ev.changed_at)}</span>}
          </div>
        );
      })}
      {currentIdx < 0 && <span className="text-xs text-[#9a9184]">No status recorded yet</span>}
    </div>
  );
};

const VehicleCard: React.FC<{ v: MyWonVehicle }> = ({ v }) => {
  const [history, setHistory] = useState<MyStatusEvent[]>([]);
  const [docs, setDocs] = useState<MyDocument[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const snap = (v.won_snapshot ?? {}) as Record<string, unknown>;
  const title = [snap.year, snap.make, snap.model, snap.trim].filter(Boolean).join(' ') || 'Vehicle';

  useEffect(() => {
    void (async () => {
      try {
        const [h, d] = await Promise.all([listMyStatusHistory(v.id), listMyDocuments(v.id)]);
        setHistory(h); setDocs(d);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [v.id]);

  const download = async (docId: string) => {
    setBusy(docId); setErr(null);
    try { const url = await getMyDocumentUrl(docId); window.open(url, '_blank', 'noopener'); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <div className="border border-[#e8e2d0] rounded-lg p-4 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <Car className="w-4 h-4 text-[#a58039]" />
        <span className="font-medium text-[#3d3a37]">{title}</span>
        {snap.vin ? <span className="text-xs text-[#9a9184]">VIN {snap.vin as string}</span> : null}
      </div>
      <StatusLadder vehicleId={v.id} history={history} />
      {docs.length > 0 && (
        <div className="mt-3 space-y-1">
          {docs.map(d => (
            <button key={d.id} onClick={() => download(d.id)} disabled={busy === d.id}
              className="flex items-center gap-2 text-xs text-[#5c4a2f] hover:text-[#a58039] disabled:opacity-50">
              {busy === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              {d.original_filename} <span className="text-[#9a9184]">({d.document_type.replace(/_/g, ' ')})</span>
            </button>
          ))}
        </div>
      )}
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  );
};

const InvoiceCard: React.FC<{ doc: MyBillingDoc }> = ({ doc }) => {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<MyBillingLine[] | null>(null);
  const [balance, setBalance] = useState<MyBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open; setOpen(next);
    if (next && lines === null) {
      setLoading(true); setErr(null);
      try {
        const [l, b] = await Promise.all([listMyBillingLines(doc.id), doc.doc_type === 'credit_note' ? Promise.resolve(null) : getMyBalance(doc.id)]);
        setLines(l); setBalance(b);
      } catch (e) { setErr((e as Error).message); }
      finally { setLoading(false); }
    }
  };

  const kindLabel = doc.doc_type === 'invoice' ? (doc.invoice_kind === 'retail' ? 'Invoice' : doc.invoice_kind === 'repair' ? 'Repair invoice' : 'Invoice')
    : doc.doc_type === 'retainer' ? 'Retainer invoice' : 'Credit note';

  return (
    <div className="border border-[#e8e2d0] rounded-lg mb-2 overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#f7f4ea]">
        <div>
          <div className="text-sm font-medium text-[#3d3a37]">{doc.number_text} <span className="text-xs text-[#9a9184] font-normal">{kindLabel}</span></div>
          <div className="text-xs text-[#9a9184]">{ddmmyyyy(doc.issue_date)}{doc.voided_at ? ' · voided' : ''}</div>
        </div>
        <div className="text-sm font-semibold text-[#5c4a2f]">{money(doc.total, doc.currency)}</div>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-[#e8e2d0] pt-3">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-[#a58039]" />}
          {err && <p className="text-xs text-red-600">{err}</p>}
          {lines && lines.map(l => (
            <div key={l.position} className="flex justify-between text-xs text-[#5c4a2f] py-0.5">
              <span>{l.description}</span>
              <span>{money(l.net_amount, doc.currency)}</span>
            </div>
          ))}
          {doc.scope_statement && (
            <p className="text-xs text-[#9a9184] italic mt-2 border-t border-dashed border-[#e8e2d0] pt-2">
              <strong className="not-italic">Scope: </strong>{doc.scope_statement}
            </p>
          )}
          {doc.settlement_currency !== doc.currency && doc.fx_rate && (
            <p className="text-xs text-[#9a9184] mt-1">1 {doc.currency} = {doc.fx_rate.toLocaleString('en-US', { maximumFractionDigits: 4 })} {doc.settlement_currency}</p>
          )}
          {!doc.voided_at && balance && doc.doc_type !== 'credit_note' && (
            <div className="flex justify-between text-sm font-semibold text-[#3d3a37] mt-2 border-t border-[#e8e2d0] pt-2">
              <span>Balance outstanding</span>
              <span>{money(balance.outstanding, doc.currency)}{balance.outstanding_settlement !== null ? ` (${money(balance.outstanding_settlement, doc.settlement_currency)})` : ''}</span>
            </div>
          )}
          {doc.voided_at && <p className="text-xs text-[#9a9184] italic">This document was voided; it does not carry a balance.</p>}
        </div>
      )}
    </div>
  );
};

const ReceiptRow: React.FC<{ r: MyReceipt }> = ({ r }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const download = async () => {
    if (!r.file_id) return;
    setBusy(true); setErr(null);
    try { const url = await getMyReceiptUrl(r.file_id); window.open(url, '_blank', 'noopener'); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex items-center justify-between text-sm py-1.5 border-b border-[#f0ece0] last:border-0">
      <span className="text-[#3d3a37]">{r.receipt_number}{r.voided_at ? ' (voided)' : ''}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-[#9a9184]">{ddmmyyyy(r.issued_at)}</span>
        {r.file_id && (
          <button onClick={download} disabled={busy} className="text-[#a58039] hover:text-[#8a6a2f] disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
};

const ClientDashboard: React.FC = () => {
  const { signOut } = useAuth();
  const [me, setMe] = useState<MyClientRecord | null>(null);
  const [briefs, setBriefs] = useState<MyBrief[]>([]);
  const [runs, setRuns] = useState<MySharedRun[]>([]);
  const [vehicles, setVehicles] = useState<MyWonVehicle[]>([]);
  const [docs, setDocs] = useState<MyBillingDoc[]>([]);
  const [receipts, setReceipts] = useState<MyReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [rec, b, r, v, d, rec2] = await Promise.all([
          getMyClientRecord(), listMyBriefs(), listMySharedRuns(), listMyWonVehicles(), listMyBillingDocs(), listMyReceipts(),
        ]);
        setMe(rec); setBriefs(b); setRuns(r); setVehicles(v); setDocs(d); setReceipts(rec2);
      } catch (e) { setError((e as Error).message); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) {
    return <div className="min-h-screen bg-[#F0EDDE] flex items-center justify-center"><Loader2 className="w-8 h-8 text-[#a58039] animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#F0EDDE]">
      <div className="bg-white border-b border-[#e8e2d0] px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-[#3d3a37]">{me?.full_name ?? 'Your account'}</div>
          <div className="text-xs text-[#9a9184]">{me?.email ?? ''}</div>
        </div>
        <button onClick={() => void signOut()} className="flex items-center gap-1.5 text-sm text-[#5c4a2f] hover:text-[#a58039]">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
      <div className="max-w-3xl mx-auto p-5">
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {briefs.length > 0 && (
          <Section title="Your briefs">
            {briefs.map(b => (
              <div key={b.id} className="flex justify-between text-sm py-1.5 border-b border-[#f0ece0] last:border-0">
                <span className="text-[#3d3a37]">{[b.make, b.model].filter(Boolean).join(' ') || 'Vehicle brief'} {b.year_min ? `(${b.year_min}${b.year_max && b.year_max !== b.year_min ? `–${b.year_max}` : ''})` : ''}</span>
                <span className="text-xs text-[#9a9184] capitalize">{b.status.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </Section>
        )}

        {runs.length > 0 && (
          <Section title="Research shared with you">
            {runs.map(r => (
              <div key={r.id} className="flex justify-between text-sm py-1.5 border-b border-[#f0ece0] last:border-0">
                <span className="text-[#3d3a37]">{r.target_spec || 'Research run'}</span>
                <span className="text-xs text-[#9a9184] capitalize">{r.status.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </Section>
        )}

        <Section title="Your vehicles" icon={<Car className="w-4 h-4" />}>
          {vehicles.length === 0 && <p className="text-sm text-[#9a9184]">No vehicles yet.</p>}
          {vehicles.map(v => <VehicleCard key={v.id} v={v} />)}
        </Section>

        <Section title="Invoices" icon={<FileText className="w-4 h-4" />}>
          {docs.length === 0 && <p className="text-sm text-[#9a9184]">No invoices yet.</p>}
          {docs.map(d => <InvoiceCard key={d.id} doc={d} />)}
        </Section>

        {receipts.length > 0 && (
          <Section title="Receipts" icon={<ReceiptIcon className="w-4 h-4" />}>
            {receipts.map(r => <ReceiptRow key={r.id} r={r} />)}
          </Section>
        )}
      </div>
    </div>
  );
};

export default ClientDashboard;

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, FileText, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import {
  WonVehicle, WonVehicleContext, WinningBid, WonVehicleDestination,
  listWonVehicleDocuments, getWonVehicleDocumentUrl, voidInvoiceIssuance,
} from '../services/wonVehicleService';
import {
  BillingSnapshot, GeneratedInvoice, InvoiceLineRow, PrefillItem,
  loadBilling, listInvoiceLines, computeInvoicePrefill, issueInvoice, recordPayment, voidPayment, issueReceipt, voidReceipt,
} from '../services/wonVehicleBillingService';
import { deriveInvoice, KIND_LABEL } from '../../supabase/functions/_shared/invoiceRules';
import type { Hat, InvoiceCurrency, LineInput, ExcludedInput, RequiredKind } from '../../supabase/functions/_shared/invoiceRules';

// PROMPT 37 Phase 2 - billing for one won vehicle: numbered line-item invoices, payments, receipts. Staff-only.
// The builder pre-fills a line ONLY from a component that computes for real; everything else must be given a real figure
// (with what it rests on) or be EXCLUDED with a reason - and an invoice with an exclusion says so on its face.

const money = (n: number, cur: string) => `${cur} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

type Choice = 'line' | 'excluded';
interface Row { kind: RequiredKind; choice: Choice; amount: string; basis: string; reason: string; computed: boolean; sourceRef: string | null; description: string }

const rowsFromPrefill = (items: PrefillItem[]): Row[] => items.map(i => ({
  kind: i.kind, description: i.description, computed: i.state === 'real', sourceRef: i.sourceRef,
  choice: i.state === 'real' ? 'line' : 'excluded',
  amount: i.state === 'real' && i.amountUsd !== null ? String(i.amountUsd) : '',
  basis: '', reason: i.reason ?? '',
}));

const Builder: React.FC<{
  wonVehicle: WonVehicle; context: WonVehicleContext; winningBid: WinningBid | null; destination: WonVehicleDestination | null; onIssued: () => void;
}> = ({ wonVehicle, context, winningBid, destination, onIssued }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [hat, setHat] = useState<Hat>('brokerage');
  const [currency, setCurrency] = useState<InvoiceCurrency>('USD');
  const [recipient, setRecipient] = useState('');
  const [notes, setNotes] = useState('');
  const [retailPrice, setRetailPrice] = useState('');
  const [retailBasis, setRetailBasis] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());

  const start = async () => {
    setOpen(true); setLoading(true); setError(null);
    try { setRows(rowsFromPrefill(await computeInvoicePrefill(wonVehicle, context, winningBid, destination))); }
    catch (e: any) { setError(e?.message || 'Could not work out what can be pre-filled.'); }
    finally { setLoading(false); }
  };

  const update = (kind: RequiredKind, patch: Partial<Row>) => setRows(rs => rs.map(r => r.kind === kind ? { ...r, ...patch } : r));

  const { lines, excluded } = useMemo(() => {
    const ls: LineInput[] = []; const ex: ExcludedInput[] = [];
    if (hat === 'brokerage') {
      for (const r of rows) {
        if (r.choice === 'line') ls.push({ kind: r.kind, description: r.description, amount_usd: Number(r.amount), origin: r.computed ? 'computed' : 'staff_entered', basis: r.computed ? null : r.basis, source_ref: r.sourceRef });
        else ex.push({ kind: r.kind, reason: r.reason });
      }
    } else {
      ls.push({ kind: 'all_inclusive_price', description: 'Vehicle supplied, all-inclusive', amount_usd: Number(retailPrice), origin: 'staff_entered', basis: retailBasis });
      // the real components are kept as INTERNAL cost lines - stored, never shown to the client
      for (const r of rows) if (r.choice === 'line' && r.computed) ls.push({ kind: r.kind, description: r.description, amount_usd: Number(r.amount), origin: 'computed', client_visible: false, source_ref: r.sourceRef });
    }
    return { lines: ls, excluded: ex };
  }, [rows, hat, retailPrice, retailBasis]);

  const derived = useMemo(() => (rows.length ? deriveInvoice({ hat, currency, lines, excluded }) : null), [rows, hat, currency, lines, excluded]);

  const issue = async () => {
    setBusy(true); setError(null);
    try {
      await issueInvoice({ wonVehicleId: wonVehicle.id, hat, currency, lines, excluded, recipient, notes: notes || undefined, idempotencyKey: key });
      setKey(crypto.randomUUID()); setOpen(false); setRows([]); setRetailPrice(''); setRetailBasis(''); setNotes('');
      onIssued();
    } catch (e: any) { setError(e?.message || 'The invoice could not be issued.'); }
    finally { setBusy(false); }
  };

  if (!open) return <button onClick={start} className="px-3 py-1.5 bg-[#403f4c] text-white text-xs font-bold rounded" data-testid="new-invoice">New invoice</button>;

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-3" data-testid="invoice-builder">
      {loading ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div> : (<>
        <div className="flex flex-wrap gap-3 text-xs">
          <label>Issued under
            <select value={hat} onChange={e => setHat(e.target.value as Hat)} className="ml-1 border border-gray-300 rounded px-2 py-1" data-testid="hat">
              <option value="brokerage">Brokerage - costs itemised, our fee disclosed</option>
              <option value="retail">Retail - one all-inclusive price</option>
            </select>
          </label>
          <label>Currency
            <select value={currency} onChange={e => setCurrency(e.target.value as InvoiceCurrency)} className="ml-1 border border-gray-300 rounded px-2 py-1" data-testid="currency">
              <option value="USD">USD</option><option value="NGN">NGN (rate fixed at issue)</option>
            </select>
          </label>
          <label className="flex-1 min-w-[12rem]">Issued to
            <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Client name / contact" className="ml-1 border border-gray-300 rounded px-2 py-1 w-full" data-testid="recipient" />
          </label>
        </div>

        {hat === 'retail' && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label>All-inclusive price (USD)<input value={retailPrice} onChange={e => setRetailPrice(e.target.value)} className="mt-1 border border-gray-300 rounded px-2 py-1 w-full" data-testid="retail-price" /></label>
            <label>What the price rests on<input value={retailBasis} onChange={e => setRetailBasis(e.target.value)} className="mt-1 border border-gray-300 rounded px-2 py-1 w-full" /></label>
            <div className="col-span-2 text-[11px] text-gray-500">Only this price is shown on a retail invoice. The real costs below are stored as internal lines and never printed.</div>
          </div>
        )}

        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.kind} className="bg-white border border-gray-200 rounded p-2 text-xs" data-testid={`row-${r.kind}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-[#403f4c]">{KIND_LABEL[r.kind]}
                  {r.computed && <span className="ml-2 text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">real figure</span>}
                </div>
                <div className="flex gap-2">
                  <label><input type="radio" checked={r.choice === 'line'} onChange={() => update(r.kind, { choice: 'line' })} /> line</label>
                  {hat === 'brokerage' && <label><input type="radio" checked={r.choice === 'excluded'} onChange={() => update(r.kind, { choice: 'excluded' })} /> exclude</label>}
                </div>
              </div>
              {r.choice === 'line' ? (
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  <input value={r.amount} onChange={e => update(r.kind, { amount: e.target.value, computed: false })} placeholder="USD" className="border border-gray-300 rounded px-2 py-1" data-testid={`amount-${r.kind}`} />
                  {r.computed
                    ? <div className="col-span-2 text-gray-500 self-center">computed from the recorded data; editing it makes it a staff-entered figure</div>
                    : <input value={r.basis} onChange={e => update(r.kind, { basis: e.target.value })} placeholder="What this figure rests on (quote, agreement, invoice)" className="col-span-2 border border-gray-300 rounded px-2 py-1" data-testid={`basis-${r.kind}`} />}
                </div>
              ) : (
                <div className="mt-1.5"><input value={r.reason} onChange={e => update(r.kind, { reason: e.target.value })} placeholder="Why it is not on this invoice" className="border border-gray-300 rounded px-2 py-1 w-full" data-testid={`reason-${r.kind}`} /></div>
              )}
            </div>
          ))}
        </div>

        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Note printed on the invoice (optional)" className="border border-gray-300 rounded px-2 py-1 text-xs w-full" />

        {derived && derived.ok === false && <div className="text-xs text-[#ba3b46] bg-[#ba3b46]/10 border border-[#ba3b46]/30 rounded p-2" data-testid="builder-errors"><ul className="list-disc pl-4">{derived.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        {derived && derived.ok && (
          <div className={`text-xs rounded p-2 border ${derived.scope === 'partial' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-green-50 border-green-200 text-green-800'}`} data-testid="builder-summary">
            <div className="font-bold">{derived.scope === 'partial' ? 'PARTIAL invoice' : 'Complete invoice'}: total of the items listed USD {derived.totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            {derived.scope === 'partial' && <div className="mt-0.5">Printed on the invoice as NOT the full cost - it will state that it excludes: {derived.missing.map(k => KIND_LABEL[k]).join(', ')}.</div>}
          </div>
        )}
        {error && <div className="text-xs text-[#ba3b46]" data-testid="builder-error">{error}</div>}
        <div className="flex gap-2">
          <button onClick={issue} disabled={busy || !derived || !derived.ok || !recipient.trim()} className="px-3 py-1.5 bg-[#a58039] text-white text-xs font-bold rounded disabled:opacity-40 flex items-center gap-1" data-testid="issue-invoice">
            {busy && <Loader2 className="w-3 h-3 animate-spin" />} Issue invoice
          </button>
          <button onClick={() => setOpen(false)} disabled={busy} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-bold rounded">Cancel</button>
        </div>
      </>)}
    </div>
  );
};

const InvoiceCard: React.FC<{ inv: GeneratedInvoice; snap: BillingSnapshot; docPaths: Record<string, string>; onChanged: () => void }> = ({ inv, snap, docPaths, onChanged }) => {
  const [expanded, setExpanded] = useState(false);
  const [lines, setLines] = useState<InvoiceLineRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState({ amount: '', paidAt: today(), method: 'bank_transfer', reference: '' });
  const [voiding, setVoiding] = useState<{ kind: 'invoice' | 'payment' | 'receipt'; id: string } | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const bal = snap.balances[inv.id];
  const payments = snap.payments.filter(p => p.issuance_id === inv.id);

  useEffect(() => { if (expanded && !lines) listInvoiceLines(inv.id).then(setLines).catch(e => setError(e.message)); }, [expanded]);

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); onChanged(); } catch (e: any) { setError(e?.message || 'Failed.'); } finally { setBusy(false); } };
  const open = async (docId: string) => {
    const p = docPaths[docId]; const url = p ? await getWonVehicleDocumentUrl(p) : null;
    if (!url) { setError('You do not have access to download this file.'); return; }
    window.open(url, '_blank', 'noopener');
  };
  const doVoid = () => run(async () => {
    if (!voiding) return;
    if (voiding.kind === 'invoice') await voidInvoiceIssuance(voiding.id, voidReason);
    else if (voiding.kind === 'payment') await voidPayment(voiding.id, voidReason);
    else await voidReceipt(voiding.id, voidReason);
    setVoiding(null); setVoidReason('');
  });

  return (
    <div className={`border rounded-lg p-3 text-xs ${inv.voided_at ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-200 bg-white'}`} data-testid="generated-invoice">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <div className="font-bold text-[#403f4c]" data-testid="invoice-number">{inv.invoice_number}</div>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{inv.hat}</span>
        {inv.scope === 'partial' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold flex items-center gap-1" data-testid="partial-badge"><AlertTriangle className="w-2.5 h-2.5" /> PARTIAL</span>}
        {inv.voided_at && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 font-bold">VOIDED</span>}
        <div className="ml-auto text-right">
          <div className="font-bold">{money(inv.amount, inv.currency)}</div>
          {inv.currency === 'NGN' && <div className="text-[10px] text-gray-500">= {money(inv.amount_usd, 'USD')} at NGN {inv.fx_rate} ({inv.fx_rate_date})</div>}
        </div>
      </div>
      {bal && !inv.voided_at && <div className="mt-1 text-gray-600" data-testid="balance">Paid {money(bal.paid, inv.currency)} · <strong>Outstanding {money(bal.outstanding, inv.currency)}</strong></div>}
      {expanded && (
        <div className="mt-2 space-y-2">
          {error && <div className="text-[#ba3b46]">{error}</div>}
          {inv.scope === 'partial' && (
            <div className="bg-amber-50 border border-amber-200 rounded p-2 text-amber-900">
              <div className="font-bold">Excludes:</div>
              <ul className="list-disc pl-4">{inv.excluded_components.map((e, i) => <li key={i}>{KIND_LABEL[e.kind]}: {e.reason}</li>)}</ul>
            </div>
          )}
          <table className="w-full"><tbody>
            {(lines ?? []).map(l => (
              <tr key={l.position} className={l.client_visible ? '' : 'text-gray-400'}>
                <td className="py-0.5">{l.description}{!l.client_visible && ' (internal - never printed)'}</td>
                <td className="text-right">{money(l.amount, inv.currency)}</td>
              </tr>
            ))}
          </tbody></table>
          <div className="flex gap-2">
            <button onClick={() => void open(inv.document_id)} className="flex items-center gap-1 px-2 py-1 bg-white border border-gray-200 rounded font-bold"><FileText className="w-3 h-3" /> PDF</button>
            {!inv.voided_at && <button onClick={() => { setVoiding({ kind: 'invoice', id: inv.id }); setVoidReason(''); }} className="px-2 py-1 bg-white border border-gray-200 rounded text-gray-600 font-bold">Void</button>}
          </div>

          <div className="font-bold text-gray-500 uppercase text-[10px] tracking-wide">Payments</div>
          {payments.length === 0 && <div className="text-gray-400">No payments recorded.</div>}
          {payments.map(p => {
            const rec = snap.receipts.find(r => r.payment_id === p.id && !r.voided_at);
            return (
              <div key={p.id} className={`flex flex-wrap items-center gap-2 border rounded p-1.5 ${p.voided_at ? 'opacity-60 bg-gray-50' : ''}`} data-testid="payment-row">
                <div className="flex-1">{money(p.amount, p.currency)} · {p.paid_at} · {p.method.replace(/_/g, ' ')}{p.reference ? ` · ${p.reference}` : ''}{p.voided_at ? ` · VOIDED: ${p.void_reason}` : ''}</div>
                {!p.voided_at && (rec
                  ? <button onClick={() => void open(rec.document_id)} className="px-2 py-0.5 bg-green-50 border border-green-200 text-green-800 rounded font-bold" data-testid="receipt-link">{rec.receipt_number}</button>
                  : <button onClick={() => run(() => issueReceipt(p.id))} disabled={busy} className="px-2 py-0.5 bg-white border border-gray-200 rounded font-bold" data-testid="issue-receipt">Issue receipt</button>)}
                {!p.voided_at && rec && <button onClick={() => { setVoiding({ kind: 'receipt', id: rec.id }); setVoidReason(''); }} className="px-2 py-0.5 text-gray-500 underline">void receipt</button>}
                {!p.voided_at && <button onClick={() => { setVoiding({ kind: 'payment', id: p.id }); setVoidReason(''); }} className="px-2 py-0.5 text-gray-500 underline">void payment</button>}
              </div>
            );
          })}
          {!inv.voided_at && (
            <div className="flex flex-wrap items-end gap-2" data-testid="payment-form">
              <label>Amount ({inv.currency})<input value={pay.amount} onChange={e => setPay(p => ({ ...p, amount: e.target.value }))} className="block border border-gray-300 rounded px-2 py-1 w-28" data-testid="pay-amount" /></label>
              <label>Date<input type="date" value={pay.paidAt} onChange={e => setPay(p => ({ ...p, paidAt: e.target.value }))} className="block border border-gray-300 rounded px-2 py-1" /></label>
              <label>Method<select value={pay.method} onChange={e => setPay(p => ({ ...p, method: e.target.value }))} className="block border border-gray-300 rounded px-2 py-1"><option value="bank_transfer">bank transfer</option><option value="cash">cash</option><option value="card">card</option><option value="cheque">cheque</option><option value="other">other</option></select></label>
              <label>Reference<input value={pay.reference} onChange={e => setPay(p => ({ ...p, reference: e.target.value }))} className="block border border-gray-300 rounded px-2 py-1 w-32" /></label>
              <button onClick={() => run(async () => { await recordPayment({ issuanceId: inv.id, amount: Number(pay.amount), paidAt: pay.paidAt, method: pay.method, reference: pay.reference || undefined }); setPay(p => ({ ...p, amount: '', reference: '' })); })} disabled={busy || !(Number(pay.amount) > 0)} className="px-3 py-1.5 bg-[#403f4c] text-white font-bold rounded disabled:opacity-40" data-testid="record-payment">Record payment</button>
            </div>
          )}
          {voiding && (
            <div className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 rounded p-2">
              <span>Void this {voiding.kind}? It keeps its number and is never deleted.</span>
              <input value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Reason (required)" className="border border-gray-300 rounded px-2 py-1 flex-1 min-w-[10rem]" data-testid="void-reason" />
              <button onClick={doVoid} disabled={busy || !voidReason.trim()} className="px-2 py-1 bg-[#ba3b46] text-white font-bold rounded disabled:opacity-40" data-testid="confirm-void">Confirm void</button>
              <button onClick={() => setVoiding(null)} className="px-2 py-1 bg-gray-100 rounded font-bold">Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const WonVehicleBilling: React.FC<{ wonVehicle: WonVehicle; context: WonVehicleContext | null; winningBid: WinningBid | null; destination: WonVehicleDestination | null }> = ({ wonVehicle, context, winningBid, destination }) => {
  const [snap, setSnap] = useState<BillingSnapshot | null>(null);
  const [docPaths, setDocPaths] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [s, docs] = await Promise.all([loadBilling(wonVehicle.id), listWonVehicleDocuments(wonVehicle.id)]);
      setSnap(s); setDocPaths(Object.fromEntries(docs.map(d => [d.id, d.storage_path]))); setError(null);
    } catch (e: any) { setError(e?.message || 'Failed to load billing.'); }
  };
  useEffect(() => { void load(); }, [wonVehicle.id]);

  return (
    <div className="space-y-3" data-testid="billing-section">
      <div className="text-[10px] text-gray-500">Numbered invoices are generated from lines you confirm. A line is pre-filled only from a figure that computes for real; anything else needs a real figure with its basis, or is excluded with a reason and the invoice says so.</div>
      {error && <div className="text-xs text-[#ba3b46]">{error}</div>}
      {!snap && !error && <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>}
      {snap && snap.invoices.length === 0 && <div className="text-xs text-gray-400 bg-gray-50 rounded p-3" data-testid="no-generated-invoices">No generated invoices yet.</div>}
      {snap && snap.invoices.map(inv => <InvoiceCard key={inv.id} inv={inv} snap={snap} docPaths={docPaths} onChanged={() => void load()} />)}
      {context
        ? <Builder wonVehicle={wonVehicle} context={context} winningBid={winningBid} destination={destination} onIssued={() => void load()} />
        : <div className="text-xs text-gray-400">The purchase context is still loading.</div>}
    </div>
  );
};

export default WonVehicleBilling;

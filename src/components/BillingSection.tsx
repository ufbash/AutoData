import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { notifyBillingChanged, useBillingChangeCounter } from '../utils/billingEvents';
import { Loader2, FileText, Plus, Download, Eye, Ban, Receipt as ReceiptIcon } from 'lucide-react';
import {
  BillingDoc, Balance, Payment, Receipt, DocType,
  listClientDocuments, listVehicleDocumentsBilling, getBalance, listClientPayments, listClientReceipts,
  recordPayment, issueReceipt as issueReceiptCall, voidRecord, getFileUrl, Currency,
} from '../services/billingService';
import InvoiceEditor from './InvoiceEditor';
import type { WonVehicle, WinningBid, WonVehicleDestination, WonVehicleContext } from '../services/wonVehicleService';

// PROMPT 40 Stage 2 - the document list + entry points into the invoice editor, mounted BOTH on a won vehicle
// (WonVehicleDetail, scoped to that one vehicle) and directly on a client (ClientRelationship, scoped to every
// document the client has - including a repair invoice like INV-0025 that has no won vehicle at all).

const money = (n: number | null | undefined, currency: Currency) => n === null || n === undefined ? '—' : `${currency === 'NGN' ? '₦' : '$'}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ddmmyyyy = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '—');

interface Props {
  orgId: string;
  clientId: string;
  clientName?: string;
  wonVehicle?: WonVehicle | null;
  context?: WonVehicleContext | null;
  winningBid?: WinningBid | null;
  destination?: WonVehicleDestination | null;
  scopedToVehicle?: boolean;   // true from WonVehicleDetail: list only this vehicle's documents
}

const DocRow: React.FC<{ doc: BillingDoc; clientId: string; onChanged: () => void; onCreditNote: (doc: BillingDoc) => void; onOpenFile: (fileId: string, forceDownload: boolean) => void; refreshTick: number }> = ({ doc, clientId, onChanged, onCreditNote, onOpenFile, refreshTick }) => {
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [busy, setBusy] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // PROMPT 41 Stage 4 - "Record payment" lives on the invoice, where staff look for it: one action applies the
  // payment to THIS invoice and issues the receipt, rather than a separate unscoped payment form elsewhere.
  const [payForm, setPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('bank_transfer');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));

  // The balance is this row's own copy: anything that changes it from ELSEWHERE in the section (voiding a payment
  // or a receipt from the Payments list, a credit note) reloads the section, and an open row must follow.
  useEffect(() => {
    if (!open || doc.doc_type === 'credit_note' || refreshTick === 0) return;
    let cancelled = false;
    getBalance(doc.id).then(b => { if (!cancelled) setBalance(b); }).catch(() => {});
    return () => { cancelled = true; };
  }, [refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    const next = !open; setOpen(next);
    if (next && !balance && doc.doc_type !== 'credit_note') { try { setBalance(await getBalance(doc.id)); } catch { /* non-fatal */ } }
  };
  const doVoid = async () => {
    if (!voidReason.trim()) return;
    setBusy(true); setErr(null);
    try { await voidRecord('document', doc.id, voidReason); setShowVoid(false); onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const doRecordPaymentHere = async () => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) return;
    setBusy(true); setErr(null);
    try {
      const { paymentId } = await recordPayment({
        clientId, amount: amt, currency: doc.currency, paidAt: payDate, method: payMethod, purpose: 'payment',
        apply: [{ documentId: doc.id, amount: amt, sourceAmount: amt }],
      });
      await issueReceiptCall(paymentId);
      setPayForm(false); setPayAmount('');
      setBalance(await getBalance(doc.id));
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const kindLabel = doc.doc_type === 'invoice' ? (doc.invoice_kind === 'retail' ? 'Retail invoice' : doc.invoice_kind === 'repair' ? 'Repair invoice' : 'Invoice')
    : doc.doc_type === 'retainer' ? 'Deposit request' : 'Credit note';

  return (
    <div className="border rounded-lg mb-2" data-testid="doc-row">
      <button onClick={toggle} className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50">
        <div>
          <span className="font-mono text-sm font-semibold text-[#403f4c]" data-testid="doc-number">{doc.number_text}</span>
          <span className="text-xs text-gray-500 ml-2">{kindLabel}</span>
          {doc.voided_at && <span className="text-xs text-red-600 ml-2">voided</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-sm font-semibold">{money(doc.total, doc.currency)}</div>
            <div className="text-[10px] text-gray-400">{ddmmyyyy(doc.issue_date)}</div>
          </div>
          {doc.file_id && (
            <span className="flex items-center gap-1.5 pl-1">
              <span role="button" tabIndex={0} data-testid="doc-view" onClick={e => { e.stopPropagation(); onOpenFile(doc.file_id as string, false); }} title="View" className="p-1 rounded hover:bg-gray-100 cursor-pointer"><Eye className="w-3.5 h-3.5 text-[#a58039]" /></span>
              <span role="button" tabIndex={0} data-testid="doc-download" onClick={e => { e.stopPropagation(); onOpenFile(doc.file_id as string, true); }} title="Download" className="p-1 rounded hover:bg-gray-100 cursor-pointer"><Download className="w-3.5 h-3.5 text-[#a58039]" /></span>
            </span>
          )}
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t pt-2 text-sm space-y-1">
          {!doc.voided_at && balance && doc.doc_type !== 'credit_note' && (
            <div className="flex justify-between font-semibold"><span>Outstanding</span><span data-testid="doc-outstanding">{money(balance.outstanding, doc.currency)}</span></div>
          )}
          {doc.scope_statement && <p className="text-xs text-gray-500 italic">{doc.scope_statement}</p>}
          <div className="flex gap-3 pt-1">
            {doc.doc_type === 'invoice' && !doc.voided_at && balance && balance.outstanding > 0 && !payForm && (
              <button onClick={() => { setPayForm(true); setPayAmount(String(balance.outstanding)); }} data-testid="record-payment-open" className="text-xs text-green-700 hover:underline font-semibold">Record payment</button>
            )}
            {doc.doc_type === 'invoice' && !doc.voided_at && (
              <button onClick={() => onCreditNote(doc)} title="Reduces what the client owes on this invoice - a discount agreed after sending, an overcharge, a cancelled service, or a refund. If there are no payments yet, voiding and reissuing is simpler." className="text-xs text-[#a58039] hover:underline">Raise a credit note</button>
            )}
            {!doc.voided_at && !showVoid && (
              <button data-testid="void-open" onClick={() => setShowVoid(true)} title="Cancels a document issued in error. Its number is kept, never reused." className="text-xs text-red-600 hover:underline flex items-center gap-1"><Ban className="w-3 h-3" /> Void</button>
            )}
          </div>
          {payForm && (
            <div className="flex flex-wrap gap-2 items-center pt-1 bg-green-50 rounded p-2">
              <span className="text-xs text-gray-500">Amount</span>
              <input value={payAmount} onChange={e => setPayAmount(e.target.value)} data-testid="record-payment-amount" className="border rounded px-2 py-1 text-xs w-24" />
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="border rounded px-2 py-1 text-xs bg-white"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="cheque">Cheque</option><option value="other">Other</option></select>
              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="border rounded px-2 py-1 text-xs" />
              <button onClick={doRecordPaymentHere} disabled={busy || !payAmount} data-testid="record-payment-submit" className="text-xs bg-green-700 text-white px-2 py-1 rounded disabled:opacity-50">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Record & issue receipt'}</button>
              <button onClick={() => setPayForm(false)} className="text-xs text-gray-400">Cancel</button>
            </div>
          )}
          {showVoid && (
            <div className="flex gap-2 items-center pt-1">
              <input data-testid="void-reason" value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Reason" className="flex-1 border rounded px-2 py-1 text-xs" />
              <button data-testid="void-confirm" onClick={doVoid} disabled={busy} className="text-xs bg-red-600 text-white px-2 py-1 rounded disabled:opacity-50">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm void'}</button>
            </div>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
};

const BillingSection: React.FC<Props> = ({ orgId, clientId, clientName, wonVehicle, context, winningBid, destination, scopedToVehicle }) => {
  const [docs, setDocs] = useState<BillingDoc[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState<{ docType: DocType; creditFor?: BillingDoc } | null>(null);
  const [payForm, setPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState(''); const [payCurrency, setPayCurrency] = useState<Currency>('USD');
  const [payMethod, setPayMethod] = useState('bank_transfer'); const [payPurpose, setPayPurpose] = useState<'deposit' | 'payment'>('payment');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payBusy, setPayBusy] = useState(false);
  // errors from a payment/receipt row action are shown ON that row - the section-level line can be scrolled out of view
  const [rowErr, setRowErr] = useState<{ id: string; msg: string } | null>(null);

  // Only the FIRST load swaps the section for a spinner. A reload after a payment/void/credit note must keep the
  // rows mounted - otherwise every open invoice row collapses and the new balance is never seen (found by the
  // Prompt 42 journey 5 browser test).
  const loadedOnce = useRef(false);
  const [refreshTick, setRefreshTick] = useState(0);
  // another Billing list on screen (the client page's under the vehicle page, or the reverse) changed something: refresh
  // this one too. Found by journey 18 - a deposit request issued on the vehicle page was missing from the client page's
  // own list until a reload. Own announcements are ignored and a refresh caused by someone else's is silent, so two
  // lists can never ping-pong.
  const instanceId = useRef(Math.random().toString(36).slice(2));
  const otherListChanged = useBillingChangeCounter(instanceId.current);
  const load = async (opts?: { silent?: boolean }) => {
    const isReload = loadedOnce.current;
    if (!isReload) setLoading(true);
    setErr(null);
    try {
      const [d, p, r] = await Promise.all([
        scopedToVehicle && wonVehicle ? listVehicleDocumentsBilling(wonVehicle.id) : listClientDocuments(clientId),
        listClientPayments(clientId), listClientReceipts(clientId),
      ]);
      setDocs(d); setPayments(p); setReceipts(r);
      if (isReload) { if (!opts?.silent) notifyBillingChanged(instanceId.current); setRefreshTick(t => t + 1); }
    } catch (e) { setErr((e as Error).message); }
    finally { loadedOnce.current = true; setLoading(false); }
  };
  useEffect(() => { loadedOnce.current = false; void load(); }, [clientId, wonVehicle?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (otherListChanged > 0) void load({ silent: true }); }, [otherListChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  const doRecordPayment = async () => {
    setPayBusy(true); setErr(null);
    try {
      await recordPayment({ clientId, wonVehicleId: wonVehicle?.id, amount: Number(payAmount), currency: payCurrency, paidAt: payDate, method: payMethod, purpose: payPurpose });
      setPayForm(false); setPayAmount(''); await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setPayBusy(false); }
  };
  const doIssueReceipt = async (paymentId: string) => {
    setErr(null);
    setRowErr(null);
    try { await issueReceiptCall(paymentId); await load(); } catch (e) { setRowErr({ id: paymentId, msg: (e as Error).message }); }
  };
  // A payment can only be voided once nothing depends on it: its receipt, then its application(s) to invoices, then
  // the payment itself. The database enforces that order; this walks it for the user and SAYS what it will void,
  // rather than leaving a receipted/applied payment stuck with no control for the earlier links (found by the Stage 4
  // usability verifier, which left a $10.00 payment stuck exactly this way).
  const doVoidPayment = async (paymentId: string) => {
    const liveReceipts = receipts.filter(r => r.payment_id === paymentId && !r.voided_at);
    let apps: { id: string }[] = [];
    try {
      const { data } = await supabase.from('billing_applications').select('id').eq('payment_id', paymentId).is('voided_at', null);
      apps = (data ?? []) as { id: string }[];
    } catch { /* the void below will report what the database says */ }
    const alsoVoids = [
      liveReceipts.length ? `its receipt (${liveReceipts.map(r => r.receipt_number).join(', ')})` : '',
      apps.length ? `its application to ${apps.length === 1 ? 'an invoice' : apps.length + ' invoices'} (those balances go back up)` : '',
    ].filter(Boolean).join(' and ');
    const reason = window.prompt(`Void this payment${alsoVoids ? ` - this also voids ${alsoVoids}` : ''}.\n\nReason:`);
    if (!reason) return;
    setRowErr(null);
    try {
      for (const r of liveReceipts) await voidRecord('receipt', r.id, reason);
      for (const a of apps) await voidRecord('application', a.id, reason);
      await voidRecord('payment', paymentId, reason);
      await load();
    } catch (e) { setRowErr({ id: paymentId, msg: (e as Error).message }); await load(); }
  };
  const doVoidReceipt = async (receiptId: string) => {
    const reason = window.prompt('Reason for voiding this receipt (the payment it covers stays recorded):');
    if (!reason) return;
    setRowErr(null);
    try { await voidRecord('receipt', receiptId, reason); await load(); } catch (e) { setRowErr({ id: receiptId, msg: (e as Error).message }); }
  };
  // fileId can be viewed inline (opens the PDF in a new tab, nothing saved to disk) or force-downloaded
  // (Content-Disposition: attachment, the browser saves it) - see getFileUrl's `forceDownload` flag.
  const openFile = async (fileId: string, forceDownload: boolean) => {
    try { window.open(await getFileUrl(fileId, forceDownload), '_blank', 'noopener'); } catch (e) { setErr((e as Error).message); }
  };

  if (loading) return <Loader2 className="w-5 h-5 animate-spin text-[#a58039]" />;

  return (
    <div>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      <div className="flex gap-2 mb-3">
        <button onClick={() => setEditorOpen({ docType: 'invoice' })} className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-[#a58039] text-white rounded"><Plus className="w-3.5 h-3.5" /> New invoice</button>
        <button onClick={() => setEditorOpen({ docType: 'retainer' })} title="Asks for the commitment fee before work starts. Credits automatically against the final invoice once paid." className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-[#a58039] text-[#5c4a2f] rounded"><Plus className="w-3.5 h-3.5" /> New deposit request</button>
        <button data-testid="pay-toggle" onClick={() => setPayForm(v => !v)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-300 text-gray-600 rounded"><Plus className="w-3.5 h-3.5" /> Record payment</button>
      </div>

      {payForm && (
        <div className="border rounded-lg p-3 mb-3 flex flex-wrap gap-2 items-end">
          <p data-testid="pay-form-hint" className="basis-full text-xs text-gray-500">Records money received <strong>on account</strong> - it is not applied to any invoice, and shows as credit. To pay a specific invoice, open that invoice below and use its own "Record payment".</p>
          <div><label className="text-xs text-gray-500 block">Amount</label><input data-testid="pay-amount" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="border rounded px-2 py-1 text-sm w-24" /></div>
          <div><label className="text-xs text-gray-500 block">Currency</label><select data-testid="pay-currency" value={payCurrency} onChange={e => setPayCurrency(e.target.value as Currency)} className="border rounded px-2 py-1 text-sm bg-white"><option>USD</option><option>NGN</option></select></div>
          <div><label className="text-xs text-gray-500 block">Purpose</label><select value={payPurpose} onChange={e => setPayPurpose(e.target.value as any)} className="border rounded px-2 py-1 text-sm bg-white"><option value="deposit">Deposit</option><option value="payment">Payment</option></select></div>
          <div><label className="text-xs text-gray-500 block">Method</label><select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="border rounded px-2 py-1 text-sm bg-white"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="cheque">Cheque</option><option value="other">Other</option></select></div>
          <div><label className="text-xs text-gray-500 block">Date</label><input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="border rounded px-2 py-1 text-sm" /></div>
          <button data-testid="pay-save" onClick={doRecordPayment} disabled={payBusy || !payAmount} className="text-xs bg-[#a58039] text-white px-3 py-1.5 rounded disabled:opacity-50">{payBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}</button>
        </div>
      )}

      <div className="text-xs font-semibold text-gray-500 mb-1">Documents</div>
      {docs.length === 0 && <p className="text-sm text-gray-400 mb-3">None yet.</p>}
      {docs.map(d => <DocRow key={d.id} doc={d} clientId={clientId} onChanged={load} onCreditNote={doc => setEditorOpen({ docType: 'credit_note', creditFor: doc })} onOpenFile={openFile} refreshTick={refreshTick} />)}

      {payments.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-500 mb-1">Payments</div>
          {payments.map(p => (
            <div key={p.id} data-testid="payment-row" className="flex flex-wrap items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
              <span>{p.purpose === 'deposit' ? 'Deposit' : 'Payment'} {money(p.amount, p.currency)} · {p.method.replace(/_/g, ' ')} · {ddmmyyyy(p.paid_at)}{p.voided_at ? ' (voided)' : ''}</span>
              {!p.voided_at && (
                <span className="flex items-center gap-2">
                  <button onClick={() => doIssueReceipt(p.id)} title="Issues a numbered receipt for this payment (a permanent document). To open an existing receipt, use the Receipts list below." className="text-xs text-[#a58039] hover:underline flex items-center gap-1"><ReceiptIcon className="w-3 h-3" /> Issue receipt</button>
                  <button data-testid="payment-void" onClick={() => doVoidPayment(p.id)} className="text-xs text-red-600 hover:underline">Void</button>
                </span>
              )}
              {rowErr?.id === p.id && <span data-testid="row-error" className="basis-full text-xs text-red-600">{rowErr.msg}</span>}
            </div>
          ))}
        </div>
      )}

      {receipts.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-500 mb-1">Receipts</div>
          {receipts.map(r => (
            <div key={r.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
              <span className="font-mono" data-testid="receipt-number">{r.receipt_number}{r.voided_at ? ' (voided)' : ''}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{ddmmyyyy(r.issued_at)}</span>
                {!r.voided_at && <button data-testid="receipt-void" onClick={() => doVoidReceipt(r.id)} className="text-xs text-red-600 hover:underline">Void</button>}
                {r.file_id && (
                  <>
                    <button onClick={() => openFile(r.file_id as string, false)} title="View" data-testid="receipt-view"><Eye className="w-3.5 h-3.5 text-[#a58039]" /></button>
                    <button onClick={() => openFile(r.file_id as string, true)} title="Download" data-testid="receipt-download"><Download className="w-3.5 h-3.5 text-[#a58039]" /></button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {editorOpen && (
        <InvoiceEditor
          orgId={orgId} clientId={clientId} clientName={clientName ?? ''} wonVehicle={wonVehicle} winningBid={winningBid} destination={destination}
          docType={editorOpen.docType} creditForDoc={editorOpen.creditFor ?? null}
          onClose={() => setEditorOpen(null)}
          onIssued={() => { setEditorOpen(null); void load(); }}
        />
      )}
    </div>
  );
};

export default BillingSection;

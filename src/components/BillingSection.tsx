import React, { useEffect, useState } from 'react';
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

const DocRow: React.FC<{ doc: BillingDoc; clientId: string; onChanged: () => void; onCreditNote: (doc: BillingDoc) => void; onOpenFile: (fileId: string, forceDownload: boolean) => void }> = ({ doc, clientId, onChanged, onCreditNote, onOpenFile }) => {
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
    <div className="border rounded-lg mb-2">
      <button onClick={toggle} className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50">
        <div>
          <span className="font-mono text-sm font-semibold text-[#403f4c]">{doc.number_text}</span>
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
              <span role="button" tabIndex={0} onClick={e => { e.stopPropagation(); onOpenFile(doc.file_id as string, false); }} title="View" className="p-1 rounded hover:bg-gray-100 cursor-pointer"><Eye className="w-3.5 h-3.5 text-[#a58039]" /></span>
              <span role="button" tabIndex={0} onClick={e => { e.stopPropagation(); onOpenFile(doc.file_id as string, true); }} title="Download" className="p-1 rounded hover:bg-gray-100 cursor-pointer"><Download className="w-3.5 h-3.5 text-[#a58039]" /></span>
            </span>
          )}
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t pt-2 text-sm space-y-1">
          {!doc.voided_at && balance && doc.doc_type !== 'credit_note' && (
            <div className="flex justify-between font-semibold"><span>Outstanding</span><span>{money(balance.outstanding, doc.currency)}</span></div>
          )}
          {doc.scope_statement && <p className="text-xs text-gray-500 italic">{doc.scope_statement}</p>}
          <div className="flex gap-3 pt-1">
            {doc.doc_type === 'invoice' && !doc.voided_at && balance && balance.outstanding > 0 && !payForm && (
              <button onClick={() => { setPayForm(true); setPayAmount(String(balance.outstanding)); }} className="text-xs text-green-700 hover:underline font-semibold">Record payment</button>
            )}
            {doc.doc_type === 'invoice' && !doc.voided_at && (
              <button onClick={() => onCreditNote(doc)} title="Reduces what the client owes on this invoice - a discount agreed after sending, an overcharge, a cancelled service, or a refund. If there are no payments yet, voiding and reissuing is simpler." className="text-xs text-[#a58039] hover:underline">Raise a credit note</button>
            )}
            {!doc.voided_at && !showVoid && (
              <button onClick={() => setShowVoid(true)} title="Cancels a document issued in error. Its number is kept, never reused." className="text-xs text-red-600 hover:underline flex items-center gap-1"><Ban className="w-3 h-3" /> Void</button>
            )}
          </div>
          {payForm && (
            <div className="flex flex-wrap gap-2 items-center pt-1 bg-green-50 rounded p-2">
              <span className="text-xs text-gray-500">Amount</span>
              <input value={payAmount} onChange={e => setPayAmount(e.target.value)} className="border rounded px-2 py-1 text-xs w-24" />
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="border rounded px-2 py-1 text-xs bg-white"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="cheque">Cheque</option><option value="other">Other</option></select>
              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="border rounded px-2 py-1 text-xs" />
              <button onClick={doRecordPaymentHere} disabled={busy || !payAmount} className="text-xs bg-green-700 text-white px-2 py-1 rounded disabled:opacity-50">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Record & issue receipt'}</button>
              <button onClick={() => setPayForm(false)} className="text-xs text-gray-400">Cancel</button>
            </div>
          )}
          {showVoid && (
            <div className="flex gap-2 items-center pt-1">
              <input value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Reason" className="flex-1 border rounded px-2 py-1 text-xs" />
              <button onClick={doVoid} disabled={busy} className="text-xs bg-red-600 text-white px-2 py-1 rounded disabled:opacity-50">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm void'}</button>
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

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const [d, p, r] = await Promise.all([
        scopedToVehicle && wonVehicle ? listVehicleDocumentsBilling(wonVehicle.id) : listClientDocuments(clientId),
        listClientPayments(clientId), listClientReceipts(clientId),
      ]);
      setDocs(d); setPayments(p); setReceipts(r);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [clientId, wonVehicle?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    try { await issueReceiptCall(paymentId); await load(); } catch (e) { setErr((e as Error).message); }
  };
  const doVoidPayment = async (paymentId: string) => {
    const reason = window.prompt('Reason for voiding this payment:');
    if (!reason) return;
    try { await voidRecord('payment', paymentId, reason); await load(); } catch (e) { setErr((e as Error).message); }
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
        <button onClick={() => setPayForm(v => !v)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-300 text-gray-600 rounded"><Plus className="w-3.5 h-3.5" /> Record payment</button>
      </div>

      {payForm && (
        <div className="border rounded-lg p-3 mb-3 flex flex-wrap gap-2 items-end">
          <div><label className="text-xs text-gray-500 block">Amount</label><input value={payAmount} onChange={e => setPayAmount(e.target.value)} className="border rounded px-2 py-1 text-sm w-24" /></div>
          <div><label className="text-xs text-gray-500 block">Currency</label><select value={payCurrency} onChange={e => setPayCurrency(e.target.value as Currency)} className="border rounded px-2 py-1 text-sm bg-white"><option>USD</option><option>NGN</option></select></div>
          <div><label className="text-xs text-gray-500 block">Purpose</label><select value={payPurpose} onChange={e => setPayPurpose(e.target.value as any)} className="border rounded px-2 py-1 text-sm bg-white"><option value="deposit">Deposit</option><option value="payment">Payment</option></select></div>
          <div><label className="text-xs text-gray-500 block">Method</label><select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="border rounded px-2 py-1 text-sm bg-white"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="cheque">Cheque</option><option value="other">Other</option></select></div>
          <div><label className="text-xs text-gray-500 block">Date</label><input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="border rounded px-2 py-1 text-sm" /></div>
          <button onClick={doRecordPayment} disabled={payBusy || !payAmount} className="text-xs bg-[#a58039] text-white px-3 py-1.5 rounded disabled:opacity-50">{payBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}</button>
        </div>
      )}

      <div className="text-xs font-semibold text-gray-500 mb-1">Documents</div>
      {docs.length === 0 && <p className="text-sm text-gray-400 mb-3">None yet.</p>}
      {docs.map(d => <DocRow key={d.id} doc={d} clientId={clientId} onChanged={load} onCreditNote={doc => setEditorOpen({ docType: 'credit_note', creditFor: doc })} onOpenFile={openFile} />)}

      {payments.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-500 mb-1">Payments</div>
          {payments.map(p => (
            <div key={p.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
              <span>{p.purpose === 'deposit' ? 'Deposit' : 'Payment'} {money(p.amount, p.currency)} · {p.method.replace(/_/g, ' ')} · {ddmmyyyy(p.paid_at)}{p.voided_at ? ' (voided)' : ''}</span>
              {!p.voided_at && (
                <span className="flex items-center gap-2">
                  <button onClick={() => doIssueReceipt(p.id)} className="text-xs text-[#a58039] hover:underline flex items-center gap-1"><ReceiptIcon className="w-3 h-3" /> Receipt</button>
                  <button onClick={() => doVoidPayment(p.id)} className="text-xs text-red-600 hover:underline">Void</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {receipts.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-500 mb-1">Receipts</div>
          {receipts.map(r => (
            <div key={r.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
              <span className="font-mono">{r.receipt_number}{r.voided_at ? ' (voided)' : ''}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{ddmmyyyy(r.issued_at)}</span>
                {r.file_id && (
                  <>
                    <button onClick={() => openFile(r.file_id as string, false)} title="View"><Eye className="w-3.5 h-3.5 text-[#a58039]" /></button>
                    <button onClick={() => openFile(r.file_id as string, true)} title="Download"><Download className="w-3.5 h-3.5 text-[#a58039]" /></button>
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

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  WonVehicle, WonVehicleDocument, InvoiceIssuance, InvoiceChannel, InvoiceCurrency,
  INVOICE_CHANNELS, INVOICE_CURRENCIES,
  listWonVehicleDocuments, listInvoiceIssuances, issueInvoice, voidInvoiceIssuance, getClientContact,
} from '../services/wonVehicleService';

// PROMPT 34 Stage 5 - records that an uploaded invoice was ISSUED to the client: which document,
// what amount (staff-entered, never derived), to whom, over which channel, when, and by whom.
// Nothing here generates or sends an invoice. Behind auth; never on the tracking page. An issuance
// is never edited or deleted - it is voided with a reason, and a correction is a new issuance.

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const WonVehicleInvoices: React.FC<{ wonVehicle: WonVehicle }> = ({ wonVehicle }) => {
  const [issuances, setIssuances] = useState<InvoiceIssuance[]>([]);
  const [invoiceDocs, setInvoiceDocs] = useState<WonVehicleDocument[]>([]);
  const [clientEmail, setClientEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const [documentId, setDocumentId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<InvoiceCurrency>('USD');
  const [channel, setChannel] = useState<InvoiceChannel>('email');
  const [recipient, setRecipient] = useState('');
  const [issuedAt, setIssuedAt] = useState(toLocalInput(new Date()));
  const [notes, setNotes] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [iss, docs, client] = await Promise.all([
        listInvoiceIssuances(wonVehicle.id),
        listWonVehicleDocuments(wonVehicle.id, 'invoice'),
        getClientContact(wonVehicle.client_id).catch(() => null),
      ]);
      setIssuances(iss);
      setInvoiceDocs(docs);
      setClientEmail(client?.email ?? null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load invoices.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [wonVehicle.id]);

  // Convenience only: prefill the client's address when the channel is email; staff can change it.
  useEffect(() => {
    if (channel === 'email' && clientEmail && !recipient) setRecipient(clientEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, clientEmail]);

  const docName = (id: string) => invoiceDocs.find(d => d.id === id)?.original_filename ?? 'invoice document';

  const handleIssue = async () => {
    setBusy(true);
    setError(null);
    try {
      await issueInvoice({
        wonVehicleId: wonVehicle.id, documentId,
        invoiceNumber: invoiceNumber || undefined, amount: Number(amount), currency, channel, recipient,
        issuedAt: new Date(issuedAt).toISOString(), notes: notes || undefined,
      });
      setFormOpen(false);
      setDocumentId(''); setInvoiceNumber(''); setAmount(''); setRecipient(''); setNotes('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not record the issuance.');
    } finally {
      setBusy(false);
    }
  };

  const handleVoid = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await voidInvoiceIssuance(id, voidReason);
      setVoidingId(null);
      setVoidReason('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not void the issuance.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = documentId && Number(amount) > 0 && recipient.trim() && issuedAt;
  const active = issuances.filter(i => !i.voided_at);

  return (
    <div data-testid="invoices-section">
      {error && <div className="text-xs text-[#ba3b46] bg-[#ba3b46]/10 border border-[#ba3b46]/30 rounded p-2 mb-3" data-testid="invoices-error">{error}</div>}
      <p className="text-[10px] text-gray-400 mb-2">
        Upload the invoice PDF under Documents (type Invoice), then record here that it was issued. Amounts are entered by staff, not calculated. Staff only.
      </p>

      {loading ? (
        <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : (
        <>
          <div className="text-xs mb-2" data-testid="invoice-status">
            {active.length > 0
              ? <span className="font-bold text-emerald-700">Issued ({active.length})</span>
              : <span className="font-bold text-amber-600">Not yet issued</span>}
          </div>

          <div className="space-y-1.5">
            {issuances.map(i => (
              <div key={i.id} className={`p-2 rounded text-xs ${i.voided_at ? 'bg-gray-50 text-gray-400' : 'bg-emerald-50/60'}`} data-testid="issuance-row">
                <div className={i.voided_at ? 'line-through' : 'font-medium text-[#403f4c]'}>
                  {i.invoice_number ? `#${i.invoice_number} · ` : ''}{i.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {i.currency} · {docName(i.document_id)}
                </div>
                <div className="text-[10px]">
                  Issued {new Date(i.issued_at).toLocaleString()} via {INVOICE_CHANNELS.find(c => c.value === i.channel)?.label} to {i.recipient}
                  {i.notes ? ` · ${i.notes}` : ''}
                </div>
                {i.voided_at && <div className="text-[10px] text-[#ba3b46]">Voided {new Date(i.voided_at).toLocaleString()}: {i.void_reason}</div>}
                {!i.voided_at && (voidingId === i.id ? (
                  <div className="mt-1 flex gap-1.5 items-center">
                    <input value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Reason (required)" className="flex-1 text-xs border border-gray-300 rounded px-2 py-1" data-testid="void-reason" />
                    <button onClick={() => void handleVoid(i.id)} disabled={busy || !voidReason.trim()} className="px-2 py-1 bg-[#ba3b46] text-white rounded font-bold disabled:opacity-50" data-testid="confirm-void">Void</button>
                    <button onClick={() => setVoidingId(null)} className="px-2 py-1 bg-gray-100 rounded font-bold">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => { setVoidingId(i.id); setVoidReason(''); }} className="mt-1 text-[10px] text-[#ba3b46] hover:underline" data-testid="void-issuance">Void…</button>
                ))}
              </div>
            ))}
          </div>

          {!formOpen ? (
            <button onClick={() => setFormOpen(true)} className="mt-3 px-3 py-1.5 bg-[#403f4c] text-white text-xs font-bold rounded" data-testid="record-issuance">Record issuance</button>
          ) : invoiceDocs.length === 0 ? (
            <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2" data-testid="no-invoice-doc">
              No invoice document is uploaded for this vehicle yet. Upload one under Documents (type Invoice) first.
              <button onClick={() => setFormOpen(false)} className="ml-2 underline">Close</button>
            </div>
          ) : (
            <div className="mt-3 p-3 border border-gray-200 rounded-lg space-y-2 text-xs" data-testid="issuance-form">
              <select value={documentId} onChange={e => setDocumentId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5" data-testid="issue-document">
                <option value="">Which invoice document…</option>
                {invoiceDocs.map(d => <option key={d.id} value={d.id}>{d.original_filename}</option>)}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="Invoice no. (optional)" className="border border-gray-300 rounded px-2 py-1.5" />
                <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount" inputMode="decimal" className="border border-gray-300 rounded px-2 py-1.5" data-testid="issue-amount" />
                <select value={currency} onChange={e => setCurrency(e.target.value as InvoiceCurrency)} className="border border-gray-300 rounded px-2 py-1.5">
                  {INVOICE_CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={channel} onChange={e => setChannel(e.target.value as InvoiceChannel)} className="border border-gray-300 rounded px-2 py-1.5" data-testid="issue-channel">
                  {INVOICE_CHANNELS.map(c => <option key={c.value} value={c.value}>Sent via {c.label}</option>)}
                </select>
                <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder={channel === 'email' ? 'Email address' : 'Phone number / handle'} className="border border-gray-300 rounded px-2 py-1.5" data-testid="issue-recipient" />
              </div>
              <input type="datetime-local" value={issuedAt} onChange={e => setIssuedAt(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5" />
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full border border-gray-300 rounded px-2 py-1.5" />
              <div className="flex gap-2">
                <button onClick={() => void handleIssue()} disabled={busy || !canSubmit} className="px-3 py-1.5 bg-[#403f4c] text-white font-bold rounded disabled:opacity-50" data-testid="submit-issuance">
                  {busy ? 'Saving…' : 'Record issuance'}
                </button>
                <button onClick={() => setFormOpen(false)} className="px-3 py-1.5 bg-gray-100 font-bold rounded">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default WonVehicleInvoices;

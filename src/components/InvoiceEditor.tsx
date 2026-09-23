import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Plus, Trash2, ChevronUp, ChevronDown, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  DocType, InvoiceKind, Currency, DiscountType, Origin, EditorLine, TaxCode, BillingDefault, OrgProfile, Balance,
  PaymentRemaining, listTaxCodesAsOf, getBillingDefault, getOrgProfile, peekNextNumber, previewTotals, issueDocument,
  listVehicleDocuments, VehicleDoc, listClientPayments, getPaymentRemaining, listClientDocuments, BillingDoc,
} from '../services/billingService';
import { computeOffers, offerToLine, PrefillOffer } from '../services/invoicePrefill';
import { getWonVehicleContext } from '../services/wonVehicleService';
import type { WonVehicle, WinningBid, WonVehicleDestination } from '../services/wonVehicleService';
import type { Client } from '../services/researchService';

// PROMPT 40 Stage 2 - the staff invoice editor. Built entirely on the Prompt 38 engine (documentMath.ts / the
// billing_compute() RPC / the billing Edge Function) - no second engine, no second template. The live preview
// calls the exact same billing_compute() the database calls at commit, so "the preview matches what's issued" is
// not a claim to test, it's a consequence of calling the same function.

const uid = () => (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const money = (n: number | null | undefined, currency: Currency) => n === null || n === undefined ? '—' : `${currency === 'NGN' ? '₦' : '$'}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
  orgId: string;
  clientId: string;
  clientName: string;
  wonVehicle?: WonVehicle | null;
  winningBid?: WinningBid | null;
  destination?: WonVehicleDestination | null;
  externalDefault?: { plate?: string; vin?: string; description?: string };
  docType: DocType;
  creditForDoc?: BillingDoc | null;   // required when docType === 'credit_note'
  onClose: () => void;
  onIssued: () => void;
}

const emptyLine = (position: number): EditorLine => ({ position, section: '', description: '', quantity: 1, rate: 0, discountType: 'none', discountValue: 0, taxCode: null, clientVisible: true, origin: 'staff_entered', basis: '' });

const InvoiceEditor: React.FC<Props> = ({ orgId, clientId, clientName, wonVehicle, winningBid, destination, externalDefault, docType, creditForDoc, onClose, onIssued }) => {
  const { user } = useAuth();
  const [invoiceKind, setInvoiceKind] = useState<InvoiceKind>('vehicle_purchase');
  const [useExternal, setUseExternal] = useState(!wonVehicle);
  const [extPlate, setExtPlate] = useState(externalDefault?.plate ?? '');
  const [extVin, setExtVin] = useState(externalDefault?.vin ?? '');
  const [extDesc, setExtDesc] = useState(externalDefault?.description ?? '');
  const [issueDate, setIssueDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [scopeStatement, setScopeStatement] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [settlementCurrency, setSettlementCurrency] = useState<Currency>('USD');
  const [fxBasis, setFxBasis] = useState<'agreed' | 'live'>('agreed');
  const [fxRate, setFxRate] = useState('');
  const [fxSource, setFxSource] = useState('');
  const [lines, setLines] = useState<EditorLine[]>([emptyLine(1)]);
  const [invDiscType, setInvDiscType] = useState<DiscountType>('none');
  const [invDiscValue, setInvDiscValue] = useState('');
  const [adjustment, setAdjustment] = useState('');
  const [adjustmentLabel, setAdjustmentLabel] = useState('');

  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [serviceFeeDefault, setServiceFeeDefault] = useState<BillingDefault | null>(null);
  const [orgProfile, setOrgProfile] = useState<OrgProfile | null>(null);
  const [offers, setOffers] = useState<PrefillOffer[]>([]);
  const [vehicleDocs, setVehicleDocs] = useState<VehicleDoc[]>([]);
  const [availablePayments, setAvailablePayments] = useState<{ id: string; label: string; remaining: PaymentRemaining }[]>([]);
  const [availableRetainers, setAvailableRetainers] = useState<{ id: string; number: string; available: number; currency: Currency }[]>([]);
  const [applyRows, setApplyRows] = useState<{ kind: 'payment' | 'retainer_credit'; sourceId: string; label: string; amount: string; currency: Currency }[]>([]);

  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewTotals>> | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [nextNumber, setNextNumber] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueErr, setIssueErr] = useState<string | null>(null);
  const [idempotencyKey] = useState(uid());

  const isRetail = docType === 'invoice' && invoiceKind === 'retail';
  const needsScope = docType === 'invoice' && (invoiceKind === 'vehicle_purchase' || invoiceKind === 'retail');
  const crossCurrency = settlementCurrency !== currency;

  // ---- load reference data
  useEffect(() => {
    void (async () => {
      try {
        const [tc, sf, profile] = await Promise.all([listTaxCodesAsOf(orgId, issueDate), getBillingDefault(orgId, 'service_fee', issueDate), getOrgProfile(orgId)]);
        setTaxCodes(tc); setServiceFeeDefault(sf); setOrgProfile(profile);
      } catch (e) { setPreviewErr((e as Error).message); }
    })();
  }, [orgId, issueDate]);

  useEffect(() => {
    if (!wonVehicle || useExternal) { setOffers([]); return; }
    void (async () => {
      try {
        const context = await getWonVehicleContext(wonVehicle);
        const o = await computeOffers(wonVehicle, context, winningBid ?? null, destination ?? null);
        setOffers(o);
      } catch { /* prefill is a convenience; a failure here never blocks the editor */ }
    })();
  }, [wonVehicle, useExternal, winningBid, destination]);

  useEffect(() => {
    if (!wonVehicle) { setVehicleDocs([]); return; }
    void listVehicleDocuments(wonVehicle.id).then(setVehicleDocs).catch(() => setVehicleDocs([]));
  }, [wonVehicle]);

  useEffect(() => {
    void (async () => {
      try {
        const [payments, docs] = await Promise.all([listClientPayments(clientId), listClientDocuments(clientId)]);
        const live = payments.filter(p => !p.voided_at);
        const remainders = await Promise.all(live.map(p => getPaymentRemaining(p.id)));
        setAvailablePayments(live.map((p, i) => ({ id: p.id, label: `${p.purpose === 'deposit' ? 'Deposit' : 'Payment'} ${money(p.amount, p.currency)} (${p.paid_at})`, remaining: remainders[i]! })).filter(p => p.remaining && p.remaining.unapplied > 0 && !p.remaining.voided_at));
        const retainers = docs.filter(d => d.doc_type === 'retainer' && !d.voided_at);
        // available retainer credit = total - already credited; approximate via balance lookups the section below performs lazily
        setAvailableRetainers(retainers.map(r => ({ id: r.id, number: r.number_text, available: r.total, currency: r.currency })));
      } catch { /* non-fatal */ }
    })();
  }, [clientId]);

  // ---- lines
  const addLine = () => setLines(ls => [...ls, emptyLine(ls.length + 1)]);
  const removeLine = (i: number) => setLines(ls => ls.filter((_, j) => j !== i).map((l, j) => ({ ...l, position: j + 1 })));
  const moveLine = (i: number, dir: -1 | 1) => setLines(ls => {
    const j = i + dir; if (j < 0 || j >= ls.length) return ls;
    const copy = [...ls]; [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy.map((l, k) => ({ ...l, position: k + 1 }));
  });
  const updateLine = (i: number, patch: Partial<EditorLine>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));
  // PROMPT 41 Stage 3 - every figure is editable, including a computed one. Editing a computed line's rate
  // converts it to staff-entered (never leaves it labelled "computed" with an unverified figure - that would
  // silently undo debt #79) and keeps a visible note of what it was before the edit. Server-side, "computed" on
  // an issued invoice still always means genuinely recomputed and verified - only a truly unedited figure ever
  // reaches billing_compute()'s cross-check as `origin: 'computed'`.
  const editComputedRate = (i: number, newRate: string) => setLines(ls => ls.map((l, j) => {
    if (j !== i) return l;
    if (l.origin !== 'computed') return { ...l, rate: newRate };
    const was = money(Number(l.rate) || 0, 'USD');
    return { ...l, rate: newRate, origin: 'staff_entered', basis: `was ${was}, computed` };
  }));

  const addOfferLine = (o: PrefillOffer) => {
    const line = offerToLine(o, lines.length + 1);
    if (!line) return;
    setLines(ls => [...ls.filter(l => !(l.origin === 'staff_entered' && l.description === '' && l.rate === 0)), line]);
  };
  const addServiceFeeLine = () => {
    if (!serviceFeeDefault) return;
    setLines(ls => [...ls, { position: ls.length + 1, section: 'Vehicle Purchase', description: serviceFeeDefault.label, quantity: 1, rate: serviceFeeDefault.amount, discountType: 'none', discountValue: 0, taxCode: serviceFeeDefault.tax_code, clientVisible: true, origin: 'staff_entered', basis: 'Agreed service fee', component: 'service_fee' }]);
  };
  const addDocBackedLine = (doc: VehicleDoc) => {
    setLines(ls => [...ls, { position: ls.length + 1, section: 'Vehicle Purchase', description: doc.original_filename, quantity: 1, rate: 0, discountType: 'none', discountValue: 0, taxCode: null, clientVisible: true, origin: 'document_backed', sourceDocumentId: doc.id }]);
  };

  // ---- scope statement auto-suggestion
  useEffect(() => {
    if (!needsScope || scopeStatement) return;
    const missing = offers.filter(o => o.state === 'needs_figure' && !lines.some(l => l.component === o.component));
    if (missing.length > 0) {
      setScopeStatement(`This invoice covers ${lines.filter(l => l.origin !== 'staff_entered' || l.description).map(l => l.description).filter(Boolean).join(', ') || 'the items listed'}. ${missing.map(m => m.label).join(', ')} will be invoiced separately.`);
    }
  }, [offers, needsScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- live preview (debounced), via the SAME function the database calls
  useEffect(() => {
    setPreviewErr(null); setPreview(null);
    const valid = lines.filter(l => l.description.trim() && Number(l.rate) > 0 && Number(l.quantity) > 0);
    if (valid.length === 0) return;
    const t = setTimeout(() => {
      setPreviewBusy(true);
      previewTotals(orgId, issueDate, valid.map(l => ({ position: l.position, section: l.section, quantity: l.quantity, rate: l.rate, discount_type: l.discountType, discount_value: l.discountValue, tax_code: l.taxCode })),
        { type: invDiscType, value: Number(invDiscValue) || 0 }, Number(adjustment) || 0)
        .then(setPreview).catch(e => setPreviewErr(e.message)).finally(() => setPreviewBusy(false));
    }, 400);
    return () => clearTimeout(t);
  }, [lines, invDiscType, invDiscValue, adjustment, orgId, issueDate]);

  const applyTotalCents = useMemo(() => applyRows.reduce((s, r) => s + Math.round((Number(r.amount) || 0) * 100), 0), [applyRows]);

  const openConfirm = async () => {
    setIssueErr(null);
    try { setNextNumber(await peekNextNumber(orgId, docType)); setConfirmOpen(true); }
    catch (e) { setIssueErr((e as Error).message); }
  };

  const doIssue = async () => {
    setIssuing(true); setIssueErr(null);
    try {
      const validLines = lines.filter(l => l.description.trim() && Number(l.rate) > 0 && Number(l.quantity) > 0);
      const result = await issueDocument({
        docType, invoiceKind: docType === 'invoice' ? invoiceKind : undefined, clientId,
        wonVehicleId: !useExternal && wonVehicle ? wonVehicle.id : undefined,
        externalVehicle: useExternal ? { plate: extPlate || undefined, vin: extVin || undefined, description: extDesc || undefined } : undefined,
        reference: reference || undefined, issueDate, dueDate: dueDate || undefined, currency, settlementCurrency,
        fx: crossCurrency ? { basis: fxBasis, rate: fxBasis === 'agreed' ? Number(fxRate) : undefined, source: fxSource || undefined } : undefined,
        scopeStatement: needsScope ? scopeStatement : undefined, notes: notes || undefined, creditForId: creditForDoc?.id,
        invoiceDiscount: { type: invDiscType, value: Number(invDiscValue) || 0 },
        adjustment: { amount: Number(adjustment) || 0, label: adjustmentLabel || undefined },
        lines: validLines,
        apply: applyRows.filter(r => Number(r.amount) > 0).map(r => ({ kind: r.kind, sourceId: r.sourceId, amount: Number(r.amount), sourceAmount: Number(r.amount) })),
        idempotencyKey,
      });
      void result;
      onIssued();
    } catch (e) { setIssueErr((e as Error).message); setConfirmOpen(false); }
    finally { setIssuing(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-[#403f4c]">
            {docType === 'invoice' ? 'New invoice' : docType === 'retainer' ? 'New deposit request' : `Credit note against ${creditForDoc?.number_text}`} — {clientName}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5">
          {docType === 'invoice' && (
            <div className="flex gap-2">
              {(['vehicle_purchase', 'retail', 'repair'] as InvoiceKind[]).map(k => (
                <button key={k} onClick={() => setInvoiceKind(k)} className={`px-3 py-1.5 text-sm rounded-full border ${invoiceKind === k ? 'bg-[#a58039] text-white border-[#a58039]' : 'border-gray-300 text-gray-600'}`}>
                  {k === 'vehicle_purchase' ? 'Vehicle purchase (brokerage)' : k === 'retail' ? 'Retail sale' : 'Repair / service'}
                </button>
              ))}
            </div>
          )}

          {/* Vehicle */}
          {!creditForDoc && (
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-4 mb-2">
                <label className="flex items-center gap-1.5 text-sm"><input type="radio" checked={!useExternal} onChange={() => setUseExternal(false)} disabled={!wonVehicle} /> Won vehicle {wonVehicle ? '' : '(none linked here)'}</label>
                <label className="flex items-center gap-1.5 text-sm"><input type="radio" checked={useExternal} onChange={() => setUseExternal(true)} /> External vehicle</label>
              </div>
              {useExternal ? (
                <div className="grid grid-cols-3 gap-2">
                  <input placeholder="Plate" value={extPlate} onChange={e => setExtPlate(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
                  <input placeholder="VIN" value={extVin} onChange={e => setExtVin(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
                  <input placeholder="Description (e.g. 2022 Toyota Camry SE)" value={extDesc} onChange={e => setExtDesc(e.target.value)} className="border rounded px-2 py-1.5 text-sm col-span-3" />
                </div>
              ) : wonVehicle ? <div className="text-sm text-gray-600">{[(wonVehicle.won_snapshot as any)?.year, (wonVehicle.won_snapshot as any)?.make, (wonVehicle.won_snapshot as any)?.model].filter(Boolean).join(' ') || 'This won vehicle'}</div> : null}
            </div>
          )}

          {/* dates / reference */}
          <div className="grid grid-cols-4 gap-3">
            <div><label className="text-xs text-gray-500">Issue date</label><input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
            <div><label className="text-xs text-gray-500">Payment due</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
            <div className="col-span-2"><label className="text-xs text-gray-500">Reference</label><input value={reference} onChange={e => setReference(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          </div>

          {/* currency / FX */}
          <div className="grid grid-cols-4 gap-3 items-end">
            <div><label className="text-xs text-gray-500">Currency</label><select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className="w-full border rounded px-2 py-1.5 text-sm bg-white"><option>USD</option><option>NGN</option></select></div>
            <div><label className="text-xs text-gray-500">Settled in</label><select value={settlementCurrency} onChange={e => setSettlementCurrency(e.target.value as Currency)} className="w-full border rounded px-2 py-1.5 text-sm bg-white"><option>USD</option><option>NGN</option></select></div>
            {crossCurrency && (<>
              <div><label className="text-xs text-gray-500">Rate basis</label><select value={fxBasis} onChange={e => setFxBasis(e.target.value as any)} className="w-full border rounded px-2 py-1.5 text-sm bg-white"><option value="agreed">Agreed</option><option value="live">Live (fetched at issue)</option></select></div>
              {fxBasis === 'agreed' && <div><label className="text-xs text-gray-500">Rate ({currency}→{settlementCurrency})</label><input value={fxRate} onChange={e => setFxRate(e.target.value)} placeholder="e.g. 1390" className="w-full border rounded px-2 py-1.5 text-sm" /></div>}
            </>)}
          </div>
          {crossCurrency && fxBasis === 'agreed' && (
            <input value={fxSource} onChange={e => setFxSource(e.target.value)} placeholder="Who agreed the rate, and how (e.g. agreed with the client by WhatsApp, 14/09/2026)" className="w-full border rounded px-2 py-1.5 text-sm" />
          )}

          {/* prefill offers */}
          {offers.length > 0 && (
            <div className="border rounded-lg p-3 bg-[#faf8f2]">
              <div className="text-xs font-semibold text-gray-600 mb-2">Computed components — add only what genuinely computes</div>
              <div className="flex flex-wrap gap-2">
                {offers.map(o => (
                  <button key={o.component} disabled={o.state === 'needs_figure'} onClick={() => addOfferLine(o)}
                    title={o.state !== 'needs_figure' ? o.sourceRef ?? '' : o.reason ?? ''}
                    className={`text-xs px-2.5 py-1.5 rounded border ${o.state === 'actual' ? 'border-green-600 text-green-700 hover:bg-green-50' : o.state === 'computed' ? 'border-[#a58039] text-[#5c4a2f] hover:bg-[#a58039]/10' : 'border-gray-200 text-gray-400 cursor-not-allowed'}`}>
                    {o.label}{o.state === 'actual' ? ` — ${money(o.amountUsd, 'USD')} (actual)` : o.state === 'computed' ? ` — ${money(o.amountUsd, 'USD')}` : ' (needs a figure)'}
                  </button>
                ))}
                {serviceFeeDefault && <button onClick={addServiceFeeLine} className="text-xs px-2.5 py-1.5 rounded border border-[#a58039] text-[#5c4a2f] hover:bg-[#a58039]/10">{serviceFeeDefault.label} — {money(serviceFeeDefault.amount, serviceFeeDefault.currency)}</button>}
              </div>
            </div>
          )}
          {vehicleDocs.length > 0 && (
            <div className="text-xs">
              <span className="text-gray-500 mr-2">Add a document-backed line:</span>
              {vehicleDocs.map(d => <button key={d.id} onClick={() => addDocBackedLine(d)} className="mr-2 mb-1 px-2 py-1 border rounded text-[#5c4a2f] border-gray-300 hover:border-[#a58039]">{d.original_filename}</button>)}
            </div>
          )}

          {/* lines */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr><th className="text-left px-2 py-1.5 w-8"></th><th className="text-left px-2 py-1.5">Section</th><th className="text-left px-2 py-1.5">Description</th><th className="text-right px-2 py-1.5 w-16">Qty</th><th className="text-right px-2 py-1.5 w-24">Rate</th><th className="text-left px-2 py-1.5 w-28">Discount</th><th className="text-left px-2 py-1.5 w-20">Tax</th><th className="text-left px-2 py-1.5 w-24">Origin</th><th className="w-16"></th></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-1"><div className="flex flex-col"><button onClick={() => moveLine(i, -1)} disabled={i === 0}><ChevronUp className="w-3 h-3 text-gray-400" /></button><button onClick={() => moveLine(i, 1)} disabled={i === lines.length - 1}><ChevronDown className="w-3 h-3 text-gray-400" /></button></div></td>
                    <td className="px-1"><input value={l.section} onChange={e => updateLine(i, { section: e.target.value })} className="w-full border rounded px-1.5 py-1" placeholder="Section" /></td>
                    <td className="px-1"><input value={l.description} onChange={e => updateLine(i, { description: e.target.value })} className="w-full border rounded px-1.5 py-1" /></td>
                    <td className="px-1"><input value={l.quantity} onChange={e => updateLine(i, { quantity: e.target.value })} className="w-full border rounded px-1.5 py-1 text-right" /></td>
                    <td className="px-1"><input data-testid={`line-rate-${i}`} value={l.rate} onChange={e => editComputedRate(i, e.target.value)} className="w-full border rounded px-1.5 py-1 text-right" /></td>
                    <td className="px-1 flex gap-1">
                      <select value={l.discountType} onChange={e => updateLine(i, { discountType: e.target.value as DiscountType, discountValue: 0 })} className="border rounded px-1 py-1 bg-white text-xs"><option value="none">—</option><option value="percent">%</option><option value="fixed">$</option></select>
                      {l.discountType !== 'none' && <input value={l.discountValue} onChange={e => updateLine(i, { discountValue: e.target.value })} className="w-14 border rounded px-1 py-1" />}
                    </td>
                    <td className="px-1"><select value={l.taxCode ?? ''} onChange={e => updateLine(i, { taxCode: e.target.value || null })} className="w-full border rounded px-1 py-1 bg-white text-xs"><option value="">—</option>{taxCodes.map(t => <option key={t.code} value={t.code}>{t.code}</option>)}</select></td>
                    <td className="px-1 text-xs text-gray-500" data-testid={`line-origin-${i}`}>{l.origin === 'computed' ? 'Computed' : l.origin === 'document_backed' ? 'Document' : (
                      <input data-testid={`line-basis-${i}`} value={l.basis ?? ''} onChange={e => updateLine(i, { basis: e.target.value })} placeholder="basis" className="w-full border rounded px-1 py-1" />
                    )}</td>
                    <td className="px-1"><button onClick={() => removeLine(i)}><Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={addLine} className="flex items-center gap-1 text-xs text-[#a58039] px-2 py-2"><Plus className="w-3.5 h-3.5" /> Add line</button>
          </div>
          {isRetail && <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Retail: exactly one client-visible line (the all-inclusive price); mark any cost line "hidden" — the engine refuses otherwise.</p>}

          {/* invoice-level discount / adjustment */}
          <div className="grid grid-cols-4 gap-3">
            <div><label className="text-xs text-gray-500">Invoice discount</label><select value={invDiscType} onChange={e => setInvDiscType(e.target.value as DiscountType)} className="w-full border rounded px-2 py-1.5 text-sm bg-white"><option value="none">None</option><option value="percent">Percent</option><option value="fixed">Fixed</option></select></div>
            {invDiscType !== 'none' && <div><label className="text-xs text-gray-500">Value</label><input value={invDiscValue} onChange={e => setInvDiscValue(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>}
            <div><label className="text-xs text-gray-500">Adjustment</label><input value={adjustment} onChange={e => setAdjustment(e.target.value)} placeholder="0.00" className="w-full border rounded px-2 py-1.5 text-sm" /></div>
            {Number(adjustment) !== 0 && <div><label className="text-xs text-gray-500">Adjustment label</label><input value={adjustmentLabel} onChange={e => setAdjustmentLabel(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>}
          </div>

          {/* scope statement */}
          {needsScope && (
            <div><label className="text-xs text-gray-500">Scope of this invoice</label><textarea data-testid="invoice-scope" value={scopeStatement} onChange={e => setScopeStatement(e.target.value)} rows={2} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          )}
          <div><label className="text-xs text-gray-500">Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full border rounded px-2 py-1.5 text-sm" /></div>

          {/* apply payments/credits */}
          {(availablePayments.length > 0 || availableRetainers.length > 0) && docType !== 'credit_note' && (
            <div className="border rounded-lg p-3">
              <div className="text-xs font-semibold text-gray-600 mb-2">Apply existing payments or deposit credit</div>
              {applyRows.map((r, i) => (
                <div key={i} className="flex items-center gap-2 mb-1 text-sm">
                  <span className="flex-1">{r.label}</span>
                  <input value={r.amount} onChange={e => setApplyRows(rs => rs.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className="w-24 border rounded px-1.5 py-1 text-right" />
                  <button onClick={() => setApplyRows(rs => rs.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5 text-gray-400" /></button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                {availablePayments.map(p => <button key={p.id} onClick={() => setApplyRows(rs => [...rs, { kind: 'payment', sourceId: p.id, label: p.label, amount: String(p.remaining.unapplied), currency: p.remaining.currency }])} className="text-xs px-2 py-1 border rounded text-[#5c4a2f] border-gray-300 hover:border-[#a58039]">{p.label}</button>)}
                {availableRetainers.map(r => <button key={r.id} onClick={() => setApplyRows(rs => [...rs, { kind: 'retainer_credit', sourceId: r.id, label: `Deposit request ${r.number}`, amount: String(r.available), currency: r.currency }])} className="text-xs px-2 py-1 border rounded text-[#5c4a2f] border-gray-300 hover:border-[#a58039]">Deposit request {r.number}</button>)}
              </div>
            </div>
          )}

          {/* live preview */}
          <div className="border-t pt-4">
            <div className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-2">Live preview {previewBusy && <Loader2 className="w-3 h-3 animate-spin" />}</div>
            {previewErr && <p className="text-xs text-red-600">{previewErr}</p>}
            {preview && (
              <div className="text-sm space-y-0.5">
                <div className="flex justify-between"><span>Subtotal</span><span>{money(Number(centsToDecimalSafe(preview.subtotalCents)), currency)}</span></div>
                {preview.invoiceDiscountCents > 0 && <div className="flex justify-between text-[#a58039]"><span>Invoice discount</span><span>-{money(Number(centsToDecimalSafe(preview.invoiceDiscountCents)), currency)}</span></div>}
                {preview.taxBreakdown.map(t => t.amountCents > 0 && <div key={t.code} className="flex justify-between"><span>{t.code} @ {t.ratePercent}%</span><span>{money(Number(centsToDecimalSafe(t.amountCents)), currency)}</span></div>)}
                {applyTotalCents > 0 && <div className="flex justify-between text-[#a58039]"><span>Applied</span><span>-{money(applyTotalCents / 100, currency)}</span></div>}
                <div className="flex justify-between font-bold border-t pt-1 mt-1"><span>Total</span><span>{money(Number(centsToDecimalSafe(preview.totalCents)), currency)}</span></div>
                {applyTotalCents > 0 && <div className="flex justify-between font-bold"><span>Balance</span><span>{money((preview.totalCents - applyTotalCents) / 100, currency)}</span></div>}
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex items-center justify-between">
          {issueErr && <p className="text-xs text-red-600 flex-1">{issueErr}</p>}
          <div className="flex gap-2 ml-auto">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button onClick={openConfirm} disabled={!preview} data-testid="editor-issue-btn" className="px-4 py-2 text-sm font-semibold bg-[#a58039] text-white rounded-lg disabled:opacity-40">
              {docType === 'credit_note' ? 'Issue credit note' : docType === 'retainer' ? 'Issue deposit request' : 'Issue invoice'}
            </button>
          </div>
        </div>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-[#403f4c] mb-2">Confirm issue</h3>
            <p className="text-sm text-gray-600 mb-4">This will consume <span className="font-mono font-bold text-[#a58039]" data-testid="confirm-issue-number">{nextNumber}</span> and cannot be undone — the document can only be voided or reduced by a credit note afterward.</p>
            <p className="text-sm font-semibold mb-4">Total: {preview ? money(Number(centsToDecimalSafe(preview.totalCents)), currency) : '—'}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} className="px-3 py-1.5 text-sm text-gray-600">Cancel</button>
              <button onClick={doIssue} disabled={issuing} data-testid="confirm-issue-btn" className="px-3 py-1.5 text-sm font-semibold bg-[#a58039] text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5">
                {issuing && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Confirm, issue {nextNumber}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const centsToDecimalSafe = (c: number) => (c / 100).toFixed(2);

export default InvoiceEditor;

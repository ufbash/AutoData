import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-react';
import { briefReference } from '../../supabase/functions/_shared/vehicleHeading';
import { RelPayment, loadClientRelationship, ClientRelationshipData, RelWonVehicle } from '../services/clientRelationshipService';

const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString() : '');
const label = (s: string | null | undefined): string => (s ? s.replace(/_/g, ' ') : '');
const money = (amount: number, currency: string): string => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
};
const heading = (v: RelWonVehicle): string => {
  const s = (v.won_snapshot ?? {}) as Record<string, unknown>;
  const text = [s.year, s.make, s.model].filter(x => x !== null && x !== undefined && x !== '').join(' ');
  return text || 'Vehicle';
};

const Badge: React.FC<{ children: React.ReactNode; tone?: 'gray' | 'green' | 'red' | 'amber' | 'blue' }> = ({ children, tone = 'gray' }) => {
  const cls = { gray: 'bg-gray-100 text-gray-700', green: 'bg-green-100 text-green-800', red: 'bg-red-100 text-red-700', amber: 'bg-amber-100 text-amber-800', blue: 'bg-blue-100 text-blue-800' }[tone];
  return <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wide ${cls}`}>{children}</span>;
};

const Section: React.FC<{ title: string; count: number; empty: string; testId: string; children: React.ReactNode }> = ({ title, count, empty, testId, children }) => (
  <section className="bg-white border border-gray-200 rounded-xl overflow-hidden" data-testid={testId}>
    <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
      <h3 className="text-base font-bold text-[#403f4c]">{title}</h3>
      <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{count}</span>
    </div>
    {count === 0 ? <div className="px-5 py-6 text-sm text-gray-500">{empty}</div> : <div className="divide-y divide-gray-100">{children}</div>}
  </section>
);

const Row: React.FC<{ children: React.ReactNode; onClick?: () => void }> = ({ children, onClick }) => (
  <div
    onClick={onClick}
    className={`px-5 py-3 flex items-center justify-between gap-4 text-sm ${onClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}
  >
    {children}
  </div>
);

const ClientRelationship: React.FC<{
  clientId: string;
  orgId: string;
  onBack: () => void;
  onOpenWonVehicle?: (wonVehicleId: string) => void;
}> = ({ clientId, orgId, onBack, onOpenWonVehicle }) => {
  const [data, setData] = useState<ClientRelationshipData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (isCancelled: () => boolean) => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadClientRelationship(orgId, clientId);
      if (!isCancelled()) setData(result);
    } catch (e: any) {
      if (!isCancelled()) { setData(null); setError(e?.message || 'Failed to load the client relationship.'); }
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, [orgId, clientId]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  const back = (
    <button onClick={onBack} className="text-sm font-bold text-[#a58039] hover:underline mb-4 flex items-center gap-1">
      <ArrowLeft className="w-4 h-4" /> Back
    </button>
  );

  if (loading) return <div className="max-w-5xl mx-auto">{back}<div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-[#a58039]" /></div></div>;
  if (error || !data) return <div className="max-w-5xl mx-auto">{back}<div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg" data-testid="relationship-error">{error}</div></div>;

  const { client, briefs, runs, wonVehicles, documents, invoices, payments, receipts, emails, pendingSchema } = data;
  const briefById = new Map(briefs.map(b => [b.id, b]));
  const vehicleName = new Map(wonVehicles.map(v => [v.id, heading(v)]));
  const invoiceNumber = new Map(invoices.map(i => [i.id, i.invoice_number || 'Invoice']));
  const paymentById = new Map<string, RelPayment>();
  payments.forEach(p => paymentById.set(p.id, p));
  const contact = [client.email, client.phone].filter(Boolean).join(' · ');

  return (
    <div className="max-w-5xl mx-auto space-y-5" data-testid="client-relationship">
      {back}

      {pendingSchema.length > 0 && (
        <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3" data-testid="pending-schema">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Not available in this database yet: {pendingSchema.join(', ')}. Those sections show as empty.</span>
        </div>
      )}

      <section className="bg-white border border-gray-200 rounded-xl p-5" data-testid="rel-client">
        <h2 className="text-2xl font-bold text-[#403f4c]">{client.full_name}</h2>
        <div className="text-sm text-gray-500 mt-1">Client since {fmtDate(client.created_at)}</div>
        {contact && <div className="text-sm text-gray-500 mt-1">{contact}</div>}
      </section>

      <Section title="Briefs" count={briefs.length} empty="No briefs for this client." testId="rel-briefs">
        {briefs.map(b => (
          <Row key={b.id}>
            <div className="font-medium text-gray-900">{briefReference(b)}</div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {b.status && <Badge tone={b.status === 'pending_review' ? 'amber' : 'green'}>{label(b.status)}</Badge>}
              {b.deposit_received_at ? <Badge tone="green">Deposit {fmtDate(b.deposit_received_at)}</Badge> : <Badge>No deposit</Badge>}
            </div>
          </Row>
        ))}
      </Section>

      <Section title="Research runs" count={runs.length} empty="No research runs for this client." testId="rel-runs">
        {runs.map(r => {
          const brief = r.client_brief_id ? briefById.get(r.client_brief_id) : undefined;
          return (
            <Row key={r.id}>
              <div>
                <div className="font-medium text-gray-900">{r.client_name}</div>
                <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3">
                  <span className="capitalize">{label(r.run_type)}</span>
                  <span>{fmtDate(r.created_at)}</span>
                  <span>{brief ? briefReference(brief) : r.client_brief_id ? 'Deleted brief' : 'No brief'}</span>
                </div>
              </div>
              <Badge tone={r.status === 'active' ? 'green' : r.status === 'completed' ? 'blue' : 'gray'}>{r.status}</Badge>
            </Row>
          );
        })}
      </Section>

      <Section title="Won vehicles" count={wonVehicles.length} empty="No vehicles won yet." testId="rel-won-vehicles">
        {wonVehicles.map(v => (
          <Row key={v.id} onClick={onOpenWonVehicle ? () => onOpenWonVehicle(v.id) : undefined}>
            <div>
              <div className="font-medium text-gray-900">{heading(v)}</div>
              <div className="text-xs text-gray-500 mt-0.5">Won {fmtDate(v.promoted_at)}</div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {v.currentStatus && <Badge tone="blue">{label(v.currentStatus)}</Badge>}
              {onOpenWonVehicle && <ChevronRight className="w-4 h-4 text-gray-300" />}
            </div>
          </Row>
        ))}
      </Section>

      <Section title="Documents" count={documents.length} empty="No documents uploaded." testId="rel-documents">
        {documents.map(d => (
          <Row key={d.id}>
            <div>
              <div className="font-medium text-gray-900">{d.original_filename}</div>
              <div className="text-xs text-gray-500 mt-0.5">{vehicleName.get(d.won_vehicle_id)} · {fmtDate(d.uploaded_at)}</div>
            </div>
            <Badge>{label(d.document_type)}</Badge>
          </Row>
        ))}
      </Section>

      <Section title="Invoices" count={invoices.length} empty="No invoices issued." testId="rel-invoices">
        {invoices.map(i => (
          <Row key={i.id}>
            <div>
              <div className="font-medium text-gray-900">{i.invoice_number || 'Unnumbered invoice'}</div>
              <div className="text-xs text-gray-500 mt-0.5">{vehicleName.get(i.won_vehicle_id)} · {fmtDate(i.issued_at)}</div>
              {i.voided_at && <div className="text-xs text-red-600 mt-0.5">Voided {fmtDate(i.voided_at)}{i.void_reason ? `: ${i.void_reason}` : ''}</div>}
            </div>
            <div className="text-right flex-shrink-0">
              <div className={`font-medium ${i.voided_at ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{money(i.amount, i.currency)}</div>
              <div className="flex items-center gap-1.5 justify-end mt-1">
                {i.voided_at && <Badge tone="red">Void</Badge>}
                {i.generated && i.hat && <Badge>{i.hat}</Badge>}
                {i.generated && i.scope && <Badge tone={i.scope === 'partial' ? 'amber' : 'gray'}>{i.scope}</Badge>}
              </div>
              {i.generated && i.balance && (
                <div className="text-xs text-gray-500 mt-1">
                  Paid {money(i.balance.paid, i.currency)} · Outstanding {money(i.balance.outstanding, i.currency)}
                </div>
              )}
            </div>
          </Row>
        ))}
      </Section>

      <Section title="Payments" count={payments.length} empty="No payments recorded." testId="rel-payments">
        {payments.map(p => (
          <Row key={p.id}>
            <div>
              <div className="font-medium text-gray-900">{invoiceNumber.get(p.issuance_id) || 'Invoice'} · {vehicleName.get(p.won_vehicle_id)}</div>
              <div className="text-xs text-gray-500 mt-0.5 capitalize">
                {fmtDate(p.paid_at)} · {label(p.method)}{p.reference ? ` · ${p.reference}` : ''}
              </div>
              {p.voided_at && <div className="text-xs text-red-600 mt-0.5 normal-case">Voided {fmtDate(p.voided_at)}{p.void_reason ? `: ${p.void_reason}` : ''}</div>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {p.voided_at && <Badge tone="red">Void</Badge>}
              <span className={`font-medium ${p.voided_at ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{money(p.amount, p.currency)}</span>
            </div>
          </Row>
        ))}
      </Section>

      <Section title="Receipts" count={receipts.length} empty="No receipts issued." testId="rel-receipts">
        {receipts.map(r => {
          const pay = paymentById.get(r.payment_id);
          return (
            <Row key={r.id}>
              <div>
                <div className="font-medium text-gray-900">{r.receipt_number}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {vehicleName.get(r.won_vehicle_id)} · {fmtDate(r.issued_at)}{pay ? ` · ${money(pay.amount, pay.currency)}` : ''}
                </div>
                {r.voided_at && <div className="text-xs text-red-600 mt-0.5">Voided {fmtDate(r.voided_at)}{r.void_reason ? `: ${r.void_reason}` : ''}</div>}
              </div>
              {r.voided_at && <Badge tone="red">Void</Badge>}
            </Row>
          );
        })}
      </Section>

      <Section title="Email history" count={emails.length} empty="No emails sent for this client." testId="rel-emails">
        {emails.map(e => (
          <Row key={e.id}>
            <div className="min-w-0">
              <div className="font-medium text-gray-900 truncate">{e.subject || label(e.purpose)}</div>
              <div className="text-xs text-gray-500 mt-0.5 capitalize">{label(e.purpose)} · to {e.maskedRecipient} · {fmtDate(e.created_at)}</div>
            </div>
            <Badge tone={e.status === 'sent' ? 'green' : 'red'}>{e.status}</Badge>
          </Row>
        ))}
      </Section>
    </div>
  );
};

export default ClientRelationship;

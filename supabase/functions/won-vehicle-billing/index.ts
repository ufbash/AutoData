import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import * as pdfLib from "npm:pdf-lib@1.17.1";
import { renderInvoicePdf, renderReceiptPdf } from "../_shared/documentPdf.ts";
import { deriveInvoice, KIND_LABEL } from "../_shared/invoiceRules.ts";

// PROMPT 37 Phase 2 - the only writer of generated invoices, payments and receipts. Staff-only, behind auth,
// never reachable through a share token. The org is read off the vehicle / invoice row, never the request.
//   issue_invoice   lines a human confirmed -> number -> PDF stored in the won-vehicle document store -> ONE atomic
//                   database call records the numbered invoice, its lines and its frozen exchange rate. The database
//                   refuses an invoice that is silent about a cost component (migration 059); deriveInvoice says so first.
//   record_payment / void_payment    append-only, balance derived (view), overpayment refused by the database
//   issue_receipt / void_receipt     a numbered receipt against a recorded payment
// Nothing here computes a cost. Lines arrive already authored (computed by the builder from real components, or
// staff-entered with a stated basis); this function checks them, freezes the currency, numbers and stores them.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const METHODS = ['bank_transfer', 'cash', 'card', 'cheque', 'other'];
const CHANNELS = ['email', 'whatsapp', 'imessage', 'other'];
const BUCKET = 'won-vehicle-documents';

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new Error("Method not allowed");
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: "Unauthorized: Missing token" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Missing Supabase configuration");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) return json({ error: "Unauthorized: Invalid token" }, 401);

    const { data: memberships, error: memError } = await supabase.from('memberships').select('org_id, role').eq('user_id', user.id);
    if (memError) throw memError;
    const isSuperadmin = (memberships ?? []).some((m: { role: string }) => m.role === 'superadmin');
    const canAccessOrg = (orgId: string) => isSuperadmin || (memberships ?? []).some((m: { org_id: string }) => m.org_id === orgId);

    const payload = await req.json().catch(() => null);
    const mode = payload?.mode;

    // ---- helpers -------------------------------------------------------------------------------------------
    const loadVehicle = async (id: unknown) => {
      if (typeof id !== 'string') return null;
      const { data, error } = await supabase.from('won_vehicles').select('id, org_id, client_id, won_snapshot, deleted_at').eq('id', id).maybeSingle();
      if (error) throw error;
      // Same answer for "does not exist" and "not yours".
      if (!data || data.deleted_at || !canAccessOrg(data.org_id)) return null;
      return data;
    };
    const vehicleHeading = (snap: Record<string, unknown> | null) => {
      const s = snap ?? {};
      return [s.year, s.make, s.model, s.trim].filter(Boolean).join(' ') + (s.vin ? ` - VIN ${s.vin}` : '');
    };
    const clientAndOrg = async (orgId: string, clientId: string) => {
      const { data: c } = await supabase.from('clients').select('full_name').eq('id', clientId).eq('org_id', orgId).maybeSingle();
      const { data: o } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle();
      return { clientName: c?.full_name ?? 'Client', orgName: o?.name ?? 'Caplimo' };
    };
    const storePdf = async (vehicle: { id: string; org_id: string }, documentType: 'invoice' | 'receipt', filename: string, bytes: Uint8Array) => {
      const path = `${vehicle.org_id}/${vehicle.id}/${crypto.randomUUID()}/${filename}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
      if (upErr) throw new Error(`Failed to store the PDF: ${upErr.message}`);
      const { data: row, error: insErr } = await supabase.from('won_vehicle_documents').insert({
        org_id: vehicle.org_id, won_vehicle_id: vehicle.id, document_type: documentType, storage_path: path,
        original_filename: filename, mime_type: 'application/pdf', size_bytes: bytes.length, uploaded_by: user.id,
      }).select('id').single();
      if (insErr) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(`Failed to record the PDF: ${insErr.message}`); }
      return row.id as string;
    };
    const retireDocument = (id: string) => supabase.from('won_vehicle_documents').update({ deleted_at: new Date().toISOString(), deleted_by: user.id }).eq('id', id);
    const abandon = (numberId: string, note: string) => supabase.rpc('mark_document_number', { p_id: numberId, p_status: 'abandoned', p_ref: null, p_note: note });

    // ============================================================ issue_invoice
    if (mode === 'issue_invoice') {
      const vehicle = await loadVehicle(payload.wonVehicleId);
      if (!vehicle) return json({ error: "Won vehicle not found" }, 404);
      const { hat, currency, lines, excluded } = payload;
      const recipient = typeof payload.recipient === 'string' ? payload.recipient.trim().slice(0, 200) : '';
      if (!recipient) return json({ error: "recipient is required (who the invoice is issued to)" }, 400);
      const channel = CHANNELS.includes(payload.channel) ? payload.channel : 'other';
      const notes = typeof payload.notes === 'string' && payload.notes.trim() ? payload.notes.trim().slice(0, 1000) : null;
      const idem = typeof payload.idempotencyKey === 'string' && payload.idempotencyKey.trim() ? payload.idempotencyKey.trim().slice(0, 120) : null;

      if (idem) {
        const { data: existing } = await supabase.from('won_vehicle_invoice_issuances')
          .select('id, invoice_number, document_id, scope, amount, currency').eq('org_id', vehicle.org_id).eq('idempotency_key', idem).maybeSingle();
        if (existing) return json({ success: true, alreadyIssued: true, issuanceId: existing.id, invoiceNumber: existing.invoice_number, documentId: existing.document_id, scope: existing.scope, total: Number(existing.amount), currency: existing.currency });
      }

      const derived = deriveInvoice({ hat, currency, lines: Array.isArray(lines) ? lines : [], excluded: Array.isArray(excluded) ? excluded : [] });
      if (derived.ok === false) return json({ error: derived.errors.join('; '), errors: derived.errors }, 400);

      // Currency frozen ONCE: an NGN invoice takes a live rate now and records it; there is no fallback rate.
      let fx: { rate: number; date: string; source: string } | null = null;
      if (currency === 'NGN') {
        try {
          const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
          const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: ctl.signal }); clearTimeout(timer);
          const body = await res.json();
          const rate = Number(body?.rates?.NGN);
          if (!res.ok || body?.result !== 'success' || !Number.isFinite(rate) || rate < 100 || rate > 100000) throw new Error('unusable rate response');
          fx = { rate: Math.round(rate * 1e8) / 1e8, date: new Date().toISOString().slice(0, 10), source: `open.er-api.com (provider update ${String(body.time_last_update_utc ?? 'unknown')})` };
        } catch (e) {
          return json({ error: `Could not fetch a live USD to NGN exchange rate (${(e as Error).message}). An NGN invoice is never issued on a guessed rate - retry, or issue in USD.` }, 502);
        }
      }

      const fullLines = derived.lines.map(l => ({ kind: l.kind, description: l.description, amount_usd: l.amount_usd, client_visible: l.client_visible, origin: l.origin, basis: l.basis ?? null, source_ref: l.source_ref ?? null }));
      // The DATABASE does the conversion, so what the PDF prints is exactly what will be stored.
      const { data: converted, error: convErr } = await supabase.rpc('convert_invoice_lines', { p_lines: fullLines, p_currency: currency, p_fx: fx?.rate ?? null });
      if (convErr) throw convErr;
      const visible = (converted as Array<{ description: string; amount: number; amount_usd: number; client_visible: boolean }>).filter(l => l.client_visible);
      const totalCents = visible.reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0);
      const totalUsdCents = visible.reduce((s, l) => s + Math.round(Number(l.amount_usd) * 100), 0);

      const { data: numRow, error: numErr } = await supabase.rpc('allocate_document_number', { p_org: vehicle.org_id, p_kind: 'invoice', p_user: user.id });
      if (numErr) throw numErr;
      const number = numRow as { id: string; number_text: string };

      let docId: string | null = null;
      try {
        const { clientName, orgName } = await clientAndOrg(vehicle.org_id, vehicle.client_id);
        const pdf = await renderInvoicePdf(pdfLib as never, {
          orgName, number: number.number_text, issuedOn: new Date().toISOString().slice(0, 10), hat, scope: derived.scope, currency, clientName,
          vehicle: vehicleHeading(vehicle.won_snapshot as Record<string, unknown>),
          lines: visible.map(l => ({ description: l.description, amount: Number(l.amount), amount_usd: Number(l.amount_usd) })),
          total: totalCents / 100, totalUsd: totalUsdCents / 100,
          excluded: derived.excluded.map(e => ({ label: KIND_LABEL[e.kind], reason: e.reason })), fx, notes,
        });
        docId = await storePdf(vehicle, 'invoice', `${number.number_text}.pdf`, pdf);
        const { data: issuanceId, error: issueErr } = await supabase.rpc('issue_generated_invoice', {
          p_org: vehicle.org_id, p_vehicle: vehicle.id, p_document: docId, p_number_id: number.id, p_hat: hat, p_scope: derived.scope,
          p_excluded: derived.excluded, p_currency: currency, p_fx_rate: fx?.rate ?? null, p_fx_date: fx?.date ?? null, p_fx_source: fx?.source ?? null,
          p_recipient: recipient, p_channel: channel, p_notes: notes, p_idem: idem, p_user: user.id, p_lines: fullLines,
        });
        if (issueErr) {
          // The same request raced itself and lost at the database (unique idempotency key): return the winner.
          if ((issueErr as { code?: string }).code === '23505' && idem) {
            await retireDocument(docId); await abandon(number.id, 'lost a race for the same idempotency key');
            const { data: winner } = await supabase.from('won_vehicle_invoice_issuances').select('id, invoice_number, document_id, scope, amount, currency').eq('org_id', vehicle.org_id).eq('idempotency_key', idem).maybeSingle();
            if (winner) return json({ success: true, alreadyIssued: true, issuanceId: winner.id, invoiceNumber: winner.invoice_number, documentId: winner.document_id, scope: winner.scope, total: Number(winner.amount), currency: winner.currency });
          }
          throw issueErr;
        }
        return json({ success: true, issuanceId, invoiceNumber: number.number_text, documentId: docId, scope: derived.scope, total: totalCents / 100, totalUsd: totalUsdCents / 100, currency, fx });
      } catch (e) {
        if (docId) await retireDocument(docId);
        await abandon(number.id, `issue failed: ${(e as Error).message}`.slice(0, 300));
        return json({ error: (e as Error).message }, 400);
      }
    }

    // ============================================================ record_payment
    if (mode === 'record_payment') {
      const { data: inv, error: invErr } = await supabase.from('won_vehicle_invoice_issuances').select('id, org_id, won_vehicle_id, currency, generated, voided_at').eq('id', payload.issuanceId).maybeSingle();
      if (invErr) throw invErr;
      if (!inv || !canAccessOrg(inv.org_id)) return json({ error: "Invoice not found" }, 404);
      const amount = Number(payload.amount);
      if (!Number.isFinite(amount) || amount <= 0) return json({ error: "amount must be more than zero" }, 400);
      if (!METHODS.includes(payload.method)) return json({ error: `method must be one of: ${METHODS.join(', ')}` }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.paidAt ?? ''))) return json({ error: "paidAt must be a date (YYYY-MM-DD)" }, 400);
      const { data: row, error } = await supabase.from('won_vehicle_payments').insert({
        org_id: inv.org_id, won_vehicle_id: inv.won_vehicle_id, issuance_id: inv.id, amount, currency: inv.currency, paid_at: payload.paidAt,
        method: payload.method, reference: payload.reference ? String(payload.reference).slice(0, 120) : null,
        notes: payload.notes ? String(payload.notes).slice(0, 500) : null, recorded_by: user.id,
      }).select('id').single();
      if (error) return json({ error: error.message }, 400);   // the database's own refusals (overpay, voided invoice) surface plainly
      const { data: bal } = await supabase.from('won_vehicle_invoice_balances').select('paid, outstanding').eq('issuance_id', inv.id).maybeSingle();
      return json({ success: true, paymentId: row.id, balance: bal });
    }

    if (mode === 'void_payment' || mode === 'void_receipt') {
      const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
      if (!reason) return json({ error: "A reason is required to void" }, 400);
      const table = mode === 'void_payment' ? 'won_vehicle_payments' : 'won_vehicle_receipts';
      const id = mode === 'void_payment' ? payload.paymentId : payload.receiptId;
      const { data: row, error: rowErr } = await supabase.from(table).select('id, org_id, voided_at').eq('id', id).maybeSingle();
      if (rowErr) throw rowErr;
      if (!row || !canAccessOrg(row.org_id)) return json({ error: "Not found" }, 404);
      if (row.voided_at) return json({ error: "Already voided" }, 409);
      const { error } = await supabase.from(table).update({ voided_at: new Date().toISOString(), voided_by: user.id, void_reason: reason }).eq('id', id).is('voided_at', null);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    // ============================================================ issue_receipt
    if (mode === 'issue_receipt') {
      const { data: pay, error: payErr } = await supabase.from('won_vehicle_payments').select('id, org_id, won_vehicle_id, issuance_id, amount, currency, paid_at, method, reference, voided_at').eq('id', payload.paymentId).maybeSingle();
      if (payErr) throw payErr;
      if (!pay || !canAccessOrg(pay.org_id)) return json({ error: "Payment not found" }, 404);
      if (pay.voided_at) return json({ error: "A receipt cannot be issued for a voided payment" }, 400);
      const { data: live } = await supabase.from('won_vehicle_receipts').select('id, receipt_number').eq('payment_id', pay.id).is('voided_at', null).maybeSingle();
      if (live) return json({ success: true, alreadyIssued: true, receiptId: live.id, receiptNumber: live.receipt_number });
      const vehicle = await loadVehicle(pay.won_vehicle_id);
      if (!vehicle) return json({ error: "Won vehicle not found" }, 404);
      const { data: inv } = await supabase.from('won_vehicle_invoice_issuances').select('invoice_number, amount, currency').eq('id', pay.issuance_id).single();
      const { data: bal } = await supabase.from('won_vehicle_invoice_balances').select('paid, outstanding').eq('issuance_id', pay.issuance_id).single();

      const { data: numRow, error: numErr } = await supabase.rpc('allocate_document_number', { p_org: pay.org_id, p_kind: 'receipt', p_user: user.id });
      if (numErr) throw numErr;
      const number = numRow as { id: string; number_text: string };
      let docId: string | null = null;
      try {
        const { clientName, orgName } = await clientAndOrg(vehicle.org_id, vehicle.client_id);
        const pdf = await renderReceiptPdf(pdfLib as never, {
          orgName, number: number.number_text, issuedOn: new Date().toISOString().slice(0, 10), clientName, vehicle: vehicleHeading(vehicle.won_snapshot as Record<string, unknown>),
          invoiceNumber: inv!.invoice_number, paymentAmount: Number(pay.amount), currency: pay.currency, paidOn: pay.paid_at, method: pay.method, reference: pay.reference,
          invoiceTotal: Number(inv!.amount), paidToDate: Number(bal!.paid), outstanding: Number(bal!.outstanding),
        });
        docId = await storePdf(vehicle, 'receipt', `${number.number_text}.pdf`, pdf);
        const { data: receiptId, error: recErr } = await supabase.rpc('issue_receipt_record', {
          p_org: pay.org_id, p_vehicle: pay.won_vehicle_id, p_payment: pay.id, p_document: docId, p_number_id: number.id,
          p_notes: payload.notes ? String(payload.notes).slice(0, 500) : null, p_user: user.id,
        });
        if (recErr) throw recErr;
        return json({ success: true, receiptId, receiptNumber: number.number_text, documentId: docId });
      } catch (e) {
        if (docId) await retireDocument(docId);
        await abandon(number.id, `issue failed: ${(e as Error).message}`.slice(0, 300));
        return json({ error: (e as Error).message }, 400);
      }
    }

    return json({ error: "mode must be one of: issue_invoice, record_payment, void_payment, issue_receipt, void_receipt" }, 400);
  } catch (error) {
    console.error("won-vehicle-billing failed:", error);
    return json({ error: (error as Error).message }, 500);
  }
});

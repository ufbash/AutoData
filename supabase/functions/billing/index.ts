import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import * as pdfLib from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { computeDocument, centsToDecimal, decimalToCents, mulRate, divRate } from "../_shared/documentMath.ts";
import type { CalcInput, CalcResult } from "../_shared/documentMath.ts";
import { buildInvoicePrintModel, buildReceiptPrintModel } from "../_shared/documentPrint.ts";
import type { PrintApplication, PrintDocLine, PrintOrg } from "../_shared/documentPrint.ts";
import { renderInvoicePdf, renderReceiptPdf } from "../_shared/documentTemplate.ts";
import { DEJAVU_REGULAR_B64, DEJAVU_BOLD_B64 } from "../_shared/assets/fontData.ts";
import { auctionFeeComponent, inlandTruckingComponent } from "../_shared/costComponents.ts";

// PROMPT 38 Phase A - the ONLY writer of invoices, retainers, credit notes, payments, applications and receipts.
// Staff-only, behind auth, never reachable through a share token. The org is read off the client / record row, never the request.
//   issue_document   -> checks -> recomputes computed lines from the shared cost code (debt #79) -> computes every figure with
//                       the shared arithmetic AND cross-checks it against the DATABASE's own compute -> number -> PDF stored ->
//                       ONE atomic database call (the database recomputes again at commit and refuses any disagreement)
//   record_payment / apply / void / issue_receipt / file_url
// "computed" is a verified claim here: a line labelled computed is recomputed from the rates and REFUSED if the figure differs.

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
class Refuse extends Error { constructor(msg: string, public status = 400) { super(msg); } }

const BUCKET = 'won-vehicle-documents';
const METHODS = ['bank_transfer', 'cash', 'card', 'cheque', 'other'];
const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const FONTS = { regular: b64(DEJAVU_REGULAR_B64), bold: b64(DEJAVU_BOLD_B64) };

// stable JSON (sorted keys) so the same request always hashes the same
const canon = (v: unknown): string => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v ?? null);
const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('');
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cents = (v: unknown) => decimalToCents(String(v));
const money = (c: number) => Number(centsToDecimal(c));

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new Refuse("Method not allowed", 405);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: "Unauthorized: Missing token" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !key) throw new Error("Missing Supabase configuration");
    const db = createClient(supabaseUrl, key);
    const { data: { user }, error: authError } = await db.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) return json({ error: "Unauthorized: Invalid token" }, 401);

    const { data: memberships, error: memError } = await db.from('memberships').select('org_id, role').eq('user_id', user.id);
    if (memError) throw memError;
    // staff only: a membership that is a CLIENT account (Phase B) never writes billing records
    const staff = (memberships ?? []).filter((m: { role: string }) => m.role !== 'client');
    const isSuperadmin = staff.some((m: { role: string }) => m.role === 'superadmin');
    const canAccessOrg = (orgId: string) => isSuperadmin || staff.some((m: { org_id: string }) => m.org_id === orgId);
    // PROMPT 39 Stage 4 - a client may read THEIR OWN file (billing_files.client_id), never anyone else's, never
    // anything else in this function (every other mode still checks canAccessOrg, which a client role never satisfies).
    const { data: myClientRows } = await db.from('clients').select('id').eq('user_id', user.id);
    const myClientIds = new Set((myClientRows ?? []).map((c: { id: string }) => c.id));

    const payload = await req.json().catch(() => null);
    const mode = payload?.mode;

    // ---------------------------------------------------------------- helpers
    const loadClient = async (id: unknown) => {
      if (!isUuid(id)) throw new Refuse('Choose a client');
      const { data, error } = await db.from('clients').select('id, org_id, full_name, phone, deleted_at').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data || data.deleted_at || !canAccessOrg(data.org_id)) throw new Refuse('Client not found', 404);   // same answer for "missing" and "not yours"
      return data as { id: string; org_id: string; full_name: string; phone: string | null };
    };
    const loadVehicle = async (id: string, orgId: string, clientId: string) => {
      const { data, error } = await db.from('won_vehicles').select('id, org_id, client_id, research_run_listing_id, won_snapshot, deleted_at').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data || data.deleted_at || data.org_id !== orgId) throw new Refuse('Vehicle not found', 404);
      if (data.client_id !== clientId) throw new Refuse("This vehicle does not belong to the chosen client");
      return data as { id: string; org_id: string; client_id: string; research_run_listing_id: string; won_snapshot: Record<string, unknown> | null };
    };
    const loadProfile = async (orgId: string) => {
      const { data: p } = await db.from('org_billing_profile').select('*').eq('org_id', orgId).maybeSingle();
      if (!p) throw new Refuse('This org has no billing profile yet (name, address lines): set it up under Admin before issuing documents');
      let logo: Uint8Array | null = null;
      if (p.logo_path) {
        const { data: f, error } = await db.storage.from(BUCKET).download(p.logo_path);
        if (error || !f) throw new Error(`The org logo could not be read (${error?.message ?? 'missing'})`);
        logo = new Uint8Array(await f.arrayBuffer());
      }
      const org: PrintOrg = { name: p.legal_name, headerLines: p.header_lines ?? [], logoPng: logo, footerNotes: p.footer_notes ?? [], paymentInstructions: p.payment_instructions ?? null, originFootnotes: !!p.origin_footnotes };
      return { org, logoPath: p.logo_path as string | null };
    };
    // the dated tax rates in force on the issue date - exactly one per code
    const taxRatesAsOf = async (orgId: string, date: string) => {
      const { data, error } = await db.from('tax_codes').select('code, rate_percent, effective_from, effective_to').eq('org_id', orgId).lte('effective_from', date).order('code');
      if (error) throw error;
      const rates: Record<string, string> = {};
      for (const r of (data ?? []) as { code: string; rate_percent: string | number; effective_to: string | null }[]) {
        if (r.effective_to && r.effective_to < date) continue;
        if (r.code in rates) throw new Refuse(`Tax code ${r.code} has two dated rates on ${date} - close one (PROJECT_CHARTER 5.10)`);
        rates[r.code] = String(r.rate_percent);
      }
      return rates;
    };
    const storeFile = async (orgId: string, clientId: string, filename: string, bytes: Uint8Array) => {
      const path = `${orgId}/billing/${clientId}/${crypto.randomUUID()}/${filename}`;
      const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
      if (upErr) throw new Error(`Failed to store the PDF: ${upErr.message}`);
      const { data: row, error: insErr } = await db.from('billing_files').insert({ org_id: orgId, client_id: clientId, storage_path: path, filename, size_bytes: bytes.length, created_by: user.id }).select('id').single();
      if (insErr) { await db.storage.from(BUCKET).remove([path]); throw new Error(`Failed to record the PDF: ${insErr.message}`); }
      return row.id as string;
    };
    const retireFile = (id: string) => db.from('billing_files').update({ deleted_at: new Date().toISOString(), deleted_by: user.id }).eq('id', id);
    const allocate = async (orgId: string, kind: string) => {
      const { data, error } = await db.rpc('allocate_document_number', { p_org: orgId, p_kind: kind, p_user: user.id });
      if (error) throw error;
      return data as { id: string; number_text: string; seq: number };
    };
    const abandon = (numberId: string, note: string) => db.rpc('mark_document_number', { p_id: numberId, p_status: 'abandoned', p_ref: null, p_note: note });
    // after a failure: was the record in fact committed (the database call succeeded and only the reply failed)?
    const numberIssued = async (numberId: string) => {
      const { data } = await db.from('document_numbers').select('status, ref_id').eq('id', numberId).maybeSingle();
      return data?.status === 'issued' ? (data.ref_id as string) : null;
    };
    const rpcError = (e: { message: string; code?: string }) => new Refuse(e.message, e.code && /^(P0001|23|22)/.test(e.code) ? 400 : 500);

    // ================================================================ issue_document
    if (mode === 'issue_document') {
      const P = payload;
      const docType = P.docType as 'invoice' | 'retainer' | 'credit_note';
      if (!['invoice', 'retainer', 'credit_note'].includes(docType)) throw new Refuse('Unknown document type');
      const client = await loadClient(P.clientId);
      const orgId = client.org_id;
      const idem = str(P.idempotencyKey, 100);
      if (!idem) throw new Refuse('An idempotency key is required (it stops a double click issuing two documents)');
      const requestHash = await sha256(canon({ ...P, idempotencyKey: undefined }));
      const { data: existing } = await db.from('billing_documents').select('id, number_text, total, request_hash, file_id').eq('org_id', orgId).eq('idempotency_key', idem).maybeSingle();
      if (existing) {
        if (existing.request_hash && existing.request_hash !== requestHash) return json({ error: `The idempotency key was already used for a different document (${existing.number_text}). Nothing was issued.` }, 409);
        return json({ success: true, alreadyIssued: true, documentId: existing.id, numberText: existing.number_text, total: Number(existing.total) });
      }

      const issueDate = str(P.issueDate, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) throw new Refuse('The issue date must be YYYY-MM-DD');
      const currency = P.currency as 'USD' | 'NGN'; const settle = (P.settlementCurrency ?? P.currency) as 'USD' | 'NGN';
      if (!['USD', 'NGN'].includes(currency) || !['USD', 'NGN'].includes(settle)) throw new Refuse('Currency must be USD or NGN');
      const invoiceKind = docType === 'invoice' ? P.invoiceKind : null;
      if (docType === 'invoice' && !['vehicle_purchase', 'retail', 'repair'].includes(invoiceKind)) throw new Refuse('Choose the invoice kind: vehicle purchase, retail or repair');

      const rawLines = Array.isArray(P.lines) ? P.lines : [];
      if (rawLines.length === 0) throw new Refuse('A document needs at least one line');
      if (rawLines.length > 200) throw new Refuse('Too many lines');

      // ---- vehicle: linked (a won vehicle), external (plate/VIN), or none
      let vehicle: Awaited<ReturnType<typeof loadVehicle>> | null = null;
      const ext = P.externalVehicle && typeof P.externalVehicle === 'object' ? P.externalVehicle : null;
      if (P.wonVehicleId) { if (ext) throw new Refuse('A vehicle is either a won vehicle or external, never both'); vehicle = await loadVehicle(P.wonVehicleId, orgId, client.id); }
      const snap = (vehicle?.won_snapshot ?? {}) as Record<string, unknown>;

      // ---- recompute COMPUTED lines from the shared cost code; refuse any that disagree (debt #79)
      let sighting: { id: string; lot_number: string | null; title_type: string | null; location: string | null; source_platform: string | null; source_auction_platform: string | null } | null = null;
      let bid: { id: string; amount_usd: string | number; bid_method: 'proxy' | 'live' | null } | null = null;
      let dest: { destination_port: string; shipping_method: 'container' | 'roro' } | null = null;
      if (vehicle) {
        const { data: l } = await db.from('research_run_listings').select('sighting_id').eq('id', vehicle.research_run_listing_id).maybeSingle();
        if (l?.sighting_id) {
          const { data: s } = await db.from('sightings').select('id, lot_number, title_type, location, source_platform, source_auction_platform, org_id').eq('id', l.sighting_id).maybeSingle();
          if (s && s.org_id === orgId) sighting = s;
        }
        // the CURRENT winning bid: the latest recorded and not voided (a replaced bid is superseded by a later entry)
        const { data: bids } = await db.from('won_vehicle_winning_bids').select('id, amount_usd, bid_method, recorded_at').eq('won_vehicle_id', vehicle.id).is('voided_at', null).order('recorded_at', { ascending: false }).limit(1);
        bid = (bids ?? [])[0] ?? null;
        const { data: dests } = await db.from('won_vehicle_destinations').select('destination_port, shipping_method, set_at').eq('won_vehicle_id', vehicle.id).is('voided_at', null).order('set_at', { ascending: false }).limit(1);
        dest = (dests ?? [])[0] ?? null;
      }
      const lines: Record<string, unknown>[] = [];
      for (const [i, raw] of rawLines.entries()) {
        const l = raw as Record<string, unknown>;
        const position = i + 1;
        const origin = l.origin as string;
        if (!['computed', 'document_backed', 'staff_entered'].includes(origin)) throw new Refuse(`Line ${position}: choose where the figure comes from (computed, document-backed or staff-entered)`);
        const out: Record<string, unknown> = {
          position, section: str(l.section, 80), component: l.component ? str(l.component, 30) : null, description: str(l.description, 300), quantity: l.quantity, rate: l.rate,
          discount_type: l.discountType ?? 'none', discount_value: l.discountValue ?? 0, tax_code: l.taxCode ? str(l.taxCode, 16) : null, client_visible: l.clientVisible !== false, origin,
          basis: str(l.basis, 300) || null, source_ref: null, source_document_id: null, computed_inputs: null,
        };
        if (origin === 'staff_entered' && !out.basis) throw new Refuse(`Line ${position}: a staff figure must state what it rests on (a quote, an agreement, an invoice)`);
        if (origin === 'document_backed') {
          if (!isUuid(l.sourceDocumentId)) throw new Refuse(`Line ${position}: a document-backed line must name the uploaded document`);
          const { data: d } = await db.from('won_vehicle_documents').select('id, org_id, won_vehicle_id, original_filename, deleted_at').eq('id', l.sourceDocumentId).maybeSingle();
          if (!d || d.deleted_at || d.org_id !== orgId || (vehicle && d.won_vehicle_id !== vehicle.id)) throw new Refuse(`Line ${position}: that document is not available for this org and vehicle`);
          out.source_document_id = d.id; out.__docLabel = `the attached document (${d.original_filename})`;
        }
        if (origin === 'computed') {
          if (!vehicle) throw new Refuse(`Line ${position}: a computed line needs a won vehicle to compute from`);
          if (currency !== 'USD') throw new Refuse(`Line ${position}: computed figures are in US dollars - a ${currency} document cannot carry one`);
          if (String(l.quantity) !== '1' && Number(l.quantity) !== 1) throw new Refuse(`Line ${position}: a computed line has quantity 1 (its rate IS the computed figure)`);
          const comp = String(l.component);
          let figure: number | null = null; let ref = ''; let inputs: Record<string, unknown> = {};
          if (comp === 'vehicle_price') {
            if (!bid) throw new Refuse(`Line ${position}: no winning bid is recorded for this vehicle`);
            figure = Number(bid.amount_usd); ref = bid.id; inputs = { component: comp, bidId: bid.id, amountUsd: figure };
          } else if (comp === 'auction_fees') {
            if (!bid || !sighting) throw new Refuse(`Line ${position}: the fee needs the recorded winning bid and the source listing`);
            const c = await auctionFeeComponent(db, { sighting: { id: sighting.id, source_platform: sighting.source_platform, source_auction_platform: sighting.source_auction_platform, location: sighting.location } as never, titleType: sighting.title_type, referencePriceUsd: Number(bid.amount_usd), orgId, bidMethod: bid.bid_method });
            if (c.status !== 'available' || c.amountUsd === null) throw new Refuse(`Line ${position}: the auction fee cannot be computed (${c.reason ?? 'unavailable'}). Enter it as a staff figure with its basis, or link the auction's invoice.`);
            if (c.partialReason) throw new Refuse(`Line ${position}: the auction fee is only a range (${c.partialReason}) - it cannot be a computed line`);
            figure = c.amountUsd; ref = `bid ${bid.id}; ${c.sourceRows.map(r => `${r.label} (${r.source}, effective ${r.effectiveFrom})`).join('; ')}`;
            inputs = { component: comp, bidId: bid.id, bidMethod: bid.bid_method, sightingId: sighting.id, amountUsd: figure, basis: c.basis ?? null, sourceRows: c.sourceRows };
          } else if (comp === 'inland_trucking') {
            if (!sighting || !dest) throw new Refuse(`Line ${position}: trucking needs the source listing and a destination port and method`);
            const c = await inlandTruckingComponent(db, { sighting: { id: sighting.id, source_platform: sighting.source_platform, source_auction_platform: sighting.source_auction_platform, location: sighting.location } as never, destinationPortNormalized: dest.destination_port, shippingMethod: dest.shipping_method, orgId });
            if (c.status !== 'available' || c.amountUsd === null) throw new Refuse(`Line ${position}: trucking cannot be computed (${c.reason ?? 'unavailable'}). Enter it as a staff figure with its basis.`);
            figure = c.amountUsd; ref = c.sourceRows.map(r => `${r.label} (${r.source}, effective ${r.effectiveFrom})`).join('; ');
            inputs = { component: comp, sightingId: sighting.id, destination: dest, amountUsd: figure, detail: c.detail, sourceRows: c.sourceRows };
          } else {
            throw new Refuse(`Line ${position}: "${comp}" cannot be a computed line (only the vehicle price, auction fees and inland trucking can be recomputed; duty and freight have no calculator or stored rate). Enter it as a staff figure, or link a document.`);
          }
          if (cents(figure) !== cents(l.rate)) throw new Refuse(`Line ${position}: the submitted figure ${l.rate} does not match the recomputed ${figure}. A computed line is recomputed from the rates and refused if it differs - re-open the builder, or enter the figure as a staff figure with its basis.`);
          out.component = comp; out.source_ref = ref; out.computed_inputs = inputs;
        }
        lines.push(out);
      }

      // ---- the figures: shared arithmetic, cross-checked against the database's own compute
      const taxRates = await taxRatesAsOf(orgId, issueDate);
      const invDisc = P.invoiceDiscount ?? { type: 'none', value: 0 };
      const adjustment = P.adjustment ?? { amount: 0, label: null };
      const calcInput: CalcInput = {
        lines: lines.map(l => ({ position: l.position as number, section: l.section as string, quantity: l.quantity as string | number, rate: l.rate as string | number,
          discountType: l.discount_type as never, discountValue: l.discount_value as never, taxCode: l.tax_code as string | null, clientVisible: l.client_visible as boolean })),
        invoiceDiscount: { type: invDisc.type ?? 'none', value: invDisc.value ?? 0 }, adjustment: adjustment.amount ?? 0, taxRates,
      };
      let calc: CalcResult;
      try { calc = computeDocument(calcInput); } catch (e) { throw new Refuse((e as Error).message); }
      const { data: dbCalc, error: dbCalcErr } = await db.rpc('billing_compute', { p: {
        org_id: orgId, issue_date: issueDate, adjustment: adjustment.amount ?? 0, invoice_discount: { type: invDisc.type ?? 'none', value: invDisc.value ?? 0 },
        lines: lines.map(l => ({ position: l.position, section: l.section, quantity: l.quantity, rate: l.rate, discount_type: l.discount_type, discount_value: l.discount_value, tax_code: l.tax_code, client_visible: l.client_visible })) } });
      if (dbCalcErr) throw rpcError(dbCalcErr);
      const mismatch = cents(dbCalc.total) !== calc.totalCents || cents(dbCalc.subtotal) !== calc.subtotalCents || cents(dbCalc.tax_total) !== calc.taxTotalCents
        || cents(dbCalc.invoice_discount_amount) !== calc.invoiceDiscountCents
        || (dbCalc.lines as { net_amount: string | number }[]).some((x, i) => cents(x.net_amount) !== calc.lines[i].netCents);
      if (mismatch) throw new Error(`Internal error: the shared arithmetic and the database disagree (${centsToDecimal(calc.totalCents)} vs ${dbCalc.total}). Nothing was issued.`);
      if (calc.totalCents <= 0) throw new Refuse('The document total must be above zero');

      // ---- currency: same currency, or an AGREED / LIVE rate frozen at issue
      let fx: { rate: number; basis: 'agreed' | 'live'; date: string; source: string } | null = null;
      if (settle !== currency) {
        const f = P.fx ?? {};
        if (f.basis === 'live') {
          try {
            const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
            const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`, { signal: ctl.signal }); clearTimeout(timer);
            const body = await res.json(); const rate = Number(body?.rates?.[settle]);
            if (!res.ok || body?.result !== 'success' || !Number.isFinite(rate) || rate <= 0) throw new Error('unusable rate response');
            fx = { rate: Math.round(rate * 1e8) / 1e8, basis: 'live', date: new Date().toISOString().slice(0, 10), source: `open.er-api.com (provider update ${String(body.time_last_update_utc ?? 'unknown')})` };
          } catch (e) { throw new Refuse(`Could not fetch a live ${currency} to ${settle} rate (${(e as Error).message}). Set an agreed rate instead, or retry.`, 502); }
        } else if (f.basis === 'agreed') {
          const rate = Number(f.rate);
          if (!Number.isFinite(rate) || rate <= 0) throw new Refuse('Enter the agreed exchange rate');
          const src = str(f.source, 300);
          if (!src) throw new Refuse('State who agreed the rate (for example "agreed with the client by WhatsApp, 14/09/2026")');
          fx = { rate, basis: 'agreed', date: issueDate, source: src };
        } else throw new Refuse('This document is settled in another currency: choose an agreed rate (with who agreed it) or the live rate');
      }

      // ---- deposits / retainers applied at issue: work out each application in the document's own currency
      const apply: { kind: string; source_id: string; amount: number; source_amount: number; note: string | null }[] = [];
      const appPrint: PrintApplication[] = [];
      for (const a of (Array.isArray(P.apply) ? P.apply : [])) {
        if (docType === 'credit_note') throw new Refuse('Nothing is applied to a credit note');
        if (a.kind === 'payment') {
          const { data: pay } = await db.from('billing_payments').select('id, org_id, client_id, currency, purpose').eq('id', a.sourceId).maybeSingle();
          if (!pay || pay.org_id !== orgId || pay.client_id !== client.id) throw new Refuse('That payment is not this client\'s');
          const sourceAmount = Number(a.sourceAmount);
          const amount = pay.currency === currency ? sourceAmount : (pay.currency === settle && fx ? money(divRate(cents(sourceAmount), fx.rate)) : NaN);
          if (!Number.isFinite(amount)) throw new Refuse(`A ${pay.currency} payment cannot be applied to a ${currency} document settled in ${settle}`);
          apply.push({ kind: 'payment', source_id: pay.id, amount, source_amount: sourceAmount, note: null }); appPrint.push({ kind: 'payment', purpose: pay.purpose, amount, retainerNumber: null });
        } else if (a.kind === 'retainer_credit') {
          const { data: r } = await db.from('billing_documents').select('id, org_id, client_id, number_text, doc_type, currency').eq('id', a.sourceId).maybeSingle();
          if (!r || r.org_id !== orgId || r.client_id !== client.id || r.doc_type !== 'retainer') throw new Refuse('That retainer is not this client\'s');
          const amount = Number(a.sourceAmount);
          apply.push({ kind: 'retainer_credit', source_id: r.id, amount, source_amount: amount, note: null }); appPrint.push({ kind: 'retainer_credit', purpose: null, amount, retainerNumber: r.number_text });
        } else throw new Refuse('Unknown application kind');
      }
      const appliedCents = apply.reduce((s, a) => s + cents(a.amount), 0);
      if (appliedCents > calc.totalCents) throw new Refuse('The applied deposits exceed the document total');

      // ---- credit note: which invoice
      let creditForNumber: string | null = null;
      if (docType === 'credit_note') {
        const { data: inv } = await db.from('billing_documents').select('id, org_id, client_id, number_text, doc_type').eq('id', P.creditForId).maybeSingle();
        if (!inv || inv.org_id !== orgId || inv.client_id !== client.id || inv.doc_type !== 'invoice') throw new Refuse('Choose one of this client\'s invoices to credit');
        creditForNumber = inv.number_text;
      }

      // ---- the org's branding, the parties, the number, the PDF
      const { org, logoPath } = await loadProfile(orgId);
      const billTo = { name: client.full_name, lines: (Array.isArray(P.billToLines) ? P.billToLines : []).map((s: unknown) => str(s, 120)).filter(Boolean).slice(0, 6) };
      const printVehicle = vehicle ? { title: [snap.year, snap.make, snap.model, snap.trim].filter(Boolean).join(' ') || 'Vehicle', lotNo: sighting?.lot_number ?? null, vin: (snap.vin as string) ?? null, plate: null }
        : ext ? { title: str(ext.description, 120) || 'Vehicle', plate: str(ext.plate, 30) || null, vin: str(ext.vin, 30) || null, lotNo: null } : null;
      const num = await allocate(orgId, docType);
      let fileId: string | null = null;
      try {
        const balanceCents = calc.totalCents - appliedCents;
        const dec = (c: number) => Number(centsToDecimal(c));
        const printLines: PrintDocLine[] = lines.map((l, i) => ({
          position: l.position as number, section: l.section as string, description: l.description as string, quantity: Number(l.quantity), rate: Number(l.rate),
          discountAmount: dec(calc.lines[i].discountCents), netAmount: dec(calc.lines[i].netCents), clientVisible: l.client_visible as boolean, origin: l.origin as never,
          basis: l.basis as string | null, sourceRef: l.source_ref as string | null, sourceDocumentLabel: (l.__docLabel as string) ?? null,
        }));
        const model = buildInvoicePrintModel({
          doc: {
            docType, invoiceKind, numberText: num.number_text, issueDate, dueDate: P.dueDate ? str(P.dueDate, 10) : null, currency, settlementCurrency: settle, fxRate: fx?.rate ?? null,
            reference: str(P.reference, 200) || null, scopeStatement: str(P.scopeStatement, 1500) || null, notes: str(P.notes, 1500) || null, total: dec(calc.totalCents),
            invoiceDiscountAmount: dec(calc.invoiceDiscountCents), invoiceDiscountType: invDisc.type ?? 'none', invoiceDiscountValue: Number(invDisc.value ?? 0),
            adjustmentAmount: dec(calc.adjustmentCents), adjustmentLabel: adjustment.label ? str(adjustment.label, 80) : null,
            taxBreakdown: calc.taxBreakdown.map(t => ({ code: t.code, rate: t.ratePercent, base: dec(t.baseCents), amount: dec(t.amountCents) })),
            appliedAtIssue: dec(appliedCents), balanceAtIssue: dec(balanceCents), settlementBalanceAtIssue: fx ? dec(mulRate(balanceCents, fx.rate)) : null, creditForNumber,
          },
          lines: printLines, applications: appPrint, org, client: billTo, vehicle: printVehicle,
        });
        const pdf = await renderInvoicePdf(pdfLib as never, fontkit, FONTS, model);
        fileId = await storeFile(orgId, client.id, `${num.number_text}.pdf`, pdf);
        const { data: newId, error: issueErr } = await db.rpc('issue_billing_document', {
          p_doc: {
            org_id: orgId, doc_type: docType, invoice_kind: invoiceKind, number_id: num.id, client_id: client.id, won_vehicle_id: vehicle?.id ?? null,
            external_plate: ext ? str(ext.plate, 30) || null : null, external_vin: ext ? str(ext.vin, 30) || null : null, external_description: ext ? str(ext.description, 120) || null : null,
            reference: str(P.reference, 200) || null, issue_date: issueDate, due_date: P.dueDate ? str(P.dueDate, 10) : null, currency, settlement_currency: settle,
            fx_rate: fx?.rate ?? null, fx_basis: fx?.basis ?? null, fx_rate_date: fx?.date ?? null, fx_source: fx?.source ?? null, credit_for_id: docType === 'credit_note' ? P.creditForId : null,
            scope_statement: str(P.scopeStatement, 1500) || null, notes: str(P.notes, 1500) || null, invoice_discount: { type: invDisc.type ?? 'none', value: invDisc.value ?? 0 },
            adjustment_label: adjustment.label ? str(adjustment.label, 80) : null, adjustment_amount: adjustment.amount ?? 0, file_id: fileId, idempotency_key: idem, request_hash: requestHash,
            org_snapshot: { org: { name: org.name, headerLines: org.headerLines, footerNotes: org.footerNotes, paymentInstructions: org.paymentInstructions, originFootnotes: org.originFootnotes, logoPath }, billTo, vehicle: printVehicle },
          },
          p_lines: lines.map(({ __docLabel: _d, ...l }) => l), p_apply: apply, p_user: user.id,
        });
        if (issueErr) throw rpcError(issueErr);
        return json({ success: true, documentId: newId, numberText: num.number_text, total: dec(calc.totalCents), balance: dec(balanceCents), fileId });
      } catch (e) {
        // never leave a burned number or a stray PDF: unless the document in fact committed and only the reply failed
        const committed = await numberIssued(num.id);
        if (committed) return json({ success: true, documentId: committed, numberText: num.number_text, recovered: true });
        await abandon(num.id, `issue failed: ${(e as Error).message}`.slice(0, 300));
        if (fileId) await retireFile(fileId);
        throw e;
      }
    }

    // ================================================================ record_payment
    if (mode === 'record_payment') {
      const P = payload; const client = await loadClient(P.clientId); const orgId = client.org_id;
      const amount = Number(P.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount !== Math.round(amount * 100) / 100) throw new Refuse('Enter the amount received (in whole cents)');
      if (!['USD', 'NGN'].includes(P.currency)) throw new Refuse('Currency must be USD or NGN');
      if (!METHODS.includes(P.method)) throw new Refuse('Choose a payment method');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(P.paidAt))) throw new Refuse('The payment date must be YYYY-MM-DD');
      if (P.wonVehicleId) await loadVehicle(P.wonVehicleId, orgId, client.id);
      const apply: { document_id: string; amount: number; source_amount: number; note: null }[] = [];
      for (const a of (Array.isArray(P.apply) ? P.apply : [])) {
        const { data: d } = await db.from('billing_documents').select('id, org_id, client_id, currency, settlement_currency, fx_rate').eq('id', a.documentId).maybeSingle();
        if (!d || d.org_id !== orgId || d.client_id !== client.id) throw new Refuse('That document is not this client\'s');
        const sourceAmount = Number(a.sourceAmount);
        const docAmount = P.currency === d.currency ? sourceAmount : (P.currency === d.settlement_currency && d.fx_rate ? money(divRate(cents(sourceAmount), d.fx_rate)) : NaN);
        if (!Number.isFinite(docAmount)) throw new Refuse(`A ${P.currency} payment cannot be applied to a ${d.currency} document settled in ${d.settlement_currency}`);
        apply.push({ document_id: d.id, amount: docAmount, source_amount: sourceAmount, note: null });
      }
      const { data: id, error } = await db.rpc('record_billing_payment', { p_org: orgId, p_client: client.id, p_vehicle: P.wonVehicleId ?? null, p_amount: amount, p_currency: P.currency, p_paid_at: P.paidAt,
        p_method: P.method, p_purpose: P.purpose === 'deposit' ? 'deposit' : 'payment', p_reference: str(P.reference, 200), p_notes: str(P.notes, 500), p_user: user.id, p_apply: apply });
      if (error) throw rpcError(error);
      return json({ success: true, paymentId: id });
    }

    // ================================================================ apply (an existing payment or retainer to a document)
    if (mode === 'apply') {
      const P = payload;
      const { data: target } = await db.from('billing_documents').select('id, org_id, currency, settlement_currency, fx_rate').eq('id', P.documentId).maybeSingle();
      if (!target || !canAccessOrg(target.org_id)) throw new Refuse('Document not found', 404);
      let sourceAmount = Number(P.sourceAmount); let amount = sourceAmount;
      if (P.kind === 'payment') {
        const { data: pay } = await db.from('billing_payments').select('id, org_id, currency').eq('id', P.sourceId).maybeSingle();
        if (!pay || pay.org_id !== target.org_id) throw new Refuse('Payment not found', 404);
        amount = pay.currency === target.currency ? sourceAmount : (pay.currency === target.settlement_currency && target.fx_rate ? money(divRate(cents(sourceAmount), target.fx_rate)) : NaN);
        if (!Number.isFinite(amount)) throw new Refuse(`A ${pay.currency} payment cannot be applied to a ${target.currency} document settled in ${target.settlement_currency}`);
      } else if (P.kind !== 'retainer_credit') throw new Refuse('Unknown application kind');
      if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) throw new Refuse('Enter the amount to apply');
      const { data: id, error } = await db.rpc('apply_billing_credit', { p_org: target.org_id, p_kind: P.kind, p_source: P.sourceId, p_document: target.id, p_amount: amount, p_source_amount: sourceAmount, p_user: user.id, p_note: str(P.note, 300) });
      if (error) throw rpcError(error);
      return json({ success: true, applicationId: id });
    }

    // ================================================================ void
    if (mode === 'void') {
      const table = { document: 'billing_documents', payment: 'billing_payments', application: 'billing_applications', receipt: 'billing_receipts' }[String(payload.kind)];
      if (!table) throw new Refuse('Unknown record kind');
      const reason = str(payload.reason, 500);
      if (!reason) throw new Refuse('A reason is required');
      const { data: rec } = await db.from(table).select('id, org_id, voided_at').eq('id', payload.id).maybeSingle();
      if (!rec || !canAccessOrg(rec.org_id)) throw new Refuse('Record not found', 404);
      if (rec.voided_at) throw new Refuse('Already voided', 409);
      const { error } = await db.rpc('void_billing_record', { p_kind: payload.kind, p_id: rec.id, p_user: user.id, p_reason: reason });
      if (error) throw rpcError(error);
      return json({ success: true });
    }

    // ================================================================ issue_receipt
    if (mode === 'issue_receipt') {
      const { data: pay } = await db.from('billing_payments').select('id, org_id, client_id, won_vehicle_id, amount, currency, paid_at, method, reference, voided_at').eq('id', payload.paymentId).maybeSingle();
      if (!pay || !canAccessOrg(pay.org_id)) throw new Refuse('Payment not found', 404);
      if (pay.voided_at) throw new Refuse('A voided payment cannot be receipted');
      const { data: live } = await db.from('billing_receipts').select('id, receipt_number').eq('payment_id', pay.id).is('voided_at', null).maybeSingle();
      if (live) return json({ success: true, alreadyIssued: true, receiptId: live.id, receiptNumber: live.receipt_number });
      const client = await loadClient(pay.client_id);
      const { org } = await loadProfile(pay.org_id);
      const { data: apps } = await db.from('billing_applications').select('document_id, amount').eq('payment_id', pay.id).is('voided_at', null);
      const appliedTo = [];
      for (const a of (apps ?? []) as { document_id: string }[]) {
        const { data: bal } = await db.from('billing_document_balances').select('number_text, doc_type, currency, total, outstanding').eq('document_id', a.document_id).maybeSingle();
        if (bal) appliedTo.push({ label: bal.doc_type === 'retainer' ? 'Retainer' : 'Invoice', number: bal.number_text, total: Number(bal.total), paidToDate: Number(bal.total) - Number(bal.outstanding), outstanding: Number(bal.outstanding), currency: bal.currency });
      }
      let vehicleBlock = null;
      if (pay.won_vehicle_id) { const v = await loadVehicle(pay.won_vehicle_id, pay.org_id, client.id); const s = (v.won_snapshot ?? {}) as Record<string, unknown>; vehicleBlock = { title: [s.year, s.make, s.model, s.trim].filter(Boolean).join(' ') || 'Vehicle', vin: (s.vin as string) ?? null }; }
      const num = await allocate(pay.org_id, 'receipt');
      let fileId: string | null = null;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const model = buildReceiptPrintModel({ org, numberText: num.number_text, issueDate: today, client: { name: client.full_name, lines: [] }, vehicle: vehicleBlock,
          payment: { amount: Number(pay.amount), currency: pay.currency, paidOn: pay.paid_at, method: pay.method, reference: pay.reference }, appliedTo });
        const pdf = await renderReceiptPdf(pdfLib as never, fontkit, FONTS, model);
        fileId = await storeFile(pay.org_id, client.id, `${num.number_text}.pdf`, pdf);
        const { data: rid, error } = await db.rpc('issue_billing_receipt', { p_org: pay.org_id, p_payment: pay.id, p_number_id: num.id, p_file_id: fileId, p_snapshot: { appliedTo, amount: pay.amount, currency: pay.currency }, p_user: user.id, p_notes: null });
        if (error) throw rpcError(error);
        return json({ success: true, receiptId: rid, receiptNumber: num.number_text, fileId });
      } catch (e) {
        const committed = await numberIssued(num.id);
        if (committed) return json({ success: true, receiptId: committed, receiptNumber: num.number_text, recovered: true });
        // a race: another request receipted this payment first - return the winner instead of an error
        const { data: winner } = await db.from('billing_receipts').select('id, receipt_number').eq('payment_id', pay.id).is('voided_at', null).maybeSingle();
        await abandon(num.id, `receipt not issued: ${(e as Error).message}`.slice(0, 300));
        if (fileId) await retireFile(fileId);
        if (winner) return json({ success: true, alreadyIssued: true, receiptId: winner.id, receiptNumber: winner.receipt_number });
        throw e;
      }
    }

    // ================================================================ file_url: a short-lived signed link - staff of the
    // org, OR the client this file belongs to (their own billing_files.client_id only).
    if (mode === 'file_url') {
      const { data: f } = await db.from('billing_files').select('id, org_id, client_id, storage_path, filename, deleted_at').eq('id', payload.fileId).maybeSingle();
      if (!f || f.deleted_at || !(canAccessOrg(f.org_id) || myClientIds.has(f.client_id))) throw new Refuse('File not found', 404);
      const { data: signed, error } = await db.storage.from(BUCKET).createSignedUrl(f.storage_path, 300);
      if (error || !signed) throw new Error(`Could not sign the link: ${error?.message}`);
      return json({ success: true, url: signed.signedUrl, filename: f.filename });
    }

    throw new Refuse('Unknown mode');
  } catch (e) {
    if (e instanceof Refuse) return json({ error: e.message }, e.status);
    const msg = (e as { message?: string })?.message ?? String(e);
    console.error('billing error', msg);
    return json({ error: msg }, 500);
  }
});

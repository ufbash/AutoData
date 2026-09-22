import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// PROMPT 34 Stage 5 - the only writer of won_vehicle_invoice_issuances. 'issue' records that an
// invoice document (already uploaded to the vehicle's document store, type 'invoice') was issued to
// a client; 'void' voids an issuance with a reason. Nothing here sends anything, generates an
// invoice, or derives an amount - the amount/currency are staff-entered. Staff-only, behind auth;
// never reachable through a share token. The org is read off the vehicle row, never the request.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHANNELS = ['email', 'whatsapp', 'imessage', 'other'];
const CURRENCIES = ['USD', 'NGN', 'EUR', 'GBP'];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") throw new Error("Method not allowed");

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: "Unauthorized: Missing token" }, 401);
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Missing Supabase configuration");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized: Invalid token" }, 401);

    const { data: memberships, error: memError } = await supabase
      .from('memberships').select('org_id, role').eq('user_id', user.id);
    if (memError) throw memError;
    const isSuperadmin = (memberships ?? []).some((m: { role: string }) => m.role === 'superadmin');
    // PROMPT 39 Stage 3 - a client-role membership must never satisfy a staff-only org check; every staff
    // Edge Function excludes role='client' explicitly (RLS alone is not the boundary for service-role code).
    const canAccessOrg = (orgId: string) =>
      isSuperadmin || (memberships ?? []).some((m: { org_id: string; role: string }) => m.org_id === orgId && m.role !== 'client');

    const payload = await req.json().catch(() => null);
    const mode = payload?.mode;

    if (mode === 'issue') {
      const { wonVehicleId, documentId, invoiceNumber, amount, currency, channel, recipient, issuedAt, notes } = payload;
      if (typeof wonVehicleId !== 'string' || typeof documentId !== 'string') {
        return json({ error: "wonVehicleId and documentId are required" }, 400);
      }
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) return json({ error: "amount must be a positive number" }, 400);
      if (!CURRENCIES.includes(currency)) return json({ error: `currency must be one of: ${CURRENCIES.join(', ')}` }, 400);
      if (!CHANNELS.includes(channel)) return json({ error: `channel must be one of: ${CHANNELS.join(', ')}` }, 400);
      if (typeof recipient !== 'string' || !recipient.trim()) return json({ error: "recipient is required (who it was sent to)" }, 400);

      const issued = issuedAt ? new Date(issuedAt) : new Date();
      if (Number.isNaN(issued.getTime())) return json({ error: "issuedAt is not a valid date" }, 400);
      if (issued.getTime() > Date.now() + 5 * 60 * 1000) return json({ error: "issuedAt cannot be in the future" }, 400);

      const { data: vehicle, error: vehicleError } = await supabase
        .from('won_vehicles').select('id, org_id, deleted_at').eq('id', wonVehicleId).maybeSingle();
      if (vehicleError) throw vehicleError;
      if (!vehicle || vehicle.deleted_at || !canAccessOrg(vehicle.org_id)) return json({ error: "Won vehicle not found" }, 404);

      const { data: doc, error: docError } = await supabase
        .from('won_vehicle_documents').select('id, won_vehicle_id, document_type, deleted_at').eq('id', documentId).maybeSingle();
      if (docError) throw docError;
      if (!doc || doc.won_vehicle_id !== vehicle.id || doc.deleted_at) return json({ error: "Document not found on this vehicle" }, 404);
      if (doc.document_type !== 'invoice') return json({ error: "Only a document of type 'invoice' can be issued as an invoice" }, 400);

      const { data: row, error: insertError } = await supabase
        .from('won_vehicle_invoice_issuances')
        .insert({
          org_id: vehicle.org_id, won_vehicle_id: vehicle.id, document_id: doc.id,
          invoice_number: typeof invoiceNumber === 'string' && invoiceNumber.trim() ? invoiceNumber.trim().slice(0, 80) : null,
          amount: amt, currency, channel, recipient: recipient.trim().slice(0, 200),
          issued_at: issued.toISOString(), issued_by: user.id,
          notes: typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 500) : null,
        })
        .select('*').single();
      if (insertError) return json({ error: `Failed to record issuance: ${insertError.message}` }, 500);
      return json({ success: true, issuance: row });
    }

    if (mode === 'void') {
      const { issuanceId, reason } = payload;
      if (typeof issuanceId !== 'string') return json({ error: "issuanceId is required" }, 400);
      if (typeof reason !== 'string' || !reason.trim()) return json({ error: "A reason is required to void an issuance" }, 400);
      const { data: iss, error: issError } = await supabase
        .from('won_vehicle_invoice_issuances').select('id, org_id, voided_at').eq('id', issuanceId).maybeSingle();
      if (issError) throw issError;
      if (!iss || !canAccessOrg(iss.org_id)) return json({ error: "Issuance not found" }, 404);
      if (iss.voided_at) return json({ error: "This issuance is already voided" }, 400);
      const { error: updateError } = await supabase
        .from('won_vehicle_invoice_issuances')
        .update({ voided_at: new Date().toISOString(), voided_by: user.id, void_reason: reason.trim().slice(0, 500) })
        .eq('id', issuanceId);
      if (updateError) throw updateError;
      return json({ success: true });
    }

    return json({ error: "mode must be 'issue' or 'void'" }, 400);
  } catch (error) {
    console.error("won-vehicle-invoices failed:", error);
    return json({ error: (error as Error).message }, 500);
  }
});

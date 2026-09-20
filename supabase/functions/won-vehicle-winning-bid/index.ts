import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// Debt #60 - the only writer of won_vehicle_winning_bids. 'record' adds the real winning bid for a
// won vehicle (USD, staff-entered, never derived); 'void' voids an entry with a reason. Recording a
// second bid while one is live is allowed - it supersedes the earlier one, which stays in the
// history - but then a note (why it changed) is required. Staff-only, behind auth; never on the
// tracking page. The org is read off the vehicle row, never the request.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_USD = 1_000_000;

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
    const canAccessOrg = (orgId: string) =>
      isSuperadmin || (memberships ?? []).some((m: { org_id: string }) => m.org_id === orgId);

    const payload = await req.json().catch(() => null);
    const mode = payload?.mode;

    if (mode === 'record') {
      const { wonVehicleId, amountUsd, note, evidenceDocumentId, bidMethod } = payload;
      if (typeof wonVehicleId !== 'string') return json({ error: "wonVehicleId is required" }, 400);
      const amount = Number(amountUsd);
      if (!Number.isFinite(amount) || amount <= 0) return json({ error: "amountUsd must be a positive number" }, 400);
      if (amount > MAX_USD) return json({ error: `amountUsd cannot exceed ${MAX_USD.toLocaleString()} - check for a stray digit` }, 400);
      const rounded = Math.round(amount * 100) / 100;
      // Optional: how the bid was placed. Empty/absent = not known.
      if (bidMethod != null && bidMethod !== '' && !['proxy', 'live'].includes(bidMethod)) {
        return json({ error: "bidMethod must be 'proxy' or 'live' (or omitted when not known)" }, 400);
      }
      const method = bidMethod === 'proxy' || bidMethod === 'live' ? bidMethod : null;

      const { data: vehicle, error: vehicleError } = await supabase
        .from('won_vehicles').select('id, org_id, deleted_at').eq('id', wonVehicleId).maybeSingle();
      if (vehicleError) throw vehicleError;
      if (!vehicle || vehicle.deleted_at || !canAccessOrg(vehicle.org_id)) return json({ error: "Won vehicle not found" }, 404);

      let evidenceId: string | null = null;
      if (evidenceDocumentId != null && evidenceDocumentId !== '') {
        if (typeof evidenceDocumentId !== 'string') return json({ error: "evidenceDocumentId must be a document id" }, 400);
        const { data: doc, error: docError } = await supabase
          .from('won_vehicle_documents').select('id, won_vehicle_id, deleted_at').eq('id', evidenceDocumentId).maybeSingle();
        if (docError) throw docError;
        if (!doc || doc.won_vehicle_id !== vehicle.id || doc.deleted_at) return json({ error: "Evidence document not found on this vehicle" }, 404);
        evidenceId = doc.id;
      }

      const { data: live, error: liveError } = await supabase
        .from('won_vehicle_winning_bids').select('id, amount_usd')
        .eq('won_vehicle_id', vehicle.id).is('voided_at', null)
        .order('recorded_at', { ascending: false }).limit(1);
      if (liveError) throw liveError;
      const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null;
      if (live && live.length > 0 && !cleanNote) {
        return json({ error: `A winning bid ($${Number(live[0].amount_usd).toLocaleString()}) is already recorded. Add a note saying why it is being replaced.` }, 400);
      }

      const { data: row, error: insertError } = await supabase
        .from('won_vehicle_winning_bids')
        .insert({
          org_id: vehicle.org_id, won_vehicle_id: vehicle.id, amount_usd: rounded, bid_method: method,
          note: cleanNote, evidence_document_id: evidenceId, recorded_by: user.id,
        })
        .select('*').single();
      if (insertError) return json({ error: `Failed to record the winning bid: ${insertError.message}` }, 500);
      return json({ success: true, winningBid: row });
    }

    if (mode === 'void') {
      const { bidId, reason } = payload;
      if (typeof bidId !== 'string') return json({ error: "bidId is required" }, 400);
      if (typeof reason !== 'string' || !reason.trim()) return json({ error: "A reason is required to void a winning bid" }, 400);
      const { data: bid, error: bidError } = await supabase
        .from('won_vehicle_winning_bids').select('id, org_id, voided_at').eq('id', bidId).maybeSingle();
      if (bidError) throw bidError;
      if (!bid || !canAccessOrg(bid.org_id)) return json({ error: "Winning bid not found" }, 404);
      if (bid.voided_at) return json({ error: "This winning bid is already voided" }, 400);
      const { error: updateError } = await supabase
        .from('won_vehicle_winning_bids')
        .update({ voided_at: new Date().toISOString(), voided_by: user.id, void_reason: reason.trim().slice(0, 500) })
        .eq('id', bidId);
      if (updateError) throw updateError;
      return json({ success: true });
    }

    return json({ error: "mode must be 'record' or 'void'" }, 400);
  } catch (error) {
    console.error("won-vehicle-winning-bid failed:", error);
    return json({ error: (error as Error).message }, 500);
  }
});

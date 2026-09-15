import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// PROMPT 34 Stage 3 - the ONE thing shareable without login (PROJECT_CHARTER.md §7): status and
// tracking only. Same unauthenticated-but-unguessable-token pattern as public-run/index.ts
// (token format, share_enabled check, service-role client to bypass RLS for the lookup itself).
//
// The payload below is a hand-built object literal, field by field, matching public-run's own
// "deliberate, minimal widening" style (§5.9) - never a wildcard select, never the raw won_vehicle
// or won_snapshot row. Adding a field here is a deliberate, reviewed act requiring a redeploy.
// NO invoice, cost, fee, or document field may ever be added to this response - see
// DECISIONS.md for why this is locked, not just currently true.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STATUS_SEQUENCE = [
  'won', 'auction_paid', 'title_received', 'picked_up', 'at_origin_port',
  'sailed', 'arrived', 'customs_cleared', 'delivered',
];

const STATUS_LABELS: Record<string, string> = {
  won: 'Won',
  auction_paid: 'Auction paid',
  title_received: 'Title received',
  picked_up: 'Picked up from yard',
  at_origin_port: 'At origin port',
  sailed: 'Sailed',
  arrived: 'Arrived (destination port)',
  customs_cleared: 'Customs cleared',
  delivered: 'Delivered',
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let token = url.searchParams.get('token');
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (!token) token = body.token;
    }

    if (!token || typeof token !== 'string' || !/^[A-Za-z0-9]{32,128}$/.test(token)) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { data: wonVehicle, error: wvError } = await supabase
      .from('won_vehicles')
      .select('id, promoted_at')
      .eq('share_token', token)
      .eq('share_enabled', true)
      .is('deleted_at', null)
      .single();

    if (wvError || !wonVehicle) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: history, error: historyError } = await supabase
      .from('won_vehicle_status_history')
      .select('status, changed_at, is_correction')
      .eq('won_vehicle_id', wonVehicle.id)
      .order('created_at', { ascending: true });
    if (historyError) throw historyError;

    // Current status: the latest row by time, correction or not - the client-facing page shows
    // where the car actually is, not the correction trail itself (Bashir: "internal error
    // handling isn't client-facing information").
    const rows = history || [];
    const latest = rows[rows.length - 1];
    const currentStatus = latest?.status ?? 'won';
    const currentPos = STATUS_SEQUENCE.indexOf(currentStatus);

    // First (non-correction-trail) reached timestamp per status, for the progress ladder -
    // deliberately the EARLIEST time each status was ever reached, not the latest, so a later
    // correction touching an earlier stage doesn't rewrite when the client was first told about
    // it.
    const reachedAt = new Map<string, string>();
    for (const row of rows) {
      if (!reachedAt.has(row.status)) reachedAt.set(row.status, row.changed_at);
    }

    const ladder = STATUS_SEQUENCE.map((status, i) => ({
      status,
      label: STATUS_LABELS[status],
      reached: i <= currentPos,
      at: reachedAt.get(status) ?? null,
    }));

    // PROJECT_CHARTER.md §5.1 honesty doctrine: no estimated arrival date is shown at all. This
    // project has no verified basis for one yet - showing a confident ETA the system cannot
    // support is exactly the failure mode §5.1 exists to prevent. If a real, dated, sourced ETA
    // becomes available later, it is added here deliberately, with its basis stated alongside
    // it - never silently.
    const publicPayload = {
      current_status: currentStatus,
      current_status_label: STATUS_LABELS[currentStatus],
      ladder,
    };

    return new Response(JSON.stringify(publicPayload), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("won-vehicle-tracking failed:", error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

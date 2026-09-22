import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// The only writer of won_vehicle_destinations. 'set' records where a won vehicle is going (port +
// shipping method); it supersedes any earlier entry, which stays in the history. 'void' voids an
// entry with a reason. The port must be one the rate data can actually quote for this org (an
// active trucking_rates row with that exact destination_port_normalized and method), so a free-typed
// string can never become a destination. Staff-only, behind auth; never on the tracking page. The
// org is read off the vehicle row, never the request.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const METHODS = ['container', 'roro'];

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

    if (mode === 'set') {
      const { wonVehicleId, port, method, note } = payload;
      if (typeof wonVehicleId !== 'string') return json({ error: "wonVehicleId is required" }, 400);
      if (typeof port !== 'string' || !port.trim()) return json({ error: "port is required" }, 400);
      if (!METHODS.includes(method)) return json({ error: `method must be one of: ${METHODS.join(', ')}` }, 400);

      const { data: vehicle, error: vehicleError } = await supabase
        .from('won_vehicles').select('id, org_id, deleted_at').eq('id', wonVehicleId).maybeSingle();
      if (vehicleError) throw vehicleError;
      if (!vehicle || vehicle.deleted_at || !canAccessOrg(vehicle.org_id)) return json({ error: "Won vehicle not found" }, 404);

      // Exact match on the stored value: this is the string the trucking lookup uses.
      const { data: known, error: knownError } = await supabase
        .from('trucking_rates').select('id')
        .eq('org_id', vehicle.org_id).eq('destination_port_normalized', port)
        .eq('shipping_method', method).is('effective_to', null).limit(1);
      if (knownError) throw knownError;
      if (!known || known.length === 0) {
        return json({ error: `"${port}" by ${method} is not a destination the current rates can quote` }, 400);
      }

      const { data: row, error: insertError } = await supabase
        .from('won_vehicle_destinations')
        .insert({
          org_id: vehicle.org_id, won_vehicle_id: vehicle.id, destination_port: port, shipping_method: method,
          note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null, set_by: user.id,
        })
        .select('*').single();
      if (insertError) return json({ error: `Failed to save the destination: ${insertError.message}` }, 500);
      return json({ success: true, destination: row });
    }

    if (mode === 'void') {
      const { destinationId, reason } = payload;
      if (typeof destinationId !== 'string') return json({ error: "destinationId is required" }, 400);
      if (typeof reason !== 'string' || !reason.trim()) return json({ error: "A reason is required to void a destination" }, 400);
      const { data: dest, error: destError } = await supabase
        .from('won_vehicle_destinations').select('id, org_id, voided_at').eq('id', destinationId).maybeSingle();
      if (destError) throw destError;
      if (!dest || !canAccessOrg(dest.org_id)) return json({ error: "Destination not found" }, 404);
      if (dest.voided_at) return json({ error: "This destination is already voided" }, 400);
      const { error: updateError } = await supabase
        .from('won_vehicle_destinations')
        .update({ voided_at: new Date().toISOString(), voided_by: user.id, void_reason: reason.trim().slice(0, 500) })
        .eq('id', destinationId);
      if (updateError) throw updateError;
      return json({ success: true });
    }

    return json({ error: "mode must be 'set' or 'void'" }, 400);
  } catch (error) {
    console.error("won-vehicle-destination failed:", error);
    return json({ error: (error as Error).message }, 500);
  }
});

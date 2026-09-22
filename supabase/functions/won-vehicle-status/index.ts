import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// PROMPT 34 Stage 3 - the only path that changes a won vehicle's status. Two modes, two
// authorization levels: 'advance' (any authenticated staff member, exactly current+1, enforced
// by advance_won_vehicle_status()'s own sequence check) and 'correct' (superadmin only, any
// target status, reason required by the table's own CHECK constraint) - a forward mistake is
// cheap for any staff member to make and should be cheap to fix going forward; a correction
// rewrites what the record says happened, and that needs a higher bar plus a stated reason so
// "was this car actually at the port on the 14th" stays answerable.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") throw new Error("Method not allowed");

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized: Missing token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Missing Supabase configuration");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const payload = await req.json();
    const mode = payload?.mode;
    const wonVehicleId = payload?.wonVehicleId;
    const newStatus = payload?.newStatus;
    if (typeof wonVehicleId !== 'string' || typeof newStatus !== 'string') {
      return new Response(JSON.stringify({ error: "wonVehicleId and newStatus are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (mode === 'advance') {
      // Any authenticated STAFF member - PROMPT 39 Stage 3: this had no role check at all until a live hostile-client
      // test (a real client-role token) successfully advanced a vehicle's status through this exact path. Excluding
      // role='client' is not optional here the way it is elsewhere - this is the one function in the codebase that
      // previously trusted "a real logged-in user" as sufficient, and a client token is a real logged-in user.
      const { data: memberships, error: memError } = await supabase
        .from('memberships').select('role').eq('user_id', user.id);
      if (memError) throw memError;
      if (!memberships?.some((m: { role: string }) => m.role === 'staff' || m.role === 'superadmin')) {
        return new Response(JSON.stringify({ error: "Advancing a won vehicle's status is restricted to staff." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const { data, error } = await supabase.rpc('advance_won_vehicle_status', {
        p_won_vehicle_id: wonVehicleId,
        p_new_status: newStatus,
        p_changed_by: user.id,
      });
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ success: true, historyId: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (mode === 'correct') {
      const { data: memberships, error: memError } = await supabase
        .from('memberships').select('role').eq('user_id', user.id);
      if (memError) throw memError;
      const hasAccess = memberships?.some((m: { role: string }) => m.role === 'superadmin');
      if (!hasAccess) {
        return new Response(JSON.stringify({ error: "Correcting a won vehicle's status is restricted to administrators." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const reason = payload?.reason;
      if (typeof reason !== 'string' || reason.trim().length === 0) {
        return new Response(JSON.stringify({ error: "A correction requires a stated reason" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data, error } = await supabase.rpc('correct_won_vehicle_status', {
        p_won_vehicle_id: wonVehicleId,
        p_new_status: newStatus,
        p_changed_by: user.id,
        p_reason: reason,
      });
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ success: true, historyId: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "mode must be 'advance' or 'correct'" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("won-vehicle-status failed:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

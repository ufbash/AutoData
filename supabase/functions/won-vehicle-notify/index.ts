import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { sendEmail } from "../_shared/email.ts";

// PROMPT 34 Stage 5 - the "your vehicle has been won" email. Three modes:
//   'preview' - renders subject/recipient/body and sends NOTHING (content is shown before any send)
//   'test'    - sends the same email, "[TEST]"-prefixed, to the calling staff member's own account
//               address by default. A request may name a different `testRecipient` ONLY if that
//               address is on the WON_NOTIFY_TEST_RECIPIENTS allowlist (a Supabase secret, comma
//               separated) - anything else is refused before any send and recorded as a failure.
//               A client's address can never be reached through 'test'.
//   'send'    - sends to the client's address on file. Never triggered automatically.
//
// The email carries the tracking link and nothing else: no invoice, no cost, no document, no
// arrival estimate (PROJECT_CHARTER.md sections 5.1 and 7). It goes through the shared mailer, so a
// failure is recorded in email_log (status 'failed', with the error) and returned to the caller -
// never swallowed. The link base is a server-side value, never taken from the request, so a staff
// request cannot put an arbitrary link into a client email.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
    const wonVehicleId = payload?.wonVehicleId;
    if (!['preview', 'test', 'send'].includes(mode) || typeof wonVehicleId !== 'string') {
      return json({ error: "mode ('preview'|'test'|'send') and wonVehicleId are required" }, 400);
    }

    const { data: vehicle, error: vehicleError } = await supabase
      .from('won_vehicles')
      .select('id, org_id, client_id, won_snapshot, share_token, share_enabled, deleted_at')
      .eq('id', wonVehicleId).maybeSingle();
    if (vehicleError) throw vehicleError;
    if (!vehicle || vehicle.deleted_at || !canAccessOrg(vehicle.org_id)) return json({ error: "Won vehicle not found" }, 404);

    const { data: client, error: clientError } = await supabase
      .from('clients').select('full_name, email').eq('id', vehicle.client_id).maybeSingle();
    if (clientError) throw clientError;

    const problems: string[] = [];
    if (!vehicle.share_enabled || !vehicle.share_token) {
      problems.push("No active tracking link - generate one first, since the email exists to carry it.");
    }
    if (mode !== 'test' && (!client?.email || !client.email.trim())) {
      problems.push("This client has no email address on file.");
    }

    const baseUrl = (Deno.env.get("APP_BASE_URL") || "https://theautodata.com").replace(/\/+$/, "");
    const trackingUrl = vehicle.share_token ? `${baseUrl}/track/${vehicle.share_token}` : null;

    const snap = (vehicle.won_snapshot ?? {}) as Record<string, unknown>;
    const vehicleDesc = [snap.year, snap.make, snap.model, snap.trim].filter(Boolean).join(" ") || "vehicle";
    const firstName = (client?.full_name ?? "").trim().split(/\s+/)[0] || "there";

    const testPrefix = mode === 'test' ? "[TEST] " : "";
    const subject = `${testPrefix}Good news: your ${vehicleDesc} has been won`;
    const textLines = [
      `Hello ${firstName},`,
      "",
      `Good news - the bid on your ${vehicleDesc} was successful.`,
      "",
      "You can follow its progress at any time here:",
      trackingUrl ?? "(tracking link not yet generated)",
      "",
      "That page shows the vehicle's current stage only. We will be in touch separately about payment and paperwork.",
      "",
      "Caplimo",
    ];
    const text = textLines.join("\n");
    const linkHtml = trackingUrl
      ? `<a href="${escapeHtml(trackingUrl)}" style="color:#a58039;font-weight:bold;">${escapeHtml(trackingUrl)}</a>`
      : "<em>(tracking link not yet generated)</em>";
    const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;color:#403f4c;">
  <tr><td style="padding:24px;max-width:560px;">
    <p style="font-size:16px;">Hello ${escapeHtml(firstName)},</p>
    <p style="font-size:16px;">Good news &mdash; the bid on your <strong>${escapeHtml(vehicleDesc)}</strong> was successful.</p>
    <p style="font-size:15px;">You can follow its progress at any time here:</p>
    <p style="font-size:15px;">${linkHtml}</p>
    <p style="font-size:14px;color:#6b6a75;">That page shows the vehicle's current stage only. We will be in touch separately about payment and paperwork.</p>
    <p style="font-size:14px;">Caplimo</p>
  </td></tr>
</table>`.trim();

    let toEmail = mode === 'test' ? (user.email ?? null) : (client?.email?.trim() ?? null);
    if (mode === 'test' && typeof payload?.testRecipient === 'string' && payload.testRecipient.trim()) {
      const requested = payload.testRecipient.trim();
      const allowlist = (Deno.env.get("WON_NOTIFY_TEST_RECIPIENTS") ?? "")
        .split(",").map((e: string) => e.trim().toLowerCase()).filter(Boolean);
      const isOwn = (user.email ?? "").toLowerCase() === requested.toLowerCase();
      if (!isOwn && !allowlist.includes(requested.toLowerCase())) {
        // Refused before any send. Recorded, so an attempt to aim a test at an unlisted address is visible.
        await supabase.from('email_log').insert({
          org_id: vehicle.org_id, purpose: 'won_vehicle_notification_test', recipient_email: requested,
          subject, related_table: 'won_vehicles', related_id: vehicle.id, status: 'failed',
          error_text: 'Refused: this address is not on the test-recipient allowlist. Nothing was sent.',
        });
        return json({ sent: false, to: requested, error: "That address is not an allowed test recipient. Nothing was sent.", refused: true }, 403);
      }
      toEmail = requested;
    }
    if (mode === 'test' && !toEmail) problems.push("Your account has no email address to send a test to.");

    if (mode === 'preview') {
      return json({ preview: true, to: client?.email ?? null, subject, text, trackingUrl, problems });
    }
    if (problems.length > 0 || !toEmail) {
      return json({ error: problems.join(" "), problems }, 400);
    }

    const result = await sendEmail({
      supabase,
      orgId: vehicle.org_id,
      purpose: mode === 'test' ? 'won_vehicle_notification_test' : 'won_vehicle_notification',
      toEmail,
      subject,
      html,
      text,
      relatedTable: 'won_vehicles',
      relatedId: vehicle.id,
    });

    if (!result.ok) {
      // Already recorded in email_log by the shared mailer; surfaced here so the caller sees it.
      return json({ sent: false, to: toEmail, error: result.errorText ?? "The email could not be sent", recorded: true }, 502);
    }
    return json({ sent: true, to: toEmail, subject, trackingUrl });
  } catch (error) {
    console.error("won-vehicle-notify failed:", error);
    return json({ error: (error as Error).message }, 500);
  }
});

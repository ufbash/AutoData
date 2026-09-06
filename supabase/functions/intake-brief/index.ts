import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// CORS and token-format validation copied from public-run/index.ts - same shape, same
// unauthenticated-but-unguessable-token pattern. No X-Research-Secret here: this is reached by
// a client's own browser, not the extension.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Exactly the intake-form fields on client_briefs (Prompt 14's migration 024). Never status,
// org_id, client_id, id, share_token, share_enabled, created_at/_by, deleted_at/_by,
// submitted_at, confirmation_sent_at - all system-controlled, never client-writable. This list
// is used both to shape the GET response and to pick allowed keys out of a POST body, so a
// write can only ever touch what a read could see.
const BRIEF_FIELDS = [
  "make", "model", "trim", "year_min", "year_max", "max_mileage",
  "transmission", "fuel_type", "condition_required", "titles_accepted",
  "colour_preference", "interior_preference", "quantity",
  "max_budget_usd", "max_bid_usd", "additional_notes",
  "preferred_auction_sources", "pickup_delivery_location",
  "inspection_required", "inspection_scope", "payment_method",
  "damage_tolerance_accepted", "shipping_insurance_optin",
  "consent_to_bid", "consent_share_with_auction_houses",
] as const;

function pickAllowed(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of BRIEF_FIELDS) {
    if (key in body) out[key] = body[key];
  }
  return out;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let token: string | null = url.searchParams.get("token");
    let body: Record<string, unknown> = {};

    if (req.method === "POST") {
      body = await req.json().catch(() => ({}));
      if (!token && typeof body.token === "string") token = body.token;
    }

    // Same format check as public-run: reject garbage before ever touching the database.
    if (!token || typeof token !== "string" || !/^[A-Za-z0-9]{32,128}$/.test(token)) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // A token must match an existing, enabled, non-deleted brief - same three-condition shape
    // as public-run's research_runs lookup. No distinction is exposed between "no such token"
    // and "token exists but disabled/deleted" - same generic 404 either way.
    const { data: brief, error: briefError } = await supabase
      .from("client_briefs")
      .select(`id, org_id, client_id, ${BRIEF_FIELDS.join(", ")}, client:clients(full_name)`)
      .eq("share_token", token)
      .eq("share_enabled", true)
      .is("deleted_at", null)
      .single();

    if (briefError || !brief) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET") {
      const { id, org_id, client_id, client, ...allowed } = brief as any;
      return new Response(JSON.stringify({
        brief: allowed,
        client_name: client?.full_name ?? null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      // Allow-list by construction: only known intake-form keys are ever read out of the
      // body. status, org_id, client_id, and the token itself cannot reach the update payload
      // no matter what the client sends - they are simply never looked up.
      const patch = pickAllowed(body);
      patch.status = "pending_review"; // server-set, always - the client cannot approve their own brief
      patch.submitted_at = new Date().toISOString(); // server-set

      const { data: updated, error: updateError } = await supabase
        .from("client_briefs")
        .update(patch)
        .eq("id", brief.id)
        .select("*")
        .single();

      if (updateError) throw updateError;

      // The submission itself is already complete and persisted above. Everything from here
      // down is best-effort: DECISIONS.md §6 wants a confirmation copy emailed to the client,
      // but a client filling in thirty fields on a phone must never lose that work because an
      // email bounced. Failure here is caught and logged, never allowed to unwind the update
      // or fail the response - confirmation_sent_at simply stays null, which is itself the
      // record that the copy was not sent.
      try {
        const { data: clientRow } = await supabase
          .from("clients")
          .select("email, full_name")
          .eq("id", brief.client_id)
          .single();

        const resendApiKey = Deno.env.get("RESEND_API_KEY");
        const fromAddress = Deno.env.get("BACKUP_FROM") || "onboarding@resend.dev";

        if (resendApiKey && clientRow?.email) {
          const rows = BRIEF_FIELDS.map((f) => {
            const v = (updated as any)[f];
            const display = v == null ? "Not answered"
              : Array.isArray(v) ? (v.length ? v.join(", ") : "Not answered")
              : typeof v === "boolean" ? (v ? "Yes" : "No")
              : String(v);
            return `<tr><td style="padding:4px 12px 4px 0;color:#666">${f.replace(/_/g, " ")}</td><td style="padding:4px 0"><b>${display}</b></td></tr>`;
          }).join("");

          const html = `
            <h2>Your submission to Caplimo</h2>
            <p>Hi ${clientRow.full_name || ""}, this is a copy of the vehicle requirements you just submitted, for your own records.</p>
            <table>${rows}</table>
            <p>Submitted at: ${patch.submitted_at}</p>
          `;

          const resendResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: fromAddress,
              to: [clientRow.email],
              subject: "Your submission to Caplimo",
              html,
            }),
          });

          if (resendResponse.ok) {
            await supabase
              .from("client_briefs")
              .update({ confirmation_sent_at: new Date().toISOString() })
              .eq("id", brief.id);
          } else {
            const errText = await resendResponse.text();
            console.error("intake-brief: confirmation email failed (Resend):", errText);
          }
        } else {
          console.error("intake-brief: confirmation email skipped - missing RESEND_API_KEY or client email");
        }
      } catch (emailErr) {
        console.error("intake-brief: confirmation email threw:", emailErr);
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("intake-brief error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

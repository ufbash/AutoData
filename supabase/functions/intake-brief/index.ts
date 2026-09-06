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
          // Grouped the same way the form itself is grouped, so the copy reads as a summary
          // of what was submitted rather than a raw field dump. A field left unanswered still
          // appears (never silently hidden), just visually de-emphasised.
          const FIELD_LABELS: Record<string, string> = {
            make: "Make", model: "Model", trim: "Trim", year_min: "Year from", year_max: "Year to",
            quantity: "Quantity needed", max_mileage: "Max mileage", condition_required: "Condition required",
            transmission: "Transmission", fuel_type: "Fuel type", titles_accepted: "Titles accepted",
            damage_tolerance_accepted: "Damage tolerance", colour_preference: "Exterior colour preference",
            interior_preference: "Interior preference", max_budget_usd: "Max budget (USD)",
            max_bid_usd: "Max bid (USD)", preferred_auction_sources: "Preferred auction sources",
            pickup_delivery_location: "Pickup / delivery location", inspection_required: "Inspection required",
            inspection_scope: "Inspection scope", payment_method: "Payment method",
            shipping_insurance_optin: "Shipping insurance", additional_notes: "Additional notes",
            consent_to_bid: "Consent to bid on your behalf",
            consent_share_with_auction_houses: "Consent to share details with auction houses",
          };
          const FIELD_GROUPS: { title: string; fields: string[] }[] = [
            { title: "Vehicle", fields: ["make", "model", "trim", "year_min", "year_max", "quantity"] },
            { title: "Condition and title", fields: ["max_mileage", "condition_required", "transmission", "fuel_type", "titles_accepted", "damage_tolerance_accepted"] },
            { title: "Preferences", fields: ["colour_preference", "interior_preference", "preferred_auction_sources"] },
            { title: "Budget", fields: ["max_budget_usd", "max_bid_usd"] },
            { title: "Logistics", fields: ["pickup_delivery_location", "inspection_required", "inspection_scope", "payment_method", "shipping_insurance_optin"] },
            { title: "Additional notes", fields: ["additional_notes"] },
            { title: "Consent", fields: ["consent_to_bid", "consent_share_with_auction_houses"] },
          ];

          const formatValue = (v: unknown): { text: string; answered: boolean } => {
            if (v == null) return { text: "Not answered", answered: false };
            if (Array.isArray(v)) return v.length ? { text: v.join(", "), answered: true } : { text: "Not answered", answered: false };
            if (typeof v === "boolean") return { text: v ? "Yes" : "No", answered: true };
            return { text: String(v), answered: true };
          };

          const groupsHtml = FIELD_GROUPS.map((group) => {
            const rows = group.fields.map((f) => {
              const { text, answered } = formatValue((updated as any)[f]);
              const valueColor = answered ? "#1a1a1a" : "#999";
              return `<tr>
                <td style="padding:6px 16px 6px 0;color:#666;font-size:13px;white-space:nowrap;vertical-align:top">${FIELD_LABELS[f] || f}</td>
                <td style="padding:6px 0;color:${valueColor};font-size:13px;font-weight:${answered ? "600" : "400"}">${text}</td>
              </tr>`;
            }).join("");
            return `
              <tr><td colspan="2" style="padding:20px 0 6px;border-bottom:1px solid #e5e0d5;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#a58039">${group.title}</td></tr>
              ${rows}
            `;
          }).join("");

          const submittedDate = new Date(patch.submitted_at as string).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

          const html = `
          <div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#F0EDDE;padding:24px">
            <div style="background:#403f4c;color:#fff;padding:20px 28px;border-radius:12px 12px 0 0">
              <div style="font-size:18px;font-weight:700;letter-spacing:0.01em">Caplimo</div>
              <div style="font-size:13px;color:#c9c7d1;margin-top:2px">Vehicle sourcing &amp; brokerage</div>
            </div>
            <div style="background:#fff;padding:28px;border-radius:0 0 12px 12px">
              <h1 style="font-size:16px;color:#403f4c;margin:0 0 4px">Your submission is in</h1>
              <p style="font-size:13px;color:#666;margin:0 0 4px">
                Hi ${clientRow.full_name || "there"}, this is a copy of the vehicle requirements you
                submitted to Caplimo, for your own records. A member of our team will review it shortly.
              </p>
              <p style="font-size:12px;color:#999;margin:0 0 8px">Submitted ${submittedDate}</p>
              <table style="width:100%;border-collapse:collapse">${groupsHtml}</table>
              <p style="font-size:11px;color:#aaa;margin:24px 0 0;padding-top:16px;border-top:1px solid #eee">
                This email was sent by Caplimo because you submitted a vehicle request through our intake form.
                If this wasn't you, you can disregard this message.
              </p>
            </div>
          </div>`;

          const resendResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: `Caplimo <${fromAddress}>`,
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

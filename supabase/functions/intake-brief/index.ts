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

// Prompt 17 Phase 4 - widens the write boundary deliberately, onto a second table. Exactly
// these four columns on `clients`, nothing else - in particular never user_id, deposit_received_at,
// deleted_at, or assigned_agent (staff-only; a client must never choose their own sales rep,
// and a client who could set deposit_received_at would mark their own commitment fee received
// and walk straight through the Prompt 14 gate). Kept as a wholly separate list from
// BRIEF_FIELDS/pickAllowed so the two tables' allow-lists can never be accidentally merged.
const CLIENT_FIELDS = ["full_name", "phone", "email", "preferred_contact"] as const;

function pickAllowedFrom<T extends readonly string[]>(body: Record<string, unknown>, fields: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of fields) {
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

    // A token must match an existing, non-deleted brief. Prompt 18 Phase 4: share_enabled is
    // no longer "does this token resolve at all" - it is "is this brief open for editing".
    // Approval always sets share_enabled false but the link must keep resolving, read-only,
    // per the lifecycle rule (live while pending, read-only once approved, dead only on a
    // manual revoke). So the lookup itself does not filter on share_enabled - the status/
    // share_enabled combination below decides what the token is allowed to do.
    const { data: brief, error: briefError } = await supabase
      .from("client_briefs")
      .select(`id, org_id, client_id, status, share_enabled, ${BRIEF_FIELDS.join(", ")}, client:clients(${CLIENT_FIELDS.join(", ")})`)
      .eq("share_token", token)
      .is("deleted_at", null)
      .single();

    if (briefError || !brief) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isApproved = brief.status === "approved";
    const isLive = brief.share_enabled === true;

    // A brief that is neither approved nor live is a manual revoke on a still-pending brief -
    // the one case that must be a dead link, same generic 404 as an unknown token so no
    // distinction is exposed between "no such token" and "revoked".
    if (!isApproved && !isLive) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET") {
      const { id, org_id, client_id, status, share_enabled, client, ...allowed } = brief as any;
      return new Response(JSON.stringify({
        brief: allowed,
        client_name: client?.full_name ?? null,
        client: client ?? null,
        read_only: isApproved,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      // The server-side rejection matters more than the client-side read-only view: a client
      // with the form tab still open from before approval can still fire this request. If it
      // silently succeeded (or worse, reverted status back to pending_review) it would undo a
      // staff approval - and the spec rules it now drives - without anyone noticing.
      if (isApproved) {
        return new Response(JSON.stringify({ error: "This request has already been approved and can no longer be edited. Contact Caplimo to make a change." }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Allow-list by construction: only known intake-form keys are ever read out of the
      // body. status, org_id, client_id, and the token itself cannot reach the update payload
      // no matter what the client sends - they are simply never looked up.
      const patch = pickAllowedFrom(body, BRIEF_FIELDS);
      patch.status = "pending_review"; // server-set, always - the client cannot approve their own brief
      patch.submitted_at = new Date().toISOString(); // server-set

      const { data: updated, error: updateError } = await supabase
        .from("client_briefs")
        .update(patch)
        .eq("id", brief.id)
        .select("*")
        .single();

      if (updateError) throw updateError;

      // Widened write boundary (Phase 4): exactly the four CLIENT_FIELDS, on the client row
      // identified by brief.client_id read server-side from the token-verified brief above -
      // never a client-supplied id. Same allow-list-by-construction guarantee as the brief
      // patch: id, org_id, user_id, deposit_received_at, deleted_at and assigned_agent are
      // never in CLIENT_FIELDS, so they can never reach this update no matter what the client
      // sends. Best-effort like the email below - a failure here must not lose the brief
      // submission that already succeeded above.
      try {
        const clientPatch = pickAllowedFrom(body, CLIENT_FIELDS);
        if (Object.keys(clientPatch).length > 0) {
          const { error: clientUpdateError } = await supabase
            .from("clients")
            .update(clientPatch)
            .eq("id", brief.client_id);
          if (clientUpdateError) {
            console.error("intake-brief: client contact-info update failed:", clientUpdateError);
          }
        }
      } catch (clientErr) {
        console.error("intake-brief: client contact-info update threw:", clientErr);
      }

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

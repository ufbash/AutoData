import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { GoogleGenAI } from "npm:@google/genai";

// PROMPT 22 Phase 3 — AI document extraction for landed-cost source documents (trucking
// quotes, shipping quotes, customs quotes, assessment notices). Staff-only, JWT +
// superadmin, mirroring extract-vehicle-vision's exact auth pattern (Phase 1 pre-flight
// quoted it in full — this function follows it, does not invent a second one).
//
// The one thing NOT copied from extract-vehicle-vision: that function's prompt says
// "Default to 'NGN' if ambiguous" for an unclear field, which is guessing dressed as a
// default. This function's prompt instead establishes the NOT_VISIBLE convention that, until
// now, existed only in DECISIONS.md/PLAN_TRACKER.md as a description of the not-yet-built
// Daily Sniper feature — never implemented anywhere in this repo (confirmed by grep in
// Phase 1). A field the model cannot confidently read is marked NOT_VISIBLE, never guessed.
//
// This function NEVER writes to cost_rates, trucking_rates, or auction_fee_brackets. It
// writes only to cost_document_extractions (migration 032) with extraction_status defaulting
// to 'pending_review'. Confirming a row into a live rate table is Phase 4's job, done by a
// human, in a separate function/screen.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DOCUMENT_TYPES = ['trucking_quote', 'shipping_quote', 'customs_quote', 'assessment_notice', 'other'];

// The three destination shapes the model may propose a line item belongs to, and the exact
// column vocabulary for each — given to the model so its output can be reviewed directly
// against a real table's fields, never a free-form shape the review screen has to guess at.
const TABLE_FIELD_VOCAB: Record<string, string[]> = {
  cost_rates: ['cost_category', 'label', 'basis', 'rate_unit', 'rate_value', 'rate_value_max'],
  trucking_rates: ['vendor', 'auction_platform', 'yard_state', 'yard_city', 'yard_street', 'destination_port_raw', 'shipping_method', 'price'],
  auction_fee_brackets: ['auction_platform', 'member_account', 'fee_type', 'title_status', 'payment_tier', 'bid_method', 'bracket_min', 'bracket_max', 'fee_unit', 'fee_value'],
};

const EXTRACTION_PROMPT = `You are extracting cost-rate line items from a real-world document (a customs-agent
quote, a shipping quote, a trucking quote, a vehicle-auction invoice, or a Nigerian customs
assessment notice) for a vehicle-import brokerage.

Identify EVERY distinct rate or fee line item in the document. For each one, decide which of
these three destination shapes it best matches, and populate ONLY that shape's fields:

- "cost_rates" fields: cost_category (one of: inland_trucking, ocean_freight, duty_component,
  service_fee, auction_fee), label (free text describing the specific thing, e.g. "Environmental
  Fee" or "Import Duty"), basis (one of: cif, cif_plus_prior, import_duty — only for
  duty_component rows, else NOT_VISIBLE), rate_unit (usd or percent), rate_value (a number),
  rate_value_max (a number, only if the document states a range; otherwise NOT_VISIBLE).
- "trucking_rates" fields: vendor, auction_platform (copart, iaai, manheim, or adesa),
  yard_state, yard_city, yard_street, destination_port_raw, shipping_method (container or
  roro), price (a number).
- "auction_fee_brackets" fields: auction_platform (copart or iaai), member_account, fee_type
  (buyer_fee or bid_fee), title_status (clean or non_clean), payment_tier (secured or
  unsecured), bid_method (proxy or live — only for bid_fee rows, else NOT_VISIBLE), bracket_min
  (a number), bracket_max (a number, or NOT_VISIBLE if the bracket is open-ended), fee_unit
  (usd or percent), fee_value (a number).

CRITICAL RULE — read this twice: for every single field above, you must decide between exactly
three outcomes, and you must never blur them together:
1. If the document plainly states the value, return that value.
2. If the document does not address this field AT ALL (it is simply not the kind of thing this
   document would ever state), return the JSON value null.
3. If the field is the kind of thing this document SHOULD state, but you cannot confidently
   read or determine it — a blurry photograph, a cut-off table edge, ambiguous handwriting,
   two numbers that could each be it — return the exact literal string "NOT_VISIBLE".

**Never guess, never infer, never pick a default or a "most likely" value for outcome 3. A
wrong number reported as read is far worse than an honest NOT_VISIBLE.** This applies even to
fields that feel like they should have an obvious default (a currency, a title status, a
platform) — if the document itself does not make it clear, mark it NOT_VISIBLE, do not assume.

**This rule applies with equal force to your own outside knowledge, not just to unclear
handwriting or image quality.** You may know, from general knowledge, how Nigerian customs
duty is typically computed, or what a line item named "Import Duty" or "Surcharge" usually
means. That outside knowledge must NEVER fill in a field the document itself does not state.
If a document lists a line item by name and an amount, but never states what percentage was
applied or what base that percentage was computed against, then "basis" (and any other
field requiring interpretation beyond literally-printed text) is NOT_VISIBLE for that row —
even if the label is a familiar term you could otherwise explain from training knowledge.
Only mark a field "read" when the document ITSELF prints or clearly displays that fact —
never when you are supplying it from what you already know about the domain.

**Currency guard — a separate, critical rule.** Every monetary field in every destination
shape above (rate_value, rate_value_max, price, fee_value) is USD-only — there is no other
currency option in any of these tables. If a document states an amount in any currency other
than USD (Nigerian Naira/₦/NGN is the one you will see most often, since this brokerage
imports into Nigeria — but treat any non-USD symbol or currency word the same way), you MUST
NOT record that number as if it were a USD amount, and you MUST NOT convert it yourself using
an exchange rate. Mark the monetary field(s) for that row as NOT_VISIBLE, and say which
currency the document actually used in "document_summary" so a human reviewer knows why the
row has no confirmable dollar figure. Only mark a monetary field "read" when the document's
own text or symbol indicates USD (e.g. "$", "USD"), or when the row's context (e.g. a Copart/
IAAI invoice, which is always USD) makes the currency unambiguous.

Return ONLY a JSON object, no markdown formatting, no conversational text, in exactly this
shape:
{
  "document_summary": "<one plain-English sentence describing what this document actually is, for a human reviewer's context>",
  "extracted_rows": [
    { "suggested_target_table": "cost_rates" | "trucking_rates" | "auction_fee_brackets",
      "fields": { "<field name from the matching list above>": <value, or null, or "NOT_VISIBLE">, ... } }
  ]
}
If the document contains no identifiable rate/fee line items at all, return
"extracted_rows": [].`;

function normalizeFields(rawFields: Record<string, any>, tableName: string): Record<string, { value: any; status: string }> {
  const allowed = TABLE_FIELD_VOCAB[tableName] || [];
  const normalized: Record<string, { value: any; status: string }> = {};
  for (const field of allowed) {
    const raw = rawFields ? rawFields[field] : undefined;
    if (raw === 'NOT_VISIBLE') {
      normalized[field] = { value: null, status: 'unreadable' };
    } else if (raw === null || raw === undefined) {
      normalized[field] = { value: null, status: 'not_present' };
    } else {
      normalized[field] = { value: raw, status: 'read' };
    }
  }
  return normalized;
}

// A vision model can misread a partially-legible digit CONFIDENTLY - it doesn't know it's
// wrong, so no amount of "abstain if unsure" prompt instruction catches it. Proven directly
// against a deliberately degraded real invoice during this build: a single extraction pass
// read "$1,385.00" as 1285 and "$230.00" as 430, both reported as status='read', neither
// abstained. The fix is structural: run the extraction twice, independently, and only trust
// a field where both passes produced the exact same value. Disagreement between two honest
// attempts is itself the signal the source isn't reliably legible - the field downgrades to
// 'unreadable' rather than either pass's value being picked arbitrarily.
//
// Known residual limitation, found and not fully solvable by this technique alone: if the
// same misperception occurs deterministically both times (both passes confidently read the
// same wrong digit), the two passes agree with each other while still being wrong - observed
// directly on the same test document ("1385" -> "1285" in both passes). This is why Phase 4's
// review screen must always show the source document next to the figures, not just trust an
// 'agreed' status - cross-pass agreement raises confidence, it does not guarantee correctness.
function fieldsEqual(a: { value: any; status: string }, b: { value: any; status: string }): boolean {
  if (a.status !== b.status) return false;
  if (a.status !== 'read') return true; // both not_present or both unreadable -> agree
  if (typeof a.value === 'number' && typeof b.value === 'number') return a.value === b.value;
  return String(a.value).trim().toLowerCase() === String(b.value).trim().toLowerCase();
}

function reconcileRows(rowsA: any[], rowsB: any[]): any[] {
  const usedB = new Set<number>();
  const findMatch = (rowA: any): number => {
    let best = -1;
    for (let j = 0; j < rowsB.length; j++) {
      if (usedB.has(j)) continue;
      if (rowsB[j].suggested_target_table !== rowA.suggested_target_table) continue;
      const labelA = String(rowA.fields.label?.value ?? rowA.fields.vendor?.value ?? '').toLowerCase();
      const labelB = String(rowsB[j].fields.label?.value ?? rowsB[j].fields.vendor?.value ?? '').toLowerCase();
      if (labelA && labelB && (labelA === labelB || labelA.includes(labelB) || labelB.includes(labelA))) {
        best = j; break;
      }
      if (best === -1) best = j; // fallback: first unclaimed same-table row
    }
    return best;
  };

  return rowsA.map((rowA) => {
    const j = findMatch(rowA);
    if (j === -1) {
      // No pass-B counterpart at all - cannot cross-validate any field in this row.
      const downgraded: Record<string, { value: any; status: string }> = {};
      for (const k of Object.keys(rowA.fields)) downgraded[k] = { value: null, status: 'unreadable' };
      return { suggested_target_table: rowA.suggested_target_table, fields: downgraded, cross_check: 'no_match_in_second_pass' };
    }
    usedB.add(j);
    const rowB = rowsB[j];
    const reconciled: Record<string, { value: any; status: string }> = {};
    let disagreements = 0;
    for (const k of Object.keys(rowA.fields)) {
      const fA = rowA.fields[k];
      const fB = rowB.fields[k] || { value: null, status: 'not_present' };
      if (fieldsEqual(fA, fB)) {
        reconciled[k] = fA;
      } else {
        reconciled[k] = { value: null, status: 'unreadable' };
        disagreements++;
      }
    }
    return { suggested_target_table: rowA.suggested_target_table, fields: reconciled, cross_check: disagreements === 0 ? 'agreed' : `${disagreements}_field(s)_disagreed` };
  });
}

async function runOnePass(ai: any, modelName: string, filePart: any): Promise<{ document_summary: string | null; extracted_rows: any[] }> {
  const parts: any[] = [{ text: EXTRACTION_PROMPT }, filePart];
  const response = await ai.models.generateContent({
    model: modelName,
    contents: [{ role: 'user', parts }]
  });
  const text = response.text;
  if (!text) throw new Error("No response from AI");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const cleanJson = jsonMatch ? jsonMatch[0] : text;
  const parsed = JSON.parse(cleanJson);
  return {
    document_summary: parsed.document_summary ?? null,
    extracted_rows: (parsed.extracted_rows || []).map((row: any) => ({
      suggested_target_table: row.suggested_target_table,
      fields: normalizeFields(row.fields, row.suggested_target_table),
    })),
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      throw new Error("Method not allowed");
    }

    // --- Auth: JWT + superadmin, identical pattern to extract-vehicle-vision ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized: Missing token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: memberships, error: memError } = await supabase
      .from('memberships')
      .select('org_id, role')
      .eq('user_id', user.id);
    if (memError) throw memError;

    const isSuperadmin = memberships?.some(m => m.role === 'superadmin');
    if (!isSuperadmin) {
      return new Response(JSON.stringify({ error: "Cost document extraction is restricted to administrators." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --- Payload ---
    const payloadText = await req.text();
    let payload: any;
    try {
      payload = JSON.parse(payloadText);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON format" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { document_type, filename, mime_type, file_base64 } = payload;
    let { org_id } = payload;

    if (!document_type || !DOCUMENT_TYPES.includes(document_type)) {
      return new Response(JSON.stringify({ error: `document_type must be one of: ${DOCUMENT_TYPES.join(', ')}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!mime_type || !file_base64) {
      return new Response(JSON.stringify({ error: "mime_type and file_base64 are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // org_id: client-suggested but membership-validated (app-ingest's pattern,
    // docs/SOLVED.md topic 8) — never blindly trusted, never silently defaulted.
    if (!org_id) {
      if (!memberships || memberships.length === 0) {
        return new Response(JSON.stringify({ error: "No organization membership." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else if (memberships.length === 1) {
        org_id = memberships[0].org_id;
      } else {
        return new Response(JSON.stringify({ error: "Multiple org memberships; org_id required." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else {
      const isMember = memberships?.some(m => m.org_id === org_id);
      if (!isMember) {
        return new Response(JSON.stringify({ error: "Not a member of the requested org" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // --- Upload the original document first. The document must be retained regardless of
    // what happens to the AI call below (Phase 3's "a failed extraction ... keeps the
    // document" rule) — so storage happens before extraction is even attempted. ---
    const bytes = Uint8Array.from(atob(file_base64), c => c.charCodeAt(0));
    const safeName = (filename || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${org_id}/${crypto.randomUUID()}/${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from('cost-documents')
      .upload(storagePath, bytes, { contentType: mime_type, upsert: false });
    if (uploadError) {
      return new Response(JSON.stringify({ error: `Failed to store document: ${uploadError.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- Extraction. Any failure here is recorded on the row, not thrown away. ---
    let extractedRows: any[] = [];
    let extractionError: string | null = null;
    let documentSummary: string | null = null;

    try {
      const apiKey = Deno.env.get("GEMINI_API_KEY");
      if (!apiKey) throw new Error("Server configuration error: Gemini API key missing");

      const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1' } });
      const modelName = "gemini-3.1-flash-lite";

      let filePart: any;
      if (mime_type.startsWith('text/')) {
        // Trivial case: decode and paste inline rather than as binary inlineData.
        const text = new TextDecoder().decode(bytes);
        filePart = { text: `\n\nDocument content:\n${text}` };
      } else {
        // PDFs and images both go through inlineData — Gemini's vision models accept
        // application/pdf the same way they accept image/* (native multi-page document
        // support), so no separate PDF-to-image conversion step is needed here.
        filePart = { inlineData: { data: file_base64, mimeType: mime_type } };
      }

      // Two independent passes, reconciled — see reconcileRows()'s comment for why a single
      // pass is not sufficient (a confident, consistent misread survives "abstain if unsure").
      const [passA, passB] = await Promise.all([
        runOnePass(ai, modelName, filePart),
        runOnePass(ai, modelName, filePart),
      ]);

      documentSummary = passA.document_summary;
      extractedRows = reconcileRows(passA.extracted_rows, passB.extracted_rows);
    } catch (err: any) {
      extractionError = err.message || String(err);
      extractedRows = [];
    }

    // --- Insert the staging row. Always happens, success or failure. ---
    const { data: inserted, error: insertError } = await supabase
      .from('cost_document_extractions')
      .insert({
        org_id,
        document_type,
        storage_path: storagePath,
        original_filename: filename || null,
        mime_type,
        extracted_rows: extractedRows,
        extraction_error: extractionError,
        created_by: user.id,
      })
      .select('*')
      .single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ ...inserted, document_summary: documentSummary }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("extract-cost-document error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// PROMPT 40 Stage 1 - RETIRED. This was the Phase 2 (Prompt 37) billing engine: six-digit numbering
// (INV-000001, INV-000002 - both voided), issue_invoice/record_payment/void_payment/issue_receipt/void_receipt.
// Its tables (won_vehicle_invoice_issuances, _lines, _payments, _receipts) never fed the real numbering ledger
// that now continues Caplimo's own paper trail (migration 061), so a document issued here would sit entirely
// outside it. The current engine is `billing` (Prompt 38/39), reached through the invoice editor.
//
// This function refuses EVERY request unconditionally, before parsing the mode or touching any table - no
// number is ever allocated, no row is ever written. It is kept (not deleted) only because deleting it would be
// one more thing to explain later; the two real historical rows this engine created stay exactly as they are,
// voided, and are still read straight through RLS from the browser - nothing here gates that, since this
// function was never the read path to begin with.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return json(
    { error: "This billing path is retired. Existing records are still readable; new documents are issued through the current invoice editor." },
    410,
  );
});

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// PROMPT 34 Stage 4 - the ONLY write path for won_vehicle_documents. Two modes: 'upload' and
// 'delete' (soft). Reads go straight through RLS from the browser; there is no client INSERT/
// UPDATE/DELETE policy on the table or the bucket, so nothing else can create, alter or remove a
// document. Staff-only: any member of the won vehicle's org (or a superadmin). Nothing here is
// reachable by a client or a share token (PROJECT_CHARTER.md section 7).
//
// The org is NEVER taken from the request. It is read off the won vehicle row, and the caller must
// be a member of THAT org - a caller cannot file a document into an org they belong to against a
// vehicle in another (the table's composite FK enforces the same thing again at the database).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DOCUMENT_TYPES = ['invoice', 'receipt', 'shipping_document', 'bill_of_lading', 'title', 'assessment_notice', 'other'];
const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 8 * 1024 * 1024;

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

    if (mode === 'upload') {
      const { wonVehicleId, documentType, filename, mimeType, fileBase64 } = payload;
      if (typeof wonVehicleId !== 'string' || typeof fileBase64 !== 'string' || typeof mimeType !== 'string') {
        return json({ error: "wonVehicleId, mimeType and fileBase64 are required" }, 400);
      }
      if (!DOCUMENT_TYPES.includes(documentType)) {
        return json({ error: `documentType must be one of: ${DOCUMENT_TYPES.join(', ')}` }, 400);
      }
      if (!ALLOWED_MIME.includes(mimeType)) {
        return json({ error: `Unsupported file type. Allowed: PDF, PNG, JPEG, WebP.` }, 400);
      }

      const { data: vehicle, error: vehicleError } = await supabase
        .from('won_vehicles').select('id, org_id, deleted_at').eq('id', wonVehicleId).maybeSingle();
      if (vehicleError) throw vehicleError;
      // Same answer for "does not exist" and "not yours": a caller learns nothing about vehicles
      // in other orgs.
      if (!vehicle || vehicle.deleted_at || !canAccessOrg(vehicle.org_id)) {
        return json({ error: "Won vehicle not found" }, 404);
      }

      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(fileBase64), c => c.charCodeAt(0));
      } catch {
        return json({ error: "fileBase64 is not valid base64" }, 400);
      }
      if (bytes.length === 0) return json({ error: "The file is empty" }, 400);
      if (bytes.length > MAX_BYTES) return json({ error: "The file is larger than 8 MB" }, 413);

      const safeName = String(filename || 'document').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
      const storagePath = `${vehicle.org_id}/${vehicle.id}/${crypto.randomUUID()}/${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from('won-vehicle-documents')
        .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
      if (uploadError) return json({ error: `Failed to store document: ${uploadError.message}` }, 500);

      const { data: row, error: insertError } = await supabase
        .from('won_vehicle_documents')
        .insert({
          org_id: vehicle.org_id,
          won_vehicle_id: vehicle.id,
          document_type: documentType,
          storage_path: storagePath,
          original_filename: String(filename || safeName).slice(0, 200),
          mime_type: mimeType,
          size_bytes: bytes.length,
          uploaded_by: user.id,
        })
        .select('*')
        .single();
      if (insertError) {
        // The file was written a moment ago by this same request and no row references it - remove
        // that orphan so a failed upload leaves nothing behind. Not applicable to any document
        // that has a row: those are never removed from storage.
        await supabase.storage.from('won-vehicle-documents').remove([storagePath]);
        return json({ error: `Failed to record document: ${insertError.message}` }, 500);
      }
      return json({ success: true, document: row });
    }

    if (mode === 'delete') {
      const { documentId } = payload;
      if (typeof documentId !== 'string') return json({ error: "documentId is required" }, 400);
      const { data: doc, error: docError } = await supabase
        .from('won_vehicle_documents').select('id, org_id, deleted_at').eq('id', documentId).maybeSingle();
      if (docError) throw docError;
      if (!doc || !canAccessOrg(doc.org_id)) return json({ error: "Document not found" }, 404);
      if (doc.deleted_at) return json({ success: true, alreadyDeleted: true });

      // Soft delete only. The stored file is deliberately left in place: the original is always
      // retained (migration 023's pattern; a financial record is never destroyed by a click).
      const { error: updateError } = await supabase
        .from('won_vehicle_documents')
        .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
        .eq('id', documentId);
      if (updateError) throw updateError;
      return json({ success: true });
    }

    return json({ error: "mode must be 'upload' or 'delete'" }, 400);
  } catch (error) {
    console.error("won-vehicle-documents failed:", error);
    return json({ error: (error as Error).message }, 500);
  }
});

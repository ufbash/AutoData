import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { canonicalizeForFingerprint } from "../_shared/specVocabulary.ts";
import { fetchAllVerified } from "../_shared/paginatedRead.ts";
import { detectMergeConflicts, detectFieldDisagreements } from "../_shared/assetMergeConflicts.ts";
import { createHash } from "node:crypto";

// PROMPT 32 Stage 2 (debt #46) - read-only merge-candidate detection. Never merges anything
// itself (AGENTS.md standing rule for this feature: nothing merges automatically, ever - see
// DECISIONS.md). Reuses the exact same canonicalizeForFingerprint this repo already uses at
// capture time (research-capture/index.ts, app-ingest/index.ts) rather than a second,
// independently-written normaliser - that divergence is exactly what Prompt 29 Stage 2 spent
// its own time unwinding for the sold-group definition, and this function must never repeat it.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AssetRow {
  id: string;
  org_id: string;
  vin: string | null;
  make: string;
  model: string;
  year: number | null;
  trim: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  origin_status: string | null;
  fingerprint_hash: string;
  merged_into_asset_id: string | null;
  [key: string]: unknown;
}

// Byte-identical to generate_fingerprint's VIN-less branch, and to what research-capture/
// app-ingest actually pass at capture time: p_origin_status is ALWAYS null there (hardcoded at
// the call site), p_exterior_color/p_interior_color are the raw captured values.
function vinlessFingerprint(a: Pick<AssetRow, 'make' | 'model' | 'year' | 'trim' | 'exterior_color' | 'interior_color'>): string {
  const identity = canonicalizeForFingerprint(a.model, a.trim);
  const parts = [
    (a.make ?? '').toLowerCase(),
    (identity.canonicalModel ?? '').toLowerCase(),
    a.year != null ? String(a.year) : '',
    (identity.canonicalTrim ?? '').toLowerCase(),
    (a.exterior_color ?? '').toLowerCase(),
    (a.interior_color ?? '').toLowerCase(),
    '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

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

    const { data: memberships, error: memError } = await supabase
      .from('memberships').select('role').eq('user_id', user.id);
    if (memError) throw memError;
    const hasAccess = memberships?.some((m: { role: string }) => m.role === 'superadmin');
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Asset merge review is restricted to administrators." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Paged and count-verified: a merge-candidate scan over a truncated asset list would miss pairs,
    // indistinguishable from there being none.
    const assets = await fetchAllVerified<AssetRow>(
      'assets',
      (from, to) => supabase
        .from('assets')
        .select('id, org_id, vin, make, model, year, trim, exterior_color, interior_color, origin_status, fingerprint_hash, body_style, cylinders, engine_type, transmission, fuel, drivetrain, horsepower, status, historical_decay_timer_days, first_seen_at, last_seen_at, created_at, updated_at, merged_into_asset_id')
        .is('deleted_at', null)
        .order('id')
        .range(from, to),
      () => supabase.from('assets').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    );

    const live = assets.filter(a => a.merged_into_asset_id === null);
    const vinBearing = live.filter(a => a.vin && a.vin.length >= 11);
    const vinLess = live.filter(a => !a.vin || a.vin.length < 11);
    const vinLessByHash = new Map<string, AssetRow>();
    for (const a of vinLess) vinLessByHash.set(a.fingerprint_hash, a);

    // Pairs a human has already said are NOT the same car (asset_merge_decisions, live = not voided) are not offered again.
    const dismissed = await fetchAllVerified<{ survivor_asset_id: string; orphan_asset_id: string }>(
      'merge dismissals',
      (from, to) => supabase.from('asset_merge_decisions').select('survivor_asset_id, orphan_asset_id').is('voided_at', null).order('id').range(from, to),
      () => supabase.from('asset_merge_decisions').select('id', { count: 'exact', head: true }).is('voided_at', null),
    );
    const dismissedPairs = new Set(dismissed.flatMap(d => [`${d.survivor_asset_id}|${d.orphan_asset_id}`, `${d.orphan_asset_id}|${d.survivor_asset_id}`]));

    const candidatePairs: { survivor: AssetRow; orphanCandidate: AssetRow }[] = [];
    for (const vb of vinBearing) {
      const match = vinLessByHash.get(vinlessFingerprint(vb));
      if (match && match.org_id === vb.org_id && !dismissedPairs.has(`${vb.id}|${match.id}`)) {
        candidatePairs.push({ survivor: vb, orphanCandidate: match });
      }
    }

    const results = [];
    for (const { survivor, orphanCandidate } of candidatePairs) {
      const [sightingsA, sightingsB, historyA, historyB] = await Promise.all([
        supabase.from('sightings').select('*').eq('asset_id', survivor.id),
        supabase.from('sightings').select('*').eq('asset_id', orphanCandidate.id),
        supabase.from('auction_history').select('*').eq('asset_id', survivor.id),
        supabase.from('auction_history').select('*').eq('asset_id', orphanCandidate.id),
      ]);

      const sightingsSurvivor = sightingsA.data ?? [];
      const sightingsOrphan = sightingsB.data ?? [];
      const historySurvivor = historyA.data ?? [];
      const historyOrphan = historyB.data ?? [];

      const reasons = detectMergeConflicts(
        survivor, orphanCandidate, sightingsSurvivor, sightingsOrphan, historySurvivor, historyOrphan
      );
      const fieldDisagreements = detectFieldDisagreements(survivor, orphanCandidate, [
        'body_style', 'cylinders', 'engine_type', 'transmission', 'fuel', 'drivetrain', 'horsepower',
      ]);

      results.push({
        survivor: { asset: survivor, sightings: sightingsSurvivor, auction_history: historySurvivor },
        orphanCandidate: { asset: orphanCandidate, sightings: sightingsOrphan, auction_history: historyOrphan },
        doNotMerge: reasons.length > 0,
        reasons,
        fieldDisagreements,
      });
    }

    return new Response(JSON.stringify({ candidates: results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("asset-merge-candidates failed:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

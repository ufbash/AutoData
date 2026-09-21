import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { auctionHouseFromBidcarsSnapshot } from "../_shared/bidcarsLot.ts";
import { fetchAllVerified } from "../_shared/paginatedRead.ts";

// DEBT #61 - corrects sightings.source_auction_platform on EXISTING bid.cars captures, using the
// same one definition research-capture now uses at ingest (_shared/bidcarsLot.ts) rather than a
// second copy of the prefix mapping in SQL. Re-runnable and idempotent: a row is changed only when
// the derived house is known AND differs from what is stored.
//
//   mode 'dry_run' (default) - changes nothing; returns exactly what would change.
//   mode 'apply'             - writes the correction and stamps raw_payload.platform_relabel with the
//                              old value, the new value and the basis, so the change is auditable.
//
// It never touches the value the extension originally sent (that stays in raw_payload as captured,
// PROJECT_CHARTER.md section 5.8) - only the classification column derived from the raw lot prefix.
// A row whose prefix is unknown, or that has no Lot line, is reported as unresolved and left alone.
// Superadmin only.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
      .from('memberships').select('role').eq('user_id', user.id);
    if (memError) throw memError;
    if (!memberships?.some((m: { role: string }) => m.role === 'superadmin')) {
      return json({ error: "Relabelling sightings is restricted to administrators." }, 403);
    }

    const payload = await req.json().catch(() => ({}));
    const mode = payload?.mode === 'apply' ? 'apply' : 'dry_run';

    // Paged and count-verified: `.limit(5000)` is capped to 1,000 rows by PostgREST, so a backfill
    // over more bid.cars sightings than that would silently skip the rest.
    const rows = await fetchAllVerified<{ id: string; source_auction_platform: string | null; raw_payload: unknown }>(
      'bid.cars sightings',
      (from, to) => supabase
        .from('sightings')
        .select('id, source_auction_platform, raw_payload')
        .eq('source_platform', 'bidcars')
        .order('id')
        .range(from, to),
      () => supabase.from('sightings').select('id', { count: 'exact', head: true }).eq('source_platform', 'bidcars'),
    );

    const summary: Record<string, number> = {};
    const changes: { id: string; from: string | null; to: string; lot_prefix: string | null }[] = [];
    let unresolved = 0;
    let unchanged = 0;

    for (const row of rows) {
      const raw = (row.raw_payload ?? {}) as Record<string, unknown>;
      const derived = auctionHouseFromBidcarsSnapshot(raw.raw_dom_snapshot as string | null);
      if (!derived.house) { unresolved++; continue; }
      if (row.source_auction_platform === derived.house) { unchanged++; continue; }
      changes.push({ id: row.id, from: row.source_auction_platform ?? null, to: derived.house, lot_prefix: derived.prefix });
      const key = `${row.source_auction_platform ?? 'null'} -> ${derived.house} (lot prefix ${derived.prefix})`;
      summary[key] = (summary[key] ?? 0) + 1;

      if (mode === 'apply') {
        const stamped = {
          ...raw,
          platform_relabel: {
            from: row.source_auction_platform ?? null,
            to: derived.house,
            basis: `bid.cars lot prefix ${derived.prefix} (see _shared/bidcarsLot.ts)`,
            at: new Date().toISOString(),
            by: user.id,
          },
        };
        const { error: updateError } = await supabase
          .from('sightings')
          .update({ source_auction_platform: derived.house, raw_payload: stamped })
          .eq('id', row.id);
        if (updateError) throw new Error(`Failed on sighting ${row.id}: ${updateError.message}`);
      }
    }

    return json({
      mode,
      examined: (rows ?? []).length,
      unchanged,
      unresolved,
      would_change_or_changed: changes.length,
      summary,
      changes: mode === 'dry_run' ? changes : undefined,
      applied: mode === 'apply' ? changes.length : 0,
    });
  } catch (error) {
    console.error("sightings-platform-relabel failed:", error);
    return json({ error: (error as Error).message }, 500);
  }
});

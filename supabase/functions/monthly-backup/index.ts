import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-secret",
};

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const CHUNK = 0x8000; // 32KB
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const backupSecret = req.headers.get("x-backup-secret");
    if (!backupSecret || backupSecret !== Deno.env.get("BACKUP_SECRET")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const tables = ['organizations', 'memberships', 'assets', 'sightings', 'research_runs', 'research_run_listings'];
    const attachments = [];
    const counts: Record<string, number> = {};
    const omissions: string[] = [];
    let totalSize = 0;

    for (const table of tables) {
      const { data, error } = await supabase.from(table).select('*');
      if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
      
      counts[table] = data?.length || 0;
      
      if (!data || data.length === 0) {
        continue;
      }
      
      const generateCsv = (rows: any[], cols: string[]) => {
        const r = [];
        r.push(cols.map(k => `"${k}"`).join(","));
        for (const row of rows) {
          const vals = cols.map(k => {
            let val = row[k];
            if (val === null || val === undefined) return "";
            if (typeof val === 'object') {
              val = JSON.stringify(val);
            } else {
              val = String(val);
            }
            val = val.replace(/"/g, '""');
            return `"${val}"`;
          });
          r.push(vals.join(","));
        }
        return r.join("\n");
      };

      let keys = Object.keys(data[0]);
      
      // ALWAYS omit raw_payload from sightings
      if (table === 'sightings') {
        const payloadIdx = keys.indexOf('raw_payload');
        if (payloadIdx !== -1) {
          keys.splice(payloadIdx, 1);
          omissions.push("sightings.raw_payload omitted by default (debug data).");
        }
      }
      
      let csvString = generateCsv(data, keys);
      let byteLen = new TextEncoder().encode(csvString).length;
      
      // If combined size exceeds 6MB, drop the largest remaining column
      while (totalSize + byteLen > 6 * 1024 * 1024 && keys.length > 1) {
        let maxCol = '';
        let maxLen = 0;
        for (const k of keys) {
           let colLen = 0;
           for (const row of data) {
             const v = row[k];
             if (v) colLen += typeof v === 'object' ? JSON.stringify(v).length : String(v).length;
           }
           if (colLen > maxLen) {
             maxLen = colLen;
             maxCol = k;
           }
        }
        if (maxCol) {
          keys = keys.filter(k => k !== maxCol);
          omissions.push(`${table}.${maxCol} omitted due to 6MB total size constraint.`);
          csvString = generateCsv(data, keys);
          byteLen = new TextEncoder().encode(csvString).length;
        } else {
          break;
        }
      }
      
      const base64Content = toBase64(csvString);
      
      totalSize += byteLen;
      console.log(`Table ${table}: ${counts[table]} rows, ${byteLen} bytes`);
      
      const dateStr = new Date().toISOString().split('T')[0];
      attachments.push({
        filename: `${table}_${dateStr}.csv`,
        content: base64Content
      });
    }
    
    // Email via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const recipientsStr = Deno.env.get("BACKUP_RECIPIENTS");
    const backupFrom = Deno.env.get("BACKUP_FROM") || "onboarding@resend.dev";
    
    if (!resendApiKey || !recipientsStr) {
      throw new Error("Missing Resend configuration (RESEND_API_KEY, BACKUP_RECIPIENTS)");
    }
    
    const to = recipientsStr.split(',').map(e => e.trim()).filter(Boolean);
    const dateStr = new Date().toISOString().split('T')[0];
    const subject = `AutoData backup — ${dateStr}`;
    
    let html = `<h2>AutoData Monthly Backup</h2>`;
    html += `<ul>`;
    for (const [table, count] of Object.entries(counts)) {
      html += `<li><b>${table}</b>: ${count} rows</li>`;
    }
    html += `</ul>`;
    html += `<p>Total uncompressed CSV size: ${(totalSize / 1024 / 1024).toFixed(2)} MB</p>`;
    if (omissions.length > 0) {
      html += `<h3>Omissions</h3><ul>`;
      for (const o of omissions) {
        html += `<li>${o}</li>`;
      }
      html += `</ul>`;
    }
    
    const emailPayload = {
      from: backupFrom,
      to,
      subject,
      html,
      attachments
    };
    
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(emailPayload)
    });
    
    if (!resendResponse.ok) {
      const errText = await resendResponse.text();
      console.error("Resend API error:", errText);
      let parsedErr = errText;
      try { parsedErr = JSON.parse(errText); } catch(e) {}
      return new Response(JSON.stringify({ emailed: false, error: parsedErr, counts, omissions }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    
    console.log(`Backup completed successfully. Counts:`, counts);
    
    return new Response(JSON.stringify({ success: true, emailed: true, counts, omissions }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("monthly-backup error:", error);
    return new Response(JSON.stringify({ emailed: false, error: error.message || "Internal Server Error" }), { 
      status: 200, // Return 200 to prevent cron retry storms
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});

// READ-ONLY attack-surface scanner (Prompt 44 Stage 5). Reads function source + config; prints NAMES only - it never reads
// or prints an environment VALUE (it only finds the strings passed to Deno.env.get). Output feeds docs/security/attack-surface.md.
import fs from 'node:fs';
import path from 'node:path';
const root = 'supabase/functions';
const cfg = fs.readFileSync('supabase/config.toml', 'utf8');
const verifyJwt = (fn) => { const m = cfg.match(new RegExp(`\\[functions\\.${fn.replace(/[-]/g, '\\-')}\\]\\s*\\nverify_jwt\\s*=\\s*(true|false)`)); return m ? m[1] : 'default (true)'; };
const fns = fs.readdirSync(root).filter(d => !d.startsWith('_') && fs.existsSync(path.join(root, d, 'index.ts'))).sort();
const rows = [];
for (const fn of fns) {
  const src = fs.readFileSync(path.join(root, fn, 'index.ts'), 'utf8');
  const tables = new Map();
  for (const m of src.matchAll(/\.from\(\s*['"`]([a-z_0-9]+)['"`]\s*\)([\s\S]{0,420}?)(?=\.from\(|\n\s*\n|$)/g)) {
    const verbs = new Set(); for (const v of ['insert', 'update', 'delete', 'upsert']) if (new RegExp(`\\.${v}\\(`).test(m[2])) verbs.add(v);
    if (!verbs.size) verbs.add('read');
    const cur = tables.get(m[1]) ?? new Set(); verbs.forEach(v => cur.add(v)); tables.set(m[1], cur);
  }
  const rpcs = [...new Set([...src.matchAll(/\.rpc\(\s*['"`]([a-z_0-9]+)['"`]/g)].map(m => m[1]))];
  const buckets = [...new Set([...src.matchAll(/\.storage\s*\.from\(\s*['"`]([a-z\-_0-9]+)['"`]/g)].map(m => m[1]))];
  const env = [...new Set([...src.matchAll(/Deno\.env\.get\(\s*['"`]([A-Z0-9_]+)['"`]/g)].map(m => m[1]))].sort();
  const auth = [];
  if (/auth\.getUser|getUser\(/.test(src)) auth.push('caller JWT (auth.getUser)');
  if (/searchParams\.get\(\s*['"]token['"]\)|body\.token/.test(src)) auth.push('bearer-style token in URL/body');
  if (/x-[a-z\-]*(secret|key|token)|authorization/i.test(src) && /Deno\.env\.get\([^)]*(SECRET|CRON|BACKUP|INGEST|API_KEY)[^)]*\)/.test(src)) auth.push('static secret compare');
  if (/api[_-]?key|extension[_-]?key/i.test(src) && !auth.length) auth.push('key/secret check (review)');
  const roles = ['superadmin', 'staff', 'client'].filter(r => new RegExp(`['"]${r}['"]`).test(src));
  rows.push({ fn, jwt: verifyJwt(fn), auth: auth.join('; ') || '(none found - review)', roles: roles.join(','), tables: [...tables.entries()].map(([t, v]) => `${t}[${[...v].join('/')}]`), rpcs, buckets, env, revoked: /revoked_at/.test(src), readsMemberships: /from\(['"]memberships['"]\)/.test(src), svc: /SERVICE_ROLE_KEY/.test(src), lines: src.split('\n').length });
}
console.log(JSON.stringify(rows, null, 1));

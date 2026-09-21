#!/usr/bin/env node
// PROMPT 37 Phase 1 - loading an auction house's fee schedule is a DATA operation. This turns a JSON schedule
// into SQL; it does NOT execute anything (same convention as importTruckingRates.mjs): a human reviews the SQL
// and runs it. Nothing about a house, tier or fee is known to this script - it only validates shape.
//
//   node scripts/loadFeeSchedule.mjs <schedule.json> --org <org-uuid>            # SQL to load
//   node scripts/loadFeeSchedule.mjs <schedule.json> --org <org-uuid> --remove   # SQL to remove exactly those rows
//
// schedule.json:
//   { "auction_platform": "iaai",
//     "fee_tier": "IAA U.S. Licensed",            // must be an official tier in auction_fee_tiers (or add "new_tier")
//     "new_tier": { "eligibility": "...", "source_url": "...", "notes": "..." },   // optional: inserts the tier too
//     "account": { "holder_name": "...", "member_number": "...", "payment_tier": null|"secured"|"unsecured", "is_default": true },  // optional
//     "source": "official_tariff" | "agent_quote" | "actual_paid",
//     "effective_from": "YYYY-MM-DD",
//     "title_status": "any"|"clean"|"non_clean", "payment_tier": "any"|"secured"|"unsecured",
//     "buyer_fee": [ { "min": 0, "max": 99.99, "unit": "usd", "value": 25 }, ... ],
//     "bid_fee":   { "proxy": [ ...same... ], "live": [ ...same... ] },
//     "flat_fees": [ { "label": "...", "role": "environmental", "applies": "always", "value": 15 } ] }
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && a !== args[args.indexOf('--org') + 1]);
const org = args[args.indexOf('--org') + 1];
const remove = args.includes('--remove');
if (!file || args.indexOf('--org') === -1 || !/^[0-9a-f-]{36}$/.test(org || '')) {
  console.error('usage: node scripts/loadFeeSchedule.mjs <schedule.json> --org <org-uuid> [--remove]');
  process.exit(2);
}
const sch = JSON.parse(fs.readFileSync(file, 'utf8'));
const lit = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const problems = [];
const need = (cond, msg) => { if (!cond) problems.push(msg); };

need(/^[a-z][a-z0-9_]*$/.test(sch.auction_platform || ''), 'auction_platform must be lower_snake_case');
need(sch.fee_tier, 'fee_tier is required');
need(['official_tariff', 'agent_quote', 'actual_paid'].includes(sch.source), 'source must be official_tariff | agent_quote | actual_paid');
need(/^\d{4}-\d{2}-\d{2}$/.test(sch.effective_from || ''), 'effective_from must be YYYY-MM-DD');
need(['any', 'clean', 'non_clean'].includes(sch.title_status), 'title_status must be any | clean | non_clean');
need(['any', 'secured', 'unsecured'].includes(sch.payment_tier), 'payment_tier must be any | secured | unsecured');

const groups = [['buyer_fee', null, sch.buyer_fee], ['bid_fee', 'proxy', sch.bid_fee?.proxy], ['bid_fee', 'live', sch.bid_fee?.live]];
const rows = [];
for (const [feeType, method, list] of groups) {
  if (!list || list.length === 0) { if (feeType === 'buyer_fee') problems.push('buyer_fee brackets are required'); continue; }
  const sorted = [...list].sort((a, b) => a.min - b.min);
  sorted.forEach((b, i) => {
    need(['usd', 'percent'].includes(b.unit), `${feeType}${method ? '/' + method : ''}: unit must be usd | percent`);
    need(typeof b.value === 'number' && b.value >= 0, `${feeType}${method ? '/' + method : ''}: value must be a number >= 0`);
    need(b.max === null || b.max >= b.min, `${feeType}${method ? '/' + method : ''}: bracket ${b.min} has max < min`);
    if (i > 0) {
      const prev = sorted[i - 1];
      need(prev.max !== null, `${feeType}${method ? '/' + method : ''}: only the LAST bracket may be open-ended`);
      if (prev.max !== null && b.min !== prev.max && Math.abs(b.min - (prev.max + 0.01)) > 1e-9) problems.push(`${feeType}${method ? '/' + method : ''}: gap or overlap between ${prev.max} and ${b.min}`);
    }
    rows.push({ feeType, method, ...b });
  });
  if (sorted[sorted.length - 1].max !== null) console.error(`-- note: ${feeType}${method ? '/' + method : ''} has no open-ended top bracket; prices above ${sorted[sorted.length - 1].max} will not be covered`);
}
for (const f of sch.flat_fees || []) {
  need(/^[a-z][a-z0-9_]*$/.test(f.role || ''), `flat fee "${f.label}": role must be lower_snake_case`);
  need(['always', 'contingent'].includes(f.applies), `flat fee "${f.label}": applies must be always | contingent`);
  need(typeof f.value === 'number' && f.value >= 0, `flat fee "${f.label}": value must be a number >= 0`);
}
if (problems.length) { console.error('Schedule not valid:\n - ' + problems.join('\n - ')); process.exit(1); }

const P = lit(sch.auction_platform), T = lit(sch.fee_tier), O = lit(org);
const out = [];
if (remove) {
  out.push(`-- REMOVE: every row this schedule file loaded (${sch.auction_platform} / ${sch.fee_tier}). Run as the database admin role; every delete is recorded in rate_change_log.`);
  out.push(`DELETE FROM public.auction_fee_brackets WHERE org_id = ${O} AND auction_platform = ${P} AND fee_tier = ${T};`);
  for (const f of sch.flat_fees || []) out.push(`DELETE FROM public.cost_rates WHERE org_id = ${O} AND cost_category = 'auction_fee' AND auction_platform = ${P} AND fee_role = ${lit(f.role)} AND label = ${lit(f.label)};`);
  if (sch.account) out.push(`DELETE FROM public.auction_accounts WHERE org_id = ${O} AND auction_platform = ${P} AND holder_name = ${lit(sch.account.holder_name)};`);
  if (sch.new_tier) out.push(`DELETE FROM public.auction_fee_tiers WHERE auction_platform = ${P} AND fee_tier = ${T};`);
} else {
  out.push(`-- LOAD: ${sch.auction_platform} / ${sch.fee_tier} - ${rows.length} bracket rows, ${(sch.flat_fees || []).length} flat fees. Generated, not executed. Review, then run as the database admin role.`);
  out.push('BEGIN;');
  if (sch.new_tier) out.push(`INSERT INTO public.auction_fee_tiers (auction_platform, fee_tier, eligibility, source_url, notes, sort_order) VALUES (${P}, ${T}, ${lit(sch.new_tier.eligibility)}, ${lit(sch.new_tier.source_url)}, ${lit(sch.new_tier.notes)}, ${Number(sch.new_tier.sort_order ?? 99)});`);
  if (sch.account) {
    const a = sch.account;
    out.push(`INSERT INTO public.auction_accounts (org_id, auction_platform, fee_tier, holder_name, member_number, payment_tier, is_default, notes) VALUES (${O}, ${P}, ${T}, ${lit(a.holder_name)}, ${lit(a.member_number ?? null)}, ${lit(a.payment_tier ?? null)}, ${a.is_default ? 'true' : 'false'}, ${lit(a.notes ?? null)});`);
  }
  for (const r of rows) {
    out.push(`INSERT INTO public.auction_fee_brackets (org_id, auction_platform, fee_tier, fee_type, title_status, payment_tier, bid_method, bracket_min, bracket_max, fee_unit, fee_value, source, effective_from) VALUES (${O}, ${P}, ${T}, ${lit(r.feeType)}, ${lit(sch.title_status)}, ${lit(sch.payment_tier)}, ${lit(r.method)}, ${r.min}, ${r.max === null ? 'NULL' : r.max}, ${lit(r.unit)}, ${r.value}, ${lit(sch.source)}, ${lit(sch.effective_from)});`);
  }
  for (const f of sch.flat_fees || []) {
    out.push(`INSERT INTO public.cost_rates (org_id, cost_category, label, rate_unit, rate_value, source, effective_from, auction_platform, fee_role, fee_applies) VALUES (${O}, 'auction_fee', ${lit(f.label)}, 'usd', ${f.value}, ${lit(sch.source)}, ${lit(sch.effective_from)}, ${P}, ${lit(f.role)}, ${lit(f.applies)});`);
  }
  out.push('COMMIT;');
}
console.log(out.join('\n'));

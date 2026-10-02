// BLAST RADIUS (Prompt 44): for every run reachable by a live share token, the stats a client sees TODAY (the deployed
// public-run, fetched live) versus what the new code would serve (module + strict unknown lot state + mileage on the price
// population, simulated here from the same data). Read-only. Run: node --experimental-strip-types scripts/blastRadius.mts
import { execFileSync } from 'node:child_process';
import { classifyListing } from '../supabase/functions/_shared/riskRules.ts';
import { deriveAuctionHistoryFlags } from '../supabase/functions/_shared/auctionHistory.ts';

const ORG = 'a93378ea-33ef-4c75-97c4-44c37f2e9002';
const q = (sql: string): any[] => { const o = execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', sql], { encoding: 'utf8', maxBuffer: 1e8 }); return JSON.parse(o.slice(o.indexOf('{'), o.lastIndexOf('}') + 1)).rows; };
const runs = q(`select id, client_name, run_type, share_token from research_runs where share_enabled and deleted_at is null and org_id='${ORG}' order by created_at`);
const ls = q(`select rl.run_id, s.lot_state, s.current_bid_usd, s.price_usd, s.sale_confirmed, s.logged_via, s.source_platform, s.asset_id, s.mileage_miles, a.year from research_run_listings rl join sightings s on s.id=rl.sighting_id left join assets a on a.id=s.asset_id join research_runs r on r.id=rl.run_id where rl.included and r.share_enabled and r.deleted_at is null and r.org_id='${ORG}'`);
const hist = q(`select asset_id, auction_platform, lot_number, auction_date, bid_amount_usd, odometer_miles, status from auction_history where asset_id in (select s.asset_id from research_run_listings rl join sightings s on s.id=rl.sighting_id join research_runs r on r.id=rl.run_id where r.share_enabled and r.org_id='${ORG}')`);
const hb = new Map<string, any[]>(); hist.forEach(h => { if (!hb.has(h.asset_id)) hb.set(h.asset_id, []); hb.get(h.asset_id)!.push(h); });
const num = (v: any) => (v == null ? null : Number(v));

let changed = 0; const rows: string[] = [];
for (const r of runs) {
  const live = await (await fetch(`https://xrotvpuainpfdulhfhtt.supabase.co/functions/v1/public-run?token=${r.share_token}`)).json();
  const L = ls.filter(l => l.run_id === r.id).map(l => ({ ...l, price_usd: num(l.price_usd), current_bid_usd: num(l.current_bid_usd), mileage_miles: num(l.mileage_miles), id: 'x', vin: null, make: null, model: null, trim: null, damage_type: null, secondary_damage: null, title_type: null, runs_and_drives: null, seller_type: null }));
  const flags = new Map(L.map(l => [l.asset_id, deriveAuctionHistoryFlags(hb.get(l.asset_id))]));
  let tP = 0, pC = 0, tM = 0, mC = 0, sold = 0;
  for (const l of L) { const c = classifyListing(l as any, r.run_type, flags as any); if (c.population !== 'sold') continue; sold++;
    if (l.price_usd !== null && c.countsTowardAverage) { tP += l.price_usd; pC++; if (l.mileage_miles !== null && l.mileage_miles > 0) { tM += l.mileage_miles; mC++; } } }
  const hasStats = r.run_type !== 'active_listings';
  const nw = { priced_count: hasStats ? pC : null, avg_price: hasStats && pC ? Math.round(tP / pC * 100) / 100 : null, avg_mileage: hasStats && mC ? Math.round(tM / mC) : null, mileage_count: hasStats ? mC : null };
  const lv = live.stats ? { priced_count: live.stats.priced_count, avg_price: live.stats.avg_price_usd == null ? null : Math.round(live.stats.avg_price_usd * 100) / 100, avg_mileage: live.stats.avg_mileage == null ? null : Math.round(live.stats.avg_mileage) } : { priced_count: null, avg_price: null, avg_mileage: null };
  const priceSame = lv.priced_count === nw.priced_count && lv.avg_price === nw.avg_price;
  const milSame = lv.avg_mileage === nw.avg_mileage;
  if (!priceSame || !milSame) { changed++; rows.push(`CHANGES  ${r.client_name} (${r.id.slice(0, 8)}) [${r.run_type}]  price: n=${lv.priced_count} avg=${lv.avg_price} -> n=${nw.priced_count} avg=${nw.avg_price}  |  mileage: avg=${lv.avg_mileage} -> avg=${nw.avg_mileage} (sample ${nw.mileage_count})`); }
  else rows.push(`same     ${r.client_name} (${r.id.slice(0, 8)}) [${r.run_type}] price n=${lv.priced_count} avg=${lv.avg_price}; mileage avg=${lv.avg_mileage}`);
}
console.log(rows.join('\n'));
console.log(`\nshared runs=${runs.length}  runs whose client-visible figures change=${changed}`);

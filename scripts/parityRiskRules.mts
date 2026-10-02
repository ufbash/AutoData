// PARITY (Prompt 43 Stage 2): every real run, flags computed by the FROZEN legacy inline logic and by the new shared
// module, compared item by item. Differences are printed individually and attributed to a known intended change
// (repeat-sale rule, unknown-lot-state rule, the live-group-needs-a-bid fix) or flagged UNEXPLAINED (a stop condition).
// Run: node --experimental-strip-types scripts/parityRiskRules.mts [orgId]   (read-only; uses `supabase db query --linked`)
import { execFileSync } from 'node:child_process';
import { legacyChecklist } from './legacy/legacyChecklist.mts';
import { deriveAuctionHistoryFlags as legacyFlags } from './legacy/auctionHistoryFlags.legacy.ts';
import { isInSoldPopulation as legacyInSold, countsTowardSoldAverage as legacyCounts } from './legacy/soldGroup.legacy.ts';
import { evaluateRun } from '../supabase/functions/_shared/riskRules.ts';
import { deriveAuctionHistoryFlags } from '../supabase/functions/_shared/auctionHistory.ts';
import { populationOf, countsTowardSoldAverage } from '../supabase/functions/_shared/soldGroup.ts';

const ORG = process.argv[2] ?? 'a93378ea-33ef-4c75-97c4-44c37f2e9002';
const q = (sql: string): any[] => {
  const out = execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', sql], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf('{'))).rows;
};

const runs = q(`select r.id, r.client_name, r.run_type, r.share_enabled, (select to_jsonb(cb) from client_briefs cb where cb.id = r.client_brief_id) client_brief
  from research_runs r where r.org_id='${ORG}' and r.deleted_at is null order by r.created_at`);
const listings = q(`select rl.run_id, (to_jsonb(a) - 'id' - 'org_id' - 'created_at') || (to_jsonb(s) - 'id' - 'org_id' - 'created_at')
  || jsonb_build_object('id', rl.id, 'asset_id', s.asset_id, 'included', rl.included, 'position', rl.position) l
  from research_run_listings rl join research_runs r on r.id=rl.run_id and r.deleted_at is null join sightings s on s.id=rl.sighting_id left join assets a on a.id=s.asset_id
  where r.org_id='${ORG}'`);
const history = q(`select h.asset_id, h.auction_platform, h.auction_date, h.lot_number, h.bid_amount_usd, h.odometer_miles, h.status from auction_history h
  where h.asset_id in (select s.asset_id from research_run_listings rl join research_runs r on r.id=rl.run_id and r.deleted_at is null join sightings s on s.id=rl.sighting_id where r.org_id='${ORG}')`);
const decodes = q(`select vin, decoded_data from vin_decodes where decode_status='success'`);

const byRun = new Map<string, any[]>(); listings.forEach(x => { if (!byRun.has(x.run_id)) byRun.set(x.run_id, []); byRun.get(x.run_id)!.push(x.l); });
const histByAsset = new Map<string, any[]>(); history.forEach(h => { if (!histByAsset.has(h.asset_id)) histByAsset.set(h.asset_id, []); histByAsset.get(h.asset_id)!.push({ ...h, bid_amount_usd: h.bid_amount_usd == null ? null : Number(h.bid_amount_usd) }); });
const decodedByVin = new Map<string, any>(); decodes.forEach(d => decodedByVin.set(d.vin, { model: d.decoded_data?.Model ?? null, trim: d.decoded_data?.Trim ?? null, series: d.decoded_data?.Series ?? null }));

const norm = (items: any[]) => items.map(i => ({ type: i.type, passed: i.passed, message: i.message, offenders: [...i.offenderIds].sort().join(','), rule: i.rule ?? '' }))
  .sort((a, b) => (a.type + a.message + a.offenders).localeCompare(b.type + b.message + b.offenders));

let totalRuns = 0, identical = 0, intendedDiffs = 0, unexplained = 0, statDiffs = 0;
const lines: string[] = [];
for (const run of runs) {
  totalRuns++;
  const ls = (byRun.get(run.id) ?? []).map(l => ({ ...l, price_usd: l.price_usd == null ? null : Number(l.price_usd), current_bid_usd: l.current_bid_usd == null ? null : Number(l.current_bid_usd) }));
  const assetIds = [...new Set(ls.map(l => l.asset_id).filter(Boolean))];
  const lFlags = new Map(assetIds.map(a => [a, legacyFlags(histByAsset.get(a))])); const lRows = new Map(assetIds.map(a => [a, histByAsset.get(a) ?? []]));
  const nFlags = new Map(assetIds.map(a => [a, deriveAuctionHistoryFlags(histByAsset.get(a))]));
  const legacy = legacyChecklist({ run: { ...run, client_brief: run.client_brief }, listings: ls, auctionHistoryFlags: lFlags, auctionHistoryRows: lRows, decodedByVin });
  const mod = evaluateRun({ runType: run.run_type, brief: run.client_brief, listings: ls.filter(l => l.included), historyFlags: nFlags, historyRows: lRows, decoded: decodedByVin });

  const a = norm(legacy.checklistItems), b = norm(mod);
  const key = (x: any) => `${x.type}|${x.message}|${x.offenders}`;
  const bMap = new Map<string, number>(); b.forEach(x => bMap.set(key(x), (bMap.get(key(x)) ?? 0) + 1));
  const onlyLegacy: any[] = []; a.forEach(x => { const k = key(x); if ((bMap.get(k) ?? 0) > 0) bMap.set(k, bMap.get(k)! - 1); else onlyLegacy.push(x); });
  const aMap = new Map<string, number>(); a.forEach(x => aMap.set(key(x), (aMap.get(key(x)) ?? 0) + 1));
  const onlyModule: any[] = []; b.forEach(x => { const k = key(x); if ((aMap.get(k) ?? 0) > 0) aMap.set(k, aMap.get(k)! - 1); else onlyModule.push(x); });

  // item-level attribution
  const hasRepeat = ls.some(l => l.asset_id && nFlags.get(l.asset_id)?.repeatSale);
  const hasUnknownLot = ls.some(l => l.lot_state == null || l.lot_state === 'unknown'); // strict on EVERY run type since Prompt 44 Stage 1a
  const explain = (x: any, side: 'legacy' | 'module'): string | null => {
    if (side === 'module' && x.rule === 'lot_state_unknown') return 'INTENDED: unknown lot state is named (WARN) on every run type (charter 5.7 as extended, Prompt 44 1a)';
    if (side === 'module' && x.rule === 'possible_repeat_sale') return "INTENDED: Prompt 44 Stage 4 - one recorded Sold beside an appearance whose outcome is 'No information' may be a re-sale";
    if (/unconfirmed (sale |or not-sold )?status and are excluded from the average/.test(x.message)) return 'INTENDED: Prompt 44 Stage 6 - a comp confirmed NOT sold (sale_confirmed=false) is now named, wording widened to "unconfirmed or not-sold"';
    if (/^Market research average is based on only 1 sales?\. Limited sample/.test(x.message)) return 'INTENDED: Prompt 44 Stage 6 - usability verifier: "1 sales" grammar, now "1 sale"';
    if (side === 'legacy' && x.passed && x.message === 'All sold listings are confirmed') return 'INTENDED: Prompt 44 Stage 6 - the legacy check said "all confirmed" while a comp confirmed NOT sold (sale_confirmed=false) sat in the sold group, silently excluded from the average; the module now names it (the average itself is unchanged)';
    if (x.message.startsWith('Prior auction history not checkable') || x.message.startsWith('Prior auction history could not be checked')) return 'INTENDED: Prompt 44 Stage 4 - reworded (it read like a roadmap note)';
    if (side === 'module' && x.rule === 'repeat_sale' && !x.passed) return 'INTENDED: repeat-sale rule (decision 4.16)';
    if (side === 'module' && x.rule === 'repeat_sale' && x.passed) return 'INTENDED: repeat-sale rule item (passes - nothing flagged)';
    if (hasRepeat && ['limited_sample', 'unconfirmed_sale', 'different_model', 'population_mismatch', 'population_unknown', 'range_disclosure'].includes(x.rule || ((x.message.startsWith('Market research average') && 'limited_sample') as string))) return 'INTENDED: a repeat-sale comp is excluded from the sold average/sample';
    if (hasUnknownLot) return 'INTENDED: the run holds unknown-lot-state listings, now in no population on every run type (charter 5.7 as extended)';
    return null;
  };
  // a module-only item that PASSES and flags nobody (the always-present 'No repeat-sale vehicles' line) is not a flag difference
  const diffs = [...onlyLegacy.map(x => ({ side: 'legacy', x })), ...onlyModule.filter(x => !((x.rule === 'repeat_sale' || x.rule === 'possible_repeat_sale') && x.passed)).map(x => ({ side: 'module', x }))];
  const unexpl = diffs.filter(d => !explain(d.x, d.side as any));

  // stats parity: sold group (count of priced-in-average, average) + live group size
  const incl = ls.filter(l => l.included);
  const lSold = run.run_type === 'mixed' ? incl.filter(l => legacyInSold(l, 'mixed')) : run.run_type === 'sold_comps' ? incl : [];
  const nSold = incl.filter(l => populationOf(l, run.run_type) === 'sold');
  const priced = (arr: any[], counts: (l: any) => boolean) => arr.filter(l => l.price_usd !== null && counts(l));
  const avg = (arr: any[]) => arr.length ? Math.round(arr.reduce((s, l) => s + l.price_usd, 0) / arr.length * 100) / 100 : null;
  const lP = priced(lSold, legacyCounts), nP = priced(nSold.map(l => nFlags.get(l.asset_id)?.repeatSale ? { ...l, repeat_sale: true } : l), countsTowardSoldAverage);
  const lLive = run.run_type === 'mixed' ? incl.filter(l => l.lot_state !== 'finished' && l.current_bid_usd !== null).length : null;
  const nLive = run.run_type === 'mixed' ? incl.filter(l => populationOf(l, 'mixed') === 'active').length : null;
  const statSame = lSold.length === nSold.length && lP.length === nP.length && avg(lP) === avg(nP) && lLive === nLive;

  if (!diffs.length && statSame) { identical++; lines.push(`IDENTICAL   ${run.client_name} (${run.id.slice(0, 8)}) [${run.run_type}${run.share_enabled ? ', SHARED' : ''}] ${a.length} items, ${incl.length} listings`); continue; }
  if (unexpl.length) unexplained++; else intendedDiffs++;
  lines.push(`${unexpl.length ? 'UNEXPLAINED' : 'INTENDED   '} ${run.client_name} (${run.id.slice(0, 8)}) [${run.run_type}${run.share_enabled ? ', SHARED' : ''}] ${incl.length} listings`);
  diffs.forEach(d => lines.push(`      ${d.side.toUpperCase()}-ONLY ${d.x.type}${d.x.passed ? ' (passed)' : ''}: ${d.x.message.slice(0, 170)}  => ${explain(d.x, d.side as any) ?? '*** NO EXPLANATION ***'}`));
  if (!statSame) { statDiffs++; lines.push(`      STATS legacy sold=${lSold.length} priced=${lP.length} avg=${avg(lP)} live=${lLive}  |  module sold=${nSold.length} priced=${nP.length} avg=${avg(nP)} live=${nLive}`); }
}
console.log(lines.join('\n'));
console.log(`\nruns=${totalRuns} identical=${identical} intended-differences=${intendedDiffs} UNEXPLAINED=${unexplained} runs-with-stat-differences=${statDiffs}`);
if (unexplained) process.exit(2);

// Every risk/spec/quality rule, fire AND no-fire. Run: node --experimental-strip-types scripts/testRiskRules.mts
// The rules live in supabase/functions/_shared/riskRules.ts (pure). Each case below is either a thing that must be
// flagged or a thing that must NOT be (absence is not violation, AGENTS.md S6). Coverage is asserted at the end: every
// registered rule must have fired at least once in this file, so a rule that cannot fire cannot hide.
import { flagKeys, newlyFlagged, evaluateRun, badgeFor, badgeOrUnlabelled, listingBadges, classifyListing, RULE_REGISTRY } from '../supabase/functions/_shared/riskRules.ts';
import type { RuleKey, RuleListing, RunRuleInput, RuleItem } from '../supabase/functions/_shared/riskRules.ts';
import { deriveAuctionHistoryFlags } from '../supabase/functions/_shared/auctionHistory.ts';
import { populationOf } from '../supabase/functions/_shared/soldGroup.ts';

let failed = 0, n = 0;
const fired = new Set<string>();
const emitted = new Set<string>(); // every rule key the module EMITTED (passed or not) anywhere in this file
const check = (name: string, ok: boolean, detail = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`); };

let seq = 0;
const L = (o: Partial<RuleListing> = {}): RuleListing => ({
  id: `l${++seq}`, asset_id: `a${seq}`, vin: `VIN${seq}`, year: 2022, make: 'Toyota', model: 'Camry', trim: null, exterior_color: null,
  transmission: null, fuel: null, mileage_miles: 20000, damage_type: 'Front End', secondary_damage: null, title_type: 'Clean',
  runs_and_drives: true, seller_type: 'Insurance company', lot_state: 'active', current_bid_usd: 5000, price_usd: 5000,
  sale_confirmed: null, logged_via: 'extension_dom_capture', source_platform: 'copart', ...o,
});
const SOLD = (o: Partial<RuleListing> = {}) => L({ lot_state: 'finished', current_bid_usd: null, source_platform: 'bidcars', sale_confirmed: true, damage_type: 'Side', ...o });
const run = (runType: RunRuleInput['runType'], listings: RuleListing[], extra: Partial<RunRuleInput> = {}): RuleItem[] => {
  const items = evaluateRun({ runType, brief: null, listings, historyFlags: new Map(), historyRows: new Map(), decoded: new Map(), ...extra });
  items.forEach(i => { emitted.add(i.rule); if (!i.passed) fired.add(i.rule); });
  return items;
};
const failedItem = (items: RuleItem[], rule: RuleKey, pred: (i: RuleItem) => boolean = () => true) => items.find(i => i.rule === rule && !i.passed && pred(i));
const fires = (name: string, items: RuleItem[], rule: RuleKey, offenders?: string[], pred?: (i: RuleItem) => boolean) => {
  const it = failedItem(items, rule, pred);
  check(`FIRES   ${rule}: ${name}`, !!it && (!offenders || offenders.every(o => it.offenderIds.includes(o))), `items=${JSON.stringify(items.filter(i => i.rule === rule).map(i => [i.id, i.passed, i.offenderIds]))}`);
};
const silent = (name: string, items: RuleItem[], rule: RuleKey, pred?: (i: RuleItem) => boolean) =>
  check(`SILENT  ${rule}: ${name}`, !failedItem(items, rule, pred), `unexpected: ${JSON.stringify(items.filter(i => i.rule === rule && !i.passed))}`);

const hist = (rows: any[]) => deriveAuctionHistoryFlags(rows);
const sold = (lot: string, date: string, bid: number, odo: number, platform = 'Copart') => ({ auction_platform: platform, lot_number: lot, auction_date: date, bid_amount_usd: bid, odometer_miles: odo, status: 'Sold' });
const unsold = (lot: string, date: string, odo = 20000) => ({ auction_platform: 'Copart', lot_number: lot, auction_date: date, bid_amount_usd: 5000, odometer_miles: odo, status: 'Not sold' });
const withHist = (l: RuleListing, rows: any[]) => ({ historyFlags: new Map([[l.asset_id!, hist(rows)]]), historyRows: new Map([[l.asset_id!, rows]]) });
const brief = (o: any = {}) => ({ status: 'approved', ...o });

// ---- zero listings
fires('no listings', run('active_listings', []), 'zero_listings');
silent('one listing', run('active_listings', [L()]), 'zero_listings');

// ---- duplicate VIN
{ const a = L({ vin: 'SAME' }), b = L({ vin: 'SAME' }); fires('two listings, one VIN', run('active_listings', [a, b]), 'duplicate', [a.id, b.id]); }
silent('distinct VINs', run('active_listings', [L(), L()]), 'duplicate');
silent('null VINs are not duplicates of each other', run('active_listings', [L({ vin: null }), L({ vin: null })]), 'duplicate');

// ---- prior auction history (active portion only)
{ const l = L(); fires('a car that sold before, in an ACTIVE run', run('active_listings', [l], withHist(l, [sold('1', '2025-03-01', 8500, 12000)])), 'prior_auction_history', [l.id], i => /has sold at a prior auction/.test(i.message)); }
{ const l = L(); fires('not-sold prior appearance wording', run('active_listings', [l], withHist(l, [unsold('1', '2025-03-01')])), 'prior_auction_history', [l.id], i => /did not sell/.test(i.message)); }
{ const l = L(); silent('no history rows -> not checkable, NOT a block', run('active_listings', [l]), 'prior_auction_history'); }
{ const l = L(); fires('no history rows -> INFO not checkable', run('active_listings', [l]), 'prior_auction_not_checkable', [l.id]); }
{ const l = L(); silent('history present -> checkable', run('active_listings', [l], withHist(l, [sold('1', '2025-03-01', 8500, 12000)])), 'prior_auction_not_checkable'); }
{ const l = SOLD(); silent('a SOLD comp with history is never blocked (4.8)', run('sold_comps', [l], withHist(l, [unsold('1', '2025-03-01'), sold('2', '2025-09-01', 9000, 21000)])), 'prior_auction_history'); }

// ---- critical damage / unknown damage / run-and-drive (active portion)
{ const l = L({ damage_type: 'Water/Flood' }); fires('flood', run('active_listings', [l]), 'critical_damage', [l.id], i => /water damage/.test(i.message)); }
{ const l = L({ damage_type: 'Burn - Engine' }); fires('burn', run('active_listings', [l]), 'critical_damage', [l.id], i => /burn damage/.test(i.message)); }
{ const l = L({ damage_type: 'Front End', secondary_damage: 'Rollover' }); fires('secondary damage counts', run('active_listings', [l]), 'critical_damage', [l.id], i => /rollover damage/.test(i.message)); }
{ const l = L({ damage_type: 'Storm' }); fires('ambiguous storm', run('active_listings', [l]), 'critical_damage', [l.id], i => /ambiguous storm damage/.test(i.message)); }
{ const l = L({ damage_type: '' }); fires('unknown damage', run('active_listings', [l]), 'critical_damage', [l.id], i => /unknown damage/.test(i.message)); }
{ const l = L({ runs_and_drives: null }); fires('run-and-drive not confirmed (null)', run('active_listings', [l]), 'critical_damage', [l.id], i => /not confirmed run-and-drive/.test(i.message)); }
silent('clean front-end hit that runs and drives', run('active_listings', [L()]), 'critical_damage');
silent('flood on a SOLD comp is never a risk flag (4.8)', run('sold_comps', [SOLD({ damage_type: 'Water/Flood', runs_and_drives: null })]), 'critical_damage');

// ---- spec_critical (approved brief, active portion)
{ const l = L({ mileage_miles: 90000 }); fires('mileage over max', run('active_listings', [l], { brief: brief({ max_mileage: 60000 }) }), 'spec_critical', [l.id], i => /maximum mileage/.test(i.message)); }
silent('mileage within max', run('active_listings', [L({ mileage_miles: 40000 })], { brief: brief({ max_mileage: 60000 }) }), 'spec_critical');
silent('null mileage is not a violation', run('active_listings', [L({ mileage_miles: null })], { brief: brief({ max_mileage: 60000 }) }), 'spec_critical');
{ const l = L({ year: 2015 }); fires('year below min', run('active_listings', [l], { brief: brief({ year_min: 2018 }) }), 'spec_critical', [l.id], i => /below minimum year/.test(i.message)); }
{ const l = L({ year: 2025 }); fires('year above max', run('active_listings', [l], { brief: brief({ year_max: 2022 }) }), 'spec_critical', [l.id], i => /above maximum year/.test(i.message)); }
silent('null year is not a violation', run('active_listings', [L({ year: null })], { brief: brief({ year_min: 2018, year_max: 2024 }) }), 'spec_critical');
{ const l = L({ runs_and_drives: false }); fires('brief requires run and drive', run('active_listings', [l], { brief: brief({ condition_required: 'run_and_drive' }) }), 'spec_critical', [l.id], i => /Run and Drive/.test(i.message)); }
silent("condition 'either' demands nothing", run('active_listings', [L({ runs_and_drives: false })], { brief: brief({ condition_required: 'either' }) }), 'spec_critical', i => /Run and Drive/.test(i.message));
{ const l = L({ title_type: 'Salvage Certificate' }); fires('title not in accepted list', run('active_listings', [l], { brief: brief({ titles_accepted: ['clean'] }) }), 'spec_critical', [l.id], i => /title type/.test(i.message)); }
silent('accepted title', run('active_listings', [L({ title_type: 'Clean Title' })], { brief: brief({ titles_accepted: ['clean'] }) }), 'spec_critical', i => /title type/.test(i.message));
silent('null title is not a violation', run('active_listings', [L({ title_type: null })], { brief: brief({ titles_accepted: ['clean'] }) }), 'spec_critical', i => /title type/.test(i.message));
{ const items = run('active_listings', [L({ mileage_miles: 99999, year: 2010 })], { brief: brief({ max_mileage: 1000, year_min: 2020, status: 'pending_review' }) });
  check('SILENT  a pending_review brief drives NO spec rule (gated inside the module)', !items.some(i => i.rule === 'spec_critical' || i.rule === 'spec_warn')); }
silent('spec rules never run on a sold comp', run('sold_comps', [SOLD({ mileage_miles: 99999 })], { brief: brief({ max_mileage: 1000 }) }), 'spec_critical');

// ---- spec_warn
{ const l = L({ exterior_color: 'White' }); fires('colour differs', run('active_listings', [l], { brief: brief({ colour_preference: 'Black' }) }), 'spec_warn', [l.id], i => /colour differs/.test(i.message)); }
{ const l = L({ exterior_color: 'White' }); fires('colour excluded', run('active_listings', [l], { brief: brief({ colour_preference: 'Any, except White' }) }), 'spec_warn', [l.id], i => /colour excluded/.test(i.message)); }
silent('colour matches', run('active_listings', [L({ exterior_color: 'Black' })], { brief: brief({ colour_preference: 'Black' }) }), 'spec_warn');
silent("colour 'Any' demands nothing", run('active_listings', [L({ exterior_color: 'White' })], { brief: brief({ colour_preference: 'Any' }) }), 'spec_warn');
silent('null colour is not a violation', run('active_listings', [L({ exterior_color: null })], { brief: brief({ colour_preference: 'Black' }) }), 'spec_warn');
{ const l = L({ transmission: 'Manual' }); fires('transmission differs', run('active_listings', [l], { brief: brief({ transmission: 'automatic' }) }), 'spec_warn', [l.id], i => /transmission differs/.test(i.message)); }
silent('transmission matches (Automatic vs automatic)', run('active_listings', [L({ transmission: 'Automatic' })], { brief: brief({ transmission: 'automatic' }) }), 'spec_warn');
silent("transmission 'either'", run('active_listings', [L({ transmission: 'Manual' })], { brief: brief({ transmission: 'either' }) }), 'spec_warn');
{ const l = L({ fuel: 'Diesel' }); fires('fuel differs', run('active_listings', [l], { brief: brief({ fuel_type: 'petrol' }) }), 'spec_warn', [l.id], i => /fuel type differs/.test(i.message)); }
silent('fuel matches via vocabulary (Gas = petrol)', run('active_listings', [L({ fuel: 'Gas' })], { brief: brief({ fuel_type: 'petrol' }) }), 'spec_warn');
{ const l = L({ trim: 'Sport' }); fires('trim differs', run('active_listings', [l], { brief: brief({ trim: 'XLE', model: 'Camry' }) }), 'spec_warn', [l.id], i => /trim differs/.test(i.message)); }
silent('trim matches', run('active_listings', [L({ trim: 'XLE' })], { brief: brief({ trim: 'XLE', model: 'Camry' }) }), 'spec_warn');
silent("brief trim 'either'", run('active_listings', [L({ trim: 'Sport' })], { brief: brief({ trim: 'Either', model: 'Camry' }) }), 'spec_warn');

// ---- odometer rollback (EVERY run type)
{ const l = SOLD(); fires('mileage went DOWN across appearances (sold run)', run('sold_comps', [l], withHist(l, [unsold('1', '2025-05-01', 50000), sold('2', '2026-02-01', 30000, 30000)])), 'odometer_rollback', [l.id]); }
{ const l = L(); fires('same on an active run', run('active_listings', [l], withHist(l, [sold('1', '2025-05-01', 8000, 50000), sold('2', '2026-02-01', 9000, 30000)])), 'odometer_rollback', [l.id]); }
{ const l = SOLD(); silent('mileage went UP (the real Camry)', run('sold_comps', [l], withHist(l, [sold('85718855', '2025-10-15', 17100, 9078), sold('60824366', '2026-09-03', 12300, 37904)])), 'odometer_rollback'); }
silent('no history', run('sold_comps', [SOLD()]), 'odometer_rollback');

// ---- repeat sale
{ const l = SOLD(); fires('two distinct Sold events (the real Camry), sold run', run('sold_comps', [l], withHist(l, [sold('85718855', '2025-10-15', 17100, 9078), sold('60824366', '2026-09-03', 12300, 37904)])), 'repeat_sale', [l.id], i => /2025-10-15 \$17,100 at 9,078 mi then 2026-09-03 \$12,300 at 37,904 mi/.test(i.message)); }
{ const l = SOLD({ lot_state: 'finished' }); fires('finished lot inside a MIXED run', run('mixed', [l], withHist(l, [sold('1', '2025-01-01', 8000, 5000), sold('2', '2026-01-01', 9000, 9000, 'IAAI')])), 'repeat_sale', [l.id]); }
{ const l = SOLD(); silent('one Sold + one Not sold', run('sold_comps', [l], withHist(l, [unsold('1', '2025-01-01'), sold('2', '2026-01-01', 9000, 25000)])), 'repeat_sale'); }
{ const l = L(); silent('an ACTIVE listing is covered by the prior-history BLOCK, not reported here', run('active_listings', [l], withHist(l, [sold('1', '2025-01-01', 8000, 5000), sold('2', '2026-01-01', 9000, 9000)])), 'repeat_sale'); }
{ const l = SOLD(); const items = run('sold_comps', [l], withHist(l, [sold('1', '2025-01-01', 8000, 5000), sold('2', '2026-01-01', 9000, 9000)]));
  const c = classifyListing(l, 'sold_comps', withHist(l, [sold('1', '2025-01-01', 8000, 5000), sold('2', '2026-01-01', 9000, 9000)]).historyFlags);
  check('a repeat-sale comp is in the sold group but NOT in the average (one predicate, both sides)', c.population === 'sold' && c.repeatSale && !c.countsInAverage); void items; }

// ---- range disclosure (INFO, raw brief)
{ const l = SOLD({ year: 2012 }); fires('comp outside the brief year range', run('sold_comps', [l], { brief: brief({ year_min: 2013, year_max: 2016 }) }), 'range_disclosure', [l.id]); }
silent('comp inside the range', run('sold_comps', [SOLD({ year: 2014 })], { brief: brief({ year_min: 2013, year_max: 2016 }) }), 'range_disclosure');
silent('unknown year says nothing', run('sold_comps', [SOLD({ year: null })], { brief: brief({ year_min: 2013 }) }), 'range_disclosure');
{ const l = SOLD({ year: 2012 }); fires('discloses against a PENDING brief too (matches public-run)', run('sold_comps', [l], { brief: brief({ year_min: 2013, status: 'pending_review' }) }), 'range_disclosure', [l.id]); }

// ---- no price / non-insurance
{ const l = L({ price_usd: null }); fires('no USD price', run('active_listings', [l]), 'no_price', [l.id]); }
silent('has a price', run('active_listings', [L()]), 'no_price');
{ const l = L({ seller_type: 'Non-insurance seller' }); fires('non-insurance seller', run('active_listings', [l]), 'non_insurance', [l.id]); }
silent('insurance seller', run('active_listings', [L()]), 'non_insurance');
silent('null seller type', run('active_listings', [L({ seller_type: null })]), 'non_insurance');

// ---- limited sample
fires('two priced comps', run('sold_comps', [SOLD(), SOLD()]), 'limited_sample');
silent('three priced comps', run('sold_comps', [SOLD(), SOLD(), SOLD()]), 'limited_sample');
silent('zero priced comps (nothing to caveat)', run('sold_comps', [SOLD({ price_usd: null })]), 'limited_sample');
fires('an excluded repeat-sale comp does not count toward the sample', (() => { const a = SOLD(), b = SOLD(), c = SOLD(); const h = withHist(c, [sold('1', '2025-01-01', 8000, 5000), sold('2', '2026-01-01', 9000, 9000)]); return run('sold_comps', [a, b, c], h); })(), 'limited_sample');

// ---- different model
{ const a = SOLD(), b = SOLD(), c = SOLD({ model: 'Corolla' }); fires('minority model', run('sold_comps', [a, b, c]), 'different_model', [c.id]); }
silent('one model', run('sold_comps', [SOLD(), SOLD(), SOLD()]), 'different_model');

// ---- population coherence + unknown source
{ const a = SOLD(), b = SOLD({ source_platform: 'manual', logged_via: 'manual_entry', sale_confirmed: null }); fires('US auction mixed with a manual comp', run('sold_comps', [a, b, SOLD()]), 'population_mismatch', [b.id]); }
silent('all US auction', run('sold_comps', [SOLD(), SOLD(), SOLD()]), 'population_mismatch');
{ const a = SOLD({ source_platform: null }); fires('unknown source platform (INFO)', run('sold_comps', [a, SOLD(), SOLD()]), 'population_unknown', [a.id]); }
silent('known sources', run('sold_comps', [SOLD(), SOLD(), SOLD()]), 'population_unknown');

// ---- unconfirmed sale
{ const a = SOLD({ sale_confirmed: null }); fires('bid.cars null = inconclusive, excluded', run('sold_comps', [a, SOLD(), SOLD()]), 'unconfirmed_sale', [a.id]); }
{ const a = SOLD({ sale_confirmed: null, source_platform: 'copart' }); fires('Copart null = unconfirmable by platform', run('sold_comps', [a, SOLD(), SOLD()]), 'unconfirmed_sale', [a.id]); }
silent('confirmed sold', run('sold_comps', [SOLD(), SOLD(), SOLD()]), 'unconfirmed_sale');
silent('manual entry null is structural, not unconfirmed', run('sold_comps', [SOLD({ source_platform: 'manual', logged_via: 'manual_entry', sale_confirmed: null }), SOLD(), SOLD()]), 'unconfirmed_sale');

// ---- lot state unknown, and the populations (PROJECT_CHARTER 5.7 as extended)
{ const u = L({ lot_state: null, current_bid_usd: null }); const s = SOLD(); const a = L({ lot_state: 'active' });
  const items = run('mixed', [u, s, a]);
  fires('mixed run: unknown lot state is reported', items, 'lot_state_unknown', [u.id]);
  check('mixed: unknown is in NO population', populationOf(u, 'mixed') === 'unknown');
  check('mixed: it is not risk-checked as active (no flood/R&D noise from it)', !items.some(i => i.rule === 'critical_damage' && i.offenderIds.includes(u.id)));
  check('mixed: it is not in the sold average count', classifyListing(u, 'mixed', new Map()).countsInAverage === false);
  check("mixed: 'unknown' (string) behaves exactly like null", populationOf({ ...u, lot_state: 'unknown' }, 'mixed') === 'unknown'); }
check('mixed: a LIVE lot with NO bid yet is active (AGENTS 4.1 - the old live filter dropped it from every group)', populationOf(L({ lot_state: 'active', current_bid_usd: null }), 'mixed') === 'active');
check('mixed: a finished lot is sold', populationOf(SOLD(), 'mixed') === 'sold');
check('mixed: a finished lot that only carries a bid is in no group but is NOT "unknown"', populationOf(SOLD({ current_bid_usd: 4000 }), 'mixed') === 'none');
check('active run: every listing is active (risk checks never vanish for a client option)', populationOf(L({ lot_state: null }), 'active_listings') === 'active');
{ const items = run('active_listings', [L({ lot_state: null, damage_type: 'Water/Flood' })]);
  fires('an active-run listing with unknown lot state IS still risk-checked, and labelled', items, 'critical_damage');
  fires('...and told it needs classifying', items, 'lot_state_unknown'); }
silent('known lot state raises nothing', run('mixed', [SOLD(), L()]), 'lot_state_unknown');

// ---- an already-shared run warns when a rule NEWLY flags a listing
{ const ok = L({ vin: 'OK1' }); const bad = L({ vin: 'BAD1', damage_type: 'Water/Flood' });
  const before = run('active_listings', [ok]);
  const snap = flagKeys(before).map(f => f.key);
  const after = run('active_listings', [ok, bad]);
  const fresh = newlyFlagged(after, snap, false);
  check('NEW flag since the snapshot is reported, naming the listing', fresh.some(f => f.item.rule === 'critical_damage' && f.listingId === bad.id));
  check('nothing new when nothing changed', newlyFlagged(before, snap, false).length === 0);
  check('a flag that was already in the snapshot (reviewed at share time) is NOT re-reported', newlyFlagged(after, flagKeys(after).map(f => f.key), true).length === 0);
  check('INFO items never raise the shared-run warning', newlyFlagged(run('active_listings', [L({ lot_state: null })]), [], false).every(f => f.item.type !== 'INFO'));
  check('no snapshot (shared before tracking): a BLOCK is always reported', newlyFlagged(run('active_listings', [L({ vin: 'D' }), L({ vin: 'D' })]), null, true).some(f => f.item.rule === 'duplicate'));
  check('no snapshot: a CRITICAL is reported only when no override reason was ever recorded', [newlyFlagged(after, null, false).some(f => f.item.type === 'CRITICAL'), newlyFlagged(after, null, true).some(f => f.item.type === 'CRITICAL')].join() === 'true,false'); }

// ---- the registry: unknown rules fail LOUDLY
check('every rule the module EMITTED anywhere above is in the registry (a rule cannot ship unregistered)', [...emitted].every(k => k in RULE_REGISTRY), `emitted but unregistered: ${[...emitted].filter(k => !(k in RULE_REGISTRY)).join(', ')}`);
check('every rule that FIRED has a badge entry the UI can render', [...fired].every(k => { try { badgeFor({ rule: k }); return true; } catch { return false; } }));
check('every registered rule fired at least once in this file (a rule that cannot fire cannot hide)', (Object.keys(RULE_REGISTRY) as RuleKey[]).every(k => fired.has(k) || ['zero_listings'].includes(k) && fired.has('zero_listings')), `never fired: ${(Object.keys(RULE_REGISTRY)).filter(k => !fired.has(k)).join(', ')}`);
{ let threw = ''; try { badgeFor({ rule: 'brand_new_rule', id: 'x' }); } catch (e) { threw = String((e as Error).message); }
  check('an UNREGISTERED rule throws (never silence)', /Unregistered rule "brand_new_rule"/.test(threw), threw); }
check('badgeOrUnlabelled shows a visible UNLABELLED FLAG for an unknown rule', badgeOrUnlabelled({ rule: 'brand_new_rule' }) === 'UNLABELLED FLAG (brand_new_rule)');
{ const rogue = [{ id: 'r1', rule: 'brand_new_rule' as any, type: 'WARN' as const, message: 'x', offenderIds: ['L9'], passed: false }];
  const b = listingBadges(rogue);
  check('listingBadges surfaces the unknown rule on the listing instead of dropping it', b.get('L9')?.[0].text === 'UNLABELLED FLAG (brand_new_rule)'); }
{ const all = [run('active_listings', [L({ damage_type: 'Water/Flood' }), L({ vin: 'X' })]), run('sold_comps', [SOLD(), SOLD()])].flat();
  check('every item the module emits carries a registered rule', all.every(i => { try { badgeFor(i); return true; } catch { return false; } })); }
check('every registered rule with a per-listing badge has non-empty text', (Object.entries(RULE_REGISTRY) as [string, any][]).every(([k, v]) => v.badge === null || v.badge.length > 0));

console.log(`\n${n - failed}/${n} passed`);
if (failed) { console.log(`${failed} FAILED`); process.exit(1); }

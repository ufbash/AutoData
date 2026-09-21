import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  AuctionHouse, AuctionFeeTier, AuctionAccount, FeeScheduleSummary, PaymentTier,
  listAuctionHouses, listFeeTiers, listAccounts, summariseSchedules, addAccount, setAccountPaymentTier, setDefaultAccount,
} from '../services/auctionAccountsService';
import { Loader2, Plus, ExternalLink } from 'lucide-react';

// PROMPT 37 Phase 1 - one place for what the fee path used to hardcode: each auction house's OFFICIAL fee
// tiers, the buying accounts an org holds (with the tier each is on and its own Secured/Unsecured payment
// tier), and what schedule is actually loaded. A house with no account, or a tier with no schedule, is shown
// as such - the fee calculation abstains for it and says why. Loading a schedule itself is a data operation
// (Document Extraction, or scripts/loadFeeSchedule.mjs), never a code change.

const PAYMENT_LABEL = (t: PaymentTier | null) => (t === 'secured' ? 'Secured' : t === 'unsecured' ? 'Unsecured' : 'Not applicable');

const FeeSchedulesAdmin: React.FC = () => {
  const { orgId, user } = useAuth() as any;
  const [houses, setHouses] = useState<AuctionHouse[]>([]);
  const [tiers, setTiers] = useState<AuctionFeeTier[]>([]);
  const [accounts, setAccounts] = useState<AuctionAccount[]>([]);
  const [summaries, setSummaries] = useState<Record<string, FeeScheduleSummary[]>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // auction_platform of the open add form
  const [form, setForm] = useState({ fee_tier: '', holder_name: '', member_number: '', payment_tier: '' as '' | PaymentTier });

  const load = async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const [h, t, a] = await Promise.all([listAuctionHouses(), listFeeTiers(), listAccounts(orgId)]);
      setHouses(h); setTiers(t); setAccounts(a);
      const feeHouses = h.filter(x => t.some(y => y.auction_platform === x.auction_platform));
      const sums = await Promise.all(feeHouses.map(x => summariseSchedules(orgId, x.auction_platform)));
      setSummaries(Object.fromEntries(feeHouses.map((x, i) => [x.auction_platform, sums[i]])));
    } catch (e: any) {
      setError(e?.message || 'Failed to load fee schedules.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [orgId]);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try { await fn(); await load(); } catch (e: any) { setError(e?.message || 'Failed to save.'); } finally { setBusyId(null); }
  };

  const submitAdd = async (platform: string) => {
    if (!form.fee_tier || !form.holder_name.trim()) { setError('Choose the account\'s official fee tier and enter who holds the account.'); return; }
    await run('add', async () => {
      await addAccount(orgId, user.id, {
        auction_platform: platform, fee_tier: form.fee_tier, holder_name: form.holder_name.trim(),
        member_number: form.member_number.trim() || null, payment_tier: form.payment_tier || null,
      });
      setAdding(null);
      setForm({ fee_tier: '', holder_name: '', member_number: '', payment_tier: '' });
    });
  };

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  const feeHouses = houses.filter(h => tiers.some(t => t.auction_platform === h.auction_platform));

  return (
    <div className="max-w-5xl mx-auto" data-testid="fee-schedules-admin">
      <h1 className="text-2xl font-bold text-[#403f4c]">Fee schedules and accounts</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Each auction house's official fee tiers, the buying accounts this org holds, and which schedule is loaded. A fee is priced under the
        house's <strong>default account</strong>; if the house has no account, or the account's tier has no schedule, the fee is not quoted and says why.
      </p>
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3" data-testid="fee-admin-error">{error}</div>}

      {feeHouses.map(house => {
        const hTiers = tiers.filter(t => t.auction_platform === house.auction_platform);
        const hAccounts = accounts.filter(a => a.auction_platform === house.auction_platform);
        const sums = summaries[house.auction_platform] ?? [];
        const hasDefault = hAccounts.some(a => a.is_default);
        return (
          <section key={house.auction_platform} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6" data-testid={`house-${house.auction_platform}`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-[#403f4c]">{house.display_name}</h2>
              {!hasDefault && <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">No default account - fees are not quoted</span>}
            </div>

            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Accounts</h3>
            {hAccounts.length === 0 ? (
              <div className="text-xs text-gray-400 bg-gray-50 rounded p-3 mb-3">No {house.display_name} account is set up.</div>
            ) : (
              <div className="space-y-2 mb-3">
                {hAccounts.map(a => (
                  <div key={a.id} className="flex flex-wrap items-center gap-3 border border-gray-200 rounded-lg p-3 text-sm" data-testid="account-row">
                    <div className="flex-1 min-w-[16rem]">
                      <div className="font-bold text-[#403f4c]">{a.fee_tier}{a.is_default && <span className="ml-2 text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">Default</span>}</div>
                      <div className="text-xs text-gray-500">Account holder: {a.holder_name}{a.member_number ? ` · member #${a.member_number}` : ''}</div>
                    </div>
                    <label className="text-xs text-gray-500 flex items-center gap-1.5">
                      Payment tier
                      <select
                        value={a.payment_tier ?? ''}
                        disabled={busyId === a.id}
                        onChange={e => run(a.id, () => setAccountPaymentTier(a.id, (e.target.value || null) as PaymentTier | null))}
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                        data-testid="account-payment-tier"
                      >
                        <option value="">Not applicable</option>
                        <option value="unsecured">Unsecured</option>
                        <option value="secured">Secured</option>
                      </select>
                    </label>
                    {!a.is_default && (
                      <button
                        onClick={() => run(a.id, () => setDefaultAccount(orgId, a.id, house.auction_platform))}
                        disabled={busyId === a.id}
                        className="text-xs font-bold text-[#a58039] border border-[#a58039]/40 rounded px-2 py-1 hover:bg-[#a58039]/10 disabled:opacity-50"
                      >
                        Make default
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {adding === house.auction_platform ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="add-account-form">
                <label className="text-xs text-gray-600">Official fee tier
                  <select value={form.fee_tier} onChange={e => setForm(f => ({ ...f, fee_tier: e.target.value }))} className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                    <option value="">Select...</option>
                    {hTiers.map(t => <option key={t.fee_tier} value={t.fee_tier}>{t.fee_tier}</option>)}
                  </select>
                </label>
                <label className="text-xs text-gray-600">Account holder
                  <input value={form.holder_name} onChange={e => setForm(f => ({ ...f, holder_name: e.target.value }))} className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="Who holds the account" />
                </label>
                <label className="text-xs text-gray-600">Member number (optional)
                  <input value={form.member_number} onChange={e => setForm(f => ({ ...f, member_number: e.target.value }))} className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
                </label>
                <label className="text-xs text-gray-600">Payment tier
                  <select value={form.payment_tier} onChange={e => setForm(f => ({ ...f, payment_tier: e.target.value as '' | PaymentTier }))} className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                    <option value="">Not applicable</option>
                    <option value="unsecured">Unsecured</option>
                    <option value="secured">Secured</option>
                  </select>
                </label>
                <div className="sm:col-span-2 flex gap-2">
                  <button onClick={() => submitAdd(house.auction_platform)} disabled={busyId === 'add'} className="px-3 py-1.5 bg-[#a58039] text-white text-sm font-bold rounded-lg disabled:opacity-50">Add account</button>
                  <button onClick={() => setAdding(null)} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-sm font-bold rounded-lg">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setAdding(house.auction_platform); setError(null); }} className="flex items-center gap-1.5 text-xs font-bold text-[#403f4c] mb-4 hover:underline" data-testid="add-account-button">
                <Plus className="w-3.5 h-3.5" /> Add a {house.display_name} account
              </button>
            )}

            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Official fee tiers and loaded schedules</h3>
            <div className="space-y-2">
              {hTiers.map(t => {
                const sum = sums.find(s => s.fee_tier === t.fee_tier);
                return (
                  <div key={t.fee_tier} className="border border-gray-100 rounded-lg p-3 text-sm" data-testid="tier-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-[#403f4c]">{t.fee_tier}</span>
                      {sum
                        ? <span className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">{sum.buyer_rows} buyer-fee + {sum.bid_rows} bid-fee brackets · titles: {sum.title_statuses.join(', ')} · payment: {sum.payment_tiers.join(', ')}</span>
                        : <span className="text-[11px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">no schedule loaded - fees under this tier are not quoted</span>}
                      {t.source_url && <a href={t.source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-indigo-600 hover:underline flex items-center gap-0.5">house page <ExternalLink className="w-3 h-3" /></a>}
                    </div>
                    {t.eligibility && <div className="text-[11px] text-gray-500 mt-1">Eligibility (the house's own wording): "{t.eligibility}"</div>}
                    {t.notes && <div className="text-[11px] text-gray-400 mt-0.5">{t.notes}</div>}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-gray-400">
        To load a schedule, confirm it through Document Extraction (choose the official tier at review), or generate SQL with
        <code className="mx-1 bg-gray-100 px-1 rounded">scripts/loadFeeSchedule.mjs</code>. Neither needs a code change.
      </p>
    </div>
  );
};

export default FeeSchedulesAdmin;

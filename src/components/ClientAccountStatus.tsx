import React, { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { RelClient, ClientMembershipStatus, getClientMembershipStatus, getClientAccountState, ClientAccountState, provisionClientByEmail, revokeClientAccess } from '../services/clientRelationshipService';

// PROMPT 41 Stage 0 - the staff provisioning/revoking UI that never existed: the DB functions
// (provision_client_account, revoke_client_access, migration 070) shipped in Prompt 39 with no screen to call
// them from, which is exactly how Bashir ended up testing login with Mohammed's own real credentials instead.
// provision_client_account_by_email (migration 076/077) is the one this screen calls - staff provisions by
// EMAIL (the only thing they'd actually know), which links an already-existing auth account immediately, or
// keeps the client record's email in sync so a later fresh signup still links itself automatically.

const ClientAccountStatus: React.FC<{ client: RelClient; onChanged: () => void }> = ({ client, onChanged }) => {
  const { user } = useAuth();
  const [status, setStatus] = useState<ClientMembershipStatus | null | 'loading'>('loading');
  const [email, setEmail] = useState(client.email ?? '');
  const [accountState, setAccountState] = useState<ClientAccountState | null>(client.user_id ? 'linked' : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!client.user_id) {
      setStatus(null);
      setAccountState(null);
      getClientAccountState(client.id).then(a => { if (!cancelled) setAccountState(a); }).catch(() => { if (!cancelled) setAccountState('not_provisioned'); });
      return () => { cancelled = true; };
    }
    setAccountState('linked');
    getClientMembershipStatus(client.user_id, client.org_id)
      .then(s => { if (!cancelled) setStatus(s); })
      .catch(e => { if (!cancelled) { setStatus(null); setErr((e as Error).message); } });
    return () => { cancelled = true; };
  }, [client.user_id, client.org_id, client.id, client.email]);

  const doProvision = async () => {
    if (!user || !email.trim()) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await provisionClientByEmail(client.id, email.trim(), user.id);
      setMsg(r.linked
        ? 'Linked - the client can sign in now.'
        : r.reason === 'awaiting_confirmation'
          ? 'An account with that email exists but its owner has not confirmed the address yet, so it is NOT linked. It links by itself the moment they confirm.'
          : "No account with that email exists yet. The client's email is saved - once they sign in with it (Google, or an email they confirm), they'll be linked automatically.");
      setAccountState(r.linked ? 'linked' : r.reason === 'awaiting_confirmation' ? 'awaiting_confirmation' : 'not_provisioned');
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const doRevoke = async () => {
    if (!user) return;
    const reason = window.prompt("Reason for revoking this client's account access:");
    if (!reason || !reason.trim()) return;
    setBusy(true); setErr(null); setMsg(null);
    try { await revokeClientAccess(client.id, user.id, reason.trim()); setStatus(s => (s && s !== 'loading' ? { ...s, active: false, revokedAt: new Date().toISOString(), revokeReason: reason.trim() } : s)); onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const doReactivate = async () => {
    if (!user || !client.email) return;
    setBusy(true); setErr(null); setMsg(null);
    try { await provisionClientByEmail(client.id, client.email, user.id); setMsg('Reactivated.'); onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  if (status === 'loading') return <Loader2 className="w-4 h-4 animate-spin text-[#a58039]" />;

  return (
    <div className="text-sm">
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      {msg && <p className="text-xs text-green-700 mb-2">{msg}</p>}
      {!client.user_id ? (
        <div className="flex flex-wrap gap-2 items-center">
          <UserPlus className="w-4 h-4 text-gray-400" />
          {accountState === null
            ? <span data-testid="account-state-loading" className="text-gray-400">Checking account...</span>
            : accountState === 'awaiting_confirmation'
            ? <span data-testid="account-state" data-state="awaiting_confirmation" className="text-amber-700 font-medium">Awaiting email confirmation - not linked yet</span>
            : <span data-testid="account-state" data-state="not_provisioned" className="text-gray-500">Not provisioned</span>}
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="client's email" className="border rounded px-2 py-1 text-sm w-56" />
          <button onClick={doProvision} disabled={busy || !email.trim()} className="text-xs bg-[#a58039] text-white px-3 py-1.5 rounded disabled:opacity-50">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Provision'}
          </button>
        </div>
      ) : status?.active ? (
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-green-600" />
          <span data-testid="account-state" data-state="linked" className="text-green-700 font-medium">Account active (linked)</span>
          <button onClick={doRevoke} disabled={busy} className="text-xs text-red-600 hover:underline disabled:opacity-50">Revoke access</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <ShieldOff className="w-4 h-4 text-red-500" />
          <span data-testid="account-state" data-state="linked" className="text-red-600 font-medium">Access revoked</span>
          {status?.revokeReason && <span className="text-xs text-gray-400">({status.revokeReason})</span>}
          <button onClick={doReactivate} disabled={busy} className="text-xs text-[#a58039] hover:underline disabled:opacity-50">Reactivate</button>
        </div>
      )}
    </div>
  );
};

export default ClientAccountStatus;

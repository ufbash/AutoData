import { useEffect, useState } from 'react';

// The client page stays mounted underneath the full-page vehicle (overlay sibling, so Back returns to it intact).
// That means anything it shows derived from billing - the account status, each vehicle's balance - goes stale the
// moment billing changes on the vehicle page above it (found by the Prompt 42 journey 6 browser test: an overdue
// invoice was issued, Back was clicked, and the status still said "Outstanding"). BillingSection announces every
// change here; derived views refetch when the counter moves.
const EVENT = 'autodata:billing-changed';
export const notifyBillingChanged = (source?: string) => window.dispatchEvent(new CustomEvent(EVENT, { detail: { source } }));
// `ignoreSource`: a Billing list ignores announcements it made itself (it already has fresh data) so two lists on screen
// at once - the client page's and the vehicle page's - refresh each other without ping-ponging.
export const useBillingChangeCounter = (ignoreSource?: string): number => {
  const [n, setN] = useState(0);
  useEffect(() => {
    const h = (e: Event) => { if (ignoreSource && (e as CustomEvent).detail?.source === ignoreSource) return; setN(v => v + 1); };
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, [ignoreSource]);
  return n;
};

// PROMPT 44 Stage 4 - database enum values are code, not words. Anywhere a person reads one, it goes through here.
// Unknown values fall back to a humanised form (snake_case -> words), never the raw token.
const humanise = (v: string) => v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const PLATFORM: Record<string, string> = { copart: 'Copart', iaai: 'IAAI', bidcars: 'bid.cars', bidfax: 'BidFax', instagram: 'Instagram', manual: 'Entered by hand' };
const LOGGED_VIA: Record<string, string> = { manual_entry: 'Entered by hand', extension_dom_capture: 'Captured from the page', ai_vision: 'Read from a screenshot', api_import: 'Imported' };
const LOT_STATE: Record<string, string> = { active: 'Live', finished: 'Finished', unknown: 'Not recorded' };
const RUN_TYPE: Record<string, string> = { sold_comps: 'Market research (sold)', active_listings: 'Client options (live)', mixed: 'Mixed' };

export const platformLabel = (v: string | null | undefined) => (v ? PLATFORM[v.toLowerCase()] ?? humanise(v) : 'Source not recorded');
export const loggedViaLabel = (v: string | null | undefined) => (v ? LOGGED_VIA[v] ?? humanise(v) : 'Not recorded');
export const lotStateLabel = (v: string | null | undefined) => (v ? LOT_STATE[v] ?? humanise(v) : 'Not recorded');
export const runTypeLabel = (v: string | null | undefined) => (v ? RUN_TYPE[v] ?? humanise(v) : '');

# SOLVED.md — How, not just what

This file documents the *mechanism* behind non-obvious technical solutions in AutoData —
reconstructed only from the code in this repo and `git log` against it. Where the evidence
does not support a confident account, the entry says so plainly rather than guessing.

This file does not carry status markers (DONE/IN PROGRESS/etc.) — status lives in
`PLAN_TRACKER.md` per project convention (`HANDOFF.md`).

---

## 1. bid.cars image capture (pluto.bid.car)

**Symptom:** Direct browser loads of `images.bid.cars` / `pluto.bid.car` URLs return
`ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` / HTTP 403 (Cloudflare Bot Management). Server-side
`fetch()` of the same URLs from an Edge Function also gets 403'd (this is the symptom
AGENTS.md §4.9 already records — this entry is the mechanism that works around it).

**Symptom (update, 4 Sep 2026): active lots captured with zero images; archived lots
captured correctly.** Real DOM recon on both page kinds showed the cause was **timing, not
selector or Cloudflare**: on an active lot the gallery carousel is empty at page load
(`<div class="carousel-item carousel-archived active"></div>`) and only fills in — sixteen
`<div class="f-carousel__slide" data-src="https://pluto.bid.car/...">` elements — after the
page's own lazy-load runs (console: `Gallery lazy load`). The DOM-element/attribute walk
below (step 1) is correct but runs synchronously at whatever instant the popup's capture
button is clicked — before that lazy-load has necessarily fired. The same URLs are present
at load, deterministically, inside an inline `<script>` as
`preloadGalleryImage('https://pluto.bid.car/0-45737204/...-1.jpg');` calls — reading those is
timing-independent, since inline `<script>` content exists in the raw HTML before any JS runs
(fixed in step 1a below).

**Cause:** Cloudflare in front of `bid.cars`/`pluto.bid.car` blocks requests that don't
originate from a real browser tab on the `bid.cars` origin. `DECISIONS.md` §9, decision 9.2:
"Cloudflare Bot Management blocks all server-side fetching of `pluto.bid.car` (verified 403
with full browser headers). The extension fetches bytes in page context where the origin is
`bid.cars` and POSTs them."

**Solution — the full path, traced end to end:**

1. **How image URLs are found — this is the precise answer to the priority question.**
   `chrome-extension/content-bidcars.js:419-430`:
   ```js
   // Images logic
   const rx = /https?:\/\/(images\.bid\.cars|pluto\.bid\.car)\/[^\s"'<>\\]+\.jpg/gi;
   const found = new Set();
   document.querySelectorAll('*').forEach(el => {
     for (const a of el.attributes || []) {
       const m = (a.value || '').match(rx);
       if (m) m.forEach(u => found.add(u));
     }
     if (el.style && el.style.backgroundImage) {
       const m = el.style.backgroundImage.match(rx);
       if (m) m.forEach(u => found.add(u));
     }
   });
   ```
   This is **(a) SCRAPED from DOM elements** — every element on the page (`querySelectorAll('*')`),
   every one of its attributes (not a named selector like `img[src]`, all attributes on all
   elements), plus each element's inline `style.backgroundImage`, tested against a regex that
   matches full `images.bid.cars/...jpg` or `pluto.bid.car/...jpg` URLs. It is **not (b)
   constructed** from a lot number or VIN pattern — there is no string-template URL-building
   code anywhere in this file. It is **not (c)** read from `<link rel="preload">` tags
   specifically — a repo-wide grep for `"preload"` (`grep -rn "preload" chrome-extension/
   supabase/ src/`) finds zero hits in the extension or Edge Functions; the only "preload" hits
   in the whole repo are unrelated `<img>` preloading in
   `src/components/VehicleDetailModal.tsx:158-167` for the staff-UI image carousel, not
   bid.cars capture. Because `querySelectorAll('*')` walks every element's every attribute, a
   `<link rel="preload" href="...pluto.bid.car/...jpg">` tag's `href` *would* be swept up by
   this same loop like any other attribute — but there is no code that looks for `rel="preload"`
   specifically, so this cannot be called "reading preload tags" as a deliberate mechanism.

1a. **Inline-`<script>` scan (added 4 Sep 2026)** — `content-bidcars.js:455-459`, immediately
   after the DOM/attribute walk above, additive to it (the DOM walk is unchanged and archived
   lots keep working through it exactly as before):
   ```js
   document.querySelectorAll('script').forEach(s => {
     const text = s.textContent || '';
     const m = text.match(rx);
     if (m) m.forEach(u => found.add(u));
   });
   const allUrls = [...found];
   ```
   Both sources feed the same `found` Set (deduped, order not yet meaningful — real ordering
   happens in step 2). Deliberately does not scroll or click to force the lazy-load; that
   would be timing-dependent in a different way (slow connections, animation frames) — reading
   already-present script text is deterministic regardless of load speed.

2. **Filtering, domain preference, and ordering** — `content-bidcars.js:462-479`:
   ```js
   // Filter by VIN
   let vinUrls = allUrls.filter(u => u.includes(vin));
   if (vinUrls.length === 0) vinUrls = allUrls; // fallback

   // Dedupe prefer pluto.bid.car over images.bid.cars
   const imageMap = new Map(); // key -> url
   vinUrls.forEach(u => {
       const match = u.match(/-(\d+)\.jpg$/i);
       if (match) {
           const idx = parseInt(match[1], 10);
           if (!imageMap.has(idx) || u.includes('pluto.bid.car')) {
               imageMap.set(idx, u);
           }
       }
   });

   const sortedIndices = Array.from(imageMap.keys()).sort((a, b) => a - b);
   payload.image_urls = sortedIndices.map(i => imageMap.get(i));
   ```
   URLs are kept only if the VIN substring appears in the URL (falls back to the unfiltered
   set if none match); deduped by the numeric index suffix (`-<n>.jpg`), preferring a
   `pluto.bid.car` URL over an `images.bid.cars` URL for the same index; then sorted ascending
   by that numeric index — image 1 stays image 1 regardless of which order the two source
   scans found the URLs in, or which domain happened to appear first.

   **The domain preference was flipped 4 Sep 2026, confirmed live.** The two domains can
   both carry the identical image on the same active lot (confirmed by opening a captured
   `pluto.bid.car` URL directly — it loaded). Fetching an `images.bid.cars` URL from bid.cars'
   own page context (the mechanism in step 3) fails in the browser console with `Access to
   fetch at 'https://images.bid.cars/...' from origin 'https://bid.cars' has been blocked by
   CORS policy: No 'Access-Control-Allow-Origin' header is present`, then
   `net::ERR_FAILED` — a real HTTP response is returned but the browser refuses to let the page
   read it, because that response carries no CORS header for any origin, not because of
   Cloudflare bot detection (the mechanism the rest of this entry addresses). The identical
   image at `pluto.bid.car` fetches successfully from the same page context. Two live
   sightings captured before this fix — `76a34091-052e-4843-8e9c-78018af2ee5f` (active,
   16 `images.bid.cars` URLs, `image_store_status = NULL`) and an older one from 28 Aug 2026,
   `f46add62-8a77-429f-85a4-edced757796a` (active, 12 `images.bid.cars` URLs,
   `image_store_status = 'extension_managed'`, never reached `complete`) — show this
   `images.bid.cars`-on-active-lots failure predates the 4 Sep timing fix entirely; the old
   DOM-only walk was already finding `images.bid.cars` URLs on some active lots and they were
   never successfully uploading. After the flip, two fresh captures (`49804e7e...`, active,
   and `2a130af2...`, archived, both 4 Sep 2026) show 12/12 `pluto.bid.car` URLs each,
   `image_store_status = 'complete'`.

3. **Fetching the bytes in page context** — `content-bidcars.js:469-510`,
   `fetchImagesAsBase64()`: iterates up to 12 URLs, tries `fetch(url, {credentials:'omit',
   mode:'cors'})` first, falls back to a plain `fetch(url)` on failure, reads the response as
   a `Blob`, and converts to base64 via `FileReader.readAsDataURL`. A running byte budget caps
   the payload at `20 * 1024 * 1024` once at least 8 images are collected (`content-
   bidcars.js:499`: `if (totalBytes + b64.length > 20 * 1024 * 1024 && i >= 8) { truncated =
   true; break; }`).

4. **What gets sent where** — `chrome-extension/background.js:9-53`. The base64 blobs are
   stripped out of the main capture payload and POSTed separately:
   ```js
   const { image_blobs, ...payloadWithoutBlobs } = request.payload;
   const res = await fetch(url, { ... body: JSON.stringify(payloadWithoutBlobs) }); // research-capture
   ...
   if (image_blobs && Array.isArray(image_blobs) && image_blobs.length > 0) {
     const validBlobs = image_blobs.map((b, i) => b ? { index: i, data_base64: b } : null).filter(Boolean);
     ...
     fetch(`${result.supabaseUrl}/functions/v1/upload-images`, {
       method: "POST",
       headers: { "Content-Type": "application/json", "X-Research-Secret": result.researchSecret },
       body: JSON.stringify({ sighting_id: data.sighting_id, images: validBlobs })
     })
   }
   ```
   The request body to `upload-images` is `{ sighting_id: string, images: [{ index: number,
   data_base64: string }, ...] }`.

5. **What `upload-images` does with it** — `supabase/functions/upload-images/index.ts:37-125`:
   ```ts
   const { sighting_id, images } = body;
   ...
   images.sort((a, b) => a.index - b.index);
   for (const img of images) {
     ...
     const bytes = decode(img.data_base64);
     const padIndex = img.index.toString().padStart(2, '0');
     const path = `${sighting.org_id}/${sighting_id}/${padIndex}.jpg`;
     const { error: uploadError } = await supabase.storage
       .from('vehicle-images')
       .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
     ...
   }
   ```
   It authenticates via the `X-Research-Secret` header against `RESEARCH_CAPTURE_SECRET`
   (`upload-images/index.ts:20-26`), looks up the sighting's `org_id` (line 55-59), decodes
   each base64 string back to bytes, and uploads to the private `vehicle-images` Storage
   bucket at path `{org_id}/{sighting_id}/{padded index}.jpg`.

6. **How `stored_image_urls` / `image_store_status` end up set** —
   `upload-images/index.ts:67-125`:
   ```ts
   const expectedCount = Math.min(sighting.image_urls?.length || 0, 12);
   let newStatus = 'failed';
   if (uploaded > 0) {
     newStatus = (uploaded === expectedCount || uploaded === images.length) ? 'complete' : 'partial';
   }
   const updatePayload: any = { image_store_status: newStatus, images_stored_at: new Date().toISOString() };
   if (storedUrls.length > 0) { updatePayload.stored_image_urls = storedUrls; }
   await supabase.from('sightings').update(updatePayload).eq('id', sighting_id);
   ```
   `stored_image_urls` becomes the array of Storage *paths* (not signed URLs — those are
   generated on demand, see topic 7) that uploaded successfully; `image_store_status` becomes
   `complete`, `partial`, or `failed` depending on how many succeeded against the expected
   count. Confirmed against live data (read-only `SELECT`, 4 Sep 2026):
   `sightings` row `9fe9647c-c84e-431f-8c81-5848cd09f8ae` (source `bidcars`) has
   `image_store_status = 'complete'`, 12 `image_urls`, 12 `stored_image_urls`, with paths of
   the exact form `a93378ea-.../9fe9647c-.../00.jpg` through `.../11.jpg`, matching the code
   above exactly.

**Why this way:** `DECISIONS.md` §9, row 9.2: "bid.cars images uploaded extension-side
(Cloudflare blocks servers entirely) | LOCKED", with the elaboration quoted under Cause above:
"The extension fetches bytes in page context where the origin is `bid.cars` and POSTs them.
**This pattern generalises to any future source that blocks servers.**" The commit that added
this path is titled `a5d6499 C1 image pipeline (server-side Copart, extension-side bid.cars),
Copart readiness guard + lot_state, eligibility rules` — the title itself records the
server/extension split as deliberate, though the commit body carries no further prose beyond
the title and the `CHECKPOINT.md` verification steps it added.

**How to extend it:** The VIN-substring filter (`content-bidcars.js:434`) silently falls back
to the *unfiltered* URL set if zero URLs contain the VIN — a page layout change that alters
how VINs appear in image URLs would degrade to "grab everything found on the page" rather
than erroring. The `-<n>.jpg` suffix regex (`content-bidcars.js:440`) is the sole indexing
mechanism; an image URL without a numeric suffix is silently dropped from `imageMap` entirely
(the `if (match)` guard at line 441 has no `else`). The 12-image cap
(`fetchImagesAsBase64`, `Math.min(urls.length, 12)`) and the `expectedCount = Math.min(...,
12)` in `upload-images/index.ts:107` must stay in agreement — changing one without the other
would make `newStatus` compute against the wrong expected count. **Do not flip the
`pluto.bid.car` preference back to `images.bid.cars`** — that domain is confirmed (4 Sep
2026, live console evidence) to fail CORS from page context; preferring it silently produces
`image_store_status = NULL`/`'extension_managed'` with zero stored images, exactly the
regression this fix closed. If `pluto.bid.car` itself ever starts failing the same way, the
whole page-context-fetch premise (`upload-images` step 3 above) needs re-verifying against
the live site before assuming either domain works. The `document.querySelectorAll('script')`
scan (step 1a) reads every inline script's `textContent` on the page — if bid.cars ever
serves the gallery data as JSON inside a `<script type="application/json">` block instead of
`preloadGalleryImage(...)` call syntax, the URLs would still be swept up (the regex matches
the URL text regardless of surrounding JS syntax), but if they were serialized with escaped
slashes or otherwise transformed, the regex would need updating to match.

---

## 2. Copart image capture via `store-images`

**Symptom:** Copart image URLs, unlike bid.cars, needed a path that works without extension
involvement.

**Solution:** `supabase/functions/store-images/index.ts` fetches images **server-side**,
directly from the Edge Function, with browser-mimicking headers and a retry:
```ts
headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36");
headers.set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
...
headers.set("Referer", referer);
if (origin) { headers.set("Origin", origin); }
...
const imgRes = await fetch(urlStr, { headers, signal: controller.signal });
...
if ((status === 403 || status === 429) && attempt === 1) {
  await new Promise(r => setTimeout(r, 500));
  continue; // retry
}
```
(`store-images/index.ts:151-233`). `refererFor()`/`originFor()` (`store-images/index.ts:9-23`)
set `Referer: https://www.copart.com/`, `https://bid.cars/`, or `https://www.iaai.com/`
depending on the source host, and additionally set `Origin: https://bid.cars` for bid.cars
hosts specifically.

**The difference from topic 1, and why the function still has bid.cars host logic in it:**
`store-images/index.ts:115-126` explicitly detects bid.cars URLs and refuses to server-fetch
them, deferring to the extension path instead:
```ts
const firstUrl = new URL(imageUrls[0]);
const host = firstUrl.hostname.toLowerCase();
if (host.endsWith('bid.car') || host.endsWith('bid.cars')) {
   await supabase.from('sightings').update({ image_store_status: 'extension_managed' }).eq('id', sightingId);
   results.push({ sighting_id: sightingId, status: 'extension_managed', reason: 'Handled by extension' });
   continue;
}
```
So the two mechanisms coexist in the *same function*: `store-images` is the Copart (and,
per `refererFor`, nominally IAAI) server-side fetch path, and it explicitly hands bid.cars
sightings back to the extension-side path (topic 1) rather than attempting the fetch it knows
will 403. Live data confirms this split holds in practice: of 111 sightings with
`image_store_status = 'complete'`, both `source_platform = 'bidcars'` and `source_platform =
'copart'` rows appear (read-only `SELECT ... GROUP BY image_store_status`, 4 Sep 2026), and
the 11 rows with `image_store_status = 'extension_managed'` are the bid.cars rows this
`store-images` early-return produces.

**Why this way:** `DECISIONS.md` §9.2 (quoted in topic 1) states Cloudflare blocks
*server-side* fetching of bid.cars/pluto.bid.car specifically — the clear implication, backed
by the presence of a whole retry-with-headers mechanism for Copart in the same file, is that
Copart's anti-bot posture tolerates a server fetch with a plausible `User-Agent` and
`Referer` where bid.cars' Cloudflare rule does not. The code does not contain a comment
stating this comparison explicitly — the `refererFor`/retry logic is written generically for
"any of these three hosts," and its purpose is proven by the fact it is only ever reached for
non-bid.cars URLs (the bid.cars branch returns early). No commit message or code comment
states in so many words "Copart allows server fetch, bid.cars does not" — that specific
comparative claim is corroborated by AGENTS.md §4.9 ("Not a bug. Do not attempt to fix it,"
about bid.cars 403s) together with the working Copart path in this same file, but is not
verbatim in any single source.

**How to extend it:** The bid.cars short-circuit at `store-images/index.ts:115-126` runs
before the retry loop and before `image_store_status` is set to `'pending'` — a URL-hostname
check on `imageUrls[0]` only. If a sighting's `image_urls[0]` happens to be a non-bid.cars URL
while later URLs are bid.cars (shouldn't happen given topic 1's capture logic, but nothing
enforces it), this check would not catch it and the function would attempt (and presumably
403) on the bid.cars URLs mixed into the array.

---

## 3. The image permutation `[2,1,4,3]`

**Symptom:** `PLAN_TRACKER.md:245` mentions an image reordering pattern: "Same schema; image
permutation `[2,1,4,3]`. Present in the original Camry sheet; the one source still missing."

**Solution:** No such logic exists in the codebase. This text sits under
`PLAN_TRACKER.md:244`, `### B1. IAAI content script — **NOT STARTED**` — it describes a
property observed in a reference spreadsheet ("the original Camry sheet") for a capture
source (IAAI) that has no content script yet. Searches confirm no implementation exists:

```
grep -rn "2,1,4,3\|\[2, 1, 4, 3\]\|permut" PLAN_TRACKER.md src chrome-extension supabase
```
→ only the one `PLAN_TRACKER.md:245` hit (the doc mention itself).

```
grep -n "\[2, ?1, ?4, ?3\]" . --include="*.js" --include="*.ts" --include="*.tsx" -r
```
→ zero matches (exit code 1).

`chrome-extension/content-copart.js:249-273` (the only other image-collection code in the
extension) collects Copart image URLs into a `Set` and writes them with no reordering step:
```js
payload.image_urls = Array.from(uniqueUrls);
```
No `.sort()`, index-remap, or permutation array appears anywhere near it.

**Why this way:** Not applicable — there is nothing built to explain. `PLAN_TRACKER.md`
itself is the only source, and it labels IAAI content-script work `NOT STARTED`.

**How to extend it:** If an IAAI content script is built, the `[2,1,4,3]` permutation
`PLAN_TRACKER.md:245` describes is a fact about IAAI's own image ordering (as observed in a
reference spreadsheet), not a rule already implemented anywhere to copy — it would need to be
implemented from scratch against IAAI's real DOM output, per AGENTS.md §4.6 ("Never guess at
DOM structure").

---

## 4. `parseAuctionDate()`

**Symptom:** `sale_date` on `sightings` is free text with several observed shapes —
`"Thu. Aug 06, 2026 03:00 PM GMT+1"`, `"Future"`, `null`, empty string, and bid.cars variants
(AGENTS.md §4.12) — and anything time-based (countdowns, alerts) needs a real `Date` or a
clean "unknown" signal, never a guessed fallback.

**Solution:** The full function, `src/utils/auctionDate.ts:1-15`:
```ts
export function parseAuctionDate(raw: string | null | undefined): Date | null {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'future') {
    return null;
  }

  const d = new Date(trimmed);
  if (isNaN(d.getTime())) {
    return null;
  }

  return d;
}
```
Every case it handles, in order:
- **Missing/wrong type** (`raw` is `null`, `undefined`, or not a string) → `line 2`, returns
  `null` immediately.
- **Empty or whitespace-only string** (after `.trim()`) → `line 5`, returns `null`.
- **The literal case-insensitive string `"future"`** (`trimmed.toLowerCase() === 'future'`) →
  `line 5`, returns `null` — this is the explicit handling for bid.cars' `"Future"` sentinel.
- **Any other string** → handed to the native `new Date(trimmed)` constructor (`line 9`); if
  that produces an invalid date (`isNaN(d.getTime())`, `line 10`) → returns `null`; otherwise
  → returns the parsed `Date` object (`line 14`).

It fails closed by construction: **every exit path other than the final `return d` returns
`null`**, and `null` is the *only* non-`Date` value the function can return — there is no
fallback date literal, no `new Date()` (current time) default, and no branch that returns
anything else. The unparseable-input guarantee rests entirely on `isNaN(d.getTime())` at
line 10: `new Date()` on a genuinely unparseable string produces a `Date` object whose
`getTime()` is `NaN`, and that is the only signal this function trusts to distinguish a real
date from garbage input.

**Why this way:** AGENTS.md §4.12: "Anything time-based must go through the shared
`parseAuctionDate()` helper in `src/utils/auctionDate.ts`, which returns a real `Date` or
`null`. **It must never return a guessed or fallback date** — a wrong date would fire an alert
at the wrong time. Unparseable renders as 'Auction date TBC' with no countdown."

**How to extend it:** Any new caller must treat `null` as "no countdown, show TBC" and must
never coerce a `null` return into a default date. Adding a new recognized string format must
preserve the property that every non-`Date` path returns `null` and nothing else — introducing
even one fallback-date branch would reintroduce exactly the bug this function exists to
prevent (per AGENTS.md §4.12, a wrong date fires an alert at the wrong time).

### Update (4 Sep 2026): live-lot date capture, and what the stored value actually means

**Symptom:** bid.cars active lots never populated `sale_date` at all — not a parse failure,
simply never attempted. Real DOM recon showed why: the live page's own displayed date/time
has no year (`"Friday, 4 September, 14:30"`, in `div.mobile-version.status.gray`), so even if
scraped, `parseAuctionDate()` would correctly reject it (no fallback-year guess, per the
function above). The page also carries a machine-readable countdown offset:
`<label id="time-left" data-initial-time="0 d 6 h 45 min 33 sec"
data-initial-total-seconds="24333">`.

**Solution** — `content-bidcars.js`, inside the `lot_state === 'active'` branch:
```js
if (lot_state === 'active') {
    const timeLeftEl = document.getElementById('time-left');
    const totalSeconds = timeLeftEl ? parseInt(timeLeftEl.getAttribute('data-initial-total-seconds'), 10) : NaN;
    if (timeLeftEl && !isNaN(totalSeconds)) {
        sale_date = new Date(Date.now() + totalSeconds * 1000).toISOString();
    }
    // If #time-left or the attribute is absent, sale_date stays null.
}
```
Reads the countdown offset once, at capture time, and computes an absolute instant
(`capture time + offset seconds`) rather than storing the offset or the yearless display
string. Stored as `.toISOString()` — a format `parseAuctionDate()` already parses via its
`new Date(trimmed)` call, so **no second parser and no change to the shared helper.** If
`#time-left` is absent or its attribute doesn't parse as a number, `sale_date` stays `null` —
same fail-closed guarantee as the parser itself, never a guessed fallback. Archived lots are
untouched (this branch only runs when `lot_state === 'active'`); their `sale_date` stays
`null` exactly as before (`content-bidcars.js:339`, unrelated pre-existing code).

**This is bid-closing time, not auction-start time — label it as such wherever it is used.**
The `#time-left` element's own tooltip states bidding closes 30 minutes before the live
auction itself starts. `sale_date` is stored with this value because it is the only date
field available for an active lot and the countdown/alert machinery is built around
`sale_date`, but the value is bid-closing, not auction-start. Confirmed live: a captured lot
showed `AUCTION IN 6H 27M 47S` counting down to `Fri 4 Sept, 14:30` in the staff countdown,
and the same lot's bid.cars page displayed the same date/time — verified by direct
side-by-side comparison, not inferred.

**Why this way:** Not recoverable from git history — this is new code added 4 Sep 2026, no
prior commit to cite. The bid-closing-vs-auction-start distinction and the requirement to
compute an absolute instant rather than store the display string both come directly from the
real DOM evidence gathered the same day (quoted under Symptom above), not from any earlier
document or commit.

**How to extend it:** Anything that reads `sale_date` for an active bid.cars lot — the
countdown component, a future alerts build — is reading **bid-closing time**, not auction
start. `SCHEMA.md` §6 records this distinction; the alerts build (`PLAN_TRACKER.md` 4.1) must
not silently treat this value as when the auction itself starts. Do not add a second
extraction path for `#time-left` elsewhere — this is the one place `sale_date` gets computed
for active bid.cars lots.

---

## 5. `sale_confirmed` derivation from `auction_history`

**Symptom:** `sale_confirmed` is a three-state boolean/`null` field on `sightings`.
`SCHEMA.md:153` describes it at a high level: "Derived from the last row's status in
`auction_history` (bid.cars Sales History panel)."

**Solution — the actual code, and where it runs:** The derivation is **not** server-side.
`supabase/functions/research-capture/index.ts:272` simply passes through whatever the client
sent: `sale_confirmed: cf.sale_confirmed ?? null`. The real computation happens in the
extension, `chrome-extension/content-bidcars.js:348-367`:
```js
const { history: auctionHistoryArray, found: hasSalesTable } = extractSalesHistory();
let auction_appearance_count = hasSalesTable ? auctionHistoryArray.length : null;
let sale_confirmed = null;

if (auctionHistoryArray.length > 0) {
    const sorted = [...auctionHistoryArray].sort((a, b) => {
        const d1 = a.auction_date ? new Date(a.auction_date).getTime() : 0;
        const d2 = b.auction_date ? new Date(b.auction_date).getTime() : 0;
        return d1 - d2;
    });
    const latest = sorted[sorted.length - 1];
    if (latest && latest.status) {
        const s = latest.status.toLowerCase();
        if (/(not sold|no sale|withdrawn|cancell?ed|pending)/.test(s)) {
            sale_confirmed = false;
        } else if (/(sold|sale)/.test(s) && !s.includes('not')) {
            sale_confirmed = true;
        }
    }
}
```
`SCHEMA.md`'s "last row's status" is confirmed correct, with one precision the doc omits:
"last" is not the last row as scraped off the page — the rows are explicitly re-sorted
**ascending by parsed `auction_date`** (`sorted[sorted.length - 1]` after the `.sort((a,b) =>
d1 - d2)`), so "last" means most-recent-by-date, not last-in-DOM-order. If a row's
`auction_date` fails to parse via `new Date(...)`, it sorts as if dated at epoch 0
(`d1 = a.auction_date ? new Date(a.auction_date).getTime() : 0`), which could displace an
undated row to the front rather than excluding it — the code does not filter out unparseable
dates before sorting.

If the latest row's status matches none of the two regexes (e.g. an unrecognized status
string), `sale_confirmed` stays at its initialized value of `null` — this is the three-state
behavior AGENTS.md §6 documents: `false` blocks attachment, `null` shows with a badge.

`research-capture/index.ts:316-339` separately writes the raw `auction_history` rows the
extension scraped (via `extractSalesHistory()`, `content-bidcars.js:89-154`) into the
`auction_history` table, but does not itself read them back to (re-)compute
`sale_confirmed` — it only stores what the extension already computed on `sightings`.

**Why this way:** Not recoverable from the repo. No commit message or code comment explains
why this derivation lives client-side (in the extension) rather than server-side (in
`research-capture`, which does have the raw `auction_history` array available at the same
point it inserts into that table). `SCHEMA.md` describes the *behavior* accurately but not
the *location* choice.

**How to extend it:** Any change to how `sale_confirmed` is computed must be made in
`chrome-extension/content-bidcars.js`, not in `research-capture/index.ts` — the latter is a
pure pass-through (`cf.sale_confirmed ?? null`) and editing it alone would have no effect
until the extension is also changed and reloaded (AGENTS.md §4.7, §4.4). The status-matching
regexes are order-dependent (checked "not sold" family first) and both require the word
"sold"/"sale" to appear with `!s.includes('not')` as a second gate — a new status string
containing both "sold" and "not" in some other combination could produce an unintended false
positive/negative; there is no test coverage visible in the repo for this function.

---

## 6. The `verify_jwt` / CORS trap

**Symptom:** AGENTS.md §4.3: "A Supabase gateway rejection before your code runs (because
`verify_jwt` is on) surfaces in the browser as a CORS failure, because the rejection response
carries no CORS headers."

**Solution — what the repo's own config and code actually show:** `supabase/config.toml`
(full contents):
```toml
[functions.research-capture]
verify_jwt = false

[functions.daily-sniper]
verify_jwt = false

[functions.public-run]
verify_jwt = false

[functions.monthly-backup]
verify_jwt = false

[functions.upload-images]
verify_jwt = false
```
`app-ingest`, `extract-vehicle-vision`, and `store-images` have **no entry** in this file —
confirmed by reading the file directly, not inferred. This matches AGENTS.md §4.3's
requirement list exactly (`verify_jwt = false` for `research-capture`, `upload-images`,
`public-run`, `monthly-backup`; "must **not** be set for `app-ingest` or
`extract-vehicle-vision`") with one addition the repo's own config shows but AGENTS.md's list
doesn't mention: `store-images` is also absent, i.e. also gateway-JWT-checked by default —
consistent with `store-images/index.ts:39-59` performing its own `Authorization: Bearer`
token validation and superadmin-role check in code, which would be redundant if the gateway
weren't already enforcing a valid JWT first.

Every function file in this repo (`research-capture`, `upload-images`, `public-run`,
`store-images`, `app-ingest`, `extract-vehicle-vision`) defines its own `corsHeaders` constant
and attaches it to every `Response` it constructs, including error responses
(`upload-images/index.ts:5-8`, `22-25`, etc.) — but this only helps once the function's own
code is reached. **Whether a gateway-level 401/403 (raised before the function's own code
runs when `verify_jwt = true`) genuinely omits CORS headers, and specifically why that
manifests as a browser-side CORS error rather than a visible 401, is Supabase platform gateway
behavior — it is not implemented in, or documented by, any code in this repo.** The repo's
`config.toml` and each function's own auth logic are the only first-party evidence available;
the underlying gateway mechanics are outside what this repo's code can verify. AGENTS.md §4.3
is the only source in this project for that specific browser-facing claim.

**Why this way:** AGENTS.md §4.3 (quoted above) is the source for the symptom→cause claim
itself. For *why* these five/six functions specifically need `verify_jwt = false`: each of
them is called by a caller that does not carry a Supabase user JWT — the Chrome extension
(`research-capture`, `upload-images`, authenticated instead via `X-Research-Secret`), the
public share page (`public-run`, authenticated via the `share_token` query param, see topic
7), and a cron-triggered function (`monthly-backup`, `daily-sniper`). This inference is
supported directly by reading each function's own auth code (e.g.
`upload-images/index.ts:20-26` checks `x-research-secret` instead of a JWT; `public-run`
has no `Authorization` check at all, see topic 7) rather than by any comment stating the
reason explicitly.

**How to extend it:** Per AGENTS.md §4.3, adding a new Edge Function that's called without a
Supabase session JWT (extension, cron, public page) requires an explicit
`[functions.<name}]` / `verify_jwt = false` block in `config.toml`, or requests will fail at
the gateway with what looks like a CORS error in DevTools — check `config.toml` first before
debugging function code, per AGENTS.md §4.3's own instruction.

---

## 7. The share-token mechanism

**Symptom/context:** Public share pages (`/share/<token>`) expose a curated subset of a
research run's data without requiring the viewer to authenticate.

**Solution — generation:** `src/services/researchService.ts:130-132` (on run creation) and
identically at `researchService.ts:671-673` (`rotateShareToken`):
```ts
const share_token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
  .map(b => b.toString(16).padStart(2, '0'))
  .join('');
```
24 cryptographically random bytes (`crypto.getRandomValues`, not `Math.random()`), hex-encoded
to a 48-character string. `rotateShareToken` (`researchService.ts:670-684`) generates a fresh
token the same way and `.update({ share_token })`s the row, replacing the old one (invalidating
any previously shared link).

**Validation** — `supabase/functions/public-run/index.ts:16-31`:
```ts
const url = new URL(req.url);
let token = url.searchParams.get('token');
if (!token && req.method === 'POST') {
  const body = await req.json().catch(() => ({}));
  token = body.token;
}
if (!token || typeof token !== 'string' || !/^[A-Za-z0-9]{32,128}$/.test(token)) {
  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, ... });
}
```
Format-validated (32-128 alphanumeric chars — looser than the exact 48-hex-char shape the
generator produces, but a superset that rejects garbage) before ever touching the database.
Then looked up at `public-run/index.ts:41-47`:
```ts
const { data: run, error: runError } = await supabaseClient
  .from('research_runs')
  .select('id, client_name, notes, created_at, run_type')
  .eq('share_token', token)
  .eq('share_enabled', true)
  .is('deleted_at', null)
  .single();
```
A token must match an existing row **and** that row must have `share_enabled = true` **and**
not be soft-deleted, or the function returns the same generic `404 Not found` as a
malformed-token request — no distinction is exposed to the caller between "no such token" and
"token exists but sharing is off/run is deleted."

**Field allow-list** — `public-run/index.ts:112-117` for the run-level object:
```ts
const publicRun = {
  client_name: run.client_name,
  notes: run.notes,
  created_at: run.created_at,
  run_type: run.run_type
};
```
and `public-run/index.ts:154-206` for each listing, an inline object literal under the
comment `// 6. Explicitly map allow-list of fields` (`line 111`) listing exactly: `notes`,
`year, make, model, trim, body_style, engine_type, cylinders, horsepower, transmission,
drivetrain, fuel, exterior_color, vin, mileage_miles, odometer_brand, damage_type,
secondary_damage, title_type, location, has_key, runs_and_drives, engine_starts,
transmission_engages, highlights, current_bid_usd, listed_price, listed_currency, price_usd,
estimated_retail_value_usd, image_urls, source_platform, captured_at, sale_date`. Nothing
outside this explicit key list is ever placed on the response object — the initial DB query
(`public-run/index.ts:57-102`) does select a broader set of columns, but only these named keys
are copied onto `mapped`/`publicRun` before serialization.

**Why this way:** AGENTS.md §4.5: "A field missing from the `public-run` allow-list simply
never reaches the client page — the UI then behaves as if the data does not exist. This caused
every public listing to show 'Auction date TBC' while the staff view worked perfectly... Add
only the field needed; never widen it casually." This documents why the allow-list is an
explicit inline object rather than, say, forwarding the full query result — the incident that
motivated keeping it strict is recorded there. The token-generation choice (`crypto.
getRandomValues` over 24 bytes) has no comment or commit message explaining the specific byte
count; standard practice for an unguessable bearer token is the only basis for that choice,
which is not stated in the repo — treated here as "Not recoverable from the repo" for the
*specific* 24-byte/hex choice, distinct from the allow-list rationale which is documented.

**How to extend it:** Adding a field to the public share page means adding it to *both* the
DB `select` at `public-run/index.ts:57-102` *and* the explicit `mapped`/`publicRun` object —
missing the second step reproduces exactly the AGENTS.md §4.5 incident. Per §4.4, this also
requires a `supabase functions deploy public-run`, or the change has no effect in production.

---

## 8. `org_id` server-side application on insert

**Symptom/claim:** `SCHEMA.md:273-274`: "`org_id` is applied server-side on insert, not
trusted from the client."

**Solution — the mechanism is Edge Function application code, not a DB trigger or column
default.** Migration `006_multitenant_foundation.sql` adds `org_id` as a plain
`NOT NULL REFERENCES` column with no `DEFAULT` tied to the session
(`006_multitenant_foundation.sql`: `ALTER TABLE public.sightings ADD COLUMN IF NOT EXISTS
org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE;`) — there is no
trigger that stamps `org_id` automatically. What exists instead is:

1. **RLS policies** (for direct, RLS-subject inserts) — `006_multitenant_foundation.sql:87`:
   `CREATE POLICY sightings_insert ON public.sightings FOR INSERT WITH CHECK (org_id IN
   (SELECT user_org_ids()) OR is_superadmin());` where `user_org_ids()` (lines 41-46) is
   `SELECT org_id FROM memberships WHERE user_id = auth.uid()`. This only constrains inserts
   made through a client that is subject to RLS (i.e., not the service-role key).

2. **`research-capture`** (used by the extension) does not read `org_id` from the client
   payload at all — it uses a fixed environment variable, `research-capture/index.ts:101`:
   `const defaultOrgId = Deno.env.get("DEFAULT_ORG_ID");`, then writes it directly at
   `research-capture/index.ts:175, 237, 319, 363` (e.g. `org_id: defaultOrgId,`). The client
   payload has no `org_id` field in its schema at all (`captured_fields` in
   `content-bidcars.js:369-412` carries no `org_id` key) — there is nothing to "not trust"
   because nothing is ever sent.

3. **`app-ingest`** (authenticated staff API) *does* accept an optional client-supplied
   `org_id`, but cross-checks it against the caller's real memberships before using it —
   `app-ingest/index.ts:97-111`:
   ```ts
   let targetOrgId = payload.org_id;
   if (!targetOrgId) {
     if (memCount === 0) { return ...403...; }
     else if (memCount === 1) { targetOrgId = memberships[0].org_id; }
     else { return ...400 "Multiple org memberships; org_id required."...; }
   } else {
     const isMember = memberships?.some(m => m.org_id === targetOrgId);
     if (!isMember) { return ...403 "Not a member of the requested org"...; }
   }
   ```
   So `org_id` here is client-*suggested* but server-*validated* against a fresh DB lookup of
   the authenticated user's `memberships` rows — a client cannot supply an `org_id` it doesn't
   belong to, but the value used is not blindly generated server-side either; it's the more
   precise nuance `SCHEMA.md`'s one-line summary doesn't capture.

**Why this way:** Not recoverable from the repo for the RLS-vs-application-code split
specifically — no comment or commit message explains why `research-capture` uses a fixed env
var while `app-ingest` uses a membership-validated client value, though the difference is
consistent with their callers: the extension has no per-user Supabase session (it authenticates
via a shared secret, topic 6), so there is no `auth.uid()` for `user_org_ids()` to resolve —
an env-var default is the only option available to it. `app-ingest` is called by an
authenticated staff user who may belong to more than one org, so a caller-supplied
(but validated) `org_id` is necessary there. This reasoning is an inference from reading both
functions side by side, not a stated rationale in the repo.

**How to extend it:** A new Edge Function that inserts into `org_id`-scoped tables using the
**service-role key** (as `research-capture`, `upload-images`, `store-images`, `app-ingest` all
do) bypasses RLS entirely — the `WITH CHECK` policies in migration 006 provide no protection
for service-role writes. Any such function must replicate one of the two patterns above
(fixed trusted `org_id` source, or client-supplied value validated against `memberships`)
itself; there is no shared helper function in the codebase that does this membership check
once for reuse — `app-ingest/index.ts:86-111`'s logic is not factored into a shared utility.

---

## 9. Other workarounds encountered while investigating 1–8

- **Copart thumbnail-to-full-resolution URL rewrite** — `chrome-extension/content-copart.js:
  256-262`: Copart's DOM apparently exposes only thumbnail image URLs (suffix `_thb.jpg`);
  the extension rewrites them to the full-resolution filename pattern before use:
  ```js
  if (/_thb\.jpg$/i.test(u)) {
      finalUrl = u.replace(/_thb\.jpg$/i, '_ful.jpg');
  } else if (/_ful\.jpg$/i.test(u)) {
      finalUrl = u;
  }
  ```
  and explicitly excludes a third variant, `_vthb`, from being collected at all (`!u.includes
  ('_vthb')`, `content-copart.js:257`). No comment explains what `_vthb` is; it is simply
  excluded.

- **`store-images` 403/429 retry with a single retry and a 500ms backoff** —
  `store-images/index.ts:151-233`: each image URL gets exactly one retry
  (`while (attempt < 2 && !success)`) specifically gated on `status === 403 || status === 429`,
  with a fixed `500ms` pause and the retry deliberately not counted as a hard failure
  (`if ((status === 403 || status === 429) && attempt === 1) { await new Promise(r =>
  setTimeout(r, 500)); continue; }`) — a direct code-level acknowledgment that Copart's
  anti-bot response is sometimes transient and worth one retry, unlike bid.cars' 403 which
  this same function treats as unconditional (the bid.cars branch never attempts a fetch at
  all, see topic 2).

- **`extractFinalSalePrice()` skips non-USD amounts on bid.cars pages** —
  `content-bidcars.js:64-87`, with the code comment: `// MUST be a USD value. Skip EUR/PLN
  occurrences (Price Estimator section) // and skip section headers (e.g. "Final Price
  Calculator").` — the regex `^\$\s?([\d,]+(?:\.\d{2})?)\s*(USD)?$` and the early `break`
  (line 83) on the first non-matching occurrence exist specifically because the bid.cars page
  apparently repeats the label text ("Final bid" / "Sold for" / "Final price") in a separate
  currency-estimator widget that would otherwise be misread as the sale price.

- **Sale date is explicitly unavailable, not merely unparsed, for finished bid.cars lots** —
  `content-bidcars.js:336-346`:
  ```js
  let sale_date_unavailable = false;
  if (lot_state === 'finished') {
      current_bid_usd = null;
      sale_date = null; // Sale date is not available on finished bid.cars lots
      sale_date_unavailable = true;
      ...
  }
  ```
  This is a distinct, explicit signal (`sale_date_unavailable`) from `parseAuctionDate()`
  returning `null` for an unparseable string (topic 4) — here the extension knows in advance,
  from `lot_state`, that bid.cars simply does not expose a sale date on finished lots, and
  says so with a dedicated flag rather than leaving it to look like a parse failure.

---

## 10. The `research_run_listings` duplicate-key bug

**Symptom:** Re-capturing a lot already attached to a given research run threw `Server Error:
duplicate key value violates unique constraint "research_run_listings_run_id_sighting_id_key"`
instead of succeeding. Surfaced through the extension's new session-based run picker (topic
11) — once a run stays selected across many captures, re-capturing the same lot into the same
run (e.g. to refresh its data) became a routine action rather than a rare edge case.

**Cause:** `research-capture/index.ts`'s optional run-attachment step did a plain `.insert()`
into `research_run_listings` with no conflict handling:
```ts
const { data: runListing, error: rlErr } = await supabase
  .from('research_run_listings')
  .insert({ org_id: defaultOrgId, run_id: payload.research_run_id, sighting_id: newSightingId, position: maxPos + 1 })
  .select('id')
  .single();
if (rlErr) throw rlErr;
```
`research_run_listings` has a `unique(run_id, sighting_id)` constraint
(`002_create_assets_sightings.sql`). Any second capture of the same lot into the same run hit
that constraint and the raw Postgres error propagated straight to the client as a 500.

**Fix:** Check for an existing `(run_id, sighting_id)` row first and reuse its `id` rather than
re-inserting; only compute a new `position` and insert when no row exists yet:
```ts
const { data: existing } = await supabase
  .from('research_run_listings')
  .select('id')
  .eq('run_id', payload.research_run_id)
  .eq('sighting_id', newSightingId)
  .maybeSingle();

if (existing) {
  runListingId = existing.id;
} else {
  // existing get-max-position + insert, unchanged
}
```
This required a `research-capture` redeploy — editing the function source alone has no effect
in production until deployed (`AGENTS.md` §4.4).

**Why this way:** A re-capture of a lot already in a run is not an error condition; it is
either a no-op (nothing changed) or a data refresh, and either way should succeed silently
rather than surface a constraint violation the client has no way to act on. Checking first
avoids the constraint entirely rather than catching the resulting exception.

**How to extend it:** Any future write path that can attach the same `(run_id, sighting_id)`
pair more than once must follow the same check-first pattern, or catch Postgres error code
`23505` on this specific constraint and treat it as success. There is a small race window
between the `SELECT` and the `INSERT` (not atomic) — acceptable here because captures are
single-secret, effectively serialized per user action, not because the race is impossible.

---

## 11. The extension session model (run picker)

**Symptom/context:** Before this build, the Chrome extension required either a typed run UUID
or (briefly, mid-build) a dropdown re-selected before every single capture. Re-selecting a run
for every lot on a multi-lot research session was the exact friction the picker redesign was
built to remove.

**Solution — where the state lives:** Entirely in `chrome.storage.local`, read and written from
`chrome-extension/popup.js`. Four keys form the session:
- `sessionActive` (boolean) — whether a session is currently considered live.
- `activeRunId` (string or `null`) — the run to attach captures to (`null` is a valid, deliberate
  choice meaning "capture without linking," not "no session").
- `activeRunClient` / `activeRunSub` — display labels only, shown in the popup's active-session
  view; not read by any capture logic.
- `activeRunLastActivity` (epoch ms) — updated on every successful capture.

**How it is set:** `selectRunAndCapture()` (`popup.js`) fires on a run-card click (or the "no
run" card, or manual entry). It performs the capture *and*, only on success, writes all four
keys together — picking a run and starting the session are the same action, not two steps.

**How it is cleared:** Two paths, both intentional:
1. **Explicit** — the "End run" button clears `sessionActive`/`activeRunId`/`activeRunClient`/
   `activeRunSub` directly and re-renders the picker.
2. **Idle expiry** — `initSessionState()` runs on every popup open and computes
   `Date.now() - activeRunLastActivity`. If that exceeds `SESSION_IDLE_MS` (10 minutes) *or*
   `sessionActive` is falsy, the session is treated as not live: if it had been marked active,
   the stale keys are cleared back to `false`/`null`, and the picker is shown. Verified by
   direct comparison-function testing (Phase 1 of the prompt that added this entry) — the
   boundary at exactly 10 minutes is treated as expired (`<` not `<=`), and a missing/`undefined`
   timestamp safely resolves to "not live" rather than defaulting to "just active."

**The failure mode to name explicitly: a capture landing in a stale session the user believed
had ended.** Expiry is only ever *evaluated* when the popup is opened — there is no background
timer independent of that. If a user ends work on a run, does not click "End run," and reopens
the popup within 10 minutes (even on an unrelated tab, even much later the same sitting), the
session is still live and the next capture silently attaches to the old run. This is the
scenario to check first when a capture turns up in a run nobody meant to select: look at
`activeRunLastActivity` versus the capture's own timestamp before assuming the extension
mis-selected anything — it more likely never re-evaluated because the popup was reopened inside
the 10-minute window.

**Why this way:** A Chrome extension popup is not a persistent process — it is torn down each
time it closes, so there is nowhere to run a live countdown. `chrome.storage.local` plus a
check-on-open is the only mechanism available without a background service-worker timer
(`chrome.alarms`), which this build does not use.

**How to extend it:** Any new code path that captures (a future bulk-capture button, say) must
read the same four keys and go through the same is-it-live check before trusting `activeRunId`
— duplicating the check inline rather than centralizing it in one helper is the current state
of the code and a risk if a second capture path is ever added without also duplicating the
expiry logic correctly.

---

## 12. The spec-match vocabulary layer (`src/utils/specVocabulary.ts`)

**Symptom:** Two real bugs on the `2012-2016 BMW 535i` brief (Mr Ademola Kadiri). A colour
preference of `"Any, except White"` produced `colour differs (Gray vs Any, except White
requested)` on every listing, every time — the rule compared the listing's colour against the
literal negative-preference string, which no colour will ever equal or contain. A fuel
preference of `petrol` produced `fuel type differs (Gas vs petrol requested)` on listings that
were, in fact, petrol — US auction sources record fuel as `Gas`/`Gasoline`, the client said
`petrol`, same fuel, different word.

**Cause — the exact code, before the fix:** three of the nine spec-match rule blocks in
`ResearchRunDetail.tsx` compared a brief's free-text field directly against the listing's raw
value with `.includes()`:
```ts
if (brief.colour_preference != null && brief.colour_preference !== '' && brief.colour_preference.toLowerCase() !== 'either' && l.exterior_color != null) {
  if (!l.exterior_color.toLowerCase().includes(brief.colour_preference.toLowerCase())) {
    addSpecRule(specWarn, `colour differs (${l.exterior_color} vs ${brief.colour_preference} requested)`, l.id);
  }
}
```
Two independent gaps in the same line: no vocabulary mapping (so a genuine synonym like
`Gas`/`petrol` reads as a mismatch), and no parsing of a preference's *shape* — `"Any, except
White"` is an exclusion, not a required value, but the code could not tell the difference.

**Solution:** `src/utils/specVocabulary.ts` provides two independent pieces, both
comparison-time only — **the stored value on `client_briefs` or `assets` is never rewritten**,
per `PROJECT_CHARTER.md` §5.8 (raw at capture, classify at read):

1. **Vocabulary groups** — `FUEL_GROUPS`, `COLOUR_GROUPS`, `TRANSMISSION_GROUPS`, each an array
   of synonym arrays built from the live distinct values actually queried
   (`SELECT DISTINCT fuel FROM assets`, etc.), plus a small number of near-certain pairs added
   proactively because the intake form already offers them as options even though no live row
   has one yet (`Hybrid`, `Grey`, `Auto`) — each addition is commented with why. `canonicalToken()`
   maps a raw string to its group's first entry if it matches one of the mapped synonyms;
   otherwise the value passes through unchanged. **An unmapped value is deliberately not an
   error and not a match** — it simply compares as itself, so a genuinely new value (a new
   colour, a new fuel type) degrades to "treated as its own literal string," not to a crash or
   a silent false match.

2. **`parsePreference()`** — classifies a brief's free-text field into exactly one of three
   shapes: `{ kind: 'none' }` (blank, `any`, `either`, `no preference` — no rule should fire),
   `{ kind: 'required', value }` (a specific requirement — compare normally), or
   `{ kind: 'exclude', value }` (parsed out of `"Any, except X"` and the variants `apart from`,
   `not`, `no`). Critically, **an exclusion phrase that doesn't cleanly match one of the known
   shapes fails closed to `'none'`** rather than falling through to `'required'` with the whole
   unparsed phrase as the value — that fallthrough is exactly how bug 1 happened, and turning it
   into "no rule fires" trades a possible missed flag for the guarantee of never re-creating a
   permanent false one.

**Applied to exactly three of the nine spec-match blocks** — colour, transmission, fuel — since
those are the only ones with both a free-text brief field and a vocabulary-prone listing value.
`condition_required` is a controlled dropdown compared against a boolean (`runs_and_drives`),
never free text, so it never had this bug. `titles_accepted` already had its own inline
synonym table before this change (`clean`/`clear`/`certificate of title` etc.) and was left as
is. `trim` is genuinely free text on both sides with no vocabulary to map (a real trim like
`XLE` vs `SE` is not a synonym pair) and was not touched. The four numeric CRITICAL rules
(mileage, year min/max) have no vocabulary dimension at all.

**Known, deliberate limitation:** a multi-value exclusion like `"Any except white or black"`
parses to `{ kind: 'exclude', value: 'white or black' }`, but the exclude-match check is a
simple containment test (`colourMatches(listingColour, 'white or black')`), which will not
correctly catch a plain `"White"` listing against that compound phrase — the containment
direction is wrong once the excluded value itself has multiple words joined by "or". The one
live exclusion value observed (`"Any, except White"`) is single-valued and works correctly;
building a robust `"or"`-splitting parser for the compound case was judged out of scope here
(`PLAN_TRACKER.md` debt: free-text exclusions are a workaround, not the structural fix).

**Why this way:** This is deliberately **an early, narrow slice of the E2 standardisation
resolver** that `SCHEMA.md` §4 and `PLAN_TRACKER.md`'s E1→E5 estimator pipeline (E1 harvest →
E2 standardisation → E3 stats → E4 public MVP → E5 analytics) anticipate — built here only for
spec-match comparison, not as a general classifier. The module's own header comment says this
explicitly, so a future E2 build folds this in rather than duplicating it as a second,
uncoordinated normalisation layer (`isUnconfirmed`'s two-file duplication is the precedent this
was written to avoid repeating).

**How to extend it:** A new fuel/colour/transmission value discovered in future live data does
not need a code change unless it is a genuine synonym of an existing group — an unmapped value
already compares safely as itself. Only add a new synonym pair when it is confirmed as the same
underlying thing in different words (a live distinct-values query, not a guess) — the Hybrid/
Electric/Petrol distinction is exactly the kind of pair that must **never** collapse together,
and the module's own test coverage (a throwaway script, not committed) exists to catch that
class of mistake before it ships.

---

## 13. The confirmation email that silently sent nothing

**Symptom:** A real client-facing submission completed on 6 Sep 2026 and no confirmation email
arrived. `intake-brief` had been verified end to end in Prompt 15 — something specific broke,
or more precisely, something specific was never guaranteed in the first place.

**Diagnosis, not a code defect:** the client's own record simply had no email on file.
```
SELECT cb.id, cb.status, cb.submitted_at, cb.confirmation_sent_at, c.full_name, c.email
FROM client_briefs cb LEFT JOIN clients c ON c.id = cb.client_id
ORDER BY cb.submitted_at DESC NULLS LAST LIMIT 5;
```
showed the real row: `submitted_at` set, `confirmation_sent_at` `NULL`, `full_name` "Mohammed
Jamilu Danmusa", `email` `NULL`. The submission itself worked exactly as designed — it is the
recipient that never existed. `intake-brief/index.ts:119-123` reads the recipient from the
**client record** (`brief.client_id`), not from anything the form itself submitted (at the
time, the intake form had no email field at all - Prompt 17 Phase 4 added one). The guard at
line 128, `if (resendApiKey && clientRow?.email)`, correctly skips sending on a falsy email
rather than crashing or sending to nowhere - but the only trace of that skip was a
`console.error` line in the Edge Function's own Deno runtime logs, which this project's CLI
has no `functions logs` subcommand to read (`PLAN_TRACKER.md` debt #23). Staff had no way to
know, from the product itself, that a specific submission's confirmation copy never went out.

**Why this isn't "the code was wrong":** every property Prompt 15 established was already
correctly in place - the submission always persists regardless of the email outcome, and the
client-facing success screen already said "if one is on record" (the exact false-claim bug
Prompt 15 caught and fixed), so no client was ever told something untrue. The gap was pure
staff-side invisibility: a fact that mattered (no confirmation went out, and why) existed only
in a log neither this CLI nor the staff UI could surface.

**Fix — no migration needed, inferred entirely from data already on hand:** a status banner on
the brief detail view (`ClientsList.tsx`), shown whenever `submitted_at` is set: green
"Confirmation email sent" with the timestamp if `confirmation_sent_at` is set; amber
"Confirmation email not sent" otherwise, naming the reason when it's inferable ("This client
has no email on file") or stating plainly that delivery didn't complete when the client does
have an email (a Resend-side failure, whose specific cause is still only in that unreadable
log — the banner reports the fact, not a diagnosis it cannot make).

**Why this way:** the three pieces of information needed (`submitted_at`, `confirmation_sent_at`,
`clients.email`) were already being fetched into the same view for other reasons - deriving the
banner from them client-side avoided adding a new column purely to record something the existing
columns already implied together.

**How to extend it:** Prompt 17 Phase 4 lets the client supply their own email on the form,
which narrows how often this specific cause (no email on file) occurs going forward - but it
does not remove the need for this banner, since Resend can still fail for other reasons and
email remains an optional field. Anything that changes how `confirmation_sent_at` is set (a
retry mechanism, say) must keep this banner's two-state logic in sync, or it will start lying
about which state a brief is actually in.

---

## 14. The deposit gate attached to the wrong entity

**Symptom:** `clients.deposit_received_at` marked a client's commitment fee as paid at the
**client** level. A client who paid for one vehicle was then treated as having paid for every
subsequent one — the second car's research run started free, because
`createRun()`'s deposit check (`researchService.ts`) read `input.client?.deposit_received_at`,
a single boolean-ish timestamp shared across every brief and run that client would ever have.

**Why this is a modelling bug, not a logic bug:** the code that read the flag was correct given
what it was reading — the mistake was attaching a fact that is inherently **per purchase**
(one commitment fee buys the right to research *one* vehicle) to an entity that is **per
relationship** (one client, many vehicles over time). No amount of fixing the comparison logic
at the client level could have closed this gap; the fee needed to live where the purchase
lives, which is the brief, not the client.

**Solution:** migration 027 adds `deposit_received_at`/`deposit_recorded_by` to
`client_briefs`. The data move for existing deposits was itself a judgement call, not a
mechanical copy: a client's deposit was allocated to every one of their **non-deleted briefs
that already had a non-deleted run** — concrete evidence that specific vehicle's research was
actually drawn on under the old, less granular model — and left unmarked on any brief with no
run. Copying the same deposit onto *every* brief regardless of run history would have
recreated a subtler version of the same over-crediting bug one level down.
`clients.deposit_received_at`/`deposit_recorded_by` are deliberately **retained**, not dropped
— there is no staging environment to test a drop against, so the old columns stay as a
fallback until the move is proven (`PLAN_TRACKER.md` debt #28).

`createRun()` now checks `input.brief?.deposit_received_at` when a brief is linked. A run with
**no** brief linked has no deposit record to check at all — rather than treating that as "no
deposit required," it always demands the superadmin override, since a briefless run is the
exception this project wants surfaced, not a silent gap the client-level check would have
let slide through unnoticed. The placeholder "Internal / Market Research" client remains
exempt regardless, since it represents no paying client at all.

**Why this way:** the fix is a straightforward column move once the modelling error is named,
but naming it required looking past "is the deposit check firing correctly" (it was) to "is
the deposit check reading the right column" (it wasn't). The staff-facing toggle moved with
it — from the client record to the brief detail view — so there is exactly one place to mark
a deposit, matching the one place it's actually checked.

**How to extend it:** any future code that needs to know "has this vehicle's commitment fee
landed" must read `client_briefs.deposit_received_at`, never `clients.deposit_received_at` —
the latter now exists only as historical fallback data, not a live signal, and reintroducing a
client-level check anywhere would silently resurrect this exact bug.

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
7), and a cron-triggered function (`monthly-backup`). This inference is
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

---

## 15. The client approval record: why what-was-shown is captured, not just what-was-approved

**The naive design:** an approval is "client X approved listing Y at time Z" — a foreign key
plus a timestamp. This is what a first pass at the schema would produce, and it is wrong for
this project specifically, not in general.

**Why it's wrong here:** `SCHEMA.md` §1 already establishes that a live lot's `sightings` row
gets **overwritten** on re-capture — that's the whole point of a live listing, its price and
sale date change as the auction progresses. A bare foreign key to `research_run_listings` (or
further, to `sightings`) does not point at a fixed fact; it points at a **mutable** row. Weeks
later, if a client disputes what they approved ("I never agreed to that price"), following the
foreign key would show whatever the listing looks like *today*, not what it looked like at
approval time. The approval record would technically exist, and would be useless as evidence
of the one thing it exists to prove.

**Solution:** `research_run_listings.approved_snapshot` (migration 028) is a JSONB copy of the
identifying details, the price actually displayed, and the auction date actually displayed —
computed **server-side**, in the same request that records the approval, from a fresh query
joined the same way the public page itself renders the listing. It is never built from the
POST body (a client could send anything) and never deferred to a later read (the underlying
row could have changed by then). The snapshot is redundant with the live data at the instant
it's written and is expected to diverge from it over time — that divergence is the entire
point; it is what makes the record still mean something after the listing has moved on.

**Why this way:** this mirrors a decision already made once on this project, for a different
reason. `DECISIONS.md` §6 explicitly rejects relying on a signature for the intake form,
preferring "the exact form content stored unaltered, a timestamp, the client's own email
confirming" — evidentiary weight comes from an unalterable record of the actual moment, not
from a gesture that looks official. The approval snapshot is the same principle applied to a
different mutable-data problem: the record's value is in what it freezes, not in how it's
authorized.

**How to extend it:** any future approval-adjacent feature (e.g. re-approval after a staff
edit, or a client-facing "what did I approve" view) must read from `approved_snapshot`, never
by re-joining to the live `sightings`/`assets` row through `sighting_id` — that join answers
"what does this listing look like now," a different question that happens to share a
foreign key with the one that matters here.

---

## 16. A guard that can never fire looks identical to a guard that works

**Symptom:** the yard-matching ambiguity check (`matchSightingToYard`, PROMPT 20 Phase 5)
reported 0 ambiguous matches across all 171 live sightings. That result was reported and
nearly accepted as evidence the data has no ambiguous yards - until the check itself was
tested against a case constructed to actually trigger it, which revealed it could not fire
at all, for any input.

**Root cause:** the check computed `distinctYards = new Set(candidates.map(c =>
\`${c.yard_state}|${c.yard_city}\`))` and flagged ambiguity when its size exceeded 1. But
`candidates` was already filtered to rows matching the same normalised city and state - every
member of that set was therefore guaranteed identical on exactly the two fields being
compared. The set could never contain more than one distinct value. The check was not buggy
in the sense of giving a wrong answer; it was buggy in the sense of being unable to give any
answer other than "no" - a tautology dressed as a data check.

**Why "0 ambiguous" didn't catch it on its own:** a guard that never fires and a guard that
correctly never finds a positive case produce **the exact same output**. Nothing about the
report - not the number, not the code review, not the fact that it matched the expectation of
"probably rare" - distinguished the two. The bug was invisible to every form of inspection
that only looks at real data, because real data (correctly) contained zero positives either
way.

**Solution:** fed the check a synthetic input constructed specifically to be a true positive -
two yards, same platform, same city, deliberately different street addresses - and confirmed
it returned `ambiguous`. It didn't; that failure is what surfaced the tautology. Fixed by
comparing `yard_street` among the already-city-matched candidates instead of re-comparing the
city/state fields that were guaranteed equal by construction, then re-verified against the
same synthetic case (now correctly `ambiguous`) and re-confirmed the real data still returned
0 (now a trustworthy 0, not a coincidental one).

**Why this way:** verifying a detector by pointing it at real data only tests the negative
path when the real data happens to contain no positives - which is precisely the situation
where a broken detector is most likely to go unnoticed, because "0" is also what a working
detector would report. There is no way to distinguish "correctly found nothing" from
"incapable of finding anything" without a case manufactured to be found.

**How to extend it:** this generalises past this matcher. Any detection path - a validation
rule, a fraud flag, a duplicate check, an anomaly detector - whose reported rate of positives
on real data is zero (or has always been the same number) should be treated as unverified
until it has been run against a synthetic input built to be a true positive. A live "0" is
not evidence the check works; it is only evidence the check ran. Trust the zero after proving
the guard can say something other than zero, not before.

---

## 17. Importing the vendor trucking-rate spreadsheet

**Symptom-shaped summary for the next person doing this:** the source prompt for this
importer (PROMPT_20) described one column layout, taken from the COPART sheet, and stated it
as if it applied to the whole file. It did not. The real November 2025 vendor file has four
sheets with four different layouts. Trusting the prompt's description instead of the actual
file would have silently misread three of the four sheets.

**The state column is vertically merged and must be filled down.** Only the first row of each
state's block carries a value in column 0; every row below it is blank until the next state
starts. `parseSheet()` tracks `currentState`, updates it whenever column 0 is non-blank, and
carries it forward onto every blank-state row until the next update. Getting this wrong
doesn't error - it silently produces yard rows with no state, or worse, misattributes yards to
the last state that happened to be filled.

**Blank rows separate states and must be skipped, not treated as yards.** A row is a genuine
separator (not a yard, not a failure) when the city is blank, the street is blank, and every
port/price cell is blank. A row with a blank city but *some* other data present is a different
thing - a malformed row, reported as a failure with sheet+row, never silently dropped and
never silently promoted to a phantom yard.

**The column layout is NOT fixed across sheets - it must be derived from each sheet's own
header row.** The prompt described COPART's layout exactly (container pairs at columns 3/4,
6/7, 9/10, 12/13; RoRo at 16/17, 19/20, 22/23) and that description is correct **for COPART
only**. The real file's other three sheets have fewer port options and different column
positions entirely:
```
IAAI:    container (3,4) (6,7) (9,10) (11,12);  roro (13,14) (15,16) (18,19)
MANHEIM: container (3,4) (6,7) (9,10);          roro (11,12)
ADESSA:  container (3,4) (6,7) (9,10);          roro (11,12) (14,15)
```
`derivePairs()` finds these from the header row itself: any header cell whose text contains
"CONTAINER" or "RORO" starts a (port, price) pair at that column and the next one. This rule
held across all four sheets in the real file and should hold for a future vendor's file too,
since it doesn't assume a fixed width - but verify it against the new file's actual header
row before trusting it, the same way this file's assumption turned out to need checking.

**The header row itself is not row 0.** This file has a fully blank row 0 before the real
header (STATE/CITY/STREET/CONTAINER.../RORO...) on row 1. `findHeaderRowIndex()` locates it by
scanning for the row whose first cell is literally "STATE", rather than assuming a fixed
offset.

**Port names are inconsistent by construction, and this is expected, not a data-quality bug
to silently fix.** Observed in the real file: `JACKSONVILLE YARD` vs `JACKSONVILLE`, `LOS
ANGELOS` (sic) vs `LOS ANGELES`, trailing whitespace (`TEXAS `). `destination_port_raw` keeps
exactly what the vendor sent - `LOS ANGELOS` is evidence of what they actually wrote, not a
typo to correct away in storage. `destination_port_normalized` (trim, collapse whitespace,
uppercase, then a small explicit alias table) is the form used for matching. Extend
`PORT_ALIASES` in `scripts/lib/truckingRatesParser.mjs` as new vendors reveal new variants -
never guess at a correction that isn't in the table.

**State names have the same problem and it wasn't anticipated.** The vendor's own COPART sheet
spells New Hampshire `"New Hamphire"`; the IAAI sheet spells it correctly. Both exist,
unfixed, in `trucking_rates.yard_state` - `destination_port_raw`/`_normalized` gave port names
a raw+normalised pair, but `yard_state` did not get the same treatment in the migration, since
the prompt's shape only called it out for ports. The gap is closed one level up, in the
matcher (`STATE_NAME_ALIASES` in `src/services/yardMatchingService.ts`), which normalises both
spellings to the same key before comparing. Extend that table, not the stored data, if a
future vendor file has its own state-name typo.

**A yard can be real and correctly produce zero rate rows.** IAAI's Honolulu, HI yard has
every container cell blank and its one RoRo cell containing the literal text `"NO"` - the
vendor's own way of saying no service is offered there, not a missing price to estimate. This
is why the imported yard count for IAAI (187) is one less than the yard count found while
scanning the sheet (188): Honolulu is counted as a yard (it has a city), correctly produces no
`trucking_rates` rows (there is nothing to price), and the discrepancy is explained, not a
loss to chase down. If a future re-import ever "fixes" this gap by inventing a Honolulu price,
that is the bug, not the 187.

**Reject non-numeric prices, and a port name without a price is a data gap, not a parser
defect.** 137 of the 143 parse failures in the real import were exactly this shape: the vendor
listed a port name for a yard (often copy-pasted across a whole regional cluster) but never
filled in a price for most of them - e.g. COPART's Atlanta-area yards all list "BALTIMORE" as
a fourth container option, but only 2 of 11 actually have a price attached. No row is created
for these (there is no price to store), and each is reported with sheet+row rather than
silently dropped, per this project's standing rule that a silent partial import is the failure
mode to design against.

---

## 18. Copart's "Secured" vs. "Unsecured" fee tier is a property of the buying account, not the transaction

**Symptom:** researching Copart's published buyer-fee schedule (`PROMPT_21` Phase 1) turned up
four bracket-table variants per title status - Secured and Unsecured payment, each roughly 30%
cheaper for Secured at every bracket. The natural assumption, going in, was that this is
selected per purchase based on which payment method the buyer uses at checkout (wire vs. card,
say).

**Why that assumption was wrong:** cross-checked against three real Copart invoices for
vehicles bought on two different member accounts. One invoice paid entirely by Google Pay,
one paid by a mix of two Wire Payments (the large majority of the total) plus two small Google
Pay top-ups, one paid entirely by Google Pay again. All three landed exactly on their
schedule's **Unsecured** bracket value, including the one dominated by Wire Payments - a
payment method that would intuitively read as "secured" (guaranteed, non-reversible funds). If
the tier were chosen per transaction by payment method, that invoice should have priced as
Secured. It did not, on either of the two different fee schedules the two accounts sit on
(confirmed by locating the actual Non-Clean/Unsecured bracket for each account's own schedule
and finding an exact match to the penny).

**Conclusion:** Secured vs. Unsecured is best understood as a **standing classification of the
member account itself** - almost certainly whether that account carries a security deposit on
file with Copart - not a choice made at the point of payment for a given lot. A buyer without
a deposit on file pays the Unsecured rate regardless of how any individual purchase happens to
be funded.

**The concrete number this surfaced:** across the three invoices checked, Secured pricing on
the same brackets would have totalled $1,125.00 less than what was actually paid ($2,775 vs.
$3,900), roughly $375/vehicle. Purely descriptive - whether posting a deposit is worth it is a
business decision outside this research, not something this finding recommends either way.

**How to extend it:** when `cost_rates` models the Copart fee structure, Secured/Unsecured
must be a property of *which member account* a purchase runs through, not a per-listing input
a research run or headroom calculation would ever ask the user to toggle. If a future purchase
is ever made through an account that does carry a deposit, that is a new, distinct rate row (a
different account-level fact), not a different answer to the same question for an existing
account's rows.

---

## 19. The auction buyer-fee bracket circularity

**The problem, stated plainly:** the buyer fee that determines how much a bid actually costs
depends on which price bracket the final sale price falls into. Bid headroom is trying to
answer "what is the most I can bid?" - but the fee that has to be subtracted to answer that
question depends on the very number being solved for. Naively, that looks circular: fee
depends on bid, bid depends on fee.

**Why it mostly isn't, in practice:** for every bracket except the last, the fee is a fixed
dollar amount tied to a price *range*, not to the exact price. That means the circularity
collapses to a small, finite, ordered search rather than a numerical fixed-point problem:

1. For each bracket, in ascending order, compute what the bid *would* be if that bracket's fee
   applied: `candidate_bid = target_after_other_costs - bracket.fee`.
2. Check whether `candidate_bid` actually falls inside that same bracket's own
   `[min, max]` range.
3. The first bracket where that check passes is the answer. Because brackets are contiguous
   and non-overlapping on the same variable being solved for, at most one bracket can ever
   pass this check for a given input - there is no need to iterate to convergence, and no
   risk of oscillating between two brackets.

**The one genuine edge case: the terminal open-ended bracket.** Above $15,000 (both Copart and
IAAI), the fee stops being a fixed dollar figure and becomes a flat percentage of the sale
price itself - now genuinely a function of the unknown. But because the rate is constant
across that entire unbounded bracket, it is still a one-step linear solve, not iteration:
`bid = target_after_other_costs / (1 + rate)`, then check `bid >= 15,000` to confirm it
actually belongs in that bracket rather than the last fixed-dollar one below it.

**Implementation:** `solveMaxBidAgainstBracket()` in `bidHeadroomService.ts` does exactly this
- a single pass over the brackets sorted by `bracket_min`, fixed-dollar brackets checked by
substitution, the percent bracket solved algebraically. It is written and correct, but not
reachable in normal operation yet: bid headroom requires every cost component to be available,
and duty is permanently unavailable until C2 exists (`PLAN_TRACKER.md` Phase C). The function
exists now so headroom is genuinely ready the moment C2 unblocks, not something to build then.

**How to extend it:** if a future rate schedule ever has two brackets that could both pass the
self-consistency check for the same input (which would mean the brackets overlap - a data
error, not a normal case), `findBracket`-style helpers here would need to detect and reject
that explicitly rather than silently returning whichever bracket happens to be checked first.
That has not happened with any real Copart or IAAI table seen so far.

---

## 20. Dual-pass extraction reconciliation — and why agreement is a filter, not proof

**The problem, stated plainly:** a vision model reading a degraded document (a blurry photo,
a low-quality scan) can misread a digit and be genuinely, internally confident it read it
correctly. It is not "unsure" in any sense a prompt instruction can address - it does not
know it is wrong. Telling it "abstain if you cannot read something" does nothing for a
misperception it believes is a clean read.

**Proven directly, not assumed, during PROMPT_22 Phase 3.** A single extraction pass against
a deliberately degraded (but genuinely real) invoice image read `"$1,385.00"` as `1285` and
`"$230.00"` as `430`, both reported with `status: 'read'` - the exact failure mode this whole
staging pipeline exists to prevent, produced on the first real adversarial test, not a
hypothetical.

**The fix - structural, not a prompt tweak:** `supabase/functions/extract-cost-document/
index.ts`'s `runOnePass()` executes the identical extraction call **twice**, independently
(`Promise.all`, no shared state between the two calls). `reconcileRows()` then compares every
field pairwise: a field is trusted (kept at `status: 'read'`) only when both passes produced
the exact same value; any disagreement - different value, or one pass reading where the other
abstained - downgrades that field to `status: 'unreadable'` rather than picking either pass's
answer. Re-tested against the same degraded document: this caught 2 of the 3 real digit
misreads immediately, each downgrading to "not visible - enter manually" instead of silently
carrying a wrong number into the review screen.

**The residual limit - found on the same test, not theoretical, and not fixed by this
technique:** the third misread (`"1385"` read as `1285`) was produced **identically by both
independent passes**. Two honest, separate attempts landed on the same wrong digit. Dual-pass
agreement could not catch this, because the two passes were not disagreeing - they shared the
same misperception. **This means an `'agreed'` `cross_check` status raises confidence; it does
not guarantee correctness.** Anything that reads `extracted_rows` and sees `cross_check:
'agreed'` must not treat that as "verified" - it is "two independent readings produced the
same answer," which is evidence, not proof.

**Why this means the review screen is the actual safety net, not a formality layered on an
already-solved problem.** `CostDocumentExtractions.tsx`'s `ReviewDetail` always renders the
real source document (a signed URL into the private `cost-documents` bucket) directly beside
every extracted field, editable, regardless of that field's status or cross-check result. This
is not decorative - it is the only remaining check against a shared misperception surviving
dual-pass agreement. A future change that hides or collapses the source-document panel "since
the data is already verified" would silently remove the one thing standing between a
consistent AI misread and a live rate table.

**How to extend it:** a third independent pass and a 2-of-3 vote would very likely raise
confidence further (a systematic misperception surviving three independent attempts is less
likely than surviving two, though not impossible), but would not close the gap in principle -
any number of passes sharing the same underlying visual illusion agree with each other while
still being wrong. There is no purely automated fix for "the model consistently misperceives
this specific image" short of a fundamentally different extraction method (e.g. a
deterministic OCR engine cross-checked against the vision model, which this build did not
attempt). Treat dual-pass agreement as raising the bar for what a human reviewer should
double-check quickly versus scrutinize carefully - never as a reason to skip the human step
altogether.

---

## 21. IAAI capture - a real embedded JSON blob beats DOM scraping, and login state gates specific fields, not the whole page

**The problem, stated plainly:** IAAI's lot page renders bid state, seller, and VIN
differently depending on whether the viewer is logged in, and none of this was verifiable
from documentation or by analogy to Copart/bid.cars - `AGENTS.md` §4.6 (never guess at
DOM/JSON structure) and §4.1 (never guess `current_bid_usd`/`lot_state` as a liveness proxy,
three prior real bugs) both applied directly. Proceeding on the assumption that a logged-out
page is "identical to a logged-in view since login only gates the bidding widget" was flagged
and rejected before any parser was written - that claim is itself unverified, stacked on top
of the thing it exists to justify skipping. Two real authenticated-session HTML pastes were
required before writing any bid-state logic.

**What the real logged-in HTML actually showed:** IAAI embeds a complete, typed data source
on every lot page - `<script type="application/json" id="ProductDetailsVM">` - containing
`inventoryView.attributes`, `vehicleInformation`/`vehicleDescription`/`saleInformation`, and
`auctionInformation` (including `prebidInformation` and a `userLoginStatus` boolean). This is
present **regardless of login state**; it self-corrects rather than disappearing when logged
out - masked values when logged out, real values when logged in. `chrome-extension/
content-iaai.js` reads this JSON directly instead of scraping the DOM, which also turned out
more complete: `imageDimensions.keys.$values` yielded 18 images on one real lot versus 11 from
scraping rendered `<img>` tags.

**The login-state bug, found via a real capture landing with garbage data:** the first
version populated `current_bid_usd` as `0` and `seller`/`seller_type` as the literal string
`"******"` when captured logged out, because each field's own masked shape was being
pattern-matched individually. Masked shapes are not uniform - VIN keeps a real prefix when
masked, Seller/SellerType become the literal `"******"` string, current bid becomes `0` - so
matching each field's own mask pattern is fragile and was already wrong on the first real
test. Fixed by gating all three login-restricted fields (`current_bid_usd`, `seller`,
`seller_type`) on the single real signal, `auctionInformation.userLoginStatus === true`,
leaving them unpopulated (not a guessed placeholder) when false.

**Sold lots do not render this page at all - confirmed on the real platform, not assumed.**
Following a sold lot's own link redirects to IAAI's search page; there is no sold/ended lot
view to scrape in the first place. `lot_state: 'active'` is therefore set unconditionally by
this content script - it is not an unverified default, it reflects that every page this
script can ever run on is, by IAAI's own behaviour, an active lot.

**The close-date field, and a mistake avoided:** IAAI's displayed close-date text reads
"8:30am CDT" while the embedded JSON's `prebidInformation.adjustedCloseDate` differs from it
by roughly an hour. The instinct to reconcile these by back-calculating an offset was
rejected - `#AdjustedCloseDate` is IAAI's own field name for the value it intends consumers to
treat as authoritative, and manufacturing an offset to match a differently-purposed display
string risks quietly encoding a wrong assumption that breaks the next time IAAI changes either
value's formatting. `sale_date` is read straight from `adjustedCloseDate`, unmodified.

**A separate, unrelated bug found only by the user's own live testing, not by review:** the
extension's popup kept reporting "Not on a supported lot page" on a real IAAI tab despite the
content script matching. `manifest.json`'s `content_scripts.matches` glob
(`*://*.iaai.com/VehicleDetail/*`) is case-sensitive with no case-insensitive option in the
manifest format itself, and the real URL path was lowercase (`/vehicledetail/...`). Fixed by
broadening the manifest match to the whole host (`*://*.iaai.com/*`) and moving the actual gate
into JS as a case-insensitive regex, `isIaaiLotPage()`: `/^\/vehicledetail\/\d+/i`.

---

## 22. The client-facing page was more permissive than the staff dashboard about what counts as a real sale - found by a pre-flight for an unrelated fix

**How this was found - not by looking for it.** Prompt 24 set out to fix a different bug: an
active-listing fee calculation using `current_bid_usd` as its reference price. Its own Phase 1
pre-flight required tracing every consumer of the sold-comps average, as due diligence for a
completely separate question ("is a comps average available to substitute for `current_bid_usd`
on an active listing?"). That trace surfaced this instead, and it turned out to matter more than
the bug the pre-flight was written to investigate.

**The divergence, stated plainly.** `ResearchRunDetail.tsx`'s `getStats` (the staff dashboard)
excludes a sold row from the average when `sale_confirmed === false`, or when `sale_confirmed
=== null` and `logged_via` isn't `manual_entry`/`ai_vision` - the exact rule that makes a
bid.cars "final bid" honest, since a final bid on that platform is not automatically a real
sale. `public-run` (the client-facing share page, the deliverable that replaced the Excel
sheets Caplimo used to send) applied **no such exclusion at all** - it didn't even fetch
`sale_confirmed`/`logged_via` from the database in the first place. The staff view honoured the
distinction the system itself was built to make; the page the client actually reads did not.

**Real, measured blast radius - not an estimate.** Every one of the 12 currently-live share
links was checked both ways before anything was changed: 9 carry a sold-comps stats block, and
6 of those 9 produced a different number under the correct rule. Two - Nafisah Bashir's and
Tesla's real, live client links - were showing a market average computed **entirely** from
unconfirmed bid.cars final bids: $10,456.33 across 9 rows and $9,375.00 across 6, respectively,
with zero of either set being a confirmed sale. After the fix, both correctly show "no
confirmed comps" rather than any number. Four other live runs shifted by $24-$228 on one
dropped row each; three were already clean.

**Why this outranked the bug the pre-flight was written for.** The fee-bracket bug lives behind
a UI element whose own tooltip says "internal only." This one was live, in front of real
clients, on the page that specifically replaced the old process this whole project exists to
improve on. `PROJECT_CHARTER.md` §5.1 doesn't distinguish severity by which bug was being
looked for when it was found - a wrong client-facing number is a wrong client-facing number
regardless of what the prompt that found it was originally about. Fixed first, deployed, and
verified against real production data before the fee-bracket work (Prompt 26) resumed.

**The fix deliberately does not create a third, shared implementation.** `getAuctionFeeComponent`
and `getStats` are Deno server-side and client-side React respectively; a shared module across
that boundary was judged a bigger change than this fix warranted, especially with the actual fix
being small and mechanical (apply the same predicate, add the same badge). Recorded as debt
(`PLAN_TRACKER.md` #47) instead, with the explicit note that these two implementations have now
diverged once in production - a second divergence is a real, foreseeable risk, not a hypothetical
one, precisely because nothing forces them to stay in sync.

**A precision point worth keeping: `sale_confirmed = null` is not one thing.** Tracing every
write site (there is exactly one - bid.cars' own content script, reading that lot's own
sales-history table) surfaced three different real meanings behind the same stored `null`:
`manual_entry`/`ai_vision` rows can *only ever* be `null` (no code path could set them to
anything else - it isn't ambiguity, it's structural); Copart/IAAI rows are *always* `null` for
the same reason at the platform level (neither exposes a sales-history mechanism at all -
`PLAN_TRACKER.md` B2 and B1/§4.12, the latter corrected here after this same trace found it had
been mis-recorded as `false`); and a bid.cars `extension_dom_capture` row's `null` can mean the
sales-history table genuinely didn't parse to a confirmable status - real inconclusiveness. All
three currently render identically (excluded the same way, badged "Unconfirmed sale" the same
way). Distinguishing them in the UI was raised and deliberately deferred, not overlooked -
recorded as `PLAN_TRACKER.md` #48.

---

## 23. A fee bracket lookup on a guessed price is the same class of bug as a guessed price - it just hides behind an "internal only" tooltip

**The wrong question, found by its own pre-flight.** Prompt 24 set out to replace one guessed
reference price (`current_bid_usd`) with a better one (a sold-comps average) for bracketing an
active listing's auction fee. Its Phase 1 pre-flight found that an `active_listings`-only run -
plausibly the majority case - has no sold-comps average available at all, structurally, ever.
The instinct was to treat this as an obstacle: find some other substitute, plumb it through.
That instinct was wrong. **There is no correct single price for a car that hasn't sold.** A
comps average, a client's budget, last week's comparable sale - none of these is the price this
specific car will actually close at, so bracketing a real fee schedule against any of them
produces the same category of dishonesty `PROJECT_CHARTER.md` §5.1 exists to prevent, just one
step removed from an outright guessed number.

**The reframe: the fee is not a fixed unknown, it's a function.** Copart/IAAI buyer fees are
tiered by the actual sale price. A bid, unlike a sale price, is not something to predict - it's
exactly the thing a staff member is in the process of deciding. So the fee doesn't need a
predicted input; it needs to be modelled as `fees(bid)`, evaluated at whatever bid the staff
member is actually considering. This needed no comps average, no new prop threading the average
down from `ResearchRunDetail` to `ListingCostBreakdown`, and no third duplicate averaging
implementation - the entire redesign is contained to `bidHeadroomService.ts` and one new input
field (a candidate bid) on the existing panel.

**Why this is provably well-defined, not just a plausible-sounding reframe.** A function with
two output modes is only honest if the "no single number" mode is real, not a excuse to skip
verification. Monotonicity of `total(bid) = bid + fees(bid)` was tested directly against all
108 real currently-effective bracket rows for the account/tier actually used, every integer
dollar from $0 to $20,000, both title statuses - zero violations. This matters concretely: it
means a maximum-bid solve (Mode A, "the largest bid where everything still lands under budget")
has exactly one well-defined answer whenever it can be attempted, not an ambiguous set of
candidates from a non-monotonic bracket table.

**Mode A is built and correct, and is expected to be unreachable today - that expectation was
proven, not assumed.** `computeBidHeadroom`'s `maxBidSolve` only attempts the solve when
shipping, trucking, AND duty are all `'available'`. Duty (C2) is permanently blocked pending
10+ real assessment notices, so `maxBidSolve.status` is `'unavailable'` in every real case -
verified, not just expected from reading the code. A private, unexported solver
(`solveMaxBidAgainstBracket`) already existed from Prompt 21 for exactly this future moment,
built ahead of schedule and never called - it only handled the buyer-fee bracket alone, not the
combined buyer-fee + bid-fee-midpoint + flat-fee total this prompt actually needs, so it was
replaced with a real combined-region solver rather than reused as-is.

**Mode B - what actually renders today - had to solve a smaller but real problem: what does
"never derive a fee from `current_bid_usd`" mean when `current_bid_usd` is also the most useful
default value to start from?** The rule drawn: `current_bid_usd` may be *displayed* as context
and may *prefill* the candidate-bid input as a convenience, but the fee is always computed from
whatever the candidate-bid field currently holds - a fully editable, clearly labelled input,
never an auto-derived figure. The distinction is mechanism, not the coincidence that the
prefilled value and the current bid start out numerically equal. Verified against a real
listing (`current_bid_usd=$25`, non-clean Copart title): fee at $25 is $157.50, but entering
$2,000 shows $897.50, and crossing the real $99/$100 bracket boundary shows the fee step from
$180.00 to $265.00 - the number visibly tracks the candidate, not the current bid.

**The `max_budget_usd` distinction that almost got over-corrected.** An earlier checkpoint's own
wording ("confirm `max_budget_usd` never enters this logic") was too blunt and would have
forbidden the *correct* use of the budget: solving for the maximum bid such that everything
lands under it is exactly what a budget ceiling is for. The actual rule has one clause, not
zero: `max_budget_usd` enters the *solve* (the target `solveMaxBidForFees` solves against) and
must never enter *bracket selection* as an assumed sale price - that specific substitution is
what would overstate the fee on every car that ultimately bids below budget. Both facts are
true at once; a rule stated as a blanket exclusion would have quietly broken the feature it was
trying to protect.

**The Copart/IAAI asymmetry, carried forward from Prompt 24's pre-flight and now load-bearing
in the UI, not just a footnote:** a genuinely sold Copart or IAAI lot can never reach the
`sale_confirmed=true` bucket, because neither platform has any confirmation mechanism at all
(`sale_confirmed` is written in exactly one place codebase-wide - bid.cars' own content script;
see topic 22 above and `PLAN_TRACKER.md` B2). `ListingCostBreakdown`'s abstention message for
this case reads differently depending on platform for exactly this reason: Copart/IAAI get
"sale confirmation is not available on this platform," bid.cars gets "this platform marked the
final bid as not a confirmed sale, or its status could not be determined." Both currently
render as the same amber abstention block - a genuinely sold Copart lot's abstention means
**"unconfirmable by platform,"** not **"suspicious,"** which is what the same rendering means
for a bid.cars `sale_confirmed=false` row. Distinguishing them visually was raised and
deliberately deferred, consistent with the same call made in topic 22 for the client-facing
"Unconfirmed sale" badge - not built now, recorded so a future reader doesn't read the shared
rendering as an oversight.

---

## 24. A rule against an unselected field fails silently - and how to actually trust a zero

**The confirmed pattern.** `current_bid_usd` was permanently `null` on every `RunListing` for
as long as `listRunListings` existed (`PLAN_TRACKER.md` §4.15) - two compounding mistakes:
`sightings.current_bid_usd`, the real column, was never in the query's select list, and the
fallback (`raw_payload.current_bid_usd`) read a path that doesn't exist either (the real value
sits one level deeper, at `raw_payload.captured_fields.current_bid_usd`). Nothing errored.
Nothing warned. Every rule reading that field quietly evaluated a permanent `null` for years,
and under the absence-is-not-violation doctrine, `null` reads as "no preference" - the failure
mode is not loud, it is invisible, and it looks identical to "this rule correctly found nothing
wrong."

**Prompt 27 went looking for a second instance of the same mistake, deliberately** - three real
findings (an unflagged 2012 car, false trim WARNs, a misleading A2 badge) all looked, on the
surface, like they could be another silent-null case. They weren't. Auditing all nine
spec-match rules (`ResearchRunDetail.tsx`) by hand - every listing-side field and every
brief-side field, traced to its actual `.select()` and mapping code, not assumed - found both
sides clean: `listRunListings`'s select already carried `mileage_miles`, `title_type`,
`runs_and_drives` and (via the nested `assets` join) `year`, `trim`, `transmission`, `fuel`,
`exterior_color`, all mapped from the real columns; `client_briefs:*` is a wildcard select, so
no brief field can ever be silently dropped. **This is the useful negative result the pattern
demands: checking and finding a class of bug absent is not wasted effort, it's the other half
of "don't trust a zero without proving it."**

**The actual causes, once plumbing was ruled out, were three different, more ordinary things:**
a design boundary that already existed and was already disclosed in the UI (`sold_comps` runs
never run spec/risk rules at all - `PROJECT_CHARTER.md` §5.6, `PLAN_TRACKER.md` debt #52); a
vocabulary gap identical in shape to the Gas/Petrol and "Any, except White" fixes (topic 12) -
an uncovered instance, not a broken mechanism (§4.16/2B); and a badge that computed the right
trigger but discarded a field (`auction_history.status`) it already had access to when writing
the message (§4.16/2C). None of these needed the `current_bid_usd` fix's shape of repair -
proof that "a rule never fires" has more than one real cause, and jumping straight to the
select-list explanation without checking would have been its own kind of unverified assumption.

**The method that makes any of this trustworthy: synthetic fire/no-fire proof.** A rule with
zero real positives is not evidence the rule works - it's equally consistent with the rule
being silently broken. The only way to tell them apart is to construct a listing/brief pair
that *must* trigger the rule and one that *must not*, and run the real logic (not a
paraphrase of it) against both. Three of the nine rules here (year-min, transmission, fuel)
had a genuine zero on live production data at the time of this audit - proven vacuous-by-
lack-of-violating-data rather than vacuous-by-brokenness, by running the exact rule logic
against synthetic pairs built specifically to trigger each one. This is the same principle
that caught a structurally-unreachable guard earlier this session (topic 16) - a check that
can never fire looks identical to a check that works, and the only way to know which one you
have is to force it.

---

## 25. The currency guard was correct; the fix was to widen what the tables can hold, not to loosen it

Prompt 22 built `extract-cost-document`'s currency guard after watching the model try to
silently default a Naira figure to USD - a ~1,395x mispricing, the exact "generated price
wearing a costume" `PROJECT_CHARTER.md` §5.4 exists to prevent. The guard's rule: every
monetary field in every destination shape is USD-only, because `rate_unit` only ever offered
`usd | percent` - no other currency was a valid answer. So when a real Nigerian assessment
notice states an amount in Naira, the guard correctly marks that field `NOT_VISIBLE` rather
than record a wrong number with false confidence, and says which currency the document
actually used in `document_summary` so a human reviewer isn't left guessing why.

**The parked, correct-at-the-time consequence: the pipeline built specifically to process these
documents could not confirm a single row from one.** Every real Nigerian assessment notice on
hand abstained on every monetary field, for as long as C1d stayed unbuilt. This was not a bug
in the guard - the guard was doing exactly its job, refusing to let a number it couldn't
confirm pass as read. It was a genuine gap in what the destination tables could even represent.

**The two ways to close that gap, and why only one of them was ever on the table.** Loosen the
guard - teach the model to convert NGN to USD itself, or assume a currency when ambiguous -
would recreate the original bug this whole mechanism exists to prevent, just moved one step
earlier in the pipeline. The other option - leave the guard exactly as it is, and give the
destination tables a `currency` column so a human, reading the same document the model
correctly declined to guess at, can record the real figure in its real currency - is additive,
touches the guard not at all, and was Prompt 22's own original design, deliberately parked
rather than built prematurely.

**Verified, not assumed, that the guard survived untouched:** `extract-cost-document/index.ts`
has zero diff across this entire build (`git diff --stat` against the file confirms it). The
proof this actually closes the gap isn't code review, it's a real document: the exact real
assessment notice that Prompt 22 could only ever reject was walked through the new confirm
step - "FCS," ₦205,581.08, currency set to NGN, and the review screen fetched the day's rate
(1326.03, a live API value, not the hardcoded 1,500 fallback) and froze $155.04 as the USD
equivalent. Re-reading the row afterward returns the identical figure - proof this is a stored
number, not a live conversion recomputed on each view.

---

## 26. Fingerprint revision: upgrade a VIN-less asset in place, never merge into one that already has a VIN, and prove abstention with a state the normal write path cannot produce

**The problem, restated correctly.** Two capture pipelines can each be right about the same
physical car and still create two `assets` rows: one capture arrives with no VIN (fingerprint
falls back to make/model/year/trim/colour), a later capture of the *identical car* arrives with
a VIN (a completely different, VIN-based fingerprint) - and nothing merges them, because a
fingerprint lookup only ever finds a row by exact hash match. This is debt #46 in
`PLAN_TRACKER.md`, and it had already happened twice in production before this fix.

**Why the master prompt's own two premises about testing this were wrong, and had to be
reported, not worked around.** First: the prompt assumed a specific detection query would find
the real known split pair. It didn't - the two real rows differ in exactly the fields the query
matched on, because the two platforms that captured them parse model/trim differently. Second:
the prompt assumed "ambiguity" meant a lookup finding *multiple* candidate rows to choose
between. That case is structurally impossible: `assets.fingerprint_hash` is `text unique not
null`, so any lookup by hash returns at most one row, ever. Neither premise survived contact
with the actual schema and data - both were stated plainly rather than silently forced to fit.

**The actually-reachable case, once the impossible one was ruled out.** A VIN-bearing capture
computes the VIN-less fingerprint too (as a probe) and looks for an existing asset under it. Two
outcomes are real: no match (create as before), or a match whose `vin` column is `null` - a
genuine same-car candidate, safe to upgrade in place (same row acquires the VIN and the
VIN-based hash; `sightings`/`auction_history` FKs need no repointing since the row id doesn't
change). The one case that must never happen automatically: a match whose `vin` column is
**already set to something else**. That is an inconsistent state - a VIN-less-computed
fingerprint pointing at a row that already has a different VIN - and it cannot arise through the
normal RPC-only write path (a legitimate VIN-less capture never sets a VIN; a legitimate
VIN-bearing capture either creates fresh or upgrades a genuine null). The defensive branch that
handles it (abstain, do not merge, record the conflict) therefore has no live positives to test
against by construction, the same class of problem topic 16 above describes for the yard
matcher's ambiguity check.

**Solution: construct the impossible state deliberately, as synthetic test data, to prove the
abstention branch actually abstains.** Inserted a real asset row, then explicitly overwrote its
`fingerprint_hash` to the VIN-less formula's output while leaving its `vin` column populated -
the inconsistent state unreachable via the RPC path. Ran the real capture logic against it and
confirmed: no upgrade attempted, no merge, the conflict recorded (`asset_fingerprint_outcome:
{action: 'abstained_vin_conflict', ...}`) rather than silently overwritten or silently ignored.
First attempt at this test was itself wrong - the synthetic row's fingerprint initially matched
its own VIN consistently, which a vinless probe would never find - corrected by explicitly
setting the *inconsistent* hash, not just any hash.

**How to extend it:** same generalisation as topic 16 - a rule whose real-world positive count
is zero must be proven with a case built to be positive, not trusted on the strength of a clean
production history alone. And separately: when a stated test premise (a detection query, a
definition of "ambiguous") doesn't survive checking against the real schema or real data, say so
and find the actually-reachable case, rather than forcing the original premise to appear to
work.

---

## 27. Auditing every `raw_payload` mapping, not just the one already known to be broken

**Starting point:** `researchService.ts`'s `current_bid_usd` field was found reading from
`raw.current_bid_usd` - a path into the *request envelope* `research-capture` happened to spread
wholesale into `raw_payload` (`rawPayloadToSave = { ...payload }` at
`research-capture/index.ts:308`) - while the real, always-correctly-written value lived in a
proper `sightings.current_bid_usd` column that was simply missing from the `.select()` list.
Fixed once (commit `ccabb3c`). The question this topic answers: is that the only instance, or
one of several?

**Method - check every raw_payload read, don't assume the pattern repeats or stops.** For each
service reading `raw_payload` (or a field the shape of it): (1) find the exact write path that
produced that `raw_payload` for that specific pipeline - not assumed from another pipeline's
code, since two ingestion paths can shape the same-named column completely differently; (2)
check whether the field being read actually lives at that path, or lives instead as a real,
correctly-populated column that just never made it into the `.select()` list; (3) only then
decide whether a read is broken, and fix it the same way (select-list addition,
path correction) rather than guessing a blanket rule from one instance.

**The contrast case that proves the method, not just the bug.** `app-ingest/index.ts` writes
`raw_payload` as `{ ...v, record_type, date_listed }` - a flat spread of the vehicle object
itself, structurally different from `research-capture`'s envelope-spread. `storageService.ts`'s
`raw.<field>` reads against *that* pipeline's `raw_payload` are genuinely correct, for exactly
the same reason `researchService.ts`'s reads against `research-capture`'s `raw_payload` were
not: the write shape differs, so the same-looking read code is either right or wrong depending
on which write path produced the data it's reading. Checking, rather than assuming either "the
bug generalises" or "this pipeline is fine because that one was," is what separates confirmed
fixes from guesses: 3 more genuinely broken fields were found and fixed in `researchService.ts`
(`estimated_retail_value_usd`, `estimated_cost_low_usd`, `estimated_cost_high_usd`); 6 already-
correct reads elsewhere were confirmed correct and left untouched, each with its own reason
recorded rather than a blanket "looks fine."

**How to extend it:** any time a `raw_payload`-shaped bug is found in one place, the right next
step is a full audit of every reader, keyed to that reader's own actual writer - never a
find-and-replace across files that assumes the write shape is uniform across pipelines.

---

## 28. Four reader bugs, one writer bug - fixing readers treats the symptom, not the disease

**The pattern, once named:** topic 27 above audited and fixed four separate `raw_payload` reader
bugs across two prompts (`current_bid_usd`, then three more). Every one of them had the identical
root cause: `research-capture/index.ts:308` wrote `rawPayloadToSave = { ...payload }` - the
entire request envelope, whose real fields live nested under `payload.captured_fields` - so any
reader reaching for a top-level path got a silent `null` forever. Four instances of the same bug
across two prompts is itself the signal: fixing the fourth reader the same way the first three
were fixed would only guarantee a fifth, whenever the next field gets added and someone reaches
for the "obvious" path.

**Why the fix belongs on the write side, not the read side.** A reader-side fix (teach this one
reader the real path) is inherently local - it protects exactly the field someone happened to
look at, and nothing else. A writer-side fix (make what gets written predictable) protects every
future field, including ones nobody has written a reader for yet. This is the general form of
"fix the thing that produces the bug, not each place the bug shows up" - the same reasoning that
made Prompt 29's fingerprint fix look at the fingerprinting *function* first (ruled out - the
formula was correct) before finding the real cause one level up, in what fed it.

**The fix:** flattened `raw_payload`'s write shape to spread `captured_fields` directly onto the
top level - the exact convention `app-ingest/index.ts` already used correctly
(`{ ...v, record_type, date_listed }`). One canonical shape system-wide now, so copying "the
obvious" `raw.<field>` pattern from one pipeline into the other produces a correct result instead
of reproducing the bug a fifth time. The 176 historical rows under the old nested shape are left
alone - rewriting them would need a migration for a shape nothing currently reads as a query
surface; instead, `supabase/functions/_shared/rawPayload.ts`'s accessors handle both shapes
transparently, so a future reader never needs to know which shape a given row was written under.

**The other half - making a genuinely missing field loud.** A flatter write shape closes today's
gap but doesn't stop a *sixth* field from being misread if someone reaches into `raw_payload`
directly instead of using the real `sightings` column. `readRawPayloadField`/
`requireRawPayloadField` return `{ present, value }` rather than a bare value, and the `require`
variant throws when a field is genuinely absent under either shape - so "this field doesn't
exist" and "this field exists and is `null`" can never again be silently conflated the way they
were four times before this fix. Proven with synthetic input (no live row exercises the throw
path by construction - the same reasoning as topics 16/26) and separately against a real
historical row pulled from production moments before the deploy.

**How to extend it:** when the same class of bug is found more than once, stop fixing instances
and go looking for what actually produces them. A bug found four times across two prompts is not
four bugs; it's one bug with four symptoms, and the fourth occurrence is exactly the signal that
the first three fixes were incomplete.

---

## 29. A fingerprint formula can be correct and still produce two hashes for one car - when the disagreement is upstream, in the inputs

**The bug debt #46's first fix didn't close.** Prompt 29 Stage 1 fixed the case where the SAME
platform reveals a VIN it previously masked (IAAI logged-out vs. logged-in) - a real fix, proven
live. But the debt's actual motivating case survived: a Copart capture of a Mercedes wrote
`model: "E 250 Bluetec"`, `trim: null`; bid.cars' capture of the identical lot wrote
`model: "E-class"`, `trim: "250 BLUETEC"`. Two different VIN-less fingerprints for one physical
car, because `generate_fingerprint()` hashes whatever make/model/trim strings it's handed, and
the two platforms handed it different strings for the same fact.

**The key realization: this is not a fingerprinting bug.** The SHA-256 formula does exactly what
it should with the inputs it receives - the same discipline as topic 26's "the fingerprint
formula was doing exactly what it should" for the VIN-discovery case. The actual defect is one
layer upstream: two independent parsers (Copart's page structure, bid.cars' aggregation of it)
disagree about where "trim" ends and "model" begins for the same underlying fact. No change to
the hash function, the RPC, or the schema could fix a disagreement that happens before either one
is ever called.

**The fix: canonicalize identity inputs, never the stored record.** `_shared/specVocabulary.ts`
gained `canonicalizeForFingerprint(model, trim)`, extending (not duplicating) the Prompt 27
class-letter concept already built for spec-match comparison - a bare `"<Letter> <number>"`
model (Copart's "E 250") is now recognized as a class-letter model alongside the existing
`"<Letter>-Class"` pattern, and a short alphabetic token immediately after the base model name
is treated as a submodel/trim-folding artifact - but ONLY when something else follows it,
preserving it as the canonical trim otherwise. That second rule is what keeps a bare "Yaris iA"
(Toyota's real, distinct rebadged-Mazda2 submodel, confirmed by VIN WMI prefix `3MY` vs. a
genuine Toyota-built Yaris's `JTD` prefix) from colliding with a bare "Yaris" - the qualifier
survives as the only distinguishing signal a capture with nothing else to go on actually carries.
Over-normalizing (treating "iA" as always-droppable noise) would have fused two real, different
vehicle platforms that happen to share a nameplate; under-normalizing (leaving the class-letter/
submodel-folding cases alone) would have left the actual reported bug unfixed. The dividing line
- drop a qualifier only when something else follows it - is what let both succeed.

**Verification discipline: compute both sides independently, then compare - don't assert.** Both
real pairs (Mercedes lot 66964556, Yaris lot 62572576) were verified by calling the *actual*
`generate_fingerprint()` Postgres RPC with each side's own real captured values run through the
canonicalizer, and confirming the two resulting hashes were byte-identical - not by inspecting
the canonicalizer's code and reasoning it should work. The near-miss cases (E250 vs. E350; a bare
"Yaris iA" vs. a bare "Yaris") were proven NOT to collide the same way. This mirrors topic 20's
dual-pass-agreement discipline: agreement between two independently-derived answers is real
evidence, code review is not.

**The hazard changing an identity formula creates, and how it was handled.** Every VIN-less
asset's fingerprint is computed from this formula - changing it retroactively invalidates every
existing VIN-less asset's stored hash (32 real ones, at the time this was found). Recomputing and
backfilling them is unavoidable (the alternative is silently orphaning all 32 on their next
capture - the exact bug this fix exists to close, at scale). But recomputation can also produce
genuine collisions - two previously-distinct assets whose canonical identity now matches, which
is precisely the class of "should these merge?" decision that must never be made automatically
(`docs/SOLVED.md` topic 26's same principle). The backfill computed every candidate hash via the
real RPC first, grouped by result, confirmed zero collisions existed in this codebase's real
data before writing anything, and would have reported - never merged - any it found.

**How to extend it:** when two systems disagree about the same fact, look for which one is
actually producing the disagreement before touching the system that merely consumes it. And any
identity-formula change is, by construction, a backfill-and-collision-report problem, not a
one-line fix - plan for that before writing the new formula, not after.

---

## 30. A fix proven correct by RPC computation still needs proving through the real path - and the real path can reveal a second, deeper gap

**What topic 29 actually proved, precisely.** Prompt 30 proved debt #46's cross-platform fix by
calling the real `generate_fingerprint()` RPC with each platform's own raw values run through the
new canonicalizer, and confirming the two hashes matched. That is real, non-trivial proof - it is
not the same as "the code looks right." But it is also not proof that the *merge* happens through
the actual deployed capture endpoint, because the backfill that accompanied it produced zero
collisions, correctly: every VIN-bearing asset already carries a VIN-based hash, structurally
unable to collide with a freshly-recomputed VIN-less one. The RPC-level proof and the
live-endpoint proof are different claims, and only one of them had actually been tested.

**What the real capture found.** Bashir re-captured the bid.cars side of the Mercedes lot after
the backfill, specifically to close that gap. The capture landed - `captured_at` updated - but
resolved to the *same* asset it already pointed at, with `asset_fingerprint_outcome: null`: the
upgrade-probe code path never ran. Tracing why revealed a second, more fundamental limitation
than the one Prompt 30 fixed: `research-capture/index.ts`'s upgrade logic is gated on
`!existingAsset` - it only ever runs at the exact moment a VIN-bearing capture arrives and no
VIN-bearing asset for that VIN exists yet. The very first capture of this pair (bid.cars, with
VIN, timestamped minutes before Copart's vinless capture of the same lot) satisfied that
condition and found nothing to upgrade, because the vinless sibling didn't exist yet - so it
just created a normal new VIN-bearing asset, correctly, by the letter of the current design.
Every capture after that point (including today's) finds `existingAsset` immediately via the
main hash lookup and never reaches the probe at all.

**The honest conclusion: the canonicalization fix and the merge-window fix are two different
things, and only one was built.** Canonicalizing model/trim (Prompt 30) makes it *possible* for
a VIN-bearing capture's probe to find a canonically-matching vinless sibling. It does nothing for
the case where the VIN-bearing asset already exists - which, for any pair where the two platforms
happen to get captured in the "wrong" order (VIN-bearing first), is not an edge case but the
default outcome. This was always implied by the existing "existing production splits are not
auto-merged by this fix" caveat in debt #46's own text - Prompt 31's real capture is what turned
that caveat from a stated limitation into a demonstrated, concrete failure with its own evidence.

**How to extend it:** an RPC-level or unit-level proof that two independently-computed values now
agree is real evidence for the *formula*, but it is a different claim from "the system that
consumes this formula behaves correctly end to end" - especially when the surrounding logic has
its own gating conditions (here, `!existingAsset`) that a formula-level test cannot exercise. When
a fix touches a stateful, order-dependent process (an upgrade that only fires once, at a specific
moment, for a specific reason), proving the formula is necessary but not sufficient - budget for
a real, live run through the actual entry point before calling the case closed, and expect that
run to sometimes surface a second gap the formula-level proof had no way to see.

---

## 31. Retiring `daily-sniper` removed three standing doctrine exceptions, not just one function

**What it was.** `daily-sniper/index.ts` was the system's only external caller (invoked directly
by a phone Shortcuts automation, not by anything in this repo or its authenticated app), its only
static-shared-secret auth path outside the extension/cron functions already covered by AGENTS.md
§4.3, and its only consequential writer with **no human review gate** at all - `BulkImport.tsx`
and `CarForm.tsx` both route through a review step before anything is saved; this function wrote
straight to the database from an unreviewed AI extraction (see debt #56, `PLAN_TRACKER.md`).

**Why it's gone rather than fixed further.** Prompt 31 already remediated the acute security
issues (env-var secret, dropped the `sales`-table write, currency abstention). Prompt 32 Stage 1
retired the function entirely: the live site now accepts uploads from Bashir's phone directly,
through the normal reviewed pipeline, covering the same workflow `daily-sniper` existed for back
when AutoData was a localhost project with no upload path. With the workflow it existed for gone,
the standing exceptions it required go with it.

**How to extend it:** if a future feature ever again needs an external caller with its own
static-secret auth and no review gate, treat that combination as a deliberate, documented
exception requiring its own justification - not a pattern to copy from history, since this is
the second time (after `extract-vehicle-vision`'s original currency-guessing bug) that an
unreviewed AI-written field reaching the database directly turned out to be the actual risk, not
just the specific bug found in it.

---

## 32. Debt #46, actually closed - why canonicalization alone couldn't do it, and why capture order was the real cause

**What canonicalization (Prompt 30) actually fixed, precisely.** It made two platforms' VIN-less
fingerprints agree when they described the same car (Copart folding trim into its model string
vs bid.cars splitting them). That is necessary, and topic 30 proved it works at the RPC level.
**It does not merge anything, and was never going to,** because of a fact about *when* the
upgrade probe runs: `research-capture/index.ts`'s probe only ever fires inside
`if (!existingAsset && hasUsableVin)`. On the real pair this project kept reproducing (lot
66964556): bid.cars captured first (VIN-bearing, no VIN-less sibling existed yet to find), so it
created a normal new asset by the letter of the design. Copart captured second, creating its own
VIN-less asset, with no logic looking for a VIN-bearing sibling in *that* direction. Both assets
now exist. Every future capture of either platform matches its own asset immediately via the
main fingerprint lookup and never reaches the probe at all - not because the probe is broken, but
because the condition that would make it relevant (`!existingAsset`) is never true again for
either side.

**The actual cause: capture order decided whether a car split, not the fingerprint formula.** If
Copart had captured first, the VIN-bearing bid.cars capture arriving second would have found the
VIN-less sibling and upgraded it in place - no split, same two platforms, same car, opposite
order. This is not a fixable ordering problem (you cannot control which platform's scraper runs
first) - it is evidence that a split, once formed, is a permanent state requiring an explicit fix,
and that new splits need a fix that doesn't care about order at all.

**Two separate fixes, deliberately built in that order (Prompt 32).** Stage 2: a genuine merge
operation for splits that already exist - human-confirmed, never automatic, because a wrong
merge (fusing two real different cars) is worse than a split and much harder to detect (see
`DECISIONS.md` §12). Stage 3: made the probe symmetric, so capture order stops mattering for new
captures going forward - a VIN-less capture arriving after a VIN-bearing asset now finds it too,
via a new stored `vinless_identity_hash` column (every asset's own VIN-less canonical identity,
computed and stored regardless of whether that asset itself has a VIN), rather than recomputing
canonicalization against every row on every capture.

**A bug found by review, not by the original build: sentinel twice, not once.** Stage 2's merge
function mutates an orphan's `fingerprint_hash` to a sentinel so it can never be rediscovered by
a future capture computing the same hash. Stage 3 added a second identity column
(`vinless_identity_hash`) for the new symmetric probe - and initially left it unsentineled on
merge. Bashir caught this in review before deploy: a soft-retired orphan would still carry a
live, matching `vinless_identity_hash`, so a fresh VIN-less capture could attach straight back
onto the dead row through the new column, silently reviving the exact split the merge had just
fixed - the identical failure mode the first sentinel was built to prevent, just through the
door the first fix didn't know existed yet.

**How to extend it:** whenever an identity-matching mechanism gains a new stored/indexed key (the
way `vinless_identity_hash` was added alongside the existing `fingerprint_hash`), check whether
the soft-retirement/merge logic sentinels that key too - a merge that "removes" a row from future
matching via one key but not another only looks fixed. Proven both directions (VIN-bearing
then VIN-less, and VIN-less then VIN-bearing) and the ambiguous-match abstention (two different
real cars sharing one VIN-less identity) with synthetic, self-cleaning rows run directly against
the real `generate_fingerprint` RPC - not asserted, since none of these three cases had a live
positive to test against by construction.

## 33. The zero-models rule caught defunct and non-car makes by the same evidence - and could not catch the one the prompt named

**The task.** Rank the 406 seeded NHTSA makes by evidence instead of curating a list: a make with no
car/truck/MPV models across probed years is either defunct or not a car brand, computed rather than named.

**First surprise: the rule had no evidence to run on.** Prompt 33 seeded models only for the (make, year)
pairs already present in `assets`, so 2-7 makes had models in any given year. A zero-models rule over that
would have flagged nearly everything as defunct because nobody had asked. The fix was a probe
(`vehicle-reference-make-probe`) that asks NHTSA once per make and stores the answer; only then does
"zero" mean anything.

**Second surprise: names with a period fail deterministically.** 40 makes came back `probe_failed`
("AZURE DYNAMIC INC.", "EFFICIENT DRIVETRAINS, INC."). Not transient: vPIC's path routing treats the
trailing `.` as a file extension and 302s to a 404. The id-keyed endpoint (`GetModelsForMakeIdYear`)
handles them. The same batch loop also had a starvation bug — ordering by name kept re-picking the same
failing makes and starved never-probed ones; fixed by ordering never-probed first.

**Third, the finding that matters: NHTSA's year filter cannot show a make is defunct.**
AC Propulsion returned its two models (eBox, tZero) for every year 2010-2030. The obvious rescue — a
"phantom future year" sentinel — fails too: Toyota, Honda and Ford also return models for 2029. vPIC treats
a model as active from its first year until an end date is recorded. Pontiac does end correctly (7 models in
2010, none from 2011), which is why real ended makes fall out.

**What the rule actually did on all 406 makes:** 14 traded (tier 1), 317 current (tier 2), 75 other (tier
3: 47 zero-models, 28 older-only). Caught by name, after the fact, to make the rule's real effect visible:
*zero-models* — American Motors, Checker, Daewoo, Datsun, DeLorean, Geo, Lancia, Oldsmobile, Peugeot,
Plymouth, Renault, Triumph, Yugo, plus Mitsubishi Fuso, Wausau Equipment; *older-only* — Hummer, Maybach,
Mercury, Opel, Pontiac, Saab, Saturn, Suzuki, plus IC Bus, Orion Bus, Crane Carrier, Jerr-Dan. **Not
caught:** AC Propulsion (tier 2, "recent"). It was then hidden by Bashir's explicit decision (20 Sep 2026) through the demote flag, with the reason recorded on the row, not by any rule or hard-coded name.

**Lesson.** Verify a rule against the real source before promising what it will catch — the master prompt's
own verify step ("AC Propulsion lands in tier 3 by the zero-models rule") could not pass, and the honest
output is the measurement, not a hard-coded exception. Also: a probe that shares a name-encoding assumption
with the seed inherits its failure; key external lookups on the source's own id where one exists.

## 34. A table added after the merge system existed was never joined to it - found by reading the merge function, not by a test failing

**The miss.** Prompt 32 built `merge_assets()` and wrote a standing obligation into `SCHEMA.md` §17: any new
table with an `asset_id` FK must be added to its repoint list. Prompt 34 Stage 2 then created
`won_vehicles.asset_id` and did not. Nothing failed: no test exercises a merge over a won vehicle, and a merge
would have succeeded, left the won vehicle pointing at a retired asset, and reported success.

**How it surfaced.** Stage 4's pre-flight item was "the asset merge FK repoint list", and the honest check is to read
the function's actual `UPDATE` statements rather than trust the doc. `pg_get_functiondef('merge_assets')` listed three
repoints; `won_vehicles` was not one of them.

**The fix, and its proof.** One added `UPDATE` inside the existing function (sentinel logic untouched). Proven in a
transaction that was never committed: two won vehicles on one orphan asset both moved to the survivor,
`won_snapshot` and `promoted_by`/`promoted_at` byte-identical, documents unaffected, and a follow-up query confirmed
nothing persisted.

**Isolation, proven not asserted.** The specific failure to keep absent was a document readable without
authentication or visible against the wrong vehicle. Only one org exists, so "a different org's role" was built inside
an uncommitted transaction: a real user with no membership and a staff member of a freshly-created second org each saw
0 documents, 0 storage objects and 0 won vehicles, while a staff member of the vehicle's org saw all of them (the
positive control that proves the policy is not just returning nothing). The strongest logged-out caller, the public
anon key, got `NoSuchKey`, an empty bucket listing, an empty table read and an RLS violation on insert.

**Lesson.** A standing obligation written in a document is not a control. The list only stays true if the next
migration that adds an `asset_id` re-reads the function that consumes it; treat "which functions enumerate this
table's siblings" as a pre-flight question for every new FK, not a recollection.

## 35. Promotion adds and never moves - and what the Prompt 34 pre-flight found that would otherwise have shipped

**The promotion model.** Winning a car does not relocate anything. A client approves a listing inside a research run; that listing, the sighting behind
it and `approved_snapshot` are the evidence of what was shown and agreed. Promotion creates a **new** `won_vehicles` row under the brief, copies the
approved snapshot into `won_snapshot` (frozen), and marks the source listing with `won_vehicle_id`/`won_at`. The listing is retained unchanged: rewriting
or moving it would erase the account of what the client actually saw. Exactly-once is a **UNIQUE constraint** on `research_run_listing_id`, so a double
click, a retry or a second staff member cannot create two won vehicles; it is proven at the database, not the app.

**The state machine that was not the one.** The master prompt warned an existing 4-step status machine might be the foundation. The pre-flight found
two candidates and neither fit: `asset_status_enum` is declared but dormant (only `ACTIVE` is ever written anywhere), and `research_run_status_enum` is
live but is the research-run workflow, not shipping. Building on either would have bolted a shipping concept onto an unrelated lifecycle. The real
nine-stage corridor was **asked for, not invented** (Bashir supplied it), because a lifecycle that does not match how Caplimo actually works produces
status updates nobody trusts.

**Two more pre-flight finds, both fixed rather than noted.** (1) "One approved listing per run" was enforced only in the app (check-then-update): now
a partial unique index. (2) The "mailer" was never a shared module — `intake-brief` called Resend inline and recorded success but never failure. "Reuse the
existing mailer" therefore meant *extracting* it (`_shared/email.ts`) and logging both outcomes to `email_log`; copying the pattern would have made a second
mailer in substance.

**Stage 5 lesson, the one that generalises.** The test-send guard ("only to the caller's own address") could not honour the address Bashir wanted. The tempting
fix was to let a request name any recipient; the correct one was an explicit allowlist held in a secret, with refusal *before* any send and the refusal
logged. Proven by aiming a test at a real client's address and at an unlisted staff address: both refused, nothing sent, both recorded.

**Verified (Stage 5), synthetic vehicles only, real endpoints:** preview sends nothing (`email_log` stayed empty); an invalid recipient is rejected by the
provider, recorded `failed` with the error and returned to the caller; issuance rejects a wrong-type document, another vehicle's document, zero amount, bad
currency/channel, blank recipient and a future date; void needs a reason and cannot repeat; edit, hard delete and rewriting a voided row are all refused by
the trigger even as the service role; anon key gets `[]` on the issuance and email tables, an RLS denial on insert, `NoSuchKey` on the invoice file, and 401 on
both functions; the tracking payload for a vehicle with an invoice issued contains none of invoice/amount/price/cost/fee/document/recipient/email/estimate.
**Not verified:** that the one test email reached an inbox (Resend accepted it; only Bashir can confirm receipt), and the link in that email resolves on
`theautodata.com` only after the unpushed `/track` route is deployed.

## 36. Recording the real winning bid - why not the snapshot, and why the fee needed the method too

**Why a separate ledger.** The obvious place for the hammer price was `won_snapshot`, the record of the purchase. It is the wrong place: the snapshot is frozen at
promotion to hold what the client *approved*, and the hammer price does not exist yet at that moment. Writing it in later would either break the freeze or leave a
snapshot claiming something untrue at the time it was taken. The sighting is no better a source (`research-capture` updates it in place on re-capture, so its price
can drift). So the figure is entered by a person, in its own append-only table, and shown beside the approved price with the difference.

**Why bid method came with it.** Recording the bid alone would still have left the bid fee as a "$85-$95 depending on bid method (not yet known)" range, because the
fee schedule prices a proxy bid and a live bid differently and the fee function averaged them. For a car already won, and a method staff know, that range is a guess
dressed as a figure. An optional `bidMethod` on the shared fee function makes it a lookup. Proven against independent SQL on five cases (proxy/live at $1,700 and
$5,000, and live at $1,650), and the no-method output was checked identical to before so the run-listing breakdown and headroom callers did not move.

**One design consequence worth stating.** Voiding a replacement makes the earlier entry current again. That is deliberate (the earlier entry was superseded, not
disproved), but it means "the current winning bid" is a query (latest non-voided), not a stored flag, and no code may cache it as one.

**Process note.** The endpoint tests were interrupted when the browser's login session vanished after a dev-server restart. The database-level checks (guards, FKs,
CHECKs in an uncommitted transaction, and the logged-out probes) and the independent SQL fee figures did not need a login and were run first; the authenticated
endpoint and UI checks resumed once the session was restored. Nothing was worked around: a signed-in session is not something to mint.

## 37. Persisting the destination: why the option list had to show its evidence

**The starting point.** The bought-car view made staff pick a port every time it opened and saved nothing, so trucking and shipping fell back to "not calculable" on every reopen.
The obvious fix - two columns on `won_vehicles` - would have overwritten history, and a destination is exactly the kind of thing that changes and drives a cost.

**The finding that shaped the picker.** The destination has to be a value the trucking lookup can match, i.e. `trucking_rates.destination_port_normalized`. Reading the actual values
showed that column is not fully normalized: `BATIMORE`, `PROVDIENCE`, `WILLMINGTON`, `MD-BALTIMORE`, `GA-RINCON`, and `MIAMI` beside `MIAMI PORT`. A plain "distinct ports" dropdown would have
offered the typos as equals of the real ports. Fixing the importer is a decision about the canonical set (and touches raw-at-capture data), so it was logged (debt #66) rather than done here;
the picker instead shows how many rates back each option, sorted most-evidenced first with the current yard's quotable ports marked. The real ports lead and the typo variants are visibly the
one-rate entries at the bottom - the same "rank by evidence, never curate by hand" rule as the make vocabulary (`DECISIONS.md` §13).

**Proven, including the abstention.** Trenton to Baltimore/container $400, New Jersey/container $275, Newark/roro $350, each matching SQL; Savannah/container, a real port that Trenton does not
quote, abstained with "no current rate for this yard/port/method" - the case that would otherwise look like a bug in the lookup. Shipping now abstains for the real reason (no ocean-freight rate
stored, debt #35) instead of "no destination selected".

**A false alarm worth recording.** One guard test read "BUG: allowed" for editing the shipping method. The test had set `roro` on a row that was already `roro` - a no-op the trigger correctly does not
treat as a change. Re-run with a genuine change (and note, and `set_at`), all were refused. Check that a failing test actually attempted the thing it claims before treating it as a defect.

## 38. The mislabel was not one lot, and the mapping was backwards - found by asking the data instead of the debt entry

**The debt as filed** said one bid.cars sighting (the Yaris) was labelled `copart` while its yard read "IAA Dallas/Ft Worth", and proposed abstaining on that contradiction, which was done. Root-causing it meant reading
where the label comes from: the extension derived it from the numeric prefix of bid.cars' Lot field (`0`/`1` → copart, `2` → iaai). The Yaris's raw text said `Lot 0-45905795`, so this was not an odd lot - it was what
prefix `0` produces.

**Two independent checks, both against the project's own data, before touching anything.** (1) Yard-name evidence: for each prefix, count locations whose city exists only in Copart's yard list versus only in IAAI's. Prefix `1`: 49 Copart-only,
0 IAAI-only. Prefix `0`: 0 Copart-only, 18 IAAI-only (Akron-Canton, Bridgeport, Englishtown, Kansas City East, Metro DC ...). City membership alone was inconclusive because both companies have yards in most cities; it was the
*exclusive* cities that decided it. (2) The page's own sales-history table, stored as `auction_history.auction_platform`: IAAI on all 41 prefix-`0` assets, Copart on the 71 prefix-`1` assets that have any. Two unrelated sources agreeing is
what turned "looks backwards" into "is backwards".

**Scope found:** 50 IAAI lots labelled Copart, 12 unlabelled - 62, not 1. The consequence was worse than a wrong label: 24 of them "matched" a Copart yard and quoted Copart trucking rates for an IAAI car, silently.

**Design lesson:** the first instinct was to correct the extension's mapping. But an extension fix only reaches browsers that have reloaded it, and a mapping written again in SQL for the backfill would be a second copy. So the derivation
moved to the server, once, from the raw page text every capture already carries; the extension stopped classifying; and the backfill imports the same module. The mapping also shrank to what the data proves - prefix `2` had been
mapped to IAAI with no observation, and now resolves to unknown, which abstains.

**Honest limits.** IAAI has no stored fee schedule, so relabelled lots now abstain instead of showing a wrong Copart number - correct, but it looks like a regression until an IAAI invoice supplies the schedule. The ingest path (extension to
`research-capture`) is not exercised live from a coding session. And the yard matcher still misses 3 IAAI lots on naming quirks (a leading "IAA ", hyphen vs space) - logged as debt #67, not widened here, because the matcher is strict on purpose.

## 39. Fixing the port typos through the importer's own table - and a measurement that was quietly measuring a block

**The fix.** The importer already carried a reviewed alias table with the rule "never silently fix a name that isn't in this table, since that would be guessing, not normalising". So the four typos went into that
table, one at a time, after checking each: did the same yard already have a correct-port rate (it did not, so no duplicate), and does the yard's geography fit the target (Spartanburg/North Charleston SC to Baltimore,
Boston-area MA to Providence, Seaford DE to Wilmington). The correction SQL is generated from the table itself, so the mapping exists once. Only the derived column moved; the vendor's raw string is preserved, and the
generator is idempotent. Names that might be real places or a naming judgement (`GA-RINCON`, `DAVISVILLE`, `MIAMI PORT`, the regional labels) were left for a human, exactly as the importer's rule intends.

**The near-miss worth recording.** While preparing the next item (measuring how many models each of the 330 "current" makes really has) a script reported that 292 of 330 makes had **zero** models in 2026. That contradicted
the probe's own stored evidence (every one of those makes had a model hit in the last three years, and AC Propulsion had returned two 2026 models earlier the same day). The cause: a burst of parallel requests had tripped
NHTSA's rate limit for this machine, every response was HTTP 403, and the script counted a failed request as "no models". Nothing was reported or stored from it, and the output was deleted, but it is the same shape as the
silent-null bugs this project keeps unwinding: **a failed lookup and a genuine zero must never share a value.** The rerun with retries and a failure counter was cancelled once a single direct `curl` showed the block.
The measurement is deferred (gentler pacing, or run server-side from the Supabase project where the production probe already runs without trouble).

## 40. Model breadth cannot narrow the makes list - measured server-side, after the local measurement turned out to be measuring a block

**The question.** Tier 2 ("current") holds 330 of 406 makes, so the default make picker is still long. The suggestion on the table was to rank or threshold by how many models each make has in the current model year, on the
theory that real consumer brands have many models and custom builders have one or two.

**How it was measured, and why it took two attempts.** The first run (locally) hit NHTSA's rate limit; every call returned 403 and the script counted a failed request as "zero models" (docs/SOLVED.md 39). The rerun executed
server-side from the Supabase project, where the production probe already runs without trouble, in a throwaway superadmin-only function that wrote nothing, paced sequentially at ~4 requests/second, reported a failed lookup as
`null` (never 0), and aborted on any 403/429. Result: 330 makes, **0 failures, 0 unknowns, never blocked**; the function was then deleted (it returns 404). Sanity checks held: Toyota 24, BMW 32, Ford 20, Mercedes-Benz 19
(counts merge NHTSA's car, truck and MPV types, the same population as the model seed).

**Distribution.** 0 models: 8 · 1: 121 · 2: 54 · 3-4: 62 · 5-9: 50 · 10+: 35.

**Why it does not work.** Breadth measures how much a manufacturer submitted to NHTSA, not whether it is a car brand a client could want.
- Legitimate brands score LOW: `FIAT` 1, `JAGUAR` 1, `FISKER` 1, `INEOS` 1, `ZEEKR` 1, `DODGE` 2, `INFINITI` 2, `LOTUS` 2, `LUCID` 2, `BUGATTI` 2, `KOENIGSEGG` 2, `PAGANI` 2, `LAMBORGHINI` 3, `BENTLEY` 3,
  `MINI` 3, `MITSUBISHI` 3, `POLESTAR` 3, `CHRYSLER` 3, `BUICK` 4, `MASERATI` 4, `ROLLS-ROYCE` 4, `RIVIAN` 4.
- Heavy-truck and fire-apparatus makers score HIGH: `FREIGHTLINER` 35, `KENWORTH` 29, `INTERNATIONAL` 26, `PETERBILT` 17, `OSHKOSH` 15, `PIERCE MANUFACTURING` 14, `NATIONAL OILWELL VARCO` 14, `ARMBRUSTER STAGEWAY` 16.
- Junk sits across the range: `ZZKNOWN` 1, `ELGIN SWEEPER CO` 1, `MCNEILUS` 1, but also `KANDI` 11 and `UKEYCHEYMA` 10.
A threshold (say "3 or more") would keep ~147 makes and hide Fiat, Jaguar, Dodge, Infiniti and Lotus while keeping Freightliner and Kenworth. As a sort key it would put Freightliner above Toyota. Ranking must never block a legitimate make
(`DECISIONS.md` 13); breadth would do exactly that, so it is rejected.

**What might discriminate (untested).** Whether a make has any `car`/`multipurpose passenger vehicle` model at all versus `truck` only - the probe merges the three types, so the split was never recorded. Cheap to test the same way,
but it is a hypothesis: NHTSA's "truck" type includes pickups, so RAM and Ford would need care. The already-sanctioned manual route is the reversible demote flag, used deliberately on clearly non-car makers.

**Lesson.** A plausible-sounding proxy (breadth) was cheap to state and cheap to disprove, and the disproof only counted because the measurement itself was made trustworthy first.

## 41. Checking a real IAAI invoice against published fees - what could and could not be verified

**The question.** Is the $645 fee line on the first IAAI purchase invoice (Yaris, $1,700 bid, $2,345 total) accurate?

**What was available.** IAA publishes its fee tables as images (SVG) behind bot protection, so the primary source could not be read; a direct download was blocked and no attempt was made to get around the block. The flat per-unit fees are stated in text
on IAA's own pages (service $105, environmental $15, title-handling $20, effective 1 Jul 2026). The Standard-schedule bracket tables were taken from one broker's reproduction dated 1 Jul 2026. Two other sources were rejected on inspection: one was
IAA's UK schedule in pounds, another used stale flat fees from before the July 2026 change. Third-party fee calculators disagreed with each other and with IAA (one showed a flat "10%, min $150, max $500" that contradicts IAA's tiered table), so none was used.

**The result.** At $1,700 the Standard schedule gives $485 + $85 proxy + $140 flat = $710 ($720 live); the invoice charged $645, which is lower, so the invoice is not an overcharge. The difference fits a High-Volume buyer schedule, and the
arithmetic implies a $420 buyer fee - but that is an inference. The invoice itemises nothing, and the High-Volume bracket table was not obtainable from a source worth trusting. The honest status is "plausible and cheaper than Standard; unconfirmed".

**Two useful by-products.** (1) The invoice's Branch column ("Dallas/Ft Worth") is a primary-source confirmation of a yard name the matcher could not previously resolve. (2) The invoice's buyer is an intermediary company account (not Caplimo's own name), which
matters for the `member_account` a future IAAI schedule must be stored under, exactly as White Nexus did for Copart.

**Lesson.** When the authoritative table cannot be read, say which parts were verified, which were inferred, and what single document would settle it, rather than picking the source that happens to produce a tidy match.

## 42. A correct fix that "did not work" - because the app was matching against 57% of the yard list

**The symptom.** After the leading-"IAA " fix, the app's message changed from `no iaai yard found for "IAA DALLAS/FT WORTH, TEXAS"` to `no iaai yard found for "DALLAS/FT WORTH, TEXAS"`: the prefix was clearly stripped, yet the yard still did not match - although a Node test against the
database's yard list matched it to `Dallas/Ft Worth, Texas`. The two could only differ in the yard list they were given.

**The cause.** The browser loaded the yard list with a plain `select` and got exactly 1,000 rows. PostgREST caps every response at the project's max-rows (1,000), and the client's own `.limit(2000)` cannot raise it. `trucking_rates` has 1,740 active rows, so
the list was the first 1,000 in arbitrary order: 738 Copart rows, 262 of 588 IAAI rows, and no Manheim or ADESA at all. A yard in the missing part came back as "no yard found", which looks exactly like a real absence - the silent-null shape this project keeps
unwinding, this time from a row cap rather than a bad field path.

**Why it survived.** Every verification of the matcher that had been run used the complete list (Node, straight from SQL), and the app only ever looked "roughly right" because the truncated list still contained most Copart yards. It also made the debt #61/#67 verification less clean than it looked.

> **Correction (21 Sep 2026, Prompt 36 Stage 1):** an earlier draft of this entry said the cap "likely explains part of" Prompt 20's 65.5% match rate. That was wrong: Prompt 20's figure (and the Prompt 22 regression check's 70.7%) came from scripts over a complete export of all 1,740 rows, so the cap never touched them. The cap explains only the *app's* behaviour, and re-measuring showed it cost 39 sightings (all IAAI): 137/211 (64.9%) matched instead of 176/211 (83.4%). The two ~65% figures agree only by coincidence of different causes.

**The fix, and the guard.** One helper pages the table in stable id order and de-duplicates to distinct yards; the four unpaginated call sites use it; and it compares the number of rows loaded with an exact server count, throwing if they differ, so a future cap or a concurrent
import cannot silently shorten the list again. Result: all 531 distinct yards (208 Copart, 187 IAAI, 77 Manheim, 59 ADESA), the Yaris matched its yard, trucking $475 = the database rate.

**Lesson.** A test that reads the data one way and an app that reads it another proves nothing about the app. When a fix works in isolation and not in the product, diff the *inputs* first. And any read that means "all of them" must either page or verify its own count.

## 43. The fifth silent shortfall: a query that returns less than asked, indistinguishable from real absence

**The pattern.** A read returns fewer rows or fields than the caller asked for, nothing errors, and the result is exactly what a genuinely empty or smaller world would have returned. It has now been found five times in this project, and each time the code that consumed the result was correct:

1. `current_bid_usd` missing from three select lists - the column existed, the query never asked for it.
2. Three `raw_payload` fields read from the wrong path - the value lived nested, the reader saw `undefined`.
3. `estimated_retail_value_usd` and two siblings - same shape as 1.
4. The spec rules gated behind a run-type check - the rules never ran, so "no flags" looked like "no problems".
5. **The PostgREST 1,000-row cap** (debt #68) - the app matched yards against 1,000 of 1,740 rows, so a yard in the missing part read as "no yard found".

**The general rule, so it stops recurring.** *Any read that means "all of them" must either page to the end and verify its own count, or be provably a small set keyed on something bounded. Loading fewer rows than the server counts is an error, never a result.* In code: `supabase/functions/_shared/paginatedRead.ts` (`fetchAllVerified` for growable tables, `assertComplete` for per-parent reads). Do not write a second helper; a client-side `.limit(n)` above 1,000 is a bug, not a guard.

**How it was audited (Prompt 36 Stage 2).** Every `.from()`/`.rpc()` in the frontend, the Edge Functions and the extension was listed, then judged by *future growth*, not today's row count - `trucking_rates` was under the cap until it was not. 16 reads over growable tables now page and verify; 3 per-parent reads verify their count; the rest are bounded by a key or a deliberate `LIMIT`, with the reason recorded in `PLAN_TRACKER.md` §4.31. Today's counts were identical before and after, which is the point: the failure had not happened yet on any of them.

**Proving a check that has no live positives.** A completeness check passes on every complete read, so production never shows it firing. It was exercised against the real `trucking_rates` table with a plain query (throws `loaded 1000 of 1740`) and with 500-row pages (throws `loaded 500 of 1740`), plus synthetic cases in `scripts/testPaginatedRead.mts`. A check nobody has seen fire is a hope, not a guard.

**One trap found while testing.** `fetchAllPages` assumes the page builder honours `.range(from, to)`; a builder that ignores it returns a full page forever and never terminates. Every shipped caller ranges correctly; the bug was in the first draft of the test.

## 44. The won-vehicle popup lagged because 12 photos were decoded at full size into 80px tiles

**The symptom.** Opening a bought car's popup was slow and scrolling stuttered - the same complaint the run-detail modal had earlier.

**The cause, measured rather than assumed.** The 12 stored photos are 2576x1879 (about 500 KB each, 6.5 MB together). The gallery put each in a `w-full h-20` tile, so the browser decoded all twelve at full size - roughly 222 MB of bitmaps - to paint 80-pixel-high boxes. Supabase's image transformation is not enabled on this project (a transform URL returns 403), so a server-side thumbnail was not available.

**The fix.** `src/utils/thumbnail.ts` downscales each image in the browser (`createImageBitmap` with `resizeWidth`, re-encoded to a small JPEG blob URL), two at a time, and the gallery shows placeholders until each is ready. Object URLs are revoked when the popup closes. On any failure the tile falls back to the original image - heavy but correct, never a silently missing photo. Result on the real Yaris: decoded gallery memory about 222 MB -> 3.4 MB; scroll frame time p95 27 ms / worst 37 ms -> 17.6 / 17.8 ms (in-app browser, same page, A/B on the same twelve tiles). The photos are still downloaded at full size once per popup; a stored thumbnail written at capture time would remove that too, and is a separate change.

**Lesson.** "The images are too big" was the right guess, but the number (222 MB) and the unavailable easy fix (no transforms) decided the approach. Measure the decoded size, not the file size.

## 45. The unattributed write: the update that matched zero rows, and the door it revealed (Prompt 37 Stage 0)

**The symptom.** A confirmed `UPDATE trucking_rates ... 'MIAMI PORT' -> 'MIAMI'` matched 0 rows because the 12 rows were already `MIAMI`. Prompt 36 recorded "something had already applied it, and I don't know what".

**The investigation.** `pg_stat_statements` showed the same statement shape had run once more than the assistant's own typo runs, with the role `postgres` - a direct SQL session, so not the app (which runs as `authenticated`/`service_role`), not an Edge Function, not a database function or trigger (none touch the table), not cron (the only job is the monthly backup). The assistant's own command log showed no `UPDATE` in the window (about 23:58-00:53 UTC, when it was idle awaiting confirmation), no other Claude session existed, and the shell history and terminal were empty. It was most likely Bashir running the SQL that had been shown in the confirmation request. **That cannot be proven: the database keeps no per-statement timestamp or user.**

**What it found instead.** The three rate tables had permissive RLS letting any org member UPDATE or DELETE any row through the API, no triggers, and no `updated_at` - so a change could not be attributed afterwards - while the charter rule "rates are never edited in place" lived only in application code. The newer ledgers (winning bids, invoice issuances, destinations) already refused edits at the database; the rate tables did not.

**The fix.** A trigger lets API roles only close a live row, refuses everything else, and logs every write from every role - including the admin role, which stays allowed because it is the human-confirmed path - to `rate_change_log`. Proven in a transaction that always aborts.

**Two small lessons.** (1) An honest "cannot be determined, here is what was ruled out and why" is a result; guessing a culprit would have been a false one. (2) The proof that a guard works must attempt the forbidden thing - my first run reported a delete as "allowed" when RLS had silently filtered it to zero rows; the check that mattered was the row count afterwards.

## 46. The old fee code's answer at a shared bracket boundary depended on the order the database returned rows (Prompt 37 Phase 1)

While proving the refactor reproduced the old arithmetic exactly, the regression grid (every bracket boundary and +-0.01) found 20 points that differed. All were on the historical High-Volume account and all traced to one cause: 16 bid-fee bracket pairs share a boundary (a price of exactly $8,000 satisfies both 6,000-8,000 and 8,000+), and the old `findBracket` took the *first row the database returned*, which is physical order. For 15 of 16 pairs that happened to be the lower bracket; for the live bid fee at exactly $8,000 it was the higher ($160 vs $145) because that row had been replaced (`actual_paid`) and had moved to the end of the table.

The new rule is explicit - the lower bracket wins - and agrees with the old code on 15 of 16. The comparison harness now runs both versions under the same row order so it isolates real logic changes, and reports the old code's order dependence separately. **Lesson:** a lookup that silently depends on unspecified row order is the same silent-shortfall family (topic 43): correct until a row is rewritten. Any "first match" over rows from the database needs an explicit `ORDER BY`.

## 47. Prompt 37: the subagent experiment - an honest interim assessment (Phase 1 only; Phase 2 was not run)

This was the first prompt run with subagents (parallel read-only pre-flight, an independent verifier). Phase 2 did not start, so the assessment covers Phase 1 only and says so.

**What the subagents caught that a single agent would probably have missed.** The four pre-flight agents (admin screens, rate tables, fee path, real data) read in parallel and each returned file:line evidence. The most valuable finds were ones I did not ask about: the supersede form silently drops a row's currency (superseding the NGN duty row would store its Naira figure as dollars); the extraction-confirm path never closes the previous live row, so the flat-fee sum could double-count; two live duplicate trucking quotes; 16 shared bracket boundaries with unordered lookup; and that nothing tests the fee code. A single agent reading the same code for one goal would most likely have kept its attention on the fee path and missed the currency and duplicate findings, which sit in other files.

**What the independent verifier found that I missed.** Three real things. (1) My "zero TypeScript diff" claim was true only between the load and the removal: I had made two small edits *after* the removal, so the final code had never been run against IAAI data. I re-ran the proof on the final code. (2) A partial fee (bid fee missing) fed the headroom calculation as though complete - a pre-existing gap I had not noticed. (3) `fetchTierRows` was unpaginated, in code I had written right after writing the paging rule in topic 43. It also confirmed by an independent route (the database's own audit log) that no amount, date or source changed in the migrations - stronger evidence than my fingerprint, because it used a different mechanism. It did not disagree with my assessment on anything material.

**Where coordination cost more than it saved.** Running four agents' database reads in parallel tripped the connection pooler's authentication limit; one agent's live checks never ran. I should have serialised database access from the start (the prompt said to serialise writing; reading the same database is also a shared resource). The verifier was told to run one query at a time and completed cleanly. The pre-flight reports were long, and a good share of their text was context I then re-read in the code myself before designing; for a change this size, two agents (rates + fee path) with the admin screens read by me would have cost less for nearly the same result. **Verdict:** the verifier earned its cost clearly; the parallel pre-flight earned it on breadth, not on depth; serialise database access for any agents that share it.

**A separate lesson about my own work, not the subagents.** I found, while writing this documentation, that the "dated correction notes" for Prompt 36 Stage 3 had been appended to the summary table instead of the debt register itself (the row numbers appear in both). No agent checked that, and it was in already-pushed commits. It is fixed in the Prompt 37 docs commit. Documentation edits need the same verification as code.

## 48. Prompt 37 Phase 2: the subagent experiment, second half - and the zero line the verifier found

**What worked.** Three read-only pre-flight agents (one with database access, one query at a time - the Phase 1 lesson) established before any code was written that no numbering, no PDF library and no line items existed, and that the landed-cost refusal omits nothing silently. Serialising database access held: no pooler failures this time. A builder subagent did the client-relationship view in parallel with my backend work (different files); it hit a usage limit at the end and I finished and type-checked its output, so the parallelism saved time but not attention.

**What the independent verifier found that I missed - the important one.** I had built the doctrine "an invoice that totals while a component abstains is refused", tested it in Node and in the database, and reported it proved. The verifier tried the obvious escape instead of the obvious case: not *leaving a component out* (refused) but *putting a zero in for it*. The database accepted a $0.00 ocean-freight line with basis "n/a" in a "complete" invoice, and the form turned a blank amount into $0. The zero rule existed only in the shared JavaScript rules, not in the database, and the migration's header comment claimed otherwise. That is precisely the failure the prompt named, in a different shape. My own tests never tried it because I wrote tests for the cases I had thought of. This is the same lesson as Phase 1's "zero TS diff" gap: the author tests what the author imagined; a cold reader tests what the requirement literally forbids.

**Twelve findings that were mine, not the design's.** Lines appendable after issue, a number that never came from the ledger, a receipt with no org check, generated PDFs soft-deletable, a committed invoice's PDF retired after a reply failure, an idempotency key returning old content for a new request, no TRUNCATE guard. All were reachable only with the service role or through error paths, none through the normal UI - which is exactly why my happy-path and refusal tests did not touch them.

**What the verifier could not do, and I could not either.** Recompute a computed fee, trucking or freight line on the server: those services live in frontend code. A session holder can label a figure "computed". The fix is to move the cost core server-side (as Phase 1 did for the fee schedule), recorded as debt #79 - not done here.

**Cost/benefit, plainly.** The verifier was the most valuable single step of the phase: one material catch, a dozen smaller ones, and an honest "could not determine" list. The builder subagent broke even. Pre-flight paid for itself in the first hour. A finding I would add for next time: give the verifier the *stop-rule sentence* verbatim and ask it to break it, not just to check the requirements list.

**Test debris, honest.** My direct-SQL tests allocated 12 ledger numbers in the synthetic org and left them `allocated`; append-only ledgers cannot be cleaned, only marked `abandoned` with a note, which was done on 21 Sep 2026 after confirmation. The refusals were then re-proved live against the database and the deployed function (see PLAN_TRACKER 4.34).


## 49. Prompt 38 Phase A: the informational-discount trap, the six-component rule was wrong, and the builder subagent widened

**Why the six-component rule was wrong, precisely.** Phase 2's doctrine ("an invoice that totals while a component abstains is refused") was correct in the abstract and wrong for Caplimo's actual practice. Caplimo bills in stages - purchase and service fee now, shipping and clearance later - and the rule would have stamped every one of their real invoices "PARTIAL INVOICE - NOT the full cost" for doing exactly what they always do. The fix is not "relax the rule" but "change what it protects": a scope statement states what an invoice covers, and the database still requires that statement to be non-blank, but it can no longer verify the statement is *true*. That is a real, acknowledged reduction in guarantee, traded for matching how the business actually invoices. The lesson repeats Phase 1's and Phase 2's own: a rule built from first principles, without the real artifact in hand, encodes the builder's assumptions about the domain, not the domain.

**The informational-discount trap, closed structurally, not by convention.** INV-0025 prints "Discount Applied -₦148,250.00" as a subtotal line, and the line amounts above it are already net of their own discounts - subtracting the printed figure again gives ₦2,173,700.00, short by exactly ₦148,250.00. The Phase 2 tables could not have represented this at all (no discount concept existed), so the trap was new to this build, not inherited. The fix is not a rule that says "don't subtract this twice" - it is that no such figure is ever stored. `billing_compute()` derives "Discount Applied" at render time from the line discounts baked into each net amount; there is no column, anywhere, holding a total a second deduction could reach. The failure mode is structurally unreachable, which is a stronger guarantee than a check that could in principle be bypassed.

**The builder subagent, widened from one component to a real one.** Prompt 37 tested a builder subagent on nothing (the increment was proposed, not run). Prompt 38 actually ran one, on the PDF renderer only - the most genuinely disjoint piece available (data in, PDF out, no schema, no shared files with the engine). It read the real invoices' extracted layout (a separate pre-flight agent's output, not its own reasoning), and delivered `documentTemplate.ts` plus the logo/font assets. Its own report claimed all three golden PDFs passed exactly; the main agent re-ran the same comparison independently and got the same result (no missing/extra tokens, no position over 4pt off) - the self-report was not simply trusted. Two real gaps in its self-report, caught by re-verification rather than assumed absent: it described `documentTemplate.ts` as fully self-contained, but a later contract change (adding `'strong'` emphasis, fixing the receipt's `appliedTo` shape to support multiple applications) required editing `documentModel.ts` - a shared file - after the subagent finished, which its "disjoint, shares no file" framing hadn't anticipated because the contract itself was incomplete at handoff, not because the subagent overstepped. Cost/benefit: the increment paid for itself - a working renderer, matched exactly, for a genuinely separable unit of work - and the finding for next time is the same as Prompt 37's: give a builder subagent a *finished, stable* contract, not one still being discovered.

**Font embedding, a real technical finding.** pdf-lib's standard fonts cannot print the naira sign (₦); Caplimo's own real invoices embed DejaVu Sans for exactly this reason. The renderer embeds a subset (Latin + the naira/euro signs, via `pyftsubset`) rather than the full font, cutting the Edge Function's bundled font payload from ~1.95MB to ~154KB base64 - worth doing given Deno's cold-start sensitivity to bundle size, and cheap since pdf-lib subsets again inside the output PDF regardless (each rendered PDF is ~35-40KB either way).

**A live bug the offline tests could not have caught.** `check_billing_document()` is one trigger function shared by two tables (`billing_documents` and `billing_document_lines`), and it read `NEW.document_id` unconditionally - which errors on `billing_documents`, which has no such column. Every offline test exercised the arithmetic (`billing_compute()` directly, or the TypeScript mirror) without ever inserting through the real trigger path, so this was invisible until the first live issue attempt: `record "new" has no field "document_id"`. Fixed in one line (migration 065, reading the id via `to_jsonb(NEW)` keyed on `TG_TABLE_NAME`) and caught immediately by the first live database-level test batch, before any real-org write. The lesson: a trigger fired from more than one table needs a test that actually fires it from each table, not just a test of the function it calls.

**Test debris, honest.** Reproducing the Yaris invoice pair, two of the author's own sequencing mistakes (a wrong client id on the first attempt; a dedicated synthetic org's counter configured one number too low) burned numbers before the correct document issued. Since a voided number is never reused, the document whose content exactly matches the real INV-0027 is labelled INV-0028 on the page - disclosed plainly in PLAN_TRACKER §4.35 rather than hidden behind a fourth throwaway synthetic org.

## 50. Prompt 39: why RLS came before the dashboard, and the vulnerability a live test caught before the verifier did

**Why RLS had to come first, concretely, not just in principle.** The temptation on any "add a new kind of login" project is to build the screen the new user will see first, since that's the visible progress - and check access control once the screen works. This project's own pre-flight (Prompt 38, Stage B.1) made that temptation impossible to act on: it proved, by quoting the exact policy text, that a client login existed only as a schema possibility (`org_role_enum` had the value; nothing created the row) but that the MOMENT one was created, every existing staff policy would grant it the same org-wide read staff have - including, specifically, the hidden cost lines on a retail invoice that are the entire point of the retail hat. Building the dashboard on top of that would not have been "building it before the security work" - it would have BEEN the vulnerability, since a dashboard is what makes an exploitable gap into something a real logged-in person exercises.

**The mechanical trap the fix itself has: an unchanged permissive policy does not go away when you add a narrower one.** Postgres OR's permissive policies of the same command together. Adding a tight client-scoped policy alongside an unchanged org-wide staff policy does nothing - the org-wide one still fires for a client's own org membership and grants the wider access regardless. The fix had to touch the staff policies themselves, which reads, on first glance, like it contradicts "staff access does not change." It doesn't: "does not change" is a claim about the RESULT (which rows staff can see), proved by running the identical query, as the identical real staff user, before the migration and after, and getting byte-identical counts. The policy TEXT had to change for that result to keep holding once a client role could exist. Stating this distinction explicitly, in the migration comments and in `DECISIONS.md` 20.2, is what let the "does not change" claim be checked rather than taken on faith.

**The vulnerability Stage 5's hostile-client verifier did NOT have to find, because the main agent's own live test found it first.** Before launching the independent hostile-client subagent, the main agent minted a real client token itself and swept every staff Edge Function with it - not as a formality, but because Prompt 38's own lesson ("subagent output is evidence to verify, not fact to build on") cuts the other way too: an agent's OWN untested claim of safety is exactly as unverified as a subagent's. That sweep found that `won-vehicle-status`'s `advance` mode had no role check of any kind - its own six-year-old comment said so plainly ("any authenticated staff member - no role check beyond being a real logged-in user"), written when "authenticated" and "staff" were still the same thing. A live client token successfully advanced a synthetic vehicle's status through this exact path before the bug was caught. It was fixed, the erroneous history row deleted, the function redeployed, and the same token reconfirmed refused - all before Stage 5's independent verifier had run a single request. This is the sharpest version yet of the project's standing rule that a browser or a real call is the only real test: six OTHER Edge Functions were checked by reading their source for a role-exclusion pattern and found already safe by inspection, but this one's ABSENCE of a check was invisible to that same reading method, because there was nothing there to misread - only running a real hostile call against it surfaced the gap.

**A second, smaller bug found investigating the first, left open on purpose.** `advance_won_vehicle_status()`'s sequence check silently passes for a vehicle with no prior status history at all, because comparing against a NULL "current position" is NULL, and a NULL condition in PL/pgSQL is treated as false rather than true - so the very first status set on a fresh vehicle can be anything, not just `won`. This predates the client role and has nothing to do with client isolation; it was left as debt #83 rather than folded into the security fix, because conflating an unrelated data-integrity bug with the vulnerability that actually motivated Stage 3 would have made the record of what was fixed for WHICH reason harder to trust later.

**A process mistake, disclosed the same way.** Minting a synthetic client's test session by writing its token directly into the browser's `localStorage` overwrote the SAME storage the real staff session was using, in every tab, because same-origin browser storage is shared across tabs - not, as assumed, scoped per tab. The real (Bashir's) staff session was lost mid-verification as a result. Recovered by falling back to direct service-role database and storage calls for the one remaining live check that needed it, rather than needing the staff session back; the fix for next time is to mint any second identity's token in an entirely separate browser profile or an out-of-band HTTP client, never in the same browser that holds a session worth keeping.

**Stage 5's hostile-client findings.** No cross-client or cross-org read or write was reached anywhere - eighteen "must be zero" tables, nine write attempts, fifteen Edge Functions, direct storage access, all refused or empty, checked against known real ids belonging to another client and to the real production org, not blind guessing. The one real thing it found is a genuine gap in a place this project has not needed to think about before: RLS confines ROWS, not COLUMNS. A client querying `clients` or `won_vehicles` directly, instead of through the `my_client_record`/`my_won_vehicles` views built specifically to hide certain columns, sees those columns anyway - on their own row only, never another client's, but readable regardless of the view's intent. `won_vehicles`' extra columns turned out to be harmless on inspection (opaque internal ids nothing else lets you use, and a "secret" token staff hand the client themselves); `clients.notes` is the one column that actually matters, since it is staff's private commentary about that client, and in this test it happened to be null. The honest reason this is not fixed in the same session that found it: Postgres genuinely cannot express "the same database role sees different columns depending on which row-level policy matched" - column privileges are per-role, and staff and clients share one `authenticated` role throughout this codebase. A real fix is a table split or a second Postgres role, not a policy tweak, and doing either properly under the tail end of an already large session risked introducing a new bug into working staff functionality to close a finding that, as proven, exposes nothing cross-tenant. Recorded as debt #84 rather than rushed.

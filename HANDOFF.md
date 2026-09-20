# HANDOFF.md — paste this first in a new chat

**Last revised:** 15 September 2026 (full rewrite — Prompt 33 Stage 5 status refresh, corrected
Prompt 34 Stage 0B).

**Supersedes the version dated 9 September 2026 (Prompt 23).** That version is gone from this
file's body, not from the project — recoverable via `git log` — but per project convention
(`PROJECT_CHARTER.md` §6, `PLAN_TRACKER.md` §4.12) a superseded document states plainly, in
itself, what it used to claim and what changed, so a reader never has to run `git log` just to
know they're looking at stale context. **This matters more for this specific file than any
other**: a stale `HANDOFF.md` is what caused the "Q1–Q3 already built" loss, a session spent
rebuilding work that already existed because the handover it started from didn't say otherwise.

**What the 9 September version claimed, in summary:** work had stopped at Prompt 21 (8 September)
— auction-fee research and the bid-headroom module. It described the open items as the
delete-confirmation UI, a sold-comps-brief warning, auction alerts, the IAAI capture source, and
C2/C3/Phase D blocked on paperwork. It did not know about, and could not have known about: the
`raw_payload` reader-bug audit and its writer-side fix, the cross-platform fingerprint
canonicalizer and the two rehashes it required, `daily-sniper`'s retirement, the human-confirmed
asset-merge system, or the NHTSA vehicle reference vocabulary — all of which are Prompts 24–33,
covered in full below. **If you are holding a copy of the 9 September version, or anything
derived from it, it is wrong to treat as current — read this one instead, in full.**

You are continuing work on **AutoData**. Read this fully before responding.

---

## The document set

| File | What it holds | Read when |
|---|---|---|
| `PROJECT_CHARTER.md` | What AutoData is, ownership, doctrines. LOCKED, rarely changes. | Always |
| `PLAN_TRACKER.md` | **Status of all work. Where we stopped.** The only place status lives. | Always — start at §0 |
| `MASTER_PLAN.md` | The detailed roadmap — what each phase entails, why it's sequenced this way | Before proposing what to build next |
| `AGENTS.md` | Rules for AI coding agents + every known trap | Before writing any build prompt, and before your first edit in any session |
| `SCHEMA.md` | Column-by-column database truth | Before writing any rule or query |
| `DECISIONS.md` | Why things are the way they are, with LOCKED/PROVISIONAL/OPEN status | When a decision is questioned or a new one is needed |
| `docs/SOLVED.md` | *How* non-obvious mechanisms actually work, reconstructed from real code | When extending or debugging something that already works |
| `docs/REPO_MAP.md` | Read-only file-tree/code-location snapshot | To find where a feature lives before grepping blind |
| `docs/BUILD_LOG.md` | Chronological build record — what shipped, when, in which commit | To find *when* something was built or trace a regression to a date/commit |
| `ARCHITECTURE.md` | How the system is built, at a higher level than SCHEMA.md | For system-level questions |

**Status lives only in `PLAN_TRACKER.md`.** Do not record status anywhere but there.

**On document drift — this exact rewrite just caught a live instance of it.** Debt #58's own
table row in `PLAN_TRACKER.md` said "not fixed" long after it was actually resolved (Prompt 31
Stage 3) — the resolution note landed in a narrative log elsewhere in the same file, but nobody
went back and updated the row itself. Fixed during this rewrite. **The lesson generalizes: a
narrative account of a fix and the tracker's own status row for that debt can silently disagree,
and nothing forces them to reconcile except someone actually checking.** If something in this
document contradicts what you find in the code or the database, **the code and database are
right** — say so, fix the document, and don't assume a prior agent's account over what you can
verify yourself (`AGENTS.md` §1/§2).

---

## One-paragraph orientation

AutoData is a multi-tenant vehicle-market-intelligence and client-operations platform for the
US/EU → Nigeria vehicle import corridor, **owned solely by Bashir**. Caplimo is licensee /
tenant #1, not the owner (`PROJECT_CHARTER.md` §2, LOCKED). React 19 + Vite + TypeScript on
Vercel; Supabase for everything server-side (Postgres + RLS + Edge Functions + Storage); a Chrome
extension captures Copart and bid.cars from inside a real authenticated browser session. Since
the last handover: the integrity debt from two prompts of normalizer/reader-bug auditing is
cleared, `daily-sniper` is retired, a real human-confirmed asset-merge system is live, a full
NHTSA-backed vehicle reference vocabulary now underlies brief entry and spec matching, and VIN
decoding is cached and asynchronous.

**Supabase project ref:** `xrotvpuainpfdulhfhtt`. **Caplimo `org_id`:**
`a93378ea-33ef-4c75-97c4-44c37f2e9002`. **No staging environment exists** — every migration,
deploy and query runs directly against production.

---

## Where work stopped

**Last working session: 15 September 2026** (Prompt 33, Stages 1–3 and 5 — Stage 4 deliberately
skipped, superseded by Prompt 34, which is queued to start fresh next). Full detail in
`PLAN_TRACKER.md`.

**What Prompts 29–33 actually did, in sequence:**

- **Prompt 29** — fingerprint revision on VIN discovery (upgrade a VIN-less asset in place when a
  same-platform re-capture supplies the VIN it lacked), sold-group definition unified into one
  shared module, a full `raw_payload` mapping audit, payment-tier configuration, currency
  abstention in `extract-vehicle-vision`, document-vehicle pairing (`cost_document_extractions`).
- **Prompt 30** — fixed the `raw_payload` writer root cause (the envelope-spread bug behind four
  separate reader bugs — see the traps section below), a shared cross-platform model/trim
  canonicalizer for fingerprint identity (Copart "E 250 Bluetec" vs bid.cars "E-class"/"250
  BLUETEC" now hash identically), a second and third currency-guessing prompt found and fixed,
  and a full grep audit of every normalizer/identity/population definition in the codebase.
- **Prompt 31** — traced why canonicalization alone didn't merge existing splits (capture order,
  not the formula, decided whether a car split — see the fingerprint history below), retired
  `daily-sniper`'s acute security issues ahead of feature work (env-var secret, dropped the
  deprecated `sales` write, currency abstention), unified the two disagreeing title-status
  classifiers, closed a low-risk trim default.
- **Prompt 32** — retired `daily-sniper` entirely (source removed, undeployed — see below), and
  built the actual human-confirmed asset-merge system debt #46 had been waiting on since Prompt
  22, plus made the split-prevention probe symmetric so capture order stops mattering for new
  captures.
- **Prompt 33** (this session) — a full NHTSA vPIC-backed vehicle reference vocabulary (406
  makes, 909 models, filtered to passenger-relevant vehicle types), a cached/asynchronous VIN
  decode system, and both wired into brief entry (vocabulary selection with a "not listed"
  free-text fallback) and spec matching (`trimMatches` extended, not duplicated, to compare
  decoded values with a curated family/badge bridge for cases like BMW's "5 Series" naming
  convention). Client document centralization (Stage 4) was **deliberately skipped** — see
  "What's queued next."

**Everything from the old "immediately next" list is now done or superseded:**

1. §1.2's delete-confirmation UI, §1.4's sold-comps-brief warning, N1's auction alerts, and B1's
   IAAI content script are all **still not started** — unchanged since the last handover, still
   real, still small-to-medium, still not blocking anything above them.
2. **C2 (the duty calculator) is still blocked** on real customs assessment notices — see
   "Blocked on paperwork" below, unchanged in kind though the calibration-point count may have
   moved since 9 September; check `DECISIONS.md` §3 for the current count before assuming it's
   still 3.
3. **C3 is still blocked behind C2.**
4. **Phase D is still blocked on the signed licence — but "blocked" now means "access is
   blocked," not "building is blocked."** Prompt 34 (queued next) builds the won-vehicle
   lifecycle, tracking tokens, documents, and invoicing under Phase D's umbrella, explicitly
   *without* provisioning Fahad or Ahmed into it. The licence gates who gets a login, not
   whether the feature can be built and used by Bashir as sole superadmin in the meantime.

---

## Debts closed since the last handover (#46–#50, #53, #55–#59)

All ten are closed. What actually closed each:

| # | What it was | Closed by |
|---|---|---|
| **#46** | Asset fingerprinting permanently split a car captured with and without a VIN into two assets | **Two-part fix.** Prompt 30 made the formula agree (canonicalization). Prompt 31 found that agreement alone doesn't merge *existing* splits — the upgrade probe is gated on `!existingAsset`, so a split, once formed, is permanent under the old design. Prompt 32 built the actual fix: a human-confirmed `merge_assets()` operation (repoints every FK, soft-retires the orphan, sentinels its identity hashes so it can never be silently rediscovered) plus a symmetric capture-time probe so new splits stop forming regardless of which platform captures first. |
| **#47** | Three unshared implementations of the sold-comps average | Unified into one shared `soldGroup.ts` module (Prompt 29 Stage 2), imported by all three call sites verbatim. |
| **#48** | `sale_confirmed = null` meant two different things depending on `logged_via`, undistinguished | Made explicit as a discriminated union (`SaleConfirmation`) in the same shared module. |
| **#49** | The `manual_entry`/`ai_vision` carve-out didn't cover `api_import` | `api_import` added to the shared module's `ENTRY_METHODS_WITHOUT_MECHANISM`, applied everywhere the module is used. |
| **#50** | A third independent "sold group" implementation | Now calls the same shared `isInSoldPopulation()` as everything else. |
| **#53** | A second NGN-guessing instruction, in `standardizeVehicleString` | "Default to NGN if ambiguous" removed; `"NOT_VISIBLE"` added to the structured-output schema's enum. |
| **#55** | `research-capture`'s envelope-spread was the root cause of four `raw_payload` reader bugs | Fixed at the write side: `research-capture` now writes the flat shape every reader actually expects, matching `app-ingest`'s convention. |
| **#56** | `daily-sniper` was a third NGN-guesser writing to a deprecated table with a hardcoded secret, no review | **Closed by removal, not remediation** (Prompt 32) — see below. |
| **#57** | `normalizeHistoricalData` defaulted an unstated trim to `'Base'` | Default-on-ambiguity replaced with `null`-on-unstated, same standard as the currency guessers. |
| **#58** | Two title-status classifiers disagreed on a real, documented value | Unified into one classifier in `_shared/specVocabulary.ts`, taking the severe reading; `bidHeadroomService.ts`'s binary contract preserved via a wrapper, verified byte-identical against all 88 real values. |
| **#59** | `daily-sniper`'s secret rotation, owned by Bashir | **Closed by removal** alongside #56 — the rotated secret is now simply dead. |

## Debts still open, with why

- **#40** — the auction-fee module's Late Payment Fee is stored as always-on, not conditional. Small, not urgent.
- **#43** — Copart Secured vs. Unsecured pricing is a real, unanswered $375/vehicle question. A $400 deposit is on file but all three real invoices priced at Unsecured anyway. Not a code problem — needs an answer from Copart or a support ticket.
- **#51** — no universal vehicle database meant trim/spec matching stayed pattern-based. **Substantially addressed by Prompt 33** (the NHTSA reference vocabulary + decode + family/badge bridge), but the debt itself should stay open until Stage 3's "not listed" free-text path and the family/badge curation have run against more real production data than one session produced.
- **#54** — the model does not reliably follow the `null`-vs-`"NOT_VISIBLE"` abstention distinction in practice. A prompt-engineering limitation, not a code bug; the review gate (`CarForm.tsx`) is the actual backstop, not the schema enum.
- **§1.2 / §1.4 / N1 / B1** (see "Where work stopped" above) — real, small-to-medium, simply not built yet.

---

## `daily-sniper` — retired, and the three doctrine exceptions that went with it

`daily-sniper` was a phone-Shortcuts-triggered Edge Function built when AutoData had no upload
path other than a laptop. It was **the system's only external caller, its only static-shared-
secret auth path, and its only consequential writer with no human review gate** — three standing
exceptions to doctrine that existed solely for this one workflow. Prompt 32 retired it entirely
(source removed, undeployed, `config.toml` entry cleared) once the live site started accepting
uploads from Bashir's phone directly through the normal reviewed pipeline — the same workflow,
now covered by code that was already reviewed. This closed debts #56 and #59 **by removal, a
stronger outcome than remediation**: the risk no longer exists for anyone to trigger, rather than
existing-but-mitigated. See `docs/SOLVED.md` topic 31.

---

## The merge system: human-confirmed only, never automatic

Two real production split pairs (a Mercedes E-Class and a Toyota Yaris, both cross-platform
Copart/bid.cars splits) have now been merged through the real UI, with Bashir confirming each
one. The system this runs on (`merge_assets()`, `AssetMergeReview.tsx`, `SCHEMA.md` §17):

- **Detection is fully automatic; merging never is, and never should be**, regardless of how good
  detection gets (`DECISIONS.md` §12, LOCKED). A wrong merge fuses two real cars' histories and
  is **worse than a split, and much harder to detect** — a split leaves an orphan a query can
  find; a fusion looks exactly like one well-documented car, and silently corrupts A2 (the flag
  that catches a car being auctioned twice would read two cars' appearances as one's).
- Every FK a merge repoints was re-verified against the live schema, not assumed from the
  original design — pre-flight found a third table (`cost_document_extractions`) Prompt 29 never
  knew about.
- Provenance fields (who paired a document to an asset, and when) are **never rewritten** on
  merge — only the FK pointer moves. A human's past decision doesn't retroactively become someone
  else's decision at a different timestamp (`DECISIONS.md` §12.4) — this is a general house
  pattern, not a one-off rule for this one table.
- A subtle revival bug was caught in review, twice: merging must sentinel **every** identity key
  an orphan carries (`fingerprint_hash`, and later `vinless_identity_hash` once Stage 3 added it),
  or a soft-retired orphan can still be silently rediscovered by a future capture through
  whichever key was left untouched.

---

## The fingerprint history — two rehashes, and why a third needs its own gated prompt

1. **Prompt 30**: changed the canonical form fed into the VIN-less fingerprint formula (a shared
   `canonicalizeForFingerprint`, splitting trim folded into model consistently across platforms).
   Required a 33-asset rehash and a collision review.
2. **Prompt 32 Stage 3**: did not change the formula itself, but added a second stored identity
   key (`vinless_identity_hash`, every asset's own VIN-less canonical identity regardless of VIN
   status) to make the split-prevention probe symmetric. Backfilled across all existing assets.

**The fingerprint formula itself is now frozen, deliberately, and Prompt 33 explicitly declined
to touch it** even though NHTSA data would be a very plausible input to it — identity stays on
the existing, proven, twice-backfilled canonicalizer; NHTSA data feeds spec matching, display,
and data entry instead. **Changing the formula a third time needs its own prompt, its own
backfill, and its own collision review** — doing it casually, especially the same season the
merge system went live, is how two individually-correct systems produce one wrong ledger.

---

## What C2 → Mode A → C3 and Phase D actually wait on

- **C2 (duty calculator) → Mode A → C3 (client-facing cost display)**: all three wait on
  collecting real customs assessment notices to calibrate the declared-CIF ratio. This has not
  changed since the last handover. **Standing habit, not a task: photograph every assessment
  notice before handing it to a client** — this is calibration data that walks out the door
  otherwise.
- **Phase D**: the client-operations portal, status pipeline, and Prompt 34's won-vehicle
  lifecycle are gated on the **signed AutoData↔Caplimo licence — but only for staff access**, not
  for building. Prompt 34 builds the lifecycle now; nobody gets provisioned into it until the
  licence lands.

---

## The things that will bite you

Full list, and the incidents that produced each rule: `AGENTS.md` §4 — read it before writing any
build prompt. Everything from the last handover still holds (`current_bid_usd` is not a liveness
test; compile success is not verification; active listings and sold comps are different
populations; absence is not violation; Edge Function changes need a redeploy and `public-run`'s
allow-list needs its own edit; two Copart member accounts sit on different fee schedules;
`sale_date` is free text; a detection path with zero live positives isn't proven until tested
synthetically). **Three more, confirmed with more instances since:**

1. **The select-list silent-null pattern now has four confirmed instances**, all from one root
   cause. `current_bid_usd` missing from a select list (the original incident) turned out to be
   one case of a general failure mode: `research-capture`'s `raw_payload` writer spread the whole
   request envelope instead of the real nested fields, so *any* reader reaching for the "obvious"
   top-level path got a silent, permanent `null` — three more fields, found the same way, before
   Prompt 30 fixed the write side instead of patching a fourth reader. **A reader-side fix only
   protects the one field someone happened to look at; a writer-side fix protects every future
   field, including ones nobody's written a reader for yet** (`docs/SOLVED.md` topic 28). If you
   find a select-list bug, ask whether the write side is the real problem before fixing the read.

2. **The divergent-definition pattern is now a standing risk to check for, not a one-off.**
   Three near-misses: the sold-group definition (three independent implementations, unified
   Prompt 29), the title-status classifiers (two independent implementations, disagreeing on a
   real value, unified Prompt 31), and the BMW family/badge bridge (caught *before* shipping —
   Bashir's own review flagged that a hand-curated table would become a fourth silently-stale
   normaliser if it were allowed to override NHTSA's own live decoded `Series` field, rather than
   defer to it). **Before writing a new comparison/classification function, grep for whether one
   already exists.** Three prompts have now been spent unwinding the alternative.

3. **Proof against a database function or a local script is not proof against the deployed
   endpoint — and this has now produced one confirmed bug and one live gap.** Prompt 31 proved
   debt #46's fix correct by calling `generate_fingerprint()` directly in SQL; the real, deployed
   `research-capture` endpoint behaved differently in production, because a gating condition
   (`!existingAsset`) the RPC-level test couldn't exercise decided the actual outcome. Separately,
   this session deployed `vin-decode` and then verified its cache-first behaviour by bypassing it
   — running the same logic directly against the database rather than actually calling the
   function — until Bashir's review caught that the deployed function itself had never once been
   exercised. **A function you've deployed but never called through its real endpoint is
   unproven, no matter how thoroughly its underlying logic has been tested another way.** Where a
   real call is possible (an active authenticated session, a test VIN, a synthetic-but-real
   payload), make it, before relying on the deployment.

---

## Working model — Claude Code, since 28 August 2026

Bashir works with **Claude Code** for implementation, and with a separate architect chat for
architecture, diagnosis and prompt-writing. The architect writes detailed build prompts; Bashir
pastes them into Claude Code; Bashir confirms and reviews at every checkpoint.

**Claude Code has real terminal access** — `git`, `npm`, the authenticated `supabase` CLI
(`supabase db query "<sql>" --linked -o table` reaches the real linked production project), and
browser automation (`mcp__Claude_Browser__*`) capable of driving a real authenticated session end
to end, including reading an already-logged-in session's own auth token to make genuine
authenticated calls against deployed Edge Functions. What still needs Bashir: the sign-in flow
itself and any credential entry.

**A prior "yes" does not carry forward past a change in the plan.** If what's about to run
differs from what was approved — even a follow-up fix to something already confirmed — ask
again. Two slips this session both came from skipping that re-ask.

**Capability is not the same as authorization.** Even where Claude Code is technically able to
run something, it still confirms with Bashir first before: any migration (`supabase db push`),
any Edge Function deploy, any destructive or non-`SELECT` SQL, any real email, anything touching
the Chrome extension directly. See `AGENTS.md` §0 and §3.

**A Claude-Code-run browser test finds problems; it does not close checklist items.** Closing an
item requires database output or Bashir's own observation.

Every build prompt ends with the same required output table:
```
| # | Requirement | Done | Evidence (one line) |
```
A "No" is useful; a false "Yes" destroys trust in the whole table. Full prompt structure and
every known trap: `AGENTS.md`.

---

## How to respond

Be direct. Push back when something is a bad idea. Diagnose from evidence — SQL output, console
logs, real DOM, a quoted invoice, a real decoded VIN — over speculating or trusting a document's
account of itself.

When writing build prompts: be exhaustive about specifics, explicit about scope boundaries, and
name the exact pre-flight code to quote before anything changes. State the recommended option
directly rather than offering a menu.

Split work by layer, not by convenience. **One step ≈ one prompt ≈ ≤3 files**, unless the change
is genuinely one indivisible thing. No step starts before the previous checkpoint is verified in
the browser or database, and each verified checkpoint gets committed before moving on.

---

## Blocked on paperwork, not code

The **AutoData↔Caplimo licence is unsigned**, and it gates **Phase D staff logins** and the
auction-alert recipient list — unchanged since the last handover. The required contents are in
`DECISIONS.md` §1 (decision 1.5).

**Also non-code and time-sensitive:** every real Nigerian customs assessment notice needs
photographing before it's handed to a client — the calibration data C2 is blocked on. Check
`DECISIONS.md` §3 for the current calibration-point count; it may have moved since the last
handover.

---

## What's queued next

**Prompt 34 (the won vehicle) — DONE, 20 Sep 2026; Prompt 35 also done.** See `PLAN_TRACKER.md` §4.22-§4.24 for the evidence. In short: a won vehicle is a
client-specific record under a brief (never asset-specific), promoted exactly-once from an approved listing without moving it; a nine-stage lifecycle with
superadmin-only corrections; a token tracking page that carries status only; a private, staff-only document store anchored to the won vehicle; an append-only invoice
issuance record (uploaded PDFs for now, generation deferred to a CRM); and a manual won-notification email through the one shared mailer. Prompt 35 added the bought-car
view (thumbnail, frozen purchase, per-component costs with no landed total until every component is real), the extension picker (vehicle first), and evidence-ranked make
tiering. **Needs Bashir:** push so `/track/:token` exists on `theautodata.com`; confirm the test email arrived; decide whether to record the real winning bid (debt #60).

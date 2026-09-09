# HANDOFF.md — paste this first in a new chat

**Last revised:** 9 September 2026 (full rewrite — pre-handover reconciliation, Prompt 23).
The previous version was dated 28 August and described the state as of 5 August; five weeks
of real work had landed underneath it without this file being touched. Read the whole thing;
do not assume it's a light edit of what you remember.

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

**Status lives only in `PLAN_TRACKER.md`.** An earlier plan document carried a "nothing is
blocked or broken" line that stopped being true within a day; splitting stable doctrine
(`PROJECT_CHARTER.md`), roadmap (`MASTER_PLAN.md`), reasoning (`DECISIONS.md`) and moving
status (`PLAN_TRACKER.md`) into separate files is the fix that's held since. Do not record
status anywhere but `PLAN_TRACKER.md`.

**On document drift, since it just happened to this very file:** these documents are only as
good as the last time someone reconciled them against reality. This file, `SCHEMA.md`,
`DECISIONS.md`, `PROJECT_CHARTER.md`, `MASTER_PLAN.md` and `docs/REPO_MAP.md` were all
corrected on 9 September 2026 (Prompt 23) after each had drifted from ground truth by varying
amounts — one had a schema table missing roughly a third of its real columns. If something in
here contradicts what you find in the code or the database, **the code and database are
right** — say so, fix the document, and don't assume a prior agent's account over what you can
verify yourself (`AGENTS.md` §1/§2).

---

## One-paragraph orientation

AutoData is a multi-tenant vehicle-market-intelligence and client-operations platform for the
US/EU → Nigeria vehicle import corridor, **owned solely by Bashir**. Caplimo is licensee /
tenant #1, not the owner (`PROJECT_CHARTER.md` §2, LOCKED). It replaced two hand-built Excel
sheets per client — *Past Sales* (market comps needing an average) and *Active Listings*
(live auction options) — and both are now live in production as tokenized mobile share
pages. Built out further since: a client intake pipeline (tokenized self-service brief
submission, staff review gate, optional Google account linking), a fraud/risk checklist
(prior-auction-history hard block, critical damage, spec-match against a client's stated
brief), and the first slice of landed-cost tooling (auction fees, inland trucking rates, and
a bid-headroom calculation — though headroom itself is not yet producible for any real
listing, see below). React 19 + Vite + TypeScript on Vercel; Supabase for everything
server-side (Postgres + RLS + Edge Functions + Storage); a Chrome extension captures Copart
and bid.cars from inside a real authenticated browser session, deliberately not a headless
scraper.

**Supabase project ref:** `xrotvpuainpfdulhfhtt`. **Caplimo `org_id`:**
`a93378ea-33ef-4c75-97c4-44c37f2e9002`. **No staging environment exists** — every migration,
deploy and query runs directly against production.

---

## Where work stopped

**Last working session: 8 September 2026** (Prompt 21 — auction fee research and bid
headroom, both stages, pushed to `origin/main`). **9 September 2026** was a docs-only
pre-handover reconciliation pass (Prompt 23) — no application code changed that day. Full
detail in `PLAN_TRACKER.md` §0.

**Last completed build:** C1c — researched how Copart's buyer-fee bracket tables actually
work from primary sources, cross-checked against three real Copart invoices (not trusted on
the published page alone), found a genuine mismatch on one invoice, traced it to a second,
structurally different fee schedule for a different Copart member account (a one-off
middleman, White Nexus Ltd, buying on Caplimo's behalf under its own High-Volume Licensed
terms). Stored both schedules in a new `auction_fee_brackets` table, keyed by member account.
Built `bidHeadroomService.ts`, a single shared module computing auction fees / inland
trucking / ocean freight / duty as independently available-or-unavailable components, plus
the derived bid headroom, shown as a collapsible panel on active listings in
`ResearchRunDetail.tsx`. **A default-account bug was caught and corrected the same session**:
the module first defaulted headroom calculations to White Nexus's cheaper High-Volume
schedule — wrong, because White Nexus is not Caplimo's own account, and pricing against a
discount Caplimo doesn't actually receive would understate cost (overstate headroom) on
every listing, systematically, in the losing direction. Corrected to default to Caplimo's own
account. See `docs/SOLVED.md` topics 18-19 and `PLAN_TRACKER.md` §4.10 / debt #41-43 for the
full account-level findings this produced (Copart's Licensed-low-volume schedule turned out
to be byte-identical to Non-Licensed — incorporation alone doesn't lower fees; a $400 deposit
on file doesn't confer Secured-tier pricing, and what does is an open question worth
$375/vehicle, not yet answered by Copart).

**Everything from the old "immediately next" list is now done.** As of this rewrite, the
genuinely open items, in rough priority order:

1. **`PLAN_TRACKER.md` §1.2 (remaining piece)** — the delete-confirmation UI for briefs/
   clients is built but its own confirmation step has never actually been clicked through and
   verified.
2. **§1.4** — warn when a brief is attached to a sold-comps run (spec matching is
   active-listings-only by design; the app currently accepts the link silently) — **NOT
   STARTED**, small.
3. **§4.1 / N1** — auction alerts (24h internal+client, 1h internal-only) — fully designed,
   unblocked, reuses the already-verified `monthly-backup` pg_cron→Edge Function→Resend
   pattern — **NOT STARTED**.
4. **B1** — IAAI content script (the one capture source still missing) — **NOT STARTED**.
5. **C2** — the duty calculator. Formula is exact and verified (51.47% of declared CIF); it
   is **BLOCKED** on collecting 10+ real customs assessment notices across the value range to
   calibrate the declared-CIF ratio, which is the one thing that varies. **Standing habit,
   not a task: photograph every assessment notice before handing it to a client.** This is
   calibration data currently walking out the door. Until C2 exists, **bid headroom cannot be
   produced for any real listing** — the headroom module always reports duty unavailable, and
   the module's own rule is that any missing component makes headroom unavailable, never
   partial.
6. **C3** — client-facing grouped cost display — blocked behind C2.
7. **Phase D** (client operations / status pipeline / client portal) — blocked on the signed
   AutoData↔Caplimo licence (see "Blocked on paperwork" below).

**A2 (the highest-value open item in the previous version of this file) is resolved, not
open.** A vehicle with any prior auction appearance now hard-blocks from client-facing
active-listings and mixed runs (`PLAN_TRACKER.md` §2.A2, built and verified 4 Sep 2026). Its
one permanent limitation: the underlying `auction_history` table is populated from the
bid.cars Sales History panel only — Copart exposes no equivalent panel (confirmed via DOM
recon, not assumed), so a Copart-only capture is honestly reported "not checkable," never a
false clean pass, and this stays true permanently, not pending a future build (B2, the
Copart-parity item, is **retired as not buildable**).

---

## The things that will bite you

These are the traps with real incidents behind them. Full list, and the incidents that
produced each rule, is `AGENTS.md` §4 — read it before writing any build prompt. The ones
worth knowing before you say anything at all:

1. **`current_bid_usd` is not a liveness test.** It has caused three separate real bugs. `0`
   is a real value (a live lot with no bids yet); `null` means "no bids," not "not active."
   Use `lot_state` (`active`/`finished`/`unknown`) for liveness, always.
2. **Compile success is not verification, and an agent's own summary is not evidence.** The
   real gate is the browser or the database — a feature is done when Bashir has seen it work,
   not when an agent says it's done. This project has a documented history of confident false
   "done" reports.
3. **Active listings and sold comps are different populations — never cross their rules.** A
   salvage/flood/non-running car that genuinely *sold* is valid market history and must never
   be blocked from a sold-comps average. Risk and spec rules (critical damage, prior-auction
   history, brief spec-match) apply to active listings only.
4. **Absence is not violation.** A brief field that is null, empty or `'either'` means *no
   stated preference* — no rule may fire. A missing value on a listing is the same: unknown,
   never an invented mismatch. Getting this backwards floods the UI with false alarms and
   trains the user to ignore every badge.
5. **Edge Function changes need a redeploy**, and `public-run` (the client share page) has a
   strict field allow-list that needs its own edit before a new field reaches the client. A
   fix that "didn't work" is very often one that was never deployed, or a field that was never
   added to the allow-list.
6. **Two Copart member accounts sit on genuinely different fee schedules** (Caplimo's own
   Non-Licensed account, and a one-off middleman's High-Volume Licensed account) — never
   assume "Copart's fee schedule" is singular, and never default a cost calculation to
   whichever schedule happens to be cheaper without checking which account the purchase
   actually runs through (`docs/SOLVED.md` topic 18).
7. **`sale_date` is free text, not a timestamp**, with several real shapes including bid.cars
   active-lot values that are *bid-closing time*, not auction-start time. Always go through
   the shared `parseAuctionDate()` helper — never a second parser, never a fallback date.
8. **A detection path that reports zero positives on real data is not proven to work** until
   it has been run against a synthetic input built to actually trigger it. A guard that can
   structurally never fire looks identical, from the outside, to a guard that correctly found
   nothing (`docs/SOLVED.md` topic 16 — this is a general lesson, not specific to the one
   matcher it was found in).

---

## Working model — Claude Code, since 28 August 2026

Bashir works with **Claude Code** for implementation, and with a separate architect chat
(this one, or its successor) for architecture, diagnosis and prompt-writing. The architect
writes detailed build prompts; Bashir pastes them into Claude Code; Bashir confirms and
reviews at every checkpoint.

**Claude Code has real terminal access** — `git`, `npm`, and the authenticated `supabase` CLI
(confirmed working: `supabase db query "<sql>" --linked -o table` reaches the real linked
production project; the unqualified form defaults to a local Docker Postgres that isn't
running here and fails with connection-refused — that failure means "wrong target," not "no
DB access"). **Browser automation is also available** — Claude Code has driven a real
authenticated browser session end to end (filled forms, saved, hard-refreshed, reopened in
edit mode) via `mcp__Claude_Browser__*` tools. What still needs Bashir: the OAuth sign-in flow
itself and any credential entry.

**Capability is not the same as authorization.** Even where Claude Code is technically able
to run something, it still confirms with Bashir first before: any migration
(`supabase db push`), any Edge Function deploy, any destructive SQL (`DELETE`/`DROP`/`UPDATE`
outside a documented soft-delete pattern), anything touching the Chrome extension directly,
and anything with a real external side effect (a sent email, a live browser action). See
`AGENTS.md` §0 and §3 for the full, current rule set.

**A Claude-Code-run browser test finds problems; it does not close checklist items.** Closing
an item requires database output or Bashir's own observation — an agent's report of its own
browser session is still an agent's summary, and §1's rule about self-reported completion
applies to it too.

Everything built before 28 August 2026 was built via the previous tool (Antigravity),
prompt-paste style, with no terminal access — every deploy/migration/query was manual. That
history stays in the documents as attributed fact (`AGENTS.md` §0 keeps the incidents that
produced today's rules); it is not the current process.

Every build prompt ends with the same required output table:
```
| # | Requirement | Done | Evidence (one line) |
```
A "No" is useful; a false "Yes" destroys trust in the whole table. Full prompt structure and
every known trap: `AGENTS.md`.

---

## How to respond

Be direct. Push back when something is a bad idea — Bashir values that and has changed course
on it several times this project already (most recently: correcting his own earlier
instruction to default bid headroom to a middleman's cheaper fee schedule, once he saw it
would systematically understate cost). Don't pad. Diagnose from evidence — SQL output,
console logs, real DOM, a quoted invoice — over speculating or trusting a document's account
of itself.

When writing build prompts: be exhaustive about specifics, explicit about scope boundaries
(what's in, and just as importantly what's out), and name the exact pre-flight code to quote
before anything changes. State the recommended option directly rather than offering a menu.

Split work by layer, not by convenience: a structural refactor, a backend engine and three
screen tweaks in one prompt means a failure cannot be attributed to a cause. **One step ≈ one
prompt ≈ ≤3 files**, unless the change is genuinely one indivisible thing. No step starts
before the previous checkpoint is verified in the browser or database, and each verified
checkpoint gets committed before moving on — a revert once destroyed a session's uncommitted
work.

---

## Blocked on paperwork, not code

The **AutoData↔Caplimo licence is unsigned**, and it gates **Phase D staff logins** (the
client-operations portal) **and the auction-alert recipient list** — Fahad and Ahmed are
deliberately excluded from the initial alert list until it's signed, though the list is built
editable so they can be added the day it lands with no rebuild. Caplimo's own CAC share
register — recorded 40/30/30 rather than the agreed equal thirds — is live evidence, on this
same project, of what undocumented arrangements cost later. It's a one-page document; the
required contents are in `DECISIONS.md` §1 (decision 1.5).

**Also non-code and time-sensitive:** every real Nigerian customs assessment notice needs
photographing before it's handed to a client. This is the calibration data C2 (the duty
calculator) is blocked on — 10+ notices across the value range, and every one not captured is
gone. Currently 3 calibration points exist (a Camry, an ML350, a G63) — not enough to fit a
curve, per `DECISIONS.md` §3.

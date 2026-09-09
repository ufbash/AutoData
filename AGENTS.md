# AGENTS.md — Rules for AI coding agents on AutoData

**Status:** Binding. Read before writing any code.
**Audience:** Claude Code (primary, from 28 Aug 2026). Antigravity built the system through
5 Aug 2026 — its incidents are kept below because the mistakes are what matters, not which
tool made them. Applies to any AI agent working this repo.
**Last revised:** 9 September 2026 — added §4.13/§4.14 (capture-path traps found 6 Sep 2026,
not previously recorded here). §0-§7 otherwise unchanged since the 28 Aug tooling-switch
rewrite; the 4 Sep browser-capability correction in §3 already stood.

> This file exists because the same mistakes have been made repeatedly. Every rule below
> is written from a real incident on this project, not from general good practice.
> If you are an AI agent: read this file in full before your first edit in a session.

---

## 0. Tooling switch: Antigravity → Claude Code (28 Aug 2026)

Everything built through 5 Aug 2026 was built via Antigravity: Claude (this chat or its
successor) wrote a prompt, Bashir pasted it into Antigravity, Antigravity edited files but
**could not** run the terminal, so deploys/migrations/SQL were marked `MANUAL_USER` and run
by Bashir by hand.

**Claude Code has direct terminal access.** It can very likely run `git`, `npm`, and —
once authenticated — the `supabase` CLI itself: migrations, `functions deploy`, even
read-only production queries. This is a real capability change, not a rename, and §3 below
is rewritten for it. **Confirm CC's actual authenticated access on first use** (does it have
the Supabase CLI logged into this project? does it have `.env` values available?) and
correct §3 if the assumption below is wrong.

**What does NOT change with the switch:**
- The verification standard (§1) — if anything, CC self-running its own SQL makes the
  temptation to self-report success *stronger*, not weaker. Hold the line harder, not
  softer.
- The mandatory pre-flight (§2).
- Every trap in §4 — these are facts about the codebase and Copart/bid.cars, not about
  which agent is reading it.
- Scope discipline (§5) and null handling (§6).

**What changes:**
- §3 is rewritten: fewer things are `MANUAL_USER` by default, but irreversible actions
  (production migrations, deploys, deleting data) should still be **confirmed with Bashir
  before running**, not just run because the tool is capable of it.
- The prompt format in §7 keeps the same required output table, because the risk it guards
  against (a plausible-sounding false "done") is a property of AI agents in general, not of
  Antigravity specifically.

---

## 1. The verification standard

**Compile success is not verification. Your own summary is not evidence.**

- `tsc` passing proves types compile, not that behaviour is correct. Twice on this project,
  wrong types validated a crash.
- The real gate is the **browser or the database**. A feature is done when the user has
  seen it work on screen or in query output — not when you say it is done.

**Antigravity has falsely claimed completion at least five times on this project.** The
most recent: an 8/8 requirement table for a countdown feature that rendered nothing at all,
and separately caused a modal to flicker open and closed once per second. Both were real,
both were reported as complete.

Because of this history, every build prompt ends with a required output table:

```
| # | Requirement | Done | Evidence (one line) |
```

One line of evidence per row. **No full function bodies** — they cost tokens and prove
nothing. If a requirement was not met, write No. A No is useful; a false Yes destroys trust
in the whole table.

---

## 2. Mandatory pre-flight

Before writing anything, quote the **actual current code** — not a description of it, not a
summary, not what you believe it to be.

**"Already implemented" is forbidden without quoted evidence.**

The pre-flight has repeatedly caught real bugs that would otherwise have shipped. On
28 August, a pre-flight quote revealed that the critical damage blocks had a latent bug
(see §4.1) that had passed its own verification because the test never covered a mixed run.
The quote found it; the summary would not have.

---

## 3. What you can do now, what still needs a human — mark `MANUAL_USER` only for the latter

**This section changed with the Antigravity → Claude Code switch (§0). Read it even if you
read an earlier version of this file.**

Claude Code has direct terminal access. Assume, until proven otherwise on this machine, that
you **can**:
- Run `git` (status, diff, commit, branch)
- Run `npm` / build / lint / `tsc`
- Run the `supabase` CLI, **if** it is authenticated to this project — check first
  (`supabase status` or equivalent) rather than assuming
- Run SQL directly against the database, if credentials are available in the environment.
  **`supabase db query "<sql>"` defaults to a local Docker Postgres that is not running here
  and fails with connection-refused** — that failure means "wrong target," not "no DB
  access." Use `supabase db query "<sql>" --linked -o table` to query the actual linked
  remote project.

**Still mark `MANUAL_USER` and get explicit confirmation before running, even if you are
technically able to:**
- Any migration that alters production schema or data (`supabase db push`)
- Any Edge Function deploy (`supabase functions deploy`) — it takes effect immediately, no
  staging environment exists
- Any destructive SQL (`DELETE`, `DROP`, `UPDATE` outside a documented soft-delete pattern)
- Anything touching the Chrome extension itself (reload at `chrome://extensions`, DOM recon
  against Copart/bid.cars) — this still needs the user, sign-in and credential entry are
  still out of reach for the agent
- Anything that sends a real email (Resend) or otherwise has an external side effect

**Correction (4 Sep 2026): browser automation is available in this environment.** This
session drove a real authenticated browser session via the `mcp__Claude_Browser__*` tools —
filled a 16-field form, saved, hard-refreshed, reopened in edit mode, all without the user
driving the mouse. The earlier claim that CC "cannot drive a real browser session even with
terminal access" was wrong for this environment and is removed above. What remains correctly
out of reach: the user must perform sign-in (the OAuth flow itself) and any credential entry
— do not overcorrect and claim CC can log in.

**Standing rule: a Claude-Code-run browser test is valid for FINDING problems, not for
CLOSING items.** Closing a checklist item requires database output or the user's own
observation. An agent's report of its own browser session is still an agent's summary, which
§1 above already says is not evidence — running the browser yourself does not exempt you
from that rule.

**The reasoning:** capability is not the same as authorization. Being *able* to run
`supabase db push` does not mean it is safe to run it unsupervised on a system with no
staging environment. The Antigravity-era discipline of "stop and ask before an irreversible
action" holds; only the reason for stopping changes — from "physically cannot" to
"should not without confirmation."

**Do not answer a database question from code inference when you could just run the
query.** On 5 August, under Antigravity, an agent answered two SQL questions by reading code
instead of running them, and both answers were wrong — the real answer, once actually
queried, changed the diagnosis entirely. Under Claude Code this failure mode should mostly
disappear, since running the query is now usually possible — which makes it a worse mistake
to skip, not a more forgivable one.

If a diagnosis genuinely depends on data you cannot reach (no credentials in environment,
Docker unavailable), say so plainly and ask for the query to be run rather than guessing.

---

## 4. Known traps — these have all caused real bugs

### 4.1 `current_bid_usd` is not a liveness test — **three separate bugs**
A live auction lot with no bids yet is still a live lot. `current_bid_usd = 0` is a real
value, and `null` means "nobody has bid," not "not active."

Incidents:
1. The pre-share critical damage checks filtered mixed runs on
   `current_bid_usd !== null`, silently skipping every unbid car — meaning a
   flood-damaged car with no bids reached client deliverables unflagged.
2. The auction countdown was gated on `current_bid_usd !== null` and therefore never
   rendered at all.
3. `soldList` on mixed runs was built with a `current_bid_usd` condition, causing live
   cars to be judged by the "did it sell?" rule.

**Rule: never use `current_bid_usd` to determine whether a lot is active. Use `lot_state`.**
Never use truthiness checks on it either — `0` is real.

### 4.2 Migration numbers collide
`supabase db push` fails with
`duplicate key value violates unique constraint "schema_migrations_pkey"` when the number
is already used. The plan document said migrations ran 001→019, but a 020 already existed.

**Rule: before creating a migration file, run**
`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3;`
and use highest + 1. Never assume the next number is free.

**Never "fix" a collision by deleting the existing row from `schema_migrations`.** That row
represents a change already live in the database; removing it desyncs migration history from
the real schema. With no staging environment, that is very expensive to unpick. Renumber and
push — that is the only safe move.

### 4.3 CORS errors from Edge Functions usually are not CORS
A Supabase gateway rejection before your code runs (because `verify_jwt` is on) surfaces in
the browser as a CORS failure, because the rejection response carries no CORS headers.

**Check `config.toml` first.** `verify_jwt = false` is required for: `research-capture`,
`upload-images`, `public-run`, `monthly-backup`. It must **not** be set for `app-ingest` or
`extract-vehicle-vision`.

### 4.4 Edge Function changes need a redeploy
Editing a function file changes nothing in production until
`supabase functions deploy <name>` is run. A fix that "didn't work" is often a fix that was
never deployed. This is `MANUAL_USER`.

### 4.5 The public share page has a strict field allow-list
A field missing from the `public-run` allow-list simply never reaches the client page — the
UI then behaves as if the data does not exist. This caused every public listing to show
"Auction date TBC" while the staff view worked perfectly.

**When a feature works internally but not on the share page, check the allow-list first.**
Add only the field needed; never widen it casually. Requires redeploy (§4.4).

### 4.6 Never guess at DOM structure
Copart and bid.cars have both broken parsers built on assumptions. Always run a DevTools
recon snippet against the real page and write the parser against real output.

### 4.7 Extension changes need two refreshes
Both a reload at `chrome://extensions` **and** a hard refresh (Cmd+Shift+R) of the lot tab.
One without the other silently runs old code.

### 4.8 Placeholder text pasted literally
`WHERE ... ` and `<YOUR_RUN_ID>` pasted verbatim into SQL or curl has caused several false
alarms. Check the command before diagnosing the code.

### 4.9 bid.cars image 403s in the console are expected
`ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` / 403 from `images.bid.cars` is Cloudflare Bot
Management blocking direct loads. This is why images are uploaded via the extension in page
context. **Not a bug. Do not attempt to fix it.**

### 4.10 Data lives across two tables — check which
`year`, `exterior_color`, `transmission`, `fuel`, `trim`, `make`, `model` live on **`assets`**.
`mileage_miles`, `title_type`, `runs_and_drives`, `damage_type`, `secondary_damage`,
`sale_confirmed`, `logged_via`, `price_usd`, `lot_state` live on **`sightings`**.

A rule written against a field the object does not actually carry **fails silently** — it
never fires and never errors. See `SCHEMA.md`. When adding a rule, confirm the field is in
the query's select list first.

### 4.11 Schema traps
- `highlights` is TEXT, not an array
- `has_key` is TEXT ("Yes"/"No"), not boolean
- `runs_and_drives`, `engine_starts`, `transmission_engages` ARE booleans
- `sale_date` is TEXT and inconsistent — see §4.12
- All averaging uses `price_usd`, never `listed_price` or `current_bid_usd`

### 4.12 `sale_date` is display text, not a timestamp
Real observed values include `"Thu. Aug 06, 2026 03:00 PM GMT+1"`, `"Future"`, `null`, and
bid.cars variants. Anything time-based must go through the shared
`parseAuctionDate()` helper in `src/utils/auctionDate.ts`, which returns a real `Date` or
`null`. **It must never return a guessed or fallback date** — a wrong date would fire an
alert at the wrong time. Unparseable renders as "Auction date TBC" with no countdown.

### 4.13 Re-attaching an already-captured lot to the same run must not error
`research_run_listings` has a `unique(run_id, sighting_id)` constraint. A plain `.insert()`
on re-capture threw the raw Postgres `23505` error straight to the client once the extension
session model (§4.14) made re-capturing the same lot into the same run a routine action
rather than a rare edge case. **Any new write path that can attach the same
`(run_id, sighting_id)` pair more than once must check for an existing row first (or catch
`23505` on this specific constraint) and treat it as success** — a re-capture of a lot
already in a run is a no-op or a data refresh, never an error condition. See
`docs/SOLVED.md` topic 10.

### 4.14 The extension's active-run session can silently outlive the user's intent
The Chrome extension popup has no background timer — session state (`activeRunId`,
`sessionActive`, `activeRunLastActivity`) lives in `chrome.storage.local` and is only
re-evaluated when the popup is opened, against a 10-minute idle window. **If a user finishes
work on a run without clicking "End run" and reopens the popup within 10 minutes — even on an
unrelated tab, even much later the same sitting — the session is still live and the next
capture silently attaches to the old run.** When a capture turns up in a run nobody meant to
select, check `activeRunLastActivity` against the capture's own timestamp before assuming the
extension mis-selected anything; it more likely never re-evaluated because the popup was
reopened inside the window. See `docs/SOLVED.md` topic 11.

---

## 5. Scope discipline

- **One step ≈ one prompt ≈ ≤3 files** unless the change is genuinely one thing.
- Master prompts work well when scope is **coherent**; they fail when they span unrelated
  layers. A structural refactor, a backend engine and three screen tweaks in one prompt
  means a failure cannot be attributed to a cause.
- **No step starts before the previous checkpoint is verified in the browser or database.**
- **Commit after every verified checkpoint.** A revert once destroyed a session's work
  because nothing was committed.

---

## 6. Null and "no preference" handling — a standing rule

Across this codebase, absence is not violation:

- A brief field that is `null`, empty, or `'either'` means **no stated preference** — no
  rule may fire on it.
- A missing value on a *listing* is **not** a mismatch — it falls under unknown-data
  handling, never an invented violation.
- `sale_confirmed = null` means "cannot verify," which is different from `false`
  ("confirmed did not sell"). They get different treatment: `false` blocks attachment;
  `null` shows with a badge and is excluded from the average.

**Check the absence case first in every rule.** Getting this wrong floods the UI with false
alarms, which trains the user to ignore all badges — destroying the feature's value.

---

## 7. Prompt structure that works

A build prompt on this project should contain, in order:

1. **Scope** — what is in, and an explicit list of what is out
2. **Pre-flight** — the specific code to quote before changing anything
3. **The change** — exact, unambiguous, with the rule written out
4. **Migration** (if any) — marked `MANUAL_USER`, with the number-check from §4.2
5. **Out of scope** — named explicitly, including things that look adjacent
6. **Verify** — browser/DB steps with the expected result stated
7. **Output** — the requirement table only

Include the specific failure mode to prove absent. "Verify X works" is weak;
"verify a car with no bid still shows its countdown — that is the exact case that was
silently hidden" is strong.

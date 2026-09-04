# HANDOFF.md — paste this first in a new chat

**Last revised:** 28 August 2026

You are continuing work on **AutoData**. Read this fully before responding.

---

## The document set

| File | What it holds | Read when |
|---|---|---|
| `PROJECT_CHARTER.md` | What AutoData is, ownership, doctrines. Rarely changes. | Always |
| `PLAN_TRACKER.md` | **Status of all work. Where we stopped.** | Always — start at §0 |
| `AGENTS.md` | Rules for AI coding agents + every known trap | Before writing any build prompt |
| `SCHEMA.md` | Column-by-column database truth | Before writing any rule or query |
| `ARCHITECTURE.md` | How the system is built | For system-level questions |
| `DECISIONS.md` | Why things are the way they are, with status | When a decision is questioned |

**Status lives only in `PLAN_TRACKER.md`.** The previous plan document carried a "nothing is
blocked or broken" line that stopped being true within a day; splitting stable from moving is
the fix. Do not record status elsewhere.

---

## One-paragraph orientation

AutoData is a multi-tenant vehicle-market-intelligence and client-operations platform for the
US/EU → Nigeria vehicle import corridor, **owned solely by Bashir**. Caplimo is licensee /
tenant #1, not the owner. It replaced two hand-built Excel sheets per client — *Past Sales*
(market comps needing an average) and *Active Listings* (live auction options) — and both are
now live in production as tokenized mobile share pages. React 19 + Vite + TypeScript on
Vercel; Supabase for everything server-side; a Chrome extension captures Copart and bid.cars
from inside a real authenticated browser session.

---

## Where work stopped

**Last session: 5 August 2026.** Full detail in `PLAN_TRACKER.md` §0.

Last completed: client brief spec-match rules (migration 022), tested (a)–(g) on an
active-listings run.

Next, in order:
1. Finish the missing client-brief form fields — blocks further testing
2. View / edit / soft-delete for briefs and clients
3. Audit the runs list + creation form before the client-hub restructure
4. **A2 derived flags** — including cross-platform reappearance

**Highest-value open item:** a vehicle sold on Copart then IAAI passed into a client run with
only a mild warning. Cross-platform reappearance is a wreck-and-flip fraud signal that the
charter says must be **blocked** from client deliverables. The rule was never built (Phase A2).

---

## The five things that will bite you

1. **`current_bid_usd` is not a liveness test.** It has caused three separate bugs. `0` is a
   real value; `null` means "no bids," not "not active." Use `lot_state`.
2. **Compile success is not verification, and an agent's summary is not evidence.**
   Antigravity has falsely claimed completion at least five times. Browser or database only.
3. **Active and sold are different populations.** Risk and spec rules apply to active
   listings only. A flood-damaged car that genuinely sold is valid market history.
4. **Absence is not violation.** A brief field that is null, empty or `'either'` means no
   preference — no rule may fire. Same for a missing value on a listing.
5. **Edge Function changes need a redeploy**, and the public page has a strict field
   allow-list. A fix that "didn't work" is often one that was never deployed.

---

## Working model — switched to Claude Code, 28 August 2026

Bashir now works with **Claude Code** for implementation, and with a separate architect
chat (this one, or its successor) for architecture, diagnosis and prompt-writing. The
architect writes detailed build prompts; Bashir pastes them into Claude Code; Bashir
confirms and reviews.

**Claude Code has real terminal access** — unlike the previous tool (Antigravity), which
could not run a terminal at all. Assume CC can run `git`, `npm`, and the `supabase` CLI if
authenticated. It should still confirm before anything irreversible: production migrations,
deploys, destructive SQL, anything with a real external side effect. Mark those
`MANUAL_USER`-equivalent — "confirm before running" — rather than assuming CC cannot do
them. Full detail in `AGENTS.md` §0 and §3, rewritten for this switch.

Everything built before 5 August 2026 was built via Antigravity, prompt-paste style. That
history stays in the documents as attributed fact; it is not the current process.

Every build prompt ends with:
```
| # | Requirement | Done | Evidence (one line) |
```
Full rules and prompt structure in `AGENTS.md`.

---

## How to respond

Be direct. Push back when something is a bad idea — Bashir values that and has changed course
on it several times. Don't pad. Diagnose from evidence (SQL output, console logs, real DOM)
rather than speculating. When writing build prompts, be exhaustive about specifics and
explicit about scope boundaries. State the recommended option directly rather than offering a
menu.

Split work by layer, not by convenience: a structural refactor, a backend engine and three
screen tweaks in one prompt means a failure cannot be attributed to a cause. One step ≈ one
prompt ≈ ≤3 files.

---

## Blocked on paperwork, not code

The **AutoData↔Caplimo licence is unsigned**, and it gates Phase D staff logins *and* the
auction-alert recipient list (Fahad and Ahmed are deliberately excluded until it is signed).
Caplimo's CAC share register — recorded 40/30/30 rather than the agreed equal thirds — is
live evidence of what undocumented arrangements cost. It is a one-page document; the required
contents are in `DECISIONS.md` 1.5.

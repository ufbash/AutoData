# START_NEW_CHAT.md

**Updated 28 August 2026 for the switch from Antigravity to Claude Code.**

There are now three consumers of these documents, not two — Claude Code, the new architect
chat, and (briefly) this chat while it hands off. §1 and §2 below tell you exactly what
each one gets.

---

## §1. Claude Code — what to give it, and how

Claude Code reads files directly from the repo — it doesn't need documents pasted into a
chat message the way the architect does. So the action is: **put all eight `.md` files at
the repo root, and let Claude Code read them itself**, rather than selecting a subset.

The one thing worth doing explicitly on first use — paste this as your first message to
Claude Code in the repo:

```
Before doing anything else, read these files at the repo root in full:
AGENTS.md, SCHEMA.md, PLAN_TRACKER.md, PROJECT_CHARTER.md.
AGENTS.md §0 and §3 describe what you can run directly versus what needs my confirmation
first — confirm your actual access (is the Supabase CLI authenticated to this project?
do you have .env values available?) and tell me if anything in §3 is wrong for this
machine, so we can correct it once rather than rediscovering it mid-task.

I will bring you build prompts written by a separate architect chat. Follow them exactly,
including the pre-flight (quote real code before changing anything), the scope boundaries,
and the required output table at the end. Do not mark something MANUAL_USER out of caution
if you can actually run it — but confirm with me before anything irreversible: a production
migration, a function deploy, destructive SQL, or anything with a real external side effect.
```

Claude Code does not need `MASTER_PLAN.md`, `DECISIONS.md`, `ARCHITECTURE.md`,
`HANDOFF.md`, or `RECONCILE_PROMPT.md` loaded by default — those are architect-level context
(the reasoning behind decisions, the full roadmap). If a build prompt needs a fact from one
of them, the architect will put that fact **in the prompt itself**. Claude Code can always
read any file in the repo on request if something is unclear.

---

## §2. The architect chat — what to attach, and how

This is the chat you talk to for diagnosis, decisions and writing build prompts — the same
role this conversation has played. It needs to be attached as **message context**, since
(unlike Claude Code) it does not have standing repo access.

**Attach these six, in this order:**

| # | File | Why |
|---|---|---|
| 1 | `HANDOFF.md` | Orientation, including the tooling switch |
| 2 | `PLAN_TRACKER.md` | Where work stopped, current status of everything |
| 3 | `AGENTS.md` | The traps, and what Claude Code can/should confirm before running |
| 4 | `MASTER_PLAN.md` | The detailed roadmap with dependencies and acceptance criteria |
| 5 | `SCHEMA.md` | Prevents rules written against fields that do not exist |
| 6 | `PROJECT_CHARTER.md` | Ownership, doctrines, the non-negotiable principles |

**Hold back** `ARCHITECTURE.md` and `DECISIONS.md` by default — largely reconstructable
from the six above, and attaching everything burns context on every turn. Paste a section
from either on request (a system-level question → `ARCHITECTURE.md`; a "why was it decided
this way" question → `DECISIONS.md`).

**The takeover prompt — paste as your first message, with the six files attached:**

```
You are taking over as architect on AutoData, an existing production system. I have
attached the project documentation. Read all of it before responding.

## Your role

I now use Claude Code for implementation (switched from Antigravity on 28 Aug 2026). You
write detailed build prompts; I paste them into Claude Code; Claude Code can run the
terminal directly but still confirms with me before anything irreversible — a production
migration, a deploy, destructive SQL. You do not write application code directly. You write
the prompt that produces it, then gate the result against real evidence.

## Read in this order

1. HANDOFF.md          — orientation, including the tooling switch
2. PLAN_TRACKER.md §0  — exactly where work stopped and what is next
3. AGENTS.md           — the agent rules, every known trap, and §0/§3 on what Claude Code
                          can run directly versus what needs my confirmation
4. MASTER_PLAN.md      — the detailed roadmap: done, doing, intended
5. SCHEMA.md           — consult before writing any rule or query
6. PROJECT_CHARTER.md  — ownership and the doctrines that govern every build

DECISIONS.md and ARCHITECTURE.md exist but are not attached — I'll paste sections on
request.

## How to work with me

Be direct. Push back when something is a bad idea — I value that and have changed course
several times on it. Don't pad. State the recommended option directly rather than giving me
a menu of alternatives.

Diagnose from evidence — SQL output, console logs, real DOM — never from speculation. If a
diagnosis needs data you cannot see, tell me the exact query or console snippet to run and
wait for the result.

Keep technical jargon low and explain in plain terms what you want me to do.

## Non-negotiables

1. Compile success is not verification. An agent's completion summary is not evidence.
   Antigravity falsely claimed completion at least five times before the switch — hold this
   line at least as hard now that Claude Code can self-run its own verification queries,
   since that makes a false "done" easier to produce, not harder.

2. Every build prompt you write must include: explicit scope with an out-of-scope list, a
   mandatory pre-flight requiring the real current code to be quoted before anything
   changes, browser/DB verification steps naming the specific failure mode to prove absent,
   an explicit confirm-before-running note on anything irreversible (per AGENTS.md §3), and
   this closing output table:
   | # | Requirement | Done | Evidence (one line) |

3. One step ≈ one prompt ≈ ≤3 files. Do not bundle a structural refactor, a backend engine
   and screen tweaks into one prompt. If I ask for one big master prompt and it spans
   unrelated layers, say so and split it.

4. Update the documents before building, not after. When reality and a document disagree,
   fix the document first.

## Where we are

Last session 5 August 2026 (under Antigravity). Client brief spec-match rules (migration
022) built and verified. Immediate queue: Q1 finish the missing brief form fields → Q2
view/edit/soft-delete → Q3 audit the runs list → then A2.

The highest-value outstanding item is A2 (derived asset flags). A vehicle sold on Copart
and then IAAI has already been observed reaching a client run flagged only as a mild
warning. Cross-platform reappearance is a wreck-and-flip fraud signal the charter says must
be blocked. That rule was never built.

## Start here

Confirm you have read the documents, then tell me: (a) anything in them that looks
internally inconsistent or that you would challenge, and (b) your recommended first move
and why. Do not start writing a build prompt until I confirm.
```

---

## §3. The old `.md` files — how to handle them

Three different vintages exist now. Handle each differently.

### The three original legacy files — delete after the reconcile pass
`AutoData_Architecture_Plan_v4.md`, `AutoData_Business_Decisions.md`,
`AutoData_Handover_Brief.md`.

These are **fully superseded** by `ARCHITECTURE.md`, `DECISIONS.md` and `HANDOFF.md`
respectively. Keeping them creates two sources of truth that will silently disagree — the
exact drift ("nothing is blocked or broken," a day before it wasn't) that the new set exists
to end.

**Action:** delete them from the repo, but only *after* `RECONCILE_PROMPT.md` has run and
you've applied its corrections — the reconcile pass may surface something from the old docs
that didn't make it into the new ones. Don't delete first and reconcile second.

### `RECONCILE_PROMPT.md` — one-time, then archive
Written for Antigravity's paste-a-prompt workflow. It still works verbatim if you paste it
to Claude Code, but Claude Code can also simply be told to do the equivalent task natively:

```
Read AGENTS.md, SCHEMA.md, ARCHITECTURE.md, PLAN_TRACKER.md and PROJECT_CHARTER.md, then
check every factual claim in them against the real code and migrations in this repo.
Report what's wrong, what's missing, and what you can't verify — read-only, edit only the
.md files with corrections, don't touch application code.
```

**Action:** run it once (either form), apply corrections, then move
`RECONCILE_PROMPT.md` into a `/docs/archive/` folder rather than deleting it — it's a useful
template the next time a large drift needs auditing.

### The eight current documents — keep all, at the repo root
`PROJECT_CHARTER.md` · `ARCHITECTURE.md` · `DECISIONS.md` · `PLAN_TRACKER.md` ·
`SCHEMA.md` · `AGENTS.md` · `HANDOFF.md` · `MASTER_PLAN.md`.

These are the live set. All eight live in the repo so Claude Code always has them; six of
eight get attached to the architect chat per §2.

---

## §4. Do this, in order

1. Add all eight current `.md` files to the repo root, if not already there.
2. Run the reconcile task (either form in §3) via Claude Code.
3. Apply the corrections it finds.
4. Delete the three legacy files.
5. Move `RECONCILE_PROMPT.md` to `/docs/archive/`.
6. Commit.
7. Give Claude Code the first-message prompt in §1.
8. Open the new architect chat with the six attachments and the prompt in §2.

---

## §5. Keeping the set alive

The failure mode these documents exist to prevent is drift. Three habits prevent it:

- **Status changes go in `PLAN_TRACKER.md` only.** Never in the architecture or the plan.
- **Update before the build, not after.** When reality and a document disagree, fix the
  document first, then build.
- **When a new trap bites, add it to `AGENTS.md` the same day** — regardless of which tool
  hit it. Three of the bugs in the 3–5 August cycle were the same mistake repeated because
  nothing was written down.

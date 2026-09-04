# RECONCILE PROMPT — written for Antigravity; also works pasted to Claude Code

**Note (28 Aug 2026):** written before the switch to Claude Code. It still works verbatim —
paste it to Claude Code the same way. Claude Code can also be given the equivalent task in
plain language, since it has direct repo access; see `START_NEW_CHAT.md` §3 for that
shorter form. Archive this file once the reconcile pass has run once — see
`START_NEW_CHAT.md` §3.

Paste to your coding agent after adding the eight current .md files to the repo:

```
# TASK — Reconcile the new documentation set against the actual codebase.
# READ-ONLY on application code. You may edit ONLY the six .md files.
# Do NOT change any .ts / .tsx / .sql / extension file in this task.

## CONTEXT
Six documents have been added at the repo root:
  PROJECT_CHARTER.md · ARCHITECTURE.md · DECISIONS.md · PLAN_TRACKER.md
  SCHEMA.md · AGENTS.md · HANDOFF.md
They were written from conversation history, not from reading the code. Your job is to
correct them against what is actually in the workspace, and to fill the gaps that
conversation history could not know.

## RULES
- Correct ONLY what is factually wrong or missing. Do not rewrite for style or tone.
- Do not soften or remove any rule in AGENTS.md — those are written from real incidents.
- Where you correct something, note it in a change list at the end of your output.
- Where you cannot verify (needs production SQL, a deploy, or a browser), mark the line
  in the doc with `[UNVERIFIED — MANUAL_USER]` rather than guessing or deleting it.

## 1. SCHEMA.md — the highest-value pass
Verify against real migrations and real code:
a. List every file in supabase/migrations/ with its number and name. Correct the
   "Migrations applied: 001 → 022" line if wrong, and add a full migration index table
   to SCHEMA.md (number · name · what it did).
b. For EVERY table named in SCHEMA.md, confirm the column list against the migration
   files. Correct any wrong or missing column.
c. Confirm which table holds each field in the §2 table. Flag any that are wrong.
d. Confirm the exact CRITICAL_KEYWORDS array from ResearchRunDetail.tsx and paste the
   real one into SCHEMA.md §4 if it differs.
e. Confirm parseAuctionDate's real signature and behaviour from src/utils/auctionDate.ts.
f. Confirm the public-run allow-list field-by-field and list it in full in SCHEMA.md §13.
g. Confirm the verify_jwt settings in supabase/config.toml against the Edge Function table.
h. Add any table, column or Edge Function that exists in the repo but is missing from
   SCHEMA.md.

## 2. ARCHITECTURE.md
a. Confirm the frontend stack and versions from package.json.
b. Confirm there is still no router installed.
c. Confirm every screen listed in §7 against the real setView values in App.tsx /
   MainDashboard, and add any screen that exists but is not listed (the Clients screen
   from migration 022 in particular).
d. Confirm the capture field list against the extension content scripts.
e. Confirm the checklist tiers in §5 against the real checklistItems code — list any rule
   that exists in code but is not documented, and any documented rule not in code.

## 3. PLAN_TRACKER.md — status truth
a. For each item marked DONE, confirm the code actually exists. If an item is marked DONE
   but you cannot find the implementation, change it to BUILT-UNVERIFIED and say so.
b. For each item marked NOT STARTED, confirm no implementation exists. If code exists,
   change the status and describe what is there.
c. Confirm the "missing client-brief form fields" list (§1.1) by reading the brief form
   component. List exactly which fields have inputs and which do not.
d. Confirm whether client_briefs has a deleted_at column.
e. Confirm whether research_runs has any assignee/recipient email field, and whether any
   client_email field exists anywhere.
f. Check for any TODO / FIXME / commented-out code that should be in the debt register.

## 4. AGENTS.md
a. Confirm each trap in §4 against the real code — especially §4.10 (which table holds
   which field) and §4.11 (schema traps: highlights TEXT, has_key TEXT, the three booleans).
b. Add any trap you find in the codebase that is not listed — anything a fresh agent would
   plausibly get wrong. Include the file and the reason.
c. Confirm the isUnconfirmed duplication (debt #3) still exists in both
   researchService.ts and AddCapturesModal.tsx.

## 5. Repo hygiene
a. Confirm whether a stray query.js exists at the repo root from an earlier debugging
   session. If so, add it to the debt register (do not delete it).
b. Confirm .env is gitignored and that no secret is committed. Report only — change nothing.
c. List any file in src/ that appears orphaned (imported nowhere).

## OUTPUT
1. The change list: | File | Section | What was wrong | What it now says |
2. A list of anything you could not verify, marked MANUAL_USER.
3. A list of anything found in the code that is missing from the docs entirely.
No code bodies. Do not paste whole files back.
```

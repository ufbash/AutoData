# AutoData — Project Charter

**Status:** Stable. Rarely edited.
**Owner:** Bashir (sole owner, platform superadmin)
**Last revised:** 28 August 2026
**Companions:** `ARCHITECTURE.md` · `DECISIONS.md` · `PLAN_TRACKER.md` · `SCHEMA.md` · `AGENTS.md` · `HANDOFF.md`

> This document holds what does **not** change: what AutoData is, who owns it, and the
> doctrines that govern every build. If something here needs editing, stop and think —
> it probably belongs in `DECISIONS.md` or `PLAN_TRACKER.md` instead.

---

## 1. What AutoData is

A multi-tenant vehicle-market-intelligence and client-operations platform for the
cross-border vehicle import corridor (US/EU auctions → Nigeria).

It began as an internal tool for Caplimo and is now an independent product.
**Caplimo is licensee / tenant #1, not the owner.**

**Three product faces, one data spine:**

| Face | What it is | State |
|---|---|---|
| Brokerage toolset | Staff dashboard, capture, research runs, curation | Built |
| Client deliverables | Tokenized mobile share pages replacing the old Excel sheets | Built and live |
| Public estimator | Search a vehicle → comps average → Nigeria landed cost → request quote | Not started |

**The problem it solved:** Bashir hand-built two Excel sheets per client — *Past Sales*
(market comps needing an average sale price) and *Active Listings* (live auction options).
Both are now solved in production as mobile-friendly tokenized web pages.

---

## 2. Ownership — LOCKED

AutoData is owned **solely by Bashir**. Consequences that follow and must not be eroded:

- AutoData runs on its own resources: own Supabase, own domain (`theautodata.com`), own
  Google Cloud project, own API keys.
- Caplimo staff receive scoped *access*, never ownership.
- A second licensee is simply a new organization inside the platform, isolated by RLS.
- Multi-tenancy was built from day one specifically so this stays true without a refactor.

**Licence gate — binding:** a one-page licence agreement between Bashir (AutoData) and
Caplimo must be signed **before Fahad or Ahmed receive staff logins or any system access,
including alert emails.** IP ambiguity is cheapest to prevent before usage starts.
Caplimo's CAC share register (recorded 40/30/30 rather than the agreed equal thirds) is
direct, live evidence of what undocumented arrangements cost later.

Minimum contents: what is licensed, to whom, for how long, at what cost (nominal or free),
what happens on termination, and explicit confirmation that AutoData's code, data model
and accumulated market data remain Bashir's property.

---

## 3. Roles — LOCKED

| Role | Scope |
|---|---|
| `superadmin` | Platform owner (Bashir). Cross-org visibility. Only role permitted to log vehicles. |
| `staff` | Single licensee org. Research, client management, status updates. |
| `client` | Own records only — brokerage customers. |
| `consumer` | Own records only — public estimator signups. |

Vehicle logging (manual, AI-vision, extension) is restricted to `superadmin` deliberately
while data quality is being established. It can be widened later.

**Superadmins:**
- `ufbash@gmail.com` — `ea3ecc92-41be-43aa-be03-ae8b10041ba8`
- `umarfbash@gmail.com` — `8afa9810-afb4-45e8-9498-a3b5e1a682e2`

---

## 4. The two product lines — LOCKED

Caplimo operates two different businesses that share infrastructure. Conflating them
produces bad pricing.

| | **Brokerage** (auction) | **Retail** (clean cars) |
|---|---|---|
| Whose car | The client's | Ours |
| Our role | Agent | Seller |
| Client mindset | Value-seeking, will compare | Outcome-seeking, wants a finished car |
| Can they see our cost? | Yes — Copart/IAAI are public | No — and no reason to show them |
| Pricing model | Disclosed fee on transparent costs | All-inclusive price, margin undisclosed |
| Our advantage | Transparency and trust | Beating the local market price |

**Why this is not inconsistent:** an agent discloses their fee; a seller quotes a price.
Nobody expects a supermarket to publish what it paid the dairy. Being explicit about which
hat is being worn on any transaction resolves it entirely.

---

## 5. Doctrines — these govern every build

### 5.1 Honesty doctrine — applies to every client-facing number
- Always display sample size alongside an average.
- Widen bands and say so rather than faking precision on thin data.
- Show the underlying comparables so the client can verify.
- Abstain and flag rather than guess.
- Date every snapshot ("data captured 31 July 2026").

Both ethical and commercial: a tool that admits uncertainty is trusted; one that never
does eventually gets caught out.

### 5.2 Show and label, never silently hide
When a vehicle fails a quality or spec check, it is **displayed with a badge and excluded
from calculations** — not removed from view. The only exceptions are hard blocks, which
prevent sharing entirely rather than hiding a row. A user who cannot see what was excluded
cannot audit it.

### 5.3 Verification standard
**Browser- or database-verified, never compile-verified.** `tsc` passing proves types
compile, not that behaviour is correct. Twice, wrong types validated a crash. An AI
agent's completion summary is not evidence. See `AGENTS.md`.

### 5.4 AI never generates a price
Figures come from actual transaction records. AI's only roles are parsing free-text search
into filters and writing plain-English explanations. A plausible-sounding invented price
destroys a pricing product permanently.

### 5.5 Repair estimation stays human — indefinitely
Damage assessment is Caplimo's core expertise and the foundation of client trust. An
automated repair figure that is wrong destroys exactly the credibility the service sells.
Every quote issued is logged; over time, damage class × model × actual repair cost becomes
a proprietary dataset that cannot be scraped or bought.

### 5.6 Active and sold are different populations — never mix their rules
A **sold comp** is market history: what a car actually fetched. A salvage, flood-damaged or
non-running car that genuinely sold is *valid data* and must never be blocked from a
sold-comps run.
An **active listing** is a client option: a car we may buy for someone. Risk and spec rules
apply here and only here.
Applying client-protection rules to market history corrupts the average. Applying
market-history rules to client options hides risk. This separation is load-bearing.

### 5.7 Capture eligibility is keyed on lot state, not platform
`lot_state` (`active` | `finished` | `unknown`) determines what a sighting is eligible for.
This is self-maintaining as sources change; platform-keyed rules are not.

### 5.8 Raw at capture, classify at read
Store what the source said. Derive bands, classes and groupings at query time. This keeps
the ledger honest and lets classification improve without re-capturing.

### 5.9 Public data access is allow-listed
Public pages are served by an Edge Function with a strict field allow-list. **Never** a
public RLS policy on a ledger table. Adding a field to a public page is a deliberate,
reviewed act — and requires a redeploy.

### 5.10 Rates live in dated tables, never in code
All cost rates carry `effective_from` / `effective_to` and a `source`
(`official_tariff` | `agent_quote` | `actual_paid`), edited through an admin screen without
a deploy, so historical quotes stay explicable.

---

## 6. Risk rules — LOCKED

- **Non-insurance sellers avoided.** They correlate with undisclosed problems.
- **Flood is a distinct damage class**, not folded into general damage. Specific and severe
  risk in the Nigerian market.
- **Cross-platform reappearance is a fraud signal.** A vehicle appearing across multiple
  auctions — especially where damage severity *decreases* between appearances — indicates a
  wreck repaired cosmetically and re-sold. Classic importer trap, invisible on the listing.
  Must be blocked from client-facing deliverables.
- **VIN tampering** (missing / altered / replaced) is treated as critical: a dodgy VIN is a
  seizure risk at Nigerian customs and a fraud flag.

**Commercial upside of the same data:** failed bids reveal the market ceiling. A car that
ran three times at $6,200 / $6,800 / $7,100 without meeting reserve tells you the seller's
floor and that the market repeatedly declined. That is bidding intelligence no competitor
has.

---

## 7. Client relationship model — LOCKED

**The client record and the client account are different things.**

- **Client record** — the internal file: name, contact, briefs, runs, invoices, documents.
  Exists whether or not the client ever logs in.
- **Client account** — their login, so they can see their own records. Claimed later by
  matching email address.

The record always comes first. This dissolves the chicken-and-egg problem entirely.

**Nobody self-registers into the client list.** A stranger completing a form creates an
*enquiry*, not a client. Staff review and convert it. That review is the gate.

Accounts are **staff-provisioned and pre-populated** — the client's first login shows a
finished dashboard, not an empty signup form.

**One shareable link:** only the shipping/tracking page is shareable without login
(unguessable, revocable token). Invoices, documents and account data stay behind auth.

**Deposit gates work, not access.** Anyone may submit a brief; a research run only starts
once the commitment fee is in. This protects expensive labour without blocking the top of
the funnel.

---

## 8. Data as competitive moat

Ranked by defensibility:

1. **Repair quote history** — damage class × model × actual quoted repair cost. Cannot be
   scraped, bought or replicated. Accumulates automatically through the quote funnel.
2. **Clearance history** — official value vs declared CIF vs actual paid, per vehicle class,
   per agent. Proprietary and directly monetisable as estimate accuracy.
3. **Search demand signals** — what Nigerians search for, and what they search for but
   cannot find. A market-gap detector for acquisition decisions.
4. **Cross-source vehicle ledger** — the same VIN across Copart, bid.cars and dealer
   listings, enriched over time.

Items 1–3 cannot be bought. Comparable auction data eventually can.

---

## 9. Working model

**Switched from Google Antigravity to Claude Code on 28 August 2026.** Everything in
`PLAN_TRACKER.md` / `MASTER_PLAN.md` up to 5 August 2026 was built the Antigravity way
(below); read it as history, not current process.

Bashir now works with **Claude Code** for implementation, and with a separate Claude chat
(the "architect") for architecture, diagnosis and prompt-writing. The architect writes
detailed build prompts; Bashir pastes them into Claude Code; Claude Code can run the
terminal directly — `git`, `npm`, and (once authenticated) the Supabase CLI — but still
confirms with Bashir before anything irreversible: production migrations, deploys,
destructive SQL, anything with a real external side effect (email, a live browser session).
See `AGENTS.md` §0 and §3 for the full, current rule set — it is not optional reading, and
it was rewritten for this switch.

**Prior model, for history:** Antigravity could not run a terminal at all, so every
deploy, migration and production query was marked `MANUAL_USER` and run by Bashir by hand.
That is why the earlier build log reads the way it does.

---

## 10. How Claude should respond on this project

Be direct. Push back when something is a bad idea — Bashir values that and has changed
course on it several times. Don't pad. Diagnose from evidence (SQL output, console logs,
real DOM) over speculating. When writing build prompts, be exhaustive about specifics and
explicit about scope boundaries. State the recommended option directly rather than
presenting a menu of alternatives.

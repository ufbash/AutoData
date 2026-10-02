-- PROMPT 44 Stage 6 - hardening of the claim-first issuing (migration 086), from the independent adversarial verifier.
-- A claim now records WHO holds it (a random token per request) so that releasing is owner-only and a stale takeover is an atomic
-- conditional delete: before this, two waiting requests that both saw a stale claim could release each other's fresh claim and
-- all run at once. Additive: one nullable column.
ALTER TABLE public.billing_issue_claims ADD COLUMN IF NOT EXISTS owner_token text;

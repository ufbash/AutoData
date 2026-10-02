-- PROMPT 44 Stage 3 - a double-click must not burn invoice numbers.
--
-- Found by firing 5 identical issue requests at once (org 4): ONE document and ONE issued number came out, but the other four
-- requests had each ALLOCATED a number before losing at the final commit (unique violation on the idempotency key) - four
-- abandoned numbers, i.e. gaps in the invoice series, and a raw constraint message shown to the user. The idempotency check
-- ran before allocation, so simultaneous requests all passed it.
--
-- Fix: a request CLAIMS its idempotency key atomically (this table's primary key) BEFORE it allocates a number. Exactly one
-- request wins the claim and issues; the others wait for the winner's result and return the same document. The claim is
-- released when the request finishes either way, so the table only ever holds in-flight work and a failed issue can be
-- retried with the same key. Service-role only (the `billing` Edge Function): no policy, no grant for anon or authenticated.
CREATE TABLE IF NOT EXISTS public.billing_issue_claims (
  org_id uuid NOT NULL REFERENCES public.organizations (id),
  claim_key text NOT NULL,
  request_hash text,
  claimed_by uuid,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, claim_key)
);
ALTER TABLE public.billing_issue_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_issue_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.billing_issue_claims TO service_role;

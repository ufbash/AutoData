-- client_briefs: new intake-form fields, plus the review flow and submission evidence trail.
-- All nullable, no defaults that imply an answer (an unanswered consent is null, never false).
ALTER TABLE public.client_briefs
  ADD COLUMN preferred_auction_sources text[] DEFAULT NULL,
  ADD COLUMN pickup_delivery_location text DEFAULT NULL,
  ADD COLUMN inspection_required boolean DEFAULT NULL,
  ADD COLUMN inspection_scope text DEFAULT NULL,
  ADD COLUMN payment_method text DEFAULT NULL,
  ADD COLUMN damage_tolerance_accepted text[] DEFAULT NULL,
  ADD COLUMN shipping_insurance_optin boolean DEFAULT NULL,
  ADD COLUMN consent_to_bid boolean DEFAULT NULL,
  ADD COLUMN consent_share_with_auction_houses boolean DEFAULT NULL,
  ADD COLUMN status text DEFAULT 'pending_review',
  ADD COLUMN submitted_at timestamptz DEFAULT NULL,
  ADD COLUMN confirmation_sent_at timestamptz DEFAULT NULL;

-- Existing briefs were staff-created and are already live; the column default above would
-- otherwise leave them pending_review, retroactively disabling working briefs.
UPDATE public.client_briefs SET status = 'approved' WHERE status = 'pending_review';

-- clients: the deposit is a relationship-level fact (a client pays once, may have many briefs
-- and runs over time), not a brief or run fact - so it lives here, not on client_briefs.
ALTER TABLE public.clients
  ADD COLUMN deposit_received_at timestamptz DEFAULT NULL,
  ADD COLUMN deposit_recorded_by uuid REFERENCES auth.users(id) DEFAULT NULL;

-- research_runs: the override reason, mirroring the existing critical_override_reason/_by/_at
-- trio from 021_critical_override.sql. A real deposit sometimes arrives (e.g. via WhatsApp)
-- before it's recorded in the system; a hard block with no override gets worked around by
-- editing the database directly, which is worse.
ALTER TABLE public.research_runs
  ADD COLUMN deposit_override_reason text DEFAULT NULL,
  ADD COLUMN deposit_override_by uuid REFERENCES auth.users(id) DEFAULT NULL,
  ADD COLUMN deposit_override_at timestamptz DEFAULT NULL;

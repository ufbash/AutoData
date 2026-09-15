-- Prompt 34 Stage 1 pre-flight finding, fixed here: intake-brief's confirmation email records
-- SUCCESS (client_briefs.confirmation_sent_at) but a failure is only ever console.error'd -
-- never persisted anywhere queryable. "A notification nobody knows failed is worse than none"
-- (Stage 5's own requirement for the new won-vehicle notification) applies equally to the
-- existing mailer, so both are converted to write here - one shared, queryable log, not two
-- different standards for the same class of guarantee.
--
-- client_briefs.confirmation_sent_at is left untouched (still set on success, still read by
-- existing UI) - this table adds the failure visibility that was missing, for both callers.

CREATE TABLE IF NOT EXISTS email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id),
  purpose text NOT NULL,
  recipient_email text NOT NULL,
  subject text,
  related_table text,
  related_id uuid,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_log_related ON email_log(related_table, related_id);
CREATE INDEX IF NOT EXISTS idx_email_log_status ON email_log(status);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_log_select ON public.email_log
  FOR SELECT USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());

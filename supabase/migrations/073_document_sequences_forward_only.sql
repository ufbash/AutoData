-- Prompted by the architect's review of the INV-0028 incident: the invariant "the counter only ever moves forward"
-- lived solely inside configure_document_series/allocate_document_number - a direct UPDATE on document_sequences
-- (exactly what I ran to "fix" my own mistake) bypassed it completely and, for a moment, left the real org's
-- counter behind an existing document_numbers row. Rules in a prompt get skipped under pressure; a constraint in
-- the table cannot be. This trigger refuses ANY update that lowers last_seq, for every role - there is no
-- superuser/service_role exception, and none should ever be added (a genuine emergency rollback belongs to a
-- deliberate, reviewed migration, never a live UPDATE).
CREATE OR REPLACE FUNCTION public.document_sequences_forward_only()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.last_seq < OLD.last_seq THEN
    RAISE EXCEPTION 'document_sequences.last_seq only ever moves forward (org % kind % is at %, refusing %)', OLD.org_id, OLD.kind, OLD.last_seq, NEW.last_seq;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_sequences_forward_only ON public.document_sequences;
CREATE TRIGGER document_sequences_forward_only
  BEFORE UPDATE ON public.document_sequences
  FOR EACH ROW EXECUTE FUNCTION public.document_sequences_forward_only();

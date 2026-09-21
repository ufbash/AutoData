-- PROMPT 37 Phase 2 - document numbering: per-org sequences, separate for invoices and receipts.
--
-- Decided (Bashir delegated, Prompt 37 Stage 2.2), each hard to change later:
--   * PER ORG, separate sequences for invoices and receipts (INV-000001, REC-000001).
--   * A VOIDED document KEEPS its number and a number is NEVER reused.
--   * A gap must be explicable: every number lives in document_numbers with a status, so a number that was
--     allocated but never issued is 'abandoned' with a note, and a voided document is 'voided' - never a silent hole.
--   * Uniqueness is the DATABASE's: unique (org, kind, seq) and (org, kind, number_text), and allocation
--     serialises on the sequence row. Prompt 34 Stage 1 found the approval rule was app-level only (check-then-update),
--     which is a race; numbering must not repeat that (DECISIONS 17.6: a rule that lives only in the app is a habit).
--
-- Allocation and issue are two steps because the number is printed on the PDF before the PDF exists:
-- allocate (status 'allocated') -> render + store the document -> issue (status 'issued'). If the second step
-- fails the number is marked 'abandoned', never released. Only the service role may call these functions.

CREATE TABLE IF NOT EXISTS public.document_sequences (
  org_id uuid NOT NULL REFERENCES public.organizations (id),
  kind text NOT NULL CHECK (kind IN ('invoice', 'receipt')),
  last_seq integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  PRIMARY KEY (org_id, kind)
);

CREATE TABLE IF NOT EXISTS public.document_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id),
  kind text NOT NULL CHECK (kind IN ('invoice', 'receipt')),
  seq integer NOT NULL CHECK (seq > 0),
  number_text text NOT NULL,
  status text NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated', 'issued', 'voided', 'abandoned')),
  allocated_by uuid REFERENCES auth.users (id),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  ref_id uuid,   -- the issuance or receipt that used it
  note text,
  UNIQUE (org_id, kind, seq),
  UNIQUE (org_id, kind, number_text)
);

ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_numbers_select ON public.document_numbers FOR SELECT
  USING (org_id IN (SELECT user_org_ids()) OR is_superadmin());
CREATE POLICY document_sequences_select ON public.document_sequences FOR SELECT USING (is_superadmin());
REVOKE ALL ON public.document_sequences, public.document_numbers FROM anon, authenticated, service_role;
GRANT SELECT ON public.document_numbers TO authenticated;
GRANT SELECT ON public.document_sequences TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.document_sequences, public.document_numbers TO service_role;

-- A number can only move forward, and its identity never changes. Not even the service role can rewrite history.
CREATE OR REPLACE FUNCTION public.document_numbers_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A document number is never deleted or released - void or abandon it instead';
  END IF;
  IF (NEW.id, NEW.org_id, NEW.kind, NEW.seq, NEW.number_text, NEW.allocated_by, NEW.allocated_at)
     IS DISTINCT FROM (OLD.id, OLD.org_id, OLD.kind, OLD.seq, OLD.number_text, OLD.allocated_by, OLD.allocated_at) THEN
    RAISE EXCEPTION 'A document number''s identity is never edited';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'allocated' AND NEW.status IN ('issued', 'abandoned'))
    OR (OLD.status = 'issued' AND NEW.status = 'voided')
  ) THEN
    RAISE EXCEPTION 'A document number cannot move from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER document_numbers_guard_trg BEFORE UPDATE OR DELETE ON public.document_numbers
  FOR EACH ROW EXECUTE FUNCTION public.document_numbers_guard();
CREATE OR REPLACE FUNCTION public.document_numbers_no_truncate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Document numbers are never truncated'; END;
$$;
CREATE TRIGGER document_numbers_no_truncate_trg BEFORE TRUNCATE ON public.document_numbers
  FOR EACH STATEMENT EXECUTE FUNCTION public.document_numbers_no_truncate();

-- The UPDATE takes a row lock on the org's sequence row, so two concurrent allocations queue: the second waits for
-- the first to finish and then gets the next number. If the caller's transaction rolls back, the increment rolls
-- back with it (no silent gap from a failed statement).
CREATE OR REPLACE FUNCTION public.allocate_document_number(p_org uuid, p_kind text, p_user uuid)
RETURNS public.document_numbers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s integer;
  r public.document_numbers;
  prefix text := CASE p_kind WHEN 'invoice' THEN 'INV-' WHEN 'receipt' THEN 'REC-' ELSE NULL END;
BEGIN
  IF prefix IS NULL THEN RAISE EXCEPTION 'Unknown document kind %', p_kind; END IF;
  INSERT INTO public.document_sequences (org_id, kind) VALUES (p_org, p_kind) ON CONFLICT DO NOTHING;
  UPDATE public.document_sequences SET last_seq = last_seq + 1 WHERE org_id = p_org AND kind = p_kind RETURNING last_seq INTO s;
  INSERT INTO public.document_numbers (org_id, kind, seq, number_text, allocated_by)
  VALUES (p_org, p_kind, s, prefix || lpad(s::text, 6, '0'), p_user)
  RETURNING * INTO r;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_document_number(p_id uuid, p_status text, p_ref uuid, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.document_numbers
     SET status = p_status, ref_id = COALESCE(p_ref, ref_id), note = COALESCE(p_note, note), status_changed_at = now()
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such document number %', p_id; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.allocate_document_number(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_document_number(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_document_number(uuid, text, uuid, text) TO service_role;

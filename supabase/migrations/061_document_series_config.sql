-- PROMPT 38 Phase A - numbering: one ledger, four document kinds, configurable prefix and padding, and a way to
-- CONTINUE a real org's existing paper sequence.
--
-- Why: Caplimo's real paper trail is already at INV-0027 (4-digit). Migration 058 hard-coded 'INV-' + 6 digits and only
-- two kinds. Decided (Bashir, 21 Sep 2026): one ledger; separate per-kind counters (INV-, RET-, CN-, REC-); the real
-- org continues at INV-0028 with 4-digit padding. The ledger rules are unchanged (never reused, voided keeps its
-- number, a gap is always a status). What changes is only what the number LOOKS like and where it starts.
--
-- The counter can only be moved FORWARD: configure_document_series refuses a start at or below any number already
-- in the ledger, so it can never cause a duplicate. Every change is logged (append-only).

-- ---------------------------------------------------------------- widen the kinds
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname, conrelid::regclass::text AS t FROM pg_constraint
     WHERE conrelid IN ('public.document_sequences'::regclass, 'public.document_numbers'::regclass)
       AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.t, c.conname);
  END LOOP;
END $$;
ALTER TABLE public.document_sequences
  ADD CONSTRAINT document_sequences_kind_check CHECK (kind IN ('invoice', 'retainer', 'credit_note', 'receipt'));
ALTER TABLE public.document_numbers
  ADD CONSTRAINT document_numbers_kind_check CHECK (kind IN ('invoice', 'retainer', 'credit_note', 'receipt'));

-- ---------------------------------------------------------------- per-sequence format
-- prefix NULL = the kind's default (INV-, RET-, CN-, REC-); pad = minimum digits (a longer number is never truncated).
ALTER TABLE public.document_sequences
  ADD COLUMN IF NOT EXISTS prefix text,
  ADD COLUMN IF NOT EXISTS pad smallint NOT NULL DEFAULT 6;
ALTER TABLE public.document_sequences
  ADD CONSTRAINT document_sequences_prefix_check CHECK (prefix IS NULL OR prefix ~ '^[A-Z]{2,5}-$'),
  ADD CONSTRAINT document_sequences_pad_check CHECK (pad BETWEEN 1 AND 10);

CREATE OR REPLACE FUNCTION public.document_number_text(p_kind text, p_prefix text, p_pad integer, p_seq integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_prefix, CASE p_kind WHEN 'invoice' THEN 'INV-' WHEN 'retainer' THEN 'RET-'
                                        WHEN 'credit_note' THEN 'CN-' WHEN 'receipt' THEN 'REC-' END)
         || CASE WHEN length(p_seq::text) >= p_pad THEN p_seq::text ELSE lpad(p_seq::text, p_pad, '0') END
$$;

-- ---------------------------------------------------------------- allocate (same locking as 058, new format)
CREATE OR REPLACE FUNCTION public.allocate_document_number(p_org uuid, p_kind text, p_user uuid)
RETURNS public.document_numbers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s integer;
  pre text;
  pd smallint;
  r public.document_numbers;
BEGIN
  IF p_kind NOT IN ('invoice', 'retainer', 'credit_note', 'receipt') THEN RAISE EXCEPTION 'Unknown document kind %', p_kind; END IF;
  INSERT INTO public.document_sequences (org_id, kind) VALUES (p_org, p_kind) ON CONFLICT DO NOTHING;
  UPDATE public.document_sequences SET last_seq = last_seq + 1 WHERE org_id = p_org AND kind = p_kind
    RETURNING last_seq, prefix, pad INTO s, pre, pd;
  INSERT INTO public.document_numbers (org_id, kind, seq, number_text, allocated_by)
  VALUES (p_org, p_kind, s, public.document_number_text(p_kind, pre, pd, s), p_user)
  RETURNING * INTO r;
  RETURN r;
END;
$$;

-- What the next number WOULD be, without allocating it (no lock, no increment). Staff may ask about their own org.
CREATE OR REPLACE FUNCTION public.peek_next_document_number(p_org uuid, p_kind text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s integer := 0; pre text; pd smallint := 6;
BEGIN
  IF NOT (p_org IN (SELECT user_org_ids()) OR is_superadmin() OR current_setting('role', true) = 'service_role'
          OR session_user IN ('postgres', 'supabase_admin')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  SELECT last_seq, prefix, pad INTO s, pre, pd FROM public.document_sequences WHERE org_id = p_org AND kind = p_kind;
  IF NOT FOUND THEN s := 0; pre := NULL; pd := 6; END IF;
  RETURN public.document_number_text(p_kind, pre, pd, s + 1);
END;
$$;

-- ---------------------------------------------------------------- configure (continue a paper sequence) + append-only log
CREATE TABLE IF NOT EXISTS public.document_series_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id),
  kind text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  session_user_name text NOT NULL DEFAULT session_user,
  old_last_seq integer, new_last_seq integer NOT NULL,
  old_prefix text, new_prefix text,
  old_pad smallint, new_pad smallint NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> '')
);
ALTER TABLE public.document_series_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_series_log_select ON public.document_series_log FOR SELECT USING (is_superadmin());
REVOKE ALL ON public.document_series_log FROM anon, authenticated, service_role;
GRANT SELECT ON public.document_series_log TO authenticated;
GRANT SELECT, INSERT ON public.document_series_log TO service_role;
CREATE OR REPLACE FUNCTION public.document_series_log_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'The document series log is append-only'; END;
$$;
CREATE TRIGGER document_series_log_immutable_trg BEFORE UPDATE OR DELETE OR TRUNCATE ON public.document_series_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.document_series_log_immutable();

-- p_next_seq is the number the NEXT allocation will get (e.g. 28 for INV-0028). It must be above every number already in
-- the ledger for this org and kind, so the counter can only move forward and a duplicate is impossible.
CREATE OR REPLACE FUNCTION public.configure_document_series(
  p_org uuid, p_kind text, p_prefix text, p_pad integer, p_next_seq integer, p_user uuid, p_reason text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_seq integer; old_pre text; old_pad smallint; hi integer;
BEGIN
  IF p_kind NOT IN ('invoice', 'retainer', 'credit_note', 'receipt') THEN RAISE EXCEPTION 'Unknown document kind %', p_kind; END IF;
  IF p_next_seq IS NULL OR p_next_seq < 1 THEN RAISE EXCEPTION 'The next number must be at least 1'; END IF;
  IF btrim(coalesce(p_reason, '')) = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  INSERT INTO public.document_sequences (org_id, kind) VALUES (p_org, p_kind) ON CONFLICT DO NOTHING;
  SELECT last_seq, prefix, pad INTO old_seq, old_pre, old_pad FROM public.document_sequences WHERE org_id = p_org AND kind = p_kind FOR UPDATE;
  SELECT coalesce(max(seq), 0) INTO hi FROM public.document_numbers WHERE org_id = p_org AND kind = p_kind;
  IF p_next_seq <= hi THEN
    RAISE EXCEPTION 'The next number (%) must be above every number already in the ledger (highest is %)', p_next_seq, hi;
  END IF;
  UPDATE public.document_sequences SET last_seq = p_next_seq - 1, prefix = p_prefix, pad = p_pad WHERE org_id = p_org AND kind = p_kind;
  INSERT INTO public.document_series_log (org_id, kind, changed_by, old_last_seq, new_last_seq, old_prefix, new_prefix, old_pad, new_pad, reason)
  VALUES (p_org, p_kind, p_user, old_seq, p_next_seq - 1, old_pre, p_prefix, old_pad, p_pad, p_reason);
  RETURN public.document_number_text(p_kind, p_prefix, p_pad, p_next_seq);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.allocate_document_number(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(uuid, text, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.configure_document_series(uuid, text, text, integer, integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_document_series(uuid, text, text, integer, integer, uuid, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.peek_next_document_number(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peek_next_document_number(uuid, text) TO authenticated, service_role;

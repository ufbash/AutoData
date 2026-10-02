-- PROMPT 44 Stage 1d - new organisations number deposit requests DEP-, not RET- (Bashir, 1 Oct 2026; the document is called a
-- "Deposit request" everywhere a person reads, and Prompt 43 set the real org to DEP-).
--
-- EXISTING organisations must not change. The default prefix lives in document_number_text(): a series row whose prefix is
-- NULL falls through to that default, so changing the default alone would silently re-prefix the NEXT deposit request of
-- every org that never set one explicitly (an org that has issued RET-0001 would jump to DEP-0002). So FIRST every existing
-- retainer series with no explicit prefix is PINNED to RET- through configure_document_series - the documented path,
-- which appends to the append-only document_series_log - with the counter unchanged; THEN the default changes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT org_id, pad, last_seq FROM public.document_sequences WHERE kind = 'retainer' AND prefix IS NULL LOOP
    PERFORM public.configure_document_series(r.org_id, 'retainer', 'RET-', r.pad, r.last_seq + 1, NULL,
      'Prompt 44 Stage 1d: pin this existing org to RET- before the default for NEW orgs becomes DEP-; counter unchanged');
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.document_number_text(p_kind text, p_prefix text, p_pad integer, p_seq integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_prefix, CASE p_kind WHEN 'invoice' THEN 'INV-' WHEN 'retainer' THEN 'DEP-'
                                        WHEN 'credit_note' THEN 'CN-' WHEN 'receipt' THEN 'REC-' END)
         || CASE WHEN length(p_seq::text) >= p_pad THEN p_seq::text ELSE lpad(p_seq::text, p_pad, '0') END
$$;

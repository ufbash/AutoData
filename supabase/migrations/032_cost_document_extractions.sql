-- PROMPT 22 Phase 2 — AI document extraction staging queue.
--
-- Not a rate table. cost_rates/trucking_rates/auction_fee_brackets all encode a human
-- decision (PROJECT_CHARTER.md S5.10: effective_from + a human-chosen source). An AI
-- extraction has made no decision yet - it is a draft a human has not looked at. So this
-- table deliberately carries neither effective_from nor source; those get set by a human,
-- on the confirmed row in the destination table, at the moment of confirmation (Phase 4).
-- Writing either column here would let a model-produced value pass itself off as a human
-- judgement, which is exactly the "generated price wearing a costume" this prompt's own
-- context section warns against (PROJECT_CHARTER.md S5.4).
--
-- The core design problem this schema solves: a field the source document simply does not
-- mention, and a field the model could not read (blurry photo, cut-off table, ambiguous
-- handwriting) are different facts, and confirming a row without knowing which one you're
-- looking at is how a wrong rate gets confirmed. extracted_rows is jsonb precisely so each
-- field can carry its own three-way status - 'read' | 'not_present' | 'unreadable' - rather
-- than collapsing both null cases into one column value indistinguishable from the other.
-- Shape per row (documented here, not enforced by the database - the review screen and the
-- extraction function are what actually produce/consume this shape):
--   { "fields": { "<column_name>": { "value": <any|null>, "status": "read"|"not_present"|"unreadable" }, ... } }
create table public.cost_document_extractions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,

  document_type text not null
    check (document_type in ('trucking_quote', 'shipping_quote', 'customs_quote', 'assessment_notice', 'other')),

  -- The original document, retained always (Phase 2's own rule: "An extraction that cannot
  -- be checked against its source is not reviewable"). Path into the private
  -- 'cost-documents' Storage bucket created below, not a public URL.
  storage_path text not null,
  original_filename text,
  mime_type text not null,

  -- What the model produced, in the per-field {value, status} shape described above. Defaults
  -- to an empty array so a failed extraction (see extraction_error) still has a well-formed,
  -- queryable value rather than null.
  extracted_rows jsonb not null default '[]'::jsonb,

  -- Set when the extraction call itself failed (bad response, API error, unreadable file
  -- format) - the document and the upload are still retained; nothing is lost, per Phase 3's
  -- "a failed extraction records the failure and keeps the document" rule. Distinct from a
  -- successful extraction whose fields are individually marked 'unreadable' - this column is
  -- for the whole attempt failing, not a per-field outcome.
  extraction_error text,

  extraction_status text not null default 'pending_review'
    check (extraction_status in ('pending_review', 'confirmed', 'rejected')),

  -- Set by the human reviewer at confirmation time only - which live rate table the confirmed
  -- rows were written into. Null while pending; must be set to confirm (see the shape
  -- constraint below). A rejected extraction never sets this - rejecting writes nowhere.
  target_rate_table text
    check (target_rate_table is null or target_rate_table in ('cost_rates', 'trucking_rates', 'auction_fee_brackets')),

  -- The actual rate-table row ids produced on confirm, for traceability back to the source
  -- document (Phase 4 checkpoint: a confirmed rate must be traceable to what produced it).
  confirmed_row_ids uuid[],

  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  -- Structurally enforces "nothing reaches a rate table without a human confirming it" and
  -- "a rejected extraction keeps the record" - pending has no reviewer yet; confirmed must
  -- name both a reviewer and where the rows went; rejected must name a reviewer but never a
  -- destination, since a reject writes nothing. Mirrors the shape-constraint pattern already
  -- used on auction_fee_brackets (migration 031)'s bid_method column.
  constraint cost_document_extractions_review_shape check (
    (extraction_status = 'pending_review' and reviewed_by is null and reviewed_at is null
       and target_rate_table is null and confirmed_row_ids is null)
    or (extraction_status = 'confirmed' and reviewed_by is not null and reviewed_at is not null
       and target_rate_table is not null)
    or (extraction_status = 'rejected' and reviewed_by is not null and reviewed_at is not null
       and target_rate_table is null and confirmed_row_ids is null)
  )
);

create index cost_document_extractions_org_id_idx on public.cost_document_extractions (org_id);
create index cost_document_extractions_status_idx
  on public.cost_document_extractions (org_id, extraction_status, created_at);

alter table public.cost_document_extractions enable row level security;

-- SCHEMA.md S12's exact pattern - identical shape to cost_rates/trucking_rates/
-- auction_fee_brackets. Write access (confirming/rejecting) is further restricted to
-- superadmin at the application layer in the review screen (Phase 4) and in the extraction
-- Edge Function itself (Phase 3, mirroring extract-vehicle-vision's own gate) - consistent
-- with how cost_rates' admin screen is gated (migration 029's own comment).
create policy cost_document_extractions_select on public.cost_document_extractions
  for select using (org_id in (select user_org_ids()) or is_superadmin());

create policy cost_document_extractions_insert on public.cost_document_extractions
  for insert with check (org_id in (select user_org_ids()) or is_superadmin());

create policy cost_document_extractions_update on public.cost_document_extractions
  for update using (org_id in (select user_org_ids()) or is_superadmin());

create policy cost_document_extractions_delete on public.cost_document_extractions
  for delete using (org_id in (select user_org_ids()) or is_superadmin());

-- Private Storage bucket for the uploaded source documents (PDFs, screenshots, photographs).
-- Same pattern as migration 014's 'vehicle-images' bucket, but gated to superadmin only
-- rather than any org member - these are internal cost/procurement documents (invoices,
-- vendor quotes), not vehicle photos, and the whole feature this table serves is
-- superadmin-only end to end (Phase 3's extraction function, Phase 4's review screen).
insert into storage.buckets (id, name, public)
values ('cost-documents', 'cost-documents', false)
on conflict (id) do nothing;

drop policy if exists "cost_documents_service_role" on storage.objects;
create policy "cost_documents_service_role" on storage.objects
  for all
  using (bucket_id = 'cost-documents' and auth.role() = 'service_role')
  with check (bucket_id = 'cost-documents' and auth.role() = 'service_role');

drop policy if exists "cost_documents_superadmin_select" on storage.objects;
create policy "cost_documents_superadmin_select" on storage.objects
  for select
  using (bucket_id = 'cost-documents' and is_superadmin());

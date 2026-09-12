-- PROMPT 29 Stage 6 — an optional, human-set pairing between a staged cost-document
-- extraction (migration 032) and the specific vehicle (public.assets row) it describes, plus
-- a place to record an assessment notice's declared/assessed value for later official-vs-
-- actual comparison. This migration only creates the place for this data to land — no duty
-- calculator, no automated comparison, no chassis-number-based extraction is built here.
--
-- Never model-inferred: extract-cost-document's prompt does not read or suggest a chassis
-- number today, and this migration does not change that. If a future extraction pass ever
-- reads a chassis/VIN off an assessment notice, it must only ever be surfaced to a human as a
-- candidate to search for and confirm — never written directly to asset_id. The shape
-- constraint below enforces that pairing always carries who paired it and when, so a
-- model-set pairing (which could never populate those the way a human action does through the
-- review screen) is structurally distinguishable from a real one.

alter table public.cost_document_extractions
  add column asset_id uuid references public.assets(id),
  add column asset_paired_by uuid references auth.users(id),
  add column asset_paired_at timestamptz,
  add column declared_value numeric,
  add column declared_value_currency text
    check (declared_value_currency is null or declared_value_currency in ('NGN', 'USD', 'EUR', 'GBP'));

alter table public.cost_document_extractions
  add constraint cost_document_extractions_asset_pairing_shape check (
    (asset_id is null and asset_paired_by is null and asset_paired_at is null)
    or (asset_id is not null and asset_paired_by is not null and asset_paired_at is not null)
  );

-- Declared value is specifically an assessment notice's own stated figure (Nigerian customs'
-- declared/assessed value), captured for comparison against what was actually paid - it does
-- not apply to a trucking/shipping/customs quote, so it may only be set alongside that
-- document_type. Currency and value are set together (a value with no currency cannot later be
-- compared against an actual-cost figure, since assessment notices are not USD-denominated).
alter table public.cost_document_extractions
  add constraint cost_document_extractions_declared_value_shape check (
    (declared_value is null and declared_value_currency is null)
    or (declared_value is not null and declared_value_currency is not null
        and document_type = 'assessment_notice')
  );

create index cost_document_extractions_asset_id_idx
  on public.cost_document_extractions (asset_id) where asset_id is not null;

-- PROMPT 20 Phase 2 — trucking_rates, a second ledger at a finer grain than cost_rates.
--
-- Deliberately NOT a reshaping of cost_rates (migration 029): the real vendor data prices
-- each auction yard to each destination port individually - Tucson IAAI to Texas is $825
-- while Phoenix IAAI to Texas is $925, same state, same vendor, same port. Collapsing that
-- into a state tier (cost_rates' inland_trucking rows) would discard exactly the information
-- that makes this data worth having. cost_rates is untouched by this migration.
--
-- Grain: one row per (vendor, auction platform, yard, destination port, shipping method),
-- dated per PROJECT_CHARTER.md S5.10 - same effective_from/effective_to/source shape as
-- cost_rates, same three source values. Never edited in place: a new price list is new rows,
-- a superseded row gets an effective_to (Phase 3's importer, not this migration, owns that
-- logic - no seeded data here).
create table public.trucking_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,

  vendor text not null,

  -- The four auction networks the vendor's rate sheets are organised by (one sheet each in
  -- the source file: COPART, IAAI, MANHEIM, ADESSA). This is a distinct dimension from
  -- sightings.source_platform - bid.cars is a resale aggregator, not a yard network, so a
  -- bidcars-sourced sighting's real auction_platform for matching purposes is read from
  -- sightings.source_auction_platform, never from source_platform itself (Phase 5).
  auction_platform text not null check (auction_platform in ('copart', 'iaai', 'manheim', 'adesa')),

  -- Yard identity. city/state are the match keys (Phase 5); street is carried because the
  -- source file has it, not because matching depends on it - nullable since it is not
  -- guaranteed present for every row a future vendor file might supply.
  yard_state text not null,
  yard_city text not null,
  yard_street text,

  -- Raw at capture, classify at read (PROJECT_CHARTER.md S5.8): the vendor file's port names
  -- are inconsistent by construction (SAVANNAH / JACKSONVILLE YARD / JACKSONVILLE / "TEXAS "
  -- with trailing space / "LOS ANGELOS" sic / "LOS ANGELES " / CALIFORNIA / OAKLAND).
  -- destination_port_raw preserves exactly what the vendor sent - LOS ANGELOS is evidence of
  -- what they actually wrote, not a typo to silently correct away. destination_port_normalized
  -- is the trimmed/cased/corrected form the importer computes for matching.
  destination_port_raw text not null,
  destination_port_normalized text not null,

  shipping_method text not null check (shipping_method in ('container', 'roro')),
  price numeric not null check (price >= 0),

  source text not null check (source in ('official_tariff', 'agent_quote', 'actual_paid')),

  -- Every rate has a known start; only "still current" is a real null, never an unset default.
  effective_from date not null,
  effective_to date,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  constraint trucking_rates_effective_range check (effective_to is null or effective_to >= effective_from)
);

-- Supports Phase 4's two views (internal: all vendors for a yard-port-method; estimator:
-- aggregate the same, filtered to effective_to IS NULL) and Phase 5's platform-first,
-- then city/state matcher.
create index trucking_rates_org_id_idx on public.trucking_rates (org_id);
create index trucking_rates_match_idx
  on public.trucking_rates (org_id, auction_platform, yard_state, yard_city, effective_to);
create index trucking_rates_port_idx
  on public.trucking_rates (org_id, destination_port_normalized, shipping_method, effective_to);

alter table public.trucking_rates enable row level security;

-- SCHEMA.md S12's exact pattern - identical shape to cost_rates' policies.
create policy trucking_rates_select on public.trucking_rates
  for select using (org_id in (select user_org_ids()) or is_superadmin());

create policy trucking_rates_insert on public.trucking_rates
  for insert with check (org_id in (select user_org_ids()) or is_superadmin());

create policy trucking_rates_update on public.trucking_rates
  for update using (org_id in (select user_org_ids()) or is_superadmin());

create policy trucking_rates_delete on public.trucking_rates
  for delete using (org_id in (select user_org_ids()) or is_superadmin());

-- PROMPT 19 Phase 5 — C1: the cost_rates table.
--
-- PROJECT_CHARTER.md S5.10 (binding shape): effective_from/effective_to + a source constrained
-- to ('official_tariff' | 'agent_quote' | 'actual_paid'), edited through an admin screen
-- without a deploy, so historical quotes stay explicable. Rates are NEVER edited in place - a
-- changed rate is a new row with a new effective_from; the superseded row gets an effective_to.
--
-- What a rate applies to (PROMPT_19 Checkpoint 5 reading, DECISIONS.md S3 / MASTER_PLAN.md
-- Part VII): C2's duty calculation needs three independent dimensions, all LOCKED today -
-- US inland trucking (varies by pickup-state tier), ocean freight (varies by shipping method),
-- and the six-component duty stack (each with its own percentage AND basis - CIF, CIF-plus-
-- prior-components, or the Import Duty line itself). C3's grouped display additionally needs a
-- standalone service fee. Nothing in the locked data varies by vehicle class - the value-
-- dependent declared-CIF ratio (S3.2, "three points cannot fit a curve") is C2's own future
-- calibration problem once 10+ assessment notices exist, not a static rate to guess a column
-- shape for today.
--
-- rate_value / rate_value_max (max nullable) hold a single point value or a range - the
-- project's own honesty doctrine (MASTER_PLAN.md Part VII C3: "widen the band rather than
-- faking precision") argues against forcing an observed range like "$200-500" into one
-- averaged number.
create table public.cost_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,

  cost_category text not null
    check (cost_category in ('inland_trucking', 'ocean_freight', 'duty_component', 'service_fee')),

  -- The specific thing within the category this rate is for - e.g. "Tier 1 (FL, MA, RI, NJ,
  -- MD, CT, DE)", "RoRo", "Import Duty", "Standard brokerage fee". Free text rather than a
  -- rigid enum: the state groupings and duty component names are data (already observed to
  -- exist and be stable, per DECISIONS.md S3), not vocabulary the schema should hardcode.
  label text not null,

  -- Only meaningful for duty_component rows - what the percentage is computed against. The six
  -- known components split three ways: most are CIF-based, Surcharge is Import-Duty-based, VAT
  -- is CIF-plus-everything-above-based (DECISIONS.md S3's stack table).
  basis text check (basis is null or basis in ('cif', 'cif_plus_prior', 'import_duty')),

  rate_unit text not null check (rate_unit in ('percent', 'usd')),
  rate_value numeric not null,
  rate_value_max numeric,

  source text not null check (source in ('official_tariff', 'agent_quote', 'actual_paid')),

  -- Every rate has a known start; only "still current" is a real null, never an unset default.
  effective_from date not null,
  effective_to date,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  constraint cost_rates_effective_range check (effective_to is null or effective_to >= effective_from),
  constraint cost_rates_value_range check (rate_value_max is null or rate_value_max >= rate_value)
);

create index cost_rates_org_id_idx on public.cost_rates (org_id);
create index cost_rates_category_idx on public.cost_rates (org_id, cost_category, effective_to);

alter table public.cost_rates enable row level security;

-- SCHEMA.md S12's exact pattern - the same shape as client_briefs/research_run_listings.
-- Write access is further restricted to superadmin in the admin screen itself (Phase 6),
-- consistent with how other superadmin-only actions in this codebase are gated at the
-- application layer rather than by a narrower RLS policy.
create policy cost_rates_select on public.cost_rates
  for select using (org_id in (select user_org_ids()) or is_superadmin());

create policy cost_rates_insert on public.cost_rates
  for insert with check (org_id in (select user_org_ids()) or is_superadmin());

create policy cost_rates_update on public.cost_rates
  for update using (org_id in (select user_org_ids()) or is_superadmin());

create policy cost_rates_delete on public.cost_rates
  for delete using (org_id in (select user_org_ids()) or is_superadmin());

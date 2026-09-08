-- PROMPT 21 Phase 2 — auction buyer fees.
--
-- Two shapes of fee, two homes. Flat per-unit fees (Copart's Environmental Fee, Gate Fee,
-- Title Pickup Fee, Late Payment Fee - each a single dollar figure regardless of sale price)
-- fit cost_rates' existing shape exactly, once 'auction_fee' is added as a cost_category -
-- deliberately its own category, not 'service_fee', since service_fee already means Caplimo's
-- own brokerage fee to the client, a different thing entirely from what Copart/IAAI charge us.
--
-- The buyer fee itself and the virtual/internet bid fee do NOT fit cost_rates - each is an
-- entire bracket table (~40 rows) keyed on final sale price, not a single rate. Forcing a
-- bracket table into cost_rates' one-row-one-figure shape would either lose every bracket but
-- one or require a jsonb blob nothing else in this schema does. auction_fee_brackets is the
-- smallest schema that actually holds this shape: one row per bracket.
--
-- Confirmed against three real Copart invoices (PROMPT_21 Phase 1 cross-check), which revealed
-- something the published pages alone did not make obvious: two different Copart member
-- accounts can be on two structurally different fee schedules (standard Non-Licensed vs.
-- High-Volume Licensed), and "Secured" vs "Unsecured" tracks the member ACCOUNT (almost
-- certainly whether a security deposit is on file), not a choice made per transaction - see
-- docs/SOLVED.md topic 18. member_account is therefore a first-class dimension here, not an
-- afterthought - two rows can share every other column and differ only in which account they
-- price, and that is not redundancy, it is the fact the invoices actually showed.

alter table public.cost_rates
  drop constraint cost_rates_cost_category_check,
  add constraint cost_rates_cost_category_check
    check (cost_category in ('inland_trucking', 'ocean_freight', 'duty_component', 'service_fee', 'auction_fee'));

create table public.auction_fee_brackets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,

  auction_platform text not null check (auction_platform in ('copart', 'iaai')),

  -- Which buyer account/tier this schedule belongs to. Free text, like trucking_rates.vendor -
  -- there is no fixed set of accounts to enumerate, and a new one is a new value here, not a
  -- migration. e.g. "White Nexus Ltd (Copart High-Volume Licensed)".
  member_account text not null,

  -- Two independently-bracketed fee types share this table's shape - the buyer fee itself, and
  -- the separate charge for bidding remotely rather than in person.
  fee_type text not null check (fee_type in ('buyer_fee', 'bid_fee')),

  title_status text not null check (title_status in ('clean', 'non_clean')),

  -- Tracks the member account's standing classification (deposit on file or not), confirmed
  -- NOT to vary by which payment method a given purchase happens to use - docs/SOLVED.md
  -- topic 18. Never surfaced as a per-listing or per-purchase choice.
  payment_tier text not null check (payment_tier in ('secured', 'unsecured')),

  -- Only meaningful for fee_type='bid_fee' - which remote-bidding method. Copart calls these
  -- Pre-Bid/Live Bid, IAAI calls them Proxy/Live Online; normalised to one vocabulary here
  -- since they mean the same two things.
  bid_method text check (bid_method is null or bid_method in ('proxy', 'live')),

  bracket_min numeric not null,
  bracket_max numeric, -- null = open-ended (the terminal "$15,000+" bracket)

  fee_unit text not null check (fee_unit in ('usd', 'percent')),
  fee_value numeric not null,

  source text not null check (source in ('official_tariff', 'agent_quote', 'actual_paid')),

  effective_from date not null,
  effective_to date,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  constraint auction_fee_brackets_effective_range check (effective_to is null or effective_to >= effective_from),
  constraint auction_fee_brackets_bracket_range check (bracket_max is null or bracket_max >= bracket_min),
  constraint auction_fee_brackets_bid_method_shape check (
    (fee_type = 'bid_fee' and bid_method is not null) or (fee_type = 'buyer_fee' and bid_method is null)
  )
);

create index auction_fee_brackets_org_id_idx on public.auction_fee_brackets (org_id);
create index auction_fee_brackets_lookup_idx
  on public.auction_fee_brackets (org_id, auction_platform, member_account, fee_type, title_status, payment_tier, effective_to);

alter table public.auction_fee_brackets enable row level security;

-- SCHEMA.md S12's exact pattern - identical shape to cost_rates/trucking_rates.
create policy auction_fee_brackets_select on public.auction_fee_brackets
  for select using (org_id in (select user_org_ids()) or is_superadmin());

create policy auction_fee_brackets_insert on public.auction_fee_brackets
  for insert with check (org_id in (select user_org_ids()) or is_superadmin());

create policy auction_fee_brackets_update on public.auction_fee_brackets
  for update using (org_id in (select user_org_ids()) or is_superadmin());

create policy auction_fee_brackets_delete on public.auction_fee_brackets
  for delete using (org_id in (select user_org_ids()) or is_superadmin());

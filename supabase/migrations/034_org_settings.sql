-- PROMPT 29 Stage 4 — payment tier as configuration, not a constant.
--
-- bidHeadroomService.ts:115 hardcoded PAYMENT_TIER = 'unsecured' as const. Correct today - all
-- three real Copart invoices priced Unsecured - but Bashir has $400 on deposit and is seeking
-- a direct answer from Copart on whether that qualifies him as Secured. If it turns out he
-- does, that is worth roughly $375/vehicle (PLAN_TRACKER.md debt #43), and it should be a
-- settings change, not a code change and redeploy.
--
-- One row per org (not one row per member_account): today there is exactly one real member
-- account in active use (DEFAULT_MEMBER_ACCOUNT in bidHeadroomService.ts, itself still a
-- constant - out of scope here, this stage only moves the payment tier). A per-org setting is
-- the minimal structure that actually closes the gap Bashir described; a per-account table
-- would be building for a multi-account scenario nobody has asked for yet.

create table public.org_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  copart_payment_tier text not null default 'unsecured'
    check (copart_payment_tier in ('secured', 'unsecured')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

drop trigger if exists set_org_settings_updated_at on public.org_settings;
create trigger set_org_settings_updated_at
before update on public.org_settings
for each row execute function public.handle_updated_at();

alter table public.org_settings enable row level security;

-- Same RLS shape as cost_rates/auction_fee_brackets (migrations 029/031): any org member or
-- superadmin can read and write at this layer. "Editable by superadmin" (the actual
-- requirement) is enforced at the application layer in the settings UI, mirroring exactly how
-- cost_rates' own admin screen and cost_document_extractions' review screen already gate
-- writes to superadmin without a stricter RLS policy underneath.
create policy org_settings_select on public.org_settings
  for select using (org_id in (select user_org_ids()) or is_superadmin());

create policy org_settings_insert on public.org_settings
  for insert with check (org_id in (select user_org_ids()) or is_superadmin());

create policy org_settings_update on public.org_settings
  for update using (org_id in (select user_org_ids()) or is_superadmin());

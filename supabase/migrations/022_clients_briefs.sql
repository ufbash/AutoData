-- Table: clients
create table if not exists public.clients (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organizations(id) on delete cascade,
    full_name text not null,
    email text,
    phone text,
    preferred_contact text check (preferred_contact in ('phone', 'whatsapp', 'email')),
    assigned_agent text,
    notes text,
    created_at timestamptz default now(),
    created_by uuid references auth.users(id),
    deleted_at timestamptz
);

-- Table: client_briefs
create table if not exists public.client_briefs (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    org_id uuid not null references public.organizations(id) on delete cascade,
    make text,
    model text,
    trim text,
    year_min integer,
    year_max integer,
    max_mileage integer,
    transmission text check (transmission in ('automatic', 'manual', 'either')),
    fuel_type text check (fuel_type in ('petrol', 'diesel', 'hybrid', 'electric', 'either')),
    condition_required text check (condition_required in ('run_and_drive', 'starts_needs_work', 'non_running', 'salvage_only', 'either')),
    titles_accepted text[],
    colour_preference text,
    interior_preference text,
    quantity integer default 1,
    max_budget_usd numeric,
    max_bid_usd numeric,
    additional_notes text,
    created_at timestamptz default now(),
    created_by uuid references auth.users(id)
);

-- Add to research_runs
alter table public.research_runs 
add column if not exists client_id uuid references public.clients(id),
add column if not exists client_brief_id uuid references public.client_briefs(id);

-- Indexes
create index if not exists clients_org_id_idx on public.clients(org_id);
create index if not exists client_briefs_org_id_idx on public.client_briefs(org_id);
create index if not exists client_briefs_client_id_idx on public.client_briefs(client_id);
create index if not exists research_runs_client_id_idx on public.research_runs(client_id);
create index if not exists research_runs_client_brief_id_idx on public.research_runs(client_brief_id);

-- RLS
alter table public.clients enable row level security;
alter table public.client_briefs enable row level security;

-- clients policies
create policy clients_select on public.clients for select using (org_id in (select user_org_ids()) or is_superadmin());
create policy clients_insert on public.clients for insert with check (org_id in (select user_org_ids()) or is_superadmin());
create policy clients_update on public.clients for update using (org_id in (select user_org_ids()) or is_superadmin());
create policy clients_delete on public.clients for delete using (org_id in (select user_org_ids()) or is_superadmin());

-- client_briefs policies
create policy client_briefs_select on public.client_briefs for select using (org_id in (select user_org_ids()) or is_superadmin());
create policy client_briefs_insert on public.client_briefs for insert with check (org_id in (select user_org_ids()) or is_superadmin());
create policy client_briefs_update on public.client_briefs for update using (org_id in (select user_org_ids()) or is_superadmin());
create policy client_briefs_delete on public.client_briefs for delete using (org_id in (select user_org_ids()) or is_superadmin());

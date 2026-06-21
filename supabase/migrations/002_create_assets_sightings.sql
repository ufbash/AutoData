-- Enable pgcrypto for hashing
create extension if not exists pgcrypto;

-- Enums
create type origin_status_enum as enum ('Brand_New', 'Foreign_Used', 'Nigerian_Used', 'Auction_US', 'Auction_EU', 'Unknown');
create type asset_status_enum as enum ('ACTIVE', 'INACTIVE_MONITORING', 'PRESUMED_SOLD', 'VERIFIED_SOLD');
create type source_platform_enum as enum ('copart', 'iaai', 'bidcars', 'bidfax', 'instagram', 'manual');
create type sighting_source_type_enum as enum ('research_capture', 'sniper_listing', 'manual_entry');
create type research_run_status_enum as enum ('draft', 'active', 'completed', 'archived');

-- Table: assets
create table if not exists public.assets (
    id uuid primary key default gen_random_uuid(),
    fingerprint_hash text unique not null,
    vin text unique,
    make text not null,
    model text not null,
    year integer,
    trim text,
    exterior_color text,
    interior_color text,
    origin_status origin_status_enum not null default 'Unknown',
    status asset_status_enum not null default 'ACTIVE',
    historical_decay_timer_days integer,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_assets_fingerprint_hash on public.assets using btree (fingerprint_hash);
create index if not exists idx_assets_vin on public.assets using btree (vin);
create index if not exists idx_assets_make_model_year on public.assets using btree (make, model, year);
create index if not exists idx_assets_status on public.assets using btree (status);

-- Table: sightings
create table if not exists public.sightings (
    id uuid primary key default gen_random_uuid(),
    asset_id uuid references public.assets(id) on delete cascade not null,
    source_platform source_platform_enum not null,
    source_type sighting_source_type_enum not null,
    source_url text,
    lot_number text,
    dealer_source text,
    dealer_tier integer check (dealer_tier in (1,2,3)),
    listed_price numeric,
    listed_currency text default 'USD',
    mileage_miles integer,
    damage_type text,
    title_type text,
    location text,
    image_urls jsonb default '[]'::jsonb,
    confidence_score integer check (confidence_score between 0 and 100),
    raw_payload jsonb,
    captured_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create index if not exists idx_sightings_asset_id on public.sightings using btree (asset_id);
create index if not exists idx_sightings_source_platform on public.sightings using btree (source_platform);
create index if not exists idx_sightings_lot_number on public.sightings using btree (lot_number);
create index if not exists idx_sightings_captured_at on public.sightings using btree (captured_at);

-- Table: research_runs
create table if not exists public.research_runs (
    id uuid primary key default gen_random_uuid(),
    client_name text not null,
    target_spec jsonb,
    sheet_url text,
    drive_folder_url text,
    status research_run_status_enum not null default 'draft',
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_research_runs_client_name on public.research_runs using btree (client_name);
create index if not exists idx_research_runs_status on public.research_runs using btree (status);
create index if not exists idx_research_runs_created_at on public.research_runs using btree (created_at);

-- Table: research_run_listings
create table if not exists public.research_run_listings (
    id uuid primary key default gen_random_uuid(),
    run_id uuid references public.research_runs(id) on delete cascade not null,
    sighting_id uuid references public.sightings(id) on delete cascade not null,
    position integer,
    image_order jsonb,
    notes text,
    created_at timestamptz not null default now(),
    unique(run_id, sighting_id)
);

-- Function: generate_fingerprint
create or replace function public.generate_fingerprint(
    p_vin text,
    p_make text,
    p_model text,
    p_year integer,
    p_trim text,
    p_exterior_color text,
    p_interior_color text,
    p_origin_status text
) returns text as $$
begin
    if p_vin is not null and length(p_vin) >= 11 then
        return encode(digest('vin:' || upper(p_vin), 'sha256'), 'hex');
    else
        return encode(digest(lower(
            coalesce(p_make, '') || '|' || 
            coalesce(p_model, '') || '|' || 
            coalesce(p_year::text, '') || '|' || 
            coalesce(p_trim, '') || '|' || 
            coalesce(p_exterior_color, '') || '|' || 
            coalesce(p_interior_color, '') || '|' || 
            coalesce(p_origin_status, '')
        ), 'sha256'), 'hex');
    end if;
end;
$$ language plpgsql immutable;


-- Trigger: bump_asset_last_seen
create or replace function public.fn_bump_asset_last_seen() returns trigger as $$
begin
    update public.assets set last_seen_at = now() where id = NEW.asset_id;
    return NEW;
end;
$$ language plpgsql;

create trigger bump_asset_last_seen_trg
after insert on public.sightings
for each row execute function public.fn_bump_asset_last_seen();


-- Trigger: auto_update_updated_at
create or replace function public.fn_set_updated_at() returns trigger as $$
begin
    NEW.updated_at = now();
    return NEW;
end;
$$ language plpgsql;

create trigger auto_update_assets_updated_at_trg
before update on public.assets
for each row execute function public.fn_set_updated_at();

create trigger auto_update_research_runs_updated_at_trg
before update on public.research_runs
for each row execute function public.fn_set_updated_at();

-- RLS
alter table public.assets enable row level security;
create policy select_assets_auth on public.assets for select to authenticated using (true);
create policy all_assets_service on public.assets for all to service_role using (true) with check (true);

alter table public.sightings enable row level security;
create policy select_sightings_auth on public.sightings for select to authenticated using (true);
create policy all_sightings_service on public.sightings for all to service_role using (true) with check (true);

alter table public.research_runs enable row level security;
create policy select_research_runs_auth on public.research_runs for select to authenticated using (true);
create policy all_research_runs_service on public.research_runs for all to service_role using (true) with check (true);

alter table public.research_run_listings enable row level security;
create policy select_research_run_listings_auth on public.research_run_listings for select to authenticated using (true);
create policy all_research_run_listings_service on public.research_run_listings for all to service_role using (true) with check (true);

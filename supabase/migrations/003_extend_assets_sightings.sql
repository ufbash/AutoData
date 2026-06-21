-- Extend assets
ALTER TABLE public.assets 
ADD COLUMN IF NOT EXISTS body_style text,
ADD COLUMN IF NOT EXISTS cylinders integer,
ADD COLUMN IF NOT EXISTS engine_type text,
ADD COLUMN IF NOT EXISTS transmission text,
ADD COLUMN IF NOT EXISTS fuel text,
ADD COLUMN IF NOT EXISTS drivetrain text;

-- Extend sightings
ALTER TABLE public.sightings
ADD COLUMN IF NOT EXISTS estimated_retail_value_usd numeric,
ADD COLUMN IF NOT EXISTS current_bid_usd numeric,
ADD COLUMN IF NOT EXISTS seller text,
ADD COLUMN IF NOT EXISTS sale_date text,
ADD COLUMN IF NOT EXISTS has_key text,
ADD COLUMN IF NOT EXISTS runs_and_drives boolean,
ADD COLUMN IF NOT EXISTS engine_starts boolean,
ADD COLUMN IF NOT EXISTS transmission_engages boolean,
ADD COLUMN IF NOT EXISTS highlights text,
ADD COLUMN IF NOT EXISTS secondary_damage text;

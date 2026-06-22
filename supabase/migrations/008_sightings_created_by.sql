-- Migration: 008_sightings_created_by.sql
ALTER TABLE public.sightings ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

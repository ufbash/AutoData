ALTER TABLE public.research_runs
ADD COLUMN critical_override_reason text DEFAULT NULL,
ADD COLUMN critical_override_by uuid REFERENCES auth.users(id) DEFAULT NULL,
ADD COLUMN critical_override_at timestamptz DEFAULT NULL;

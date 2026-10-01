-- PROMPT 43 Stage 2 - "an already-shared run must warn staff when a rule newly flags a listing on it".
-- To know what is NEW, the app needs the set of unresolved flags that existed (and were reviewed/overridden) at the
-- moment sharing was switched on. It is stored on research_runs_staff_notes: a staff-only table with NO client policy
-- of any kind (migration 074), so nothing about a run's flags can ever reach a client or the public page - the same
-- reason run notes live there. Additive only: two nullable columns; no existing row or policy changes.
ALTER TABLE public.research_runs_staff_notes
  ADD COLUMN IF NOT EXISTS shared_flag_keys jsonb,
  ADD COLUMN IF NOT EXISTS shared_flags_at timestamptz;

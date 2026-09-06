-- The commitment fee gates a research run - one per vehicle, per purchase - not the client
-- relationship as a whole. clients.deposit_received_at marked a client as "paid" forever,
-- meaning a second, unrelated vehicle for the same client started its research run free.
-- Moves the marker to client_briefs, matching the existing plain-uuid-reference convention.
ALTER TABLE public.client_briefs
  ADD COLUMN deposit_received_at timestamptz DEFAULT NULL,
  ADD COLUMN deposit_recorded_by uuid REFERENCES auth.users(id) DEFAULT NULL;

-- Data move: a client's existing deposit mark carries real meaning and must not be lost, but
-- copying it onto every one of their briefs would just re-create the same over-crediting bug
-- one level down. Allocate it only to briefs that already have a non-deleted run - concrete
-- evidence the deposit was actually drawn on for that vehicle under the old, less granular
-- model. A brief with no run yet gets nothing; going forward it needs its own deposit marked
-- before a run can start (Phase 2's re-pointed gate).
UPDATE public.client_briefs cb
SET deposit_received_at = c.deposit_received_at,
    deposit_recorded_by = c.deposit_recorded_by
FROM public.clients c
WHERE cb.client_id = c.id
  AND c.deposit_received_at IS NOT NULL
  AND cb.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.research_runs r
    WHERE r.client_brief_id = cb.id AND r.deleted_at IS NULL
  );

-- clients.deposit_received_at / deposit_recorded_by are deliberately NOT dropped here - kept
-- as a fallback with no staging environment to test a drop against. Dropping them is a
-- separate, later step once this move is proven in production (PLAN_TRACKER.md debt).

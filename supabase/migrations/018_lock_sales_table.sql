ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies. With RLS on and zero policies, no anon or
-- authenticated role can read or write. service_role still bypasses,
-- so the monthly backup continues to work.

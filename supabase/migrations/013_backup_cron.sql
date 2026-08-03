CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'autodata-monthly-backup',
  '0 3 1 * *',
  $$
  SELECT net.http_post(
    url := 'https://xrotvpuainpfdulhfhtt.supabase.co/functions/v1/monthly-backup',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'X-Backup-Secret', current_setting('app.backup_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

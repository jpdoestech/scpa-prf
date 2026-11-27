-- Run after deploying sync-prf. Create secrets prf_project_url and prf_sync_secret
-- in Supabase Vault before running the schedule. Use the same secret as PRF_SYNC_SECRET.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('sync-prf-transactions', '* * * * *', $job$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'prf_project_url'), '/')
      || '/functions/v1/sync-prf',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-prf-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'prf_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);

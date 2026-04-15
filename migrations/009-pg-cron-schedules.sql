-- ════════════════════════════════════════════════════════════════════
-- TOURFEED SCHEDULER — Supabase pg_cron + pg_net
-- ════════════════════════════════════════════════════════════════════
-- Replaces GitHub Actions / cron-job.org / Netlify scheduled functions.
-- pg_cron runs from inside Postgres on a reserved worker, pg_net makes
-- async fire-and-forget HTTP calls. Zero drift, no external service.
--
-- ONE-TIME SETUP BEFORE RUNNING THIS FILE:
--   1. Supabase Dashboard → Database → Extensions
--   2. Enable `pg_cron`  (toggle on)
--   3. Enable `pg_net`   (toggle on)
--   4. Then paste this file into SQL Editor and run it.
--
-- This migration is idempotent: re-running it unschedules existing
-- tf_* jobs before re-creating them, so you can edit schedules here
-- and just paste-run again.
-- ════════════════════════════════════════════════════════════════════

-- Ensure extensions exist (no-op if already enabled via dashboard)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotency: drop all tf_* jobs first so re-running this file is safe
DO $$
DECLARE
  job_name TEXT;
BEGIN
  FOR job_name IN
    SELECT jobname FROM cron.job WHERE jobname LIKE 'tf_%'
  LOOP
    PERFORM cron.unschedule(job_name);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- Helper: fire an async GET at a Netlify function URL.
-- pg_net.http_get returns a request_id immediately; the actual HTTP
-- call happens in a background worker. We never wait for the response,
-- so even 60-second functions don't block anything.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tf_ping_function(fn_name TEXT)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT net.http_get(
    url := 'https://tourfeed.co/.netlify/functions/' || fn_name,
    timeout_milliseconds := 90000
  );
$$;

-- ════════════════════════════════════════════════════════════════════
-- SCHEDULES
-- ════════════════════════════════════════════════════════════════════

-- Every 5 min — live data + publishing pipeline
SELECT cron.schedule('tf_fetch_scores',     '*/5 * * * *',  $$SELECT public.tf_ping_function('fetch-scores-v2')$$);
SELECT cron.schedule('tf_fetch_pga',        '*/5 * * * *',  $$SELECT public.tf_ping_function('fetch-pga-graphql')$$);
SELECT cron.schedule('tf_publish_approved', '*/5 * * * *',  $$SELECT public.tf_ping_function('publish-approved')$$);

-- Every 15 min — content generation pipeline (stagger by 2 min to spread API load)
SELECT cron.schedule('tf_news_detector',    '2-59/15 * * * *', $$SELECT public.tf_ping_function('news-detector')$$);
SELECT cron.schedule('tf_content_ctrl',     '7-59/15 * * * *', $$SELECT public.tf_ping_function('content-controller')$$);

-- Every 6 hours — odds refresh
SELECT cron.schedule('tf_fetch_odds',       '17 */6 * * *',  $$SELECT public.tf_ping_function('fetch-odds')$$);

-- Daily — batches (all UTC)
SELECT cron.schedule('tf_generate_picks',   '0 5 * * *',    $$SELECT public.tf_ping_function('generate-picks')$$);
SELECT cron.schedule('tf_generate_tweets',  '0 10 * * *',   $$SELECT public.tf_ping_function('generate-tweets')$$);
SELECT cron.schedule('tf_post_reddit',      '0 12 * * *',   $$SELECT public.tf_ping_function('post-reddit')$$);

-- ════════════════════════════════════════════════════════════════════
-- VERIFY
-- ════════════════════════════════════════════════════════════════════
-- After running this file, check installed jobs with:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'tf_%' ORDER BY jobname;
--
-- Check recent job runs with:
--   SELECT jobname, status, start_time, end_time
--   FROM cron.job_run_details
--   JOIN cron.job USING (jobid)
--   WHERE jobname LIKE 'tf_%'
--   ORDER BY start_time DESC
--   LIMIT 20;
--
-- Check that pg_net is actually making the HTTP requests:
--   SELECT id, created, url, status_code, error_msg
--   FROM net._http_response
--   ORDER BY created DESC
--   LIMIT 20;
-- ════════════════════════════════════════════════════════════════════

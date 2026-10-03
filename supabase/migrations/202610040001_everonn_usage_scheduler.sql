-- Optional scheduler, applied by scripts/configure-usage-scheduler.ts only.
-- Requires pg_cron, pg_net and the existing Supabase Vault extension.
-- No secret literals, global settings, existing application tables or jobs.
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('everonn-usage-scheduler-v1', 0));

DO $guard$
BEGIN
  IF pg_catalog.to_regclass('everonn_usage.schema_migrations') IS NULL
     OR NOT EXISTS (SELECT 1 FROM everonn_usage.schema_migrations WHERE version = '202610030001' AND component = 'everonn-usage') THEN
    RAISE EXCEPTION 'Apply the recognized EverOnn usage migration first';
  END IF;
  IF pg_catalog.to_regclass('cron.job') IS NULL
     OR pg_catalog.to_regclass('net.http_request_queue') IS NULL
     OR pg_catalog.to_regclass('vault.decrypted_secrets') IS NULL
     OR pg_catalog.to_regprocedure('extensions.hmac(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Supabase Cron, pg_net, pgcrypto and Vault must be enabled first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM everonn_usage.schema_migrations WHERE version = '202610040001' AND component = 'everonn-usage-scheduler')
     AND (pg_catalog.to_regclass('everonn_usage.worker_requests') IS NOT NULL
          OR pg_catalog.to_regprocedure('everonn_usage.invoke_usage_worker()') IS NOT NULL) THEN
    RAISE EXCEPTION 'Unrecognized scheduler objects; setup stopped';
  END IF;
END;
$guard$;

CREATE TABLE IF NOT EXISTS everonn_usage.worker_requests (
  request_id bigint PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE everonn_usage.worker_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE everonn_usage.worker_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION everonn_usage.invoke_usage_worker()
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  configuration jsonb;
  application_url text;
  cron_secret text;
  request_id bigint;
  timestamp text;
  nonce text;
  signature text;
BEGIN
  -- Never overlap a request still awaiting its 65-second HTTP deadline.
  IF EXISTS (
    SELECT 1 FROM everonn_usage.worker_requests r
    WHERE r.requested_at > pg_catalog.clock_timestamp() - interval '90 seconds'
      AND NOT EXISTS (SELECT 1 FROM net._http_response h WHERE h.id = r.request_id)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret::jsonb INTO configuration
  FROM vault.decrypted_secrets
  WHERE name = 'everonn_usage_worker_v1' AND description = 'EverOnn usage scheduler v1';
  application_url := configuration ->> 'applicationUrl';
  cron_secret := configuration ->> 'cronSecret';
  IF application_url IS NULL OR application_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$'
     OR cron_secret IS NULL OR pg_catalog.length(cron_secret) NOT BETWEEN 32 AND 256
     OR cron_secret !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'EverOnn worker configuration is missing or invalid';
  END IF;

  -- Retention applies only to our request IDs and exact scheduler command.
  DELETE FROM everonn_usage.worker_requests WHERE requested_at < pg_catalog.now() - interval '7 days';
  DELETE FROM everonn_usage.usage_records
  WHERE key LIKE 'system/job-auth/%' AND updated_at < pg_catalog.now() - interval '7 days';
  DELETE FROM cron.job_run_details d
  USING cron.job j
  WHERE d.jobid = j.jobid AND j.jobname = 'everonn_usage_worker_v1'
    AND j.username = CURRENT_USER AND j.database = pg_catalog.current_database()
    AND j.command = 'SELECT everonn_usage.invoke_usage_worker();'
    AND d.end_time < pg_catalog.now() - interval '7 days';

  timestamp := pg_catalog.floor(EXTRACT(epoch FROM pg_catalog.clock_timestamp()))::bigint::text;
  nonce := pg_catalog.gen_random_uuid()::text;
  signature := pg_catalog.encode(extensions.hmac(
    E'usage-job-v1\nPOST\n/api/usage/jobs\n' || timestamp || E'\n' || nonce,
    cron_secret, 'sha256'), 'hex');
  SELECT net.http_post(
    url := application_url || '/api/usage/jobs',
    body := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json',
      'x-everonn-usage-timestamp', timestamp, 'x-everonn-usage-nonce', nonce, 'x-everonn-usage-signature', signature),
    timeout_milliseconds := 65000
  ) INTO request_id;
  INSERT INTO everonn_usage.worker_requests(request_id) VALUES (request_id);
  RETURN request_id;
END;
$function$;

REVOKE ALL ON FUNCTION everonn_usage.invoke_usage_worker() FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO everonn_usage.schema_migrations(version, component)
VALUES ('202610040001', 'everonn-usage-scheduler') ON CONFLICT (version) DO NOTHING;

-- Apply in the existing project's SQL Editor. This transaction only creates
-- or updates EverOnn's dedicated schema; it does not modify other app schemas.
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('everonn-usage-schema-v1', 0));

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'everonn_usage')
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'everonn_usage' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     ) THEN
    IF pg_catalog.to_regclass('everonn_usage.schema_migrations') IS NULL THEN
      RAISE EXCEPTION 'everonn_usage already contains unrecognized objects; migration stopped';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM everonn_usage.schema_migrations WHERE version = '202610030001' AND component = 'everonn-usage') THEN
      RAISE EXCEPTION 'everonn_usage is not the recognized EverOnn usage schema; migration stopped';
    END IF;
  END IF;
END;
$guard$;

CREATE SCHEMA IF NOT EXISTS everonn_usage;
REVOKE ALL ON SCHEMA everonn_usage FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA everonn_usage TO service_role;

CREATE TABLE IF NOT EXISTS everonn_usage.schema_migrations (
  version text PRIMARY KEY,
  component text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS everonn_usage.usage_records (
  key text COLLATE "C" PRIMARY KEY CHECK (
    key ~ '^(events|sessions|outbox|claims|billing|system)/[A-Za-z0-9_./-]+$'
    AND pg_catalog.strpos(key, '..') = 0
  ),
  payload jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(payload) = 'object'),
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  record_type text GENERATED ALWAYS AS (pg_catalog.split_part(key, '/', 1)) STORED,
  workspace_id text GENERATED ALWAYS AS (payload ->> 'workspaceId') STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS usage_records_prefix_idx
  ON everonn_usage.usage_records (key text_pattern_ops);
CREATE INDEX IF NOT EXISTS usage_records_workspace_type_idx
  ON everonn_usage.usage_records (workspace_id, record_type, key);

ALTER TABLE everonn_usage.usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE everonn_usage.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE everonn_usage.usage_records, everonn_usage.schema_migrations
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE everonn_usage.usage_records TO service_role;
GRANT SELECT ON TABLE everonn_usage.schema_migrations TO service_role;

-- Compare-and-set guards against writes from another server instance. A fresh
-- UUID on every write also detects delete/recreate cycles. No elevated function.
CREATE OR REPLACE FUNCTION everonn_usage.write_usage_record(
  p_key text,
  p_payload jsonb,
  p_expected_revision uuid DEFAULT NULL,
  p_insert_only boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  changed integer;
BEGIN
  IF p_insert_only AND p_expected_revision IS NOT NULL THEN
    RAISE EXCEPTION 'Conflicting usage write conditions';
  END IF;
  IF p_insert_only THEN
    INSERT INTO everonn_usage.usage_records(key, payload)
    VALUES (p_key, p_payload) ON CONFLICT (key) DO NOTHING;
  ELSIF p_expected_revision IS NOT NULL THEN
    UPDATE everonn_usage.usage_records
    SET payload = p_payload, revision = pg_catalog.gen_random_uuid(), updated_at = pg_catalog.clock_timestamp()
    WHERE key = p_key AND revision = p_expected_revision;
  ELSE
    INSERT INTO everonn_usage.usage_records(key, payload) VALUES (p_key, p_payload)
    ON CONFLICT (key) DO UPDATE
    SET payload = EXCLUDED.payload, revision = pg_catalog.gen_random_uuid(), updated_at = pg_catalog.clock_timestamp();
  END IF;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$function$;

REVOKE ALL ON FUNCTION everonn_usage.write_usage_record(text, jsonb, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION everonn_usage.write_usage_record(text, jsonb, uuid, boolean)
  TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA everonn_usage REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA everonn_usage REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

INSERT INTO everonn_usage.schema_migrations(version, component)
VALUES ('202610030001', 'everonn-usage') ON CONFLICT (version) DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;

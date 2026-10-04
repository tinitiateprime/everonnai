-- Private application storage in the existing Supabase project. No changes to
-- public, agentic_that, everonn_usage, Data API exposure, or Supabase Auth users.
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('everonn-app-schema-v1', 0));

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'everonn_app') THEN
    IF pg_catalog.to_regclass('everonn_app.schema_migrations') IS NULL THEN
      RAISE EXCEPTION 'everonn_app already exists without the recognized migration; stopped';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM everonn_app.schema_migrations WHERE version = '202610040002' AND component = 'everonn-app') THEN
      RAISE EXCEPTION 'everonn_app is not the recognized EverOnn application schema; stopped';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'everonn_app' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND c.relname NOT IN ('app_records', 'schema_migrations')
    ) THEN
      RAISE EXCEPTION 'everonn_app contains unrelated objects; stopped';
    END IF;
  END IF;
END;
$guard$;

CREATE SCHEMA IF NOT EXISTS everonn_app;
REVOKE ALL ON SCHEMA everonn_app FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS everonn_app.schema_migrations (
  version text PRIMARY KEY,
  component text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS everonn_app.app_records (
  key text COLLATE "C" PRIMARY KEY CHECK (
    key ~ '^(auth/accounts|workspaces/primary|workspaces/[a-f0-9]{64}|providers/google)$'
  ),
  payload jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(payload) = 'object'),
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id text GENERATED ALWAYS AS (payload ->> 'workspaceId') STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS app_records_prefix_idx ON everonn_app.app_records(key text_pattern_ops);
CREATE UNIQUE INDEX IF NOT EXISTS app_records_workspace_id_idx ON everonn_app.app_records(workspace_id)
  WHERE workspace_id IS NOT NULL AND key LIKE 'workspaces/%';

ALTER TABLE everonn_app.app_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE everonn_app.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE everonn_app.app_records, everonn_app.schema_migrations FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION everonn_app.write_app_record(
  p_key text, p_payload jsonb, p_expected_revision uuid DEFAULT NULL, p_insert_only boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE changed integer;
BEGIN
  IF p_insert_only AND p_expected_revision IS NOT NULL THEN
    RAISE EXCEPTION 'Conflicting application write conditions';
  END IF;
  IF p_insert_only THEN
    INSERT INTO everonn_app.app_records(key, payload) VALUES (p_key, p_payload)
    ON CONFLICT (key) DO NOTHING;
  ELSIF p_expected_revision IS NOT NULL THEN
    UPDATE everonn_app.app_records
    SET payload = p_payload, revision = pg_catalog.gen_random_uuid(), updated_at = pg_catalog.clock_timestamp()
    WHERE key = p_key AND revision = p_expected_revision;
  ELSE
    RAISE EXCEPTION 'Application writes require a revision or insert-only condition';
  END IF;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$function$;
REVOKE ALL ON FUNCTION everonn_app.write_app_record(text,jsonb,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA everonn_app REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA everonn_app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO everonn_app.schema_migrations(version, component)
VALUES ('202610040002', 'everonn-app') ON CONFLICT (version) DO NOTHING;
COMMIT;

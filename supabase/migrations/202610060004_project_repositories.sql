-- Customer GitHub documentation connections; no other project's schema/data changes.
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('everonn-project-repositories-v1',0));
DO $guard$
BEGIN
  IF to_regclass('everonn.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM everonn.schema_migrations WHERE version='202610040003' AND component='everonn-core'
  ) THEN RAISE EXCEPTION 'Apply the EverOnn core migration first'; END IF;
  IF EXISTS (SELECT 1 FROM everonn.schema_migrations WHERE version='202610060004' AND component<>'everonn-project-repositories')
    THEN RAISE EXCEPTION 'Occupied project migration version; stopped'; END IF;
  IF (to_regclass('everonn.project_repositories') IS NOT NULL OR to_regprocedure('everonn.write_project_repository(text,uuid,jsonb,uuid)') IS NOT NULL) AND NOT EXISTS (
    SELECT 1 FROM everonn.schema_migrations WHERE version='202610060004' AND component='everonn-project-repositories'
  ) THEN RAISE EXCEPTION 'Unrecognized project repository table; stopped'; END IF;
END;
$guard$;

CREATE TABLE IF NOT EXISTS everonn.project_repositories (
  workspace_id text NOT NULL REFERENCES everonn.workspaces(workspace_id) ON DELETE CASCADE,
  repository_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'
    AND payload->>'workspaceId' IS NOT NULL AND payload->>'id' IS NOT NULL
    AND payload->>'workspaceId'=workspace_id AND payload->>'id'=repository_id::text),
  location_key text GENERATED ALWAYS AS (payload->>'locationKey') STORED NOT NULL,
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY(workspace_id,repository_id), UNIQUE(workspace_id,location_key)
);
ALTER TABLE everonn.project_repositories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON everonn.project_repositories FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION everonn.write_project_repository(p_workspace text,p_id uuid,p_payload jsonb,p_revision uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,everonn AS $function$
DECLARE changed integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('everonn-projects:'||p_workspace,0));
  IF p_payload->>'workspaceId' IS DISTINCT FROM p_workspace OR p_payload->>'id' IS DISTINCT FROM p_id::text
    THEN RAISE EXCEPTION 'Project repository workspace mismatch'; END IF;
  IF p_revision IS NULL THEN
    IF (SELECT count(*) FROM everonn.project_repositories WHERE workspace_id=p_workspace)>=12 THEN RETURN false; END IF;
    INSERT INTO everonn.project_repositories(workspace_id,repository_id,payload) VALUES(p_workspace,p_id,p_payload)
      ON CONFLICT DO NOTHING;
  ELSE
    UPDATE everonn.project_repositories SET payload=p_payload,revision=pg_catalog.gen_random_uuid(),updated_at=pg_catalog.now()
      WHERE workspace_id=p_workspace AND repository_id=p_id AND revision=p_revision;
  END IF;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END;
$function$;
REVOKE ALL ON FUNCTION everonn.write_project_repository(text,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO everonn.schema_migrations(version,component) VALUES('202610060004','everonn-project-repositories') ON CONFLICT(version) DO NOTHING;
COMMIT;

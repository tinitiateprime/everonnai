CREATE TABLE everonn_platform.crawl_runs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  pipeline_run_id uuid NOT NULL, job_id uuid NOT NULL, request_key uuid NOT NULL,
  input_url text NOT NULL, config jsonb NOT NULL,
  status text NOT NULL DEFAULT 'paused' CHECK (status IN ('running','paused','limit','complete','failed')),
  page_limit integer NOT NULL CHECK (page_limit BETWEEN 1 AND 2000),
  revision bigint NOT NULL DEFAULT 1, lease_token bigint NOT NULL DEFAULT 0,
  lease_expires_at timestamptz, pause_requested boolean NOT NULL DEFAULT false,
  checkpoint_object_id uuid, coverage jsonb NOT NULL DEFAULT '{}', last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,project_id,id), UNIQUE (tenant_id,project_id,request_key),
  FOREIGN KEY (tenant_id,project_id) REFERENCES everonn_platform.projects(tenant_id,id),
  FOREIGN KEY (tenant_id,project_id,pipeline_run_id) REFERENCES everonn_platform.pipeline_runs(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,job_id) REFERENCES everonn_platform.jobs(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,checkpoint_object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id)
);
CREATE UNIQUE INDEX one_running_crawl_per_project ON everonn_platform.crawl_runs(tenant_id,project_id) WHERE status='running';
CREATE TABLE everonn_platform.page_captures (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, crawl_run_id uuid NOT NULL,
  normalized_url text NOT NULL, final_url text NOT NULL, http_status integer NOT NULL,
  capture_started_at timestamptz NOT NULL, captured_at timestamptz NOT NULL, rendered_at timestamptz,
  raw_sha256 text NOT NULL CHECK (raw_sha256 ~ '^[a-f0-9]{64}$'),
  text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[a-f0-9]{64}$'),
  extractor_version text NOT NULL, raw_object_id uuid NOT NULL, evidence_object_id uuid NOT NULL,
  rendered_object_id uuid, summary jsonb NOT NULL,
  UNIQUE (tenant_id,project_id,id), UNIQUE (tenant_id,project_id,crawl_run_id,id),
  UNIQUE (tenant_id,project_id,crawl_run_id,normalized_url), CHECK (captured_at >= capture_started_at),
  FOREIGN KEY (tenant_id,project_id,crawl_run_id) REFERENCES everonn_platform.crawl_runs(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,raw_object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,evidence_object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,rendered_object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id)
);
CREATE TABLE everonn_platform.source_snapshots (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, crawl_run_id uuid NOT NULL,
  crawl_revision bigint NOT NULL, manifest_object_id uuid NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  coverage jsonb NOT NULL, scope jsonb NOT NULL,
  capture_started_at timestamptz NOT NULL, capture_ended_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL REFERENCES everonn_platform.users(id),
  UNIQUE (tenant_id,project_id,id), UNIQUE (tenant_id,project_id,crawl_run_id,id),
  UNIQUE (tenant_id,project_id,crawl_run_id,crawl_revision),
  FOREIGN KEY (tenant_id,project_id,crawl_run_id) REFERENCES everonn_platform.crawl_runs(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,manifest_object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id)
);
CREATE TABLE everonn_platform.snapshot_pages (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, snapshot_id uuid NOT NULL, crawl_run_id uuid NOT NULL,
  normalized_url text NOT NULL, outcome text NOT NULL CHECK (outcome IN ('captured','skipped','pending')),
  capture_id uuid, reason text,
  PRIMARY KEY (tenant_id,project_id,snapshot_id,normalized_url),
  CHECK ((outcome='captured') = (capture_id IS NOT NULL)),
  FOREIGN KEY (tenant_id,project_id,crawl_run_id,snapshot_id) REFERENCES everonn_platform.source_snapshots(tenant_id,project_id,crawl_run_id,id),
  FOREIGN KEY (tenant_id,project_id,crawl_run_id,capture_id) REFERENCES everonn_platform.page_captures(tenant_id,project_id,crawl_run_id,id)
);
CREATE FUNCTION everonn_platform.reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Captured evidence and snapshots are immutable'; END $$;
DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['page_captures','source_snapshots','snapshot_pages'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON everonn_platform.%I FOR EACH ROW EXECUTE FUNCTION everonn_platform.reject_evidence_mutation()',n);
  END LOOP;
  FOREACH n IN ARRAY ARRAY['crawl_runs','page_captures','source_snapshots','snapshot_pages'] LOOP
    EXECUTE format('ALTER TABLE everonn_platform.%I ENABLE ROW LEVEL SECURITY',n);
    EXECUTE format('ALTER TABLE everonn_platform.%I FORCE ROW LEVEL SECURITY',n);
    EXECUTE format('CREATE POLICY scoped_read ON everonn_platform.%I FOR SELECT USING (
      tenant_id=NULLIF(current_setting(''everonn.tenant_id'',true),'''')::uuid
      AND project_id=NULLIF(current_setting(''everonn.project_id'',true),'''')::uuid
      AND everonn_platform.project_permission(tenant_id,project_id,''view''))',n);
    EXECUTE format('CREATE POLICY scoped_insert ON everonn_platform.%I FOR INSERT WITH CHECK (
      tenant_id=NULLIF(current_setting(''everonn.tenant_id'',true),'''')::uuid
      AND project_id=NULLIF(current_setting(''everonn.project_id'',true),'''')::uuid
      AND everonn_platform.project_permission(tenant_id,project_id,''edit''))',n);
    EXECUTE format('GRANT SELECT,INSERT ON everonn_platform.%I TO everonn_platform_app',n);
  END LOOP;
  FOREACH n IN ARRAY ARRAY['crawl_runs','jobs','pipeline_runs'] LOOP
    EXECUTE format('CREATE POLICY scoped_update ON everonn_platform.%I FOR UPDATE USING (
      tenant_id=NULLIF(current_setting(''everonn.tenant_id'',true),'''')::uuid
      AND project_id=NULLIF(current_setting(''everonn.project_id'',true),'''')::uuid
      AND everonn_platform.project_permission(tenant_id,project_id,''edit'')) WITH CHECK (
      tenant_id=NULLIF(current_setting(''everonn.tenant_id'',true),'''')::uuid
      AND project_id=NULLIF(current_setting(''everonn.project_id'',true),'''')::uuid
      AND everonn_platform.project_permission(tenant_id,project_id,''edit''))',n);
  END LOOP;
END $$;
GRANT UPDATE(status,page_limit,revision,lease_token,lease_expires_at,pause_requested,checkpoint_object_id,coverage,last_error,updated_at) ON everonn_platform.crawl_runs TO everonn_platform_app;
GRANT UPDATE(state,reason) ON everonn_platform.jobs TO everonn_platform_app;
GRANT UPDATE(status) ON everonn_platform.pipeline_runs TO everonn_platform_app;
REVOKE ALL ON FUNCTION everonn_platform.reject_evidence_mutation() FROM PUBLIC;
CREATE INDEX captures_run ON everonn_platform.page_captures(tenant_id,project_id,crawl_run_id,captured_at,id);
CREATE INDEX snapshots_project ON everonn_platform.source_snapshots(tenant_id,project_id,created_at,id);

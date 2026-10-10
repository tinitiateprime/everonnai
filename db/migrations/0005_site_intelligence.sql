CREATE TABLE everonn_platform.intelligence_runs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,snapshot_id uuid NOT NULL,snapshot_sha256 text NOT NULL,
 request_key uuid NOT NULL,config jsonb NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','paused','complete','partial','failed')),
 stage integer NOT NULL DEFAULT 0 CHECK(stage BETWEEN 0 AND 2),lease_token bigint NOT NULL DEFAULT 0,lease_expires_at timestamptz,
 processed_pages integer NOT NULL DEFAULT 0,required_pages integer NOT NULL,browser_pages integer NOT NULL DEFAULT 0,
 report_object_id uuid,report_sha256 text,error text,created_by uuid NOT NULL REFERENCES everonn_platform.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,project_id,id),UNIQUE(project_id,request_key),
 FOREIGN KEY(tenant_id,project_id,snapshot_id) REFERENCES everonn_platform.source_snapshots(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,report_object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id)
);
CREATE UNIQUE INDEX one_running_intelligence_per_project ON everonn_platform.intelligence_runs(project_id) WHERE status='running';
CREATE TABLE everonn_platform.page_assessments (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,run_id uuid NOT NULL,capture_id uuid NOT NULL,
 source_sha256 text NOT NULL,document_object_id uuid NOT NULL,document_sha256 text NOT NULL,browser_status text NOT NULL CHECK(browser_status IN ('observed','inconclusive')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(run_id,capture_id),
 FOREIGN KEY(tenant_id,project_id,run_id) REFERENCES everonn_platform.intelligence_runs(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,capture_id) REFERENCES everonn_platform.page_captures(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,document_object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id)
);
CREATE TRIGGER immutable_assessment BEFORE UPDATE OR DELETE ON everonn_platform.page_assessments FOR EACH ROW EXECUTE FUNCTION everonn_platform.reject_evidence_mutation();
CREATE FUNCTION everonn_platform.guard_intelligence_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
 BEGIN IF OLD.status IN ('complete','partial') THEN RAISE EXCEPTION 'Sealed intelligence reports are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_intelligence BEFORE UPDATE OR DELETE ON everonn_platform.intelligence_runs FOR EACH ROW EXECUTE FUNCTION everonn_platform.guard_intelligence_mutation();
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['intelligence_runs','page_assessments'] LOOP
  EXECUTE format('ALTER TABLE everonn_platform.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE everonn_platform.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY scoped_read ON everonn_platform.%I FOR SELECT USING (
   tenant_id=NULLIF(current_setting(''everonn.tenant_id'',true),'''')::uuid AND project_id=NULLIF(current_setting(''everonn.project_id'',true),'''')::uuid
   AND everonn_platform.project_permission(tenant_id,project_id,''view''))',n);
  EXECUTE format('CREATE POLICY scoped_insert ON everonn_platform.%I FOR INSERT WITH CHECK (
   tenant_id=NULLIF(current_setting(''everonn.tenant_id'',true),'''')::uuid AND project_id=NULLIF(current_setting(''everonn.project_id'',true),'''')::uuid
   AND everonn_platform.project_permission(tenant_id,project_id,''edit''))',n);
  EXECUTE format('GRANT SELECT,INSERT ON everonn_platform.%I TO everonn_platform_app',n);
 END LOOP;
END $$;
CREATE POLICY scoped_update ON everonn_platform.intelligence_runs FOR UPDATE USING (
 tenant_id=NULLIF(current_setting('everonn.tenant_id',true),'')::uuid AND project_id=NULLIF(current_setting('everonn.project_id',true),'')::uuid
 AND everonn_platform.project_permission(tenant_id,project_id,'edit')) WITH CHECK (
 tenant_id=NULLIF(current_setting('everonn.tenant_id',true),'')::uuid AND project_id=NULLIF(current_setting('everonn.project_id',true),'')::uuid
 AND everonn_platform.project_permission(tenant_id,project_id,'edit'));
GRANT UPDATE(status,stage,lease_token,lease_expires_at,processed_pages,browser_pages,report_object_id,report_sha256,error,updated_at) ON everonn_platform.intelligence_runs TO everonn_platform_app;
REVOKE ALL ON FUNCTION everonn_platform.guard_intelligence_mutation() FROM PUBLIC;

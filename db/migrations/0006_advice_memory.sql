-- Owner corrections ("advice memory") that the growth-advisor agent reads on every later
-- advice run for the project, and immutable advice revisions regenerated from a sealed
-- intelligence report. Sealed reports themselves are never rewritten.
CREATE TABLE everonn_platform.advice_corrections (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,run_id uuid,
 body text NOT NULL CHECK(char_length(body) BETWEEN 3 AND 2000),
 created_by uuid NOT NULL REFERENCES everonn_platform.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_at timestamptz,withdrawn_by uuid REFERENCES everonn_platform.users(id),
 UNIQUE(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,run_id) REFERENCES everonn_platform.intelligence_runs(tenant_id,project_id,id)
);
CREATE INDEX advice_corrections_project ON everonn_platform.advice_corrections(project_id,created_at);
-- Text and authorship are immutable; only a one-way withdrawal may be recorded.
CREATE FUNCTION everonn_platform.guard_correction_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
 BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Advice corrections are append-only'; END IF;
  IF OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL OR NEW.body<>OLD.body OR NEW.created_by<>OLD.created_by
   OR NEW.created_at<>OLD.created_at OR NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.project_id<>OLD.project_id OR NEW.tenant_id<>OLD.tenant_id
  THEN RAISE EXCEPTION 'Advice corrections can only be withdrawn once'; END IF;
  RETURN NEW;
 END $$;
CREATE TRIGGER append_only_correction BEFORE UPDATE OR DELETE ON everonn_platform.advice_corrections FOR EACH ROW EXECUTE FUNCTION everonn_platform.guard_correction_mutation();
CREATE TABLE everonn_platform.advice_revisions (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,run_id uuid NOT NULL,
 request_key uuid NOT NULL,report_sha256 text NOT NULL,correction_ids jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('available','inconclusive','not_configured')),model text,
 object_id uuid NOT NULL,object_sha256 text NOT NULL,
 created_by uuid NOT NULL REFERENCES everonn_platform.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,request_key),
 FOREIGN KEY(tenant_id,project_id,run_id) REFERENCES everonn_platform.intelligence_runs(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id)
);
CREATE INDEX advice_revisions_run ON everonn_platform.advice_revisions(run_id,created_at);
CREATE TRIGGER immutable_advice_revision BEFORE UPDATE OR DELETE ON everonn_platform.advice_revisions FOR EACH ROW EXECUTE FUNCTION everonn_platform.reject_evidence_mutation();
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['advice_corrections','advice_revisions'] LOOP
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
CREATE POLICY scoped_update ON everonn_platform.advice_corrections FOR UPDATE USING (
 tenant_id=NULLIF(current_setting('everonn.tenant_id',true),'')::uuid AND project_id=NULLIF(current_setting('everonn.project_id',true),'')::uuid
 AND everonn_platform.project_permission(tenant_id,project_id,'edit')) WITH CHECK (
 tenant_id=NULLIF(current_setting('everonn.tenant_id',true),'')::uuid AND project_id=NULLIF(current_setting('everonn.project_id',true),'')::uuid
 AND everonn_platform.project_permission(tenant_id,project_id,'edit'));
GRANT UPDATE(withdrawn_at,withdrawn_by) ON everonn_platform.advice_corrections TO everonn_platform_app;
REVOKE ALL ON FUNCTION everonn_platform.guard_correction_mutation() FROM PUBLIC;

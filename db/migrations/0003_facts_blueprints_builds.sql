CREATE TABLE everonn_platform.fact_sets (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,snapshot_id uuid NOT NULL,
 version integer NOT NULL,status text NOT NULL CHECK(status IN ('draft','approved')),
 document_object_id uuid NOT NULL,content_sha256 text NOT NULL,created_by uuid NOT NULL REFERENCES everonn_platform.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,project_id,id),UNIQUE(tenant_id,project_id,version),
 FOREIGN KEY(tenant_id,project_id,snapshot_id) REFERENCES everonn_platform.source_snapshots(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,document_object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id)
);
CREATE TABLE everonn_platform.facts (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,fact_set_id uuid NOT NULL,
 key text NOT NULL,value text NOT NULL,verification text NOT NULL CHECK(verification IN ('source_supported','owner_confirmed','conflict','unknown')),
 required boolean NOT NULL,evidence jsonb NOT NULL,
 UNIQUE(tenant_id,project_id,id),UNIQUE(fact_set_id,key),
 FOREIGN KEY(tenant_id,project_id,fact_set_id) REFERENCES everonn_platform.fact_sets(tenant_id,project_id,id)
);
CREATE TABLE everonn_platform.blueprint_revisions (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,snapshot_id uuid NOT NULL,fact_set_id uuid NOT NULL,
 version integer NOT NULL,status text NOT NULL CHECK(status IN ('draft','approved')),document_object_id uuid NOT NULL,content_sha256 text NOT NULL,
 created_by uuid NOT NULL REFERENCES everonn_platform.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,project_id,id),UNIQUE(tenant_id,project_id,version),
 FOREIGN KEY(tenant_id,project_id,snapshot_id) REFERENCES everonn_platform.source_snapshots(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,fact_set_id) REFERENCES everonn_platform.fact_sets(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,document_object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id)
);
CREATE TABLE everonn_platform.blueprint_pages (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,blueprint_id uuid NOT NULL,
 path text NOT NULL,outcome text NOT NULL CHECK(outcome IN ('render','redirect','exclude','unresolved')),
 content_object_id uuid,content_sha256 text,
 UNIQUE(tenant_id,project_id,id),UNIQUE(blueprint_id,path),
 FOREIGN KEY(tenant_id,project_id,blueprint_id) REFERENCES everonn_platform.blueprint_revisions(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,content_object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id)
);
CREATE TABLE everonn_platform.website_builds (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,alternative_id uuid NOT NULL,blueprint_id uuid NOT NULL,
 request_key uuid NOT NULL,revision integer NOT NULL,inputs jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','designing','designed','compiling','compiled','verifying','ready','failed')),
 stage integer NOT NULL DEFAULT 0 CHECK(stage BETWEEN 0 AND 3),lease_token bigint NOT NULL DEFAULT 0,lease_expires_at timestamptz,
 design_object_id uuid,manifest_object_id uuid,seal_sha256 text,error text,
 created_by uuid NOT NULL REFERENCES everonn_platform.users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,project_id,id),UNIQUE(tenant_id,project_id,request_key),UNIQUE(alternative_id,revision),
 FOREIGN KEY(tenant_id,project_id,alternative_id) REFERENCES everonn_platform.design_alternatives(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,blueprint_id) REFERENCES everonn_platform.blueprint_revisions(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,design_object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,manifest_object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id)
);
CREATE UNIQUE INDEX one_active_build_per_alternative ON everonn_platform.website_builds(alternative_id) WHERE status IN ('designing','compiling','verifying');
CREATE TABLE everonn_platform.build_files (
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,build_id uuid NOT NULL,path text NOT NULL,object_id uuid NOT NULL,
 PRIMARY KEY(build_id,path),
 FOREIGN KEY(tenant_id,project_id,build_id) REFERENCES everonn_platform.website_builds(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,object_id) REFERENCES everonn_platform.storage_objects(tenant_id,project_id,id)
);
CREATE TABLE everonn_platform.build_checks (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,build_id uuid NOT NULL,seal_sha256 text NOT NULL,
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id,build_id) REFERENCES everonn_platform.website_builds(tenant_id,project_id,id)
);
CREATE TABLE everonn_platform.enquiries (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,build_id uuid NOT NULL,request_key uuid NOT NULL,
 name text NOT NULL,email text NOT NULL,message text NOT NULL,is_test boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(build_id,request_key),
 FOREIGN KEY(tenant_id,project_id,build_id) REFERENCES everonn_platform.website_builds(tenant_id,project_id,id)
);
CREATE FUNCTION everonn_platform.guard_build_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
 BEGIN IF OLD.status='ready' THEN RAISE EXCEPTION 'Verified builds are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_ready_build BEFORE UPDATE OR DELETE ON everonn_platform.website_builds FOR EACH ROW EXECUTE FUNCTION everonn_platform.guard_build_mutation();
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['fact_sets','facts','blueprint_revisions','blueprint_pages','website_builds','build_files','build_checks','enquiries'] LOOP
  EXECUTE format('ALTER TABLE everonn_platform.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE everonn_platform.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY scoped_read ON everonn_platform.%I FOR SELECT USING (
   tenant_id=NULLIF(current_setting(''everonn.tenant_id'',true),'''')::uuid AND project_id=NULLIF(current_setting(''everonn.project_id'',true),'''')::uuid
   AND everonn_platform.project_permission(tenant_id,project_id,%L))',n,CASE WHEN n='enquiries' THEN 'edit' ELSE 'view' END);
  EXECUTE format('CREATE POLICY scoped_insert ON everonn_platform.%I FOR INSERT WITH CHECK (
   tenant_id=NULLIF(current_setting(''everonn.tenant_id'',true),'''')::uuid AND project_id=NULLIF(current_setting(''everonn.project_id'',true),'''')::uuid
   AND everonn_platform.project_permission(tenant_id,project_id,''edit''))',n);
  EXECUTE format('GRANT SELECT,INSERT ON everonn_platform.%I TO everonn_platform_app',n);
  IF n<>'website_builds' THEN
   EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON everonn_platform.%I FOR EACH ROW EXECUTE FUNCTION everonn_platform.reject_evidence_mutation()',n);
  END IF;
 END LOOP;
END $$;
CREATE POLICY scoped_update ON everonn_platform.website_builds FOR UPDATE USING (
 tenant_id=NULLIF(current_setting('everonn.tenant_id',true),'')::uuid AND project_id=NULLIF(current_setting('everonn.project_id',true),'')::uuid
 AND everonn_platform.project_permission(tenant_id,project_id,'edit')) WITH CHECK (
 tenant_id=NULLIF(current_setting('everonn.tenant_id',true),'')::uuid AND project_id=NULLIF(current_setting('everonn.project_id',true),'')::uuid
 AND everonn_platform.project_permission(tenant_id,project_id,'edit'));
GRANT UPDATE(status,stage,lease_token,lease_expires_at,design_object_id,manifest_object_id,seal_sha256,error,updated_at) ON everonn_platform.website_builds TO everonn_platform_app;
REVOKE ALL ON FUNCTION everonn_platform.guard_build_mutation() FROM PUBLIC;

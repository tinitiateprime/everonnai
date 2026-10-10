-- Run using a migration role with schema/role administration privileges.
-- Request transactions always SET LOCAL ROLE to the restricted NOLOGIN role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'everonn_platform_app') THEN
    CREATE ROLE everonn_platform_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE everonn_platform_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT everonn_platform_app TO CURRENT_USER;
REVOKE ALL ON SCHEMA everonn_platform FROM PUBLIC;
GRANT USAGE ON SCHEMA everonn_platform TO everonn_platform_app;

CREATE TABLE everonn_platform.users (
  id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (issuer, subject)
);
CREATE TABLE everonn_platform.sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES everonn_platform.users(id),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE TABLE everonn_platform.tenants (
  id uuid PRIMARY KEY, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_by uuid NOT NULL REFERENCES everonn_platform.users(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE everonn_platform.tenant_memberships (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES everonn_platform.tenants(id),
  user_id uuid NOT NULL REFERENCES everonn_platform.users(id),
  role text NOT NULL CHECK (role IN ('owner','admin','member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,user_id)
);
CREATE TABLE everonn_platform.projects (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES everonn_platform.tenants(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  slug text NOT NULL CHECK (length(slug) BETWEEN 1 AND 100), source_url text,
  created_by uuid NOT NULL REFERENCES everonn_platform.users(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,id), UNIQUE (tenant_id,slug)
);
CREATE TABLE everonn_platform.project_memberships (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  user_id uuid NOT NULL, permissions text[] NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,project_id,user_id),
  CHECK (permissions <@ ARRAY['view','edit','review','publish']::text[] AND 'view'=ANY(permissions)),
  FOREIGN KEY (tenant_id,project_id) REFERENCES everonn_platform.projects(tenant_id,id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES everonn_platform.tenant_memberships(tenant_id,user_id)
);
CREATE TABLE everonn_platform.design_alternatives (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3), name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,project_id,id),
  UNIQUE (tenant_id,project_id,slot),
  FOREIGN KEY (tenant_id,project_id) REFERENCES everonn_platform.projects(tenant_id,id)
);
CREATE TABLE everonn_platform.storage_objects (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  key text NOT NULL UNIQUE, kind text NOT NULL CHECK (kind IN ('document','source','asset')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 0 AND 64000000),
  media_type text NOT NULL, filename text NOT NULL,
  state text NOT NULL DEFAULT 'available' CHECK (state = 'available'),
  rights jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES everonn_platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES everonn_platform.projects(tenant_id,id)
);
CREATE TABLE everonn_platform.pipeline_runs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'blocked' CHECK (status IN ('blocked','queued','running','succeeded','failed','cancelled')),
  requested_by uuid NOT NULL REFERENCES everonn_platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES everonn_platform.projects(tenant_id,id)
);
CREATE TABLE everonn_platform.jobs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, pipeline_run_id uuid NOT NULL,
  stage text NOT NULL, target_key text NOT NULL,
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL, state text NOT NULL DEFAULT 'blocked'
    CHECK (state IN ('blocked','queued','running','retry_wait','succeeded','failed','cancelled','budget_blocked')),
  reason jsonb NOT NULL DEFAULT '{"code":"worker_not_connected"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,project_id,id),
  UNIQUE (tenant_id,project_id,idempotency_key),
  FOREIGN KEY (tenant_id,project_id,pipeline_run_id) REFERENCES everonn_platform.pipeline_runs(tenant_id,project_id,id)
);
CREATE TABLE everonn_platform.audit_events (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid,
  actor_id uuid NOT NULL REFERENCES everonn_platform.users(id), action text NOT NULL,
  subject_id uuid NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id) REFERENCES everonn_platform.tenants(id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES everonn_platform.projects(tenant_id,id)
);

CREATE FUNCTION everonn_platform.actor_id() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog AS $$ SELECT NULLIF(current_setting('everonn.actor_id',true),'')::uuid $$;
CREATE FUNCTION everonn_platform.tenant_permission(t uuid, admin_required boolean DEFAULT false)
  RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog,everonn_platform AS $$
  SELECT EXISTS (SELECT 1 FROM everonn_platform.tenant_memberships m
    WHERE m.tenant_id=t AND m.user_id=everonn_platform.actor_id() AND m.status='active'
      AND (NOT admin_required OR m.role IN ('owner','admin')))
$$;
CREATE FUNCTION everonn_platform.project_permission(t uuid,p uuid,permission text DEFAULT 'view')
  RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog,everonn_platform AS $$
  SELECT EXISTS(SELECT 1 FROM everonn_platform.tenants WHERE id=t AND status='active') AND (everonn_platform.tenant_permission(t,true) OR (
    everonn_platform.tenant_permission(t,false) AND EXISTS (
      SELECT 1 FROM everonn_platform.project_memberships m WHERE m.tenant_id=t AND m.project_id=p
        AND m.user_id=everonn_platform.actor_id() AND m.status='active' AND permission=ANY(m.permissions))))
$$;

DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['users','sessions','tenants','tenant_memberships','projects','project_memberships',
    'design_alternatives','storage_objects','pipeline_runs','jobs','audit_events'] LOOP
    EXECUTE format('ALTER TABLE everonn_platform.%I ENABLE ROW LEVEL SECURITY',n);
    EXECUTE format('ALTER TABLE everonn_platform.%I FORCE ROW LEVEL SECURITY',n);
  END LOOP;
END $$;
CREATE POLICY user_read ON everonn_platform.users FOR SELECT USING (
  id=everonn_platform.actor_id() OR (issuer=current_setting('everonn.issuer',true) AND subject=current_setting('everonn.subject',true)));
CREATE POLICY user_insert ON everonn_platform.users FOR INSERT WITH CHECK (
  issuer=current_setting('everonn.issuer',true) AND subject=current_setting('everonn.subject',true));
CREATE POLICY user_update ON everonn_platform.users FOR UPDATE USING (
  issuer=current_setting('everonn.issuer',true) AND subject=current_setting('everonn.subject',true)) WITH CHECK (
  issuer=current_setting('everonn.issuer',true) AND subject=current_setting('everonn.subject',true));
CREATE POLICY session_read ON everonn_platform.sessions FOR SELECT USING (
  token_hash=current_setting('everonn.session_hash',true) OR user_id=everonn_platform.actor_id());
CREATE POLICY session_insert ON everonn_platform.sessions FOR INSERT WITH CHECK (user_id=everonn_platform.actor_id());
CREATE POLICY session_delete ON everonn_platform.sessions FOR DELETE USING (token_hash=current_setting('everonn.session_hash',true));
CREATE POLICY tenant_read ON everonn_platform.tenants FOR SELECT USING (
  status='active' AND (everonn_platform.tenant_permission(id) OR
    (id=NULLIF(current_setting('everonn.bootstrap_tenant',true),'')::uuid AND created_by=everonn_platform.actor_id())));
CREATE POLICY tenant_insert ON everonn_platform.tenants FOR INSERT WITH CHECK (
  id=NULLIF(current_setting('everonn.bootstrap_tenant',true),'')::uuid AND created_by=everonn_platform.actor_id() AND status='active');
CREATE POLICY tenant_membership_read ON everonn_platform.tenant_memberships FOR SELECT USING (user_id=everonn_platform.actor_id());
CREATE POLICY tenant_membership_insert ON everonn_platform.tenant_memberships FOR INSERT WITH CHECK (
  tenant_id=NULLIF(current_setting('everonn.bootstrap_tenant',true),'')::uuid AND user_id=everonn_platform.actor_id() AND role='owner' AND status='active');
CREATE POLICY project_membership_read ON everonn_platform.project_memberships FOR SELECT USING (
  user_id=everonn_platform.actor_id() AND everonn_platform.tenant_permission(tenant_id));
CREATE POLICY project_membership_insert ON everonn_platform.project_memberships FOR INSERT WITH CHECK (everonn_platform.tenant_permission(tenant_id,true));
CREATE POLICY project_read ON everonn_platform.projects FOR SELECT USING (everonn_platform.project_permission(tenant_id,id));
CREATE POLICY project_insert ON everonn_platform.projects FOR INSERT WITH CHECK (
  everonn_platform.tenant_permission(tenant_id,true) AND created_by=everonn_platform.actor_id());
DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['design_alternatives','storage_objects','pipeline_runs','jobs'] LOOP
    EXECUTE format('CREATE POLICY scoped_read ON everonn_platform.%I FOR SELECT USING (
      tenant_id=NULLIF(current_setting(''everonn.tenant_id'',true),'''')::uuid
      AND project_id=NULLIF(current_setting(''everonn.project_id'',true),'''')::uuid
      AND everonn_platform.project_permission(tenant_id,project_id,''view''))',n);
    EXECUTE format('CREATE POLICY scoped_insert ON everonn_platform.%I FOR INSERT WITH CHECK (
      tenant_id=NULLIF(current_setting(''everonn.tenant_id'',true),'''')::uuid
      AND project_id=NULLIF(current_setting(''everonn.project_id'',true),'''')::uuid
      AND everonn_platform.project_permission(tenant_id,project_id,''edit''))',n);
  END LOOP;
END $$;
CREATE POLICY audit_read ON everonn_platform.audit_events FOR SELECT USING (
  everonn_platform.tenant_permission(tenant_id,true) OR
  (project_id IS NOT NULL AND everonn_platform.project_permission(tenant_id,project_id,'view')));
CREATE POLICY audit_insert ON everonn_platform.audit_events FOR INSERT WITH CHECK (
  actor_id=everonn_platform.actor_id() AND (everonn_platform.tenant_permission(tenant_id,true)
  OR (project_id IS NOT NULL AND everonn_platform.project_permission(tenant_id,project_id,'edit'))));

GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA everonn_platform TO everonn_platform_app;
REVOKE ALL ON everonn_platform.schema_migrations FROM everonn_platform_app;
GRANT UPDATE(display_name) ON everonn_platform.users TO everonn_platform_app;
GRANT DELETE ON everonn_platform.sessions TO everonn_platform_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA everonn_platform FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA everonn_platform TO everonn_platform_app;
CREATE INDEX sessions_expiry ON everonn_platform.sessions(expires_at);
CREATE INDEX membership_actor ON everonn_platform.tenant_memberships(user_id,status);
CREATE INDEX objects_project ON everonn_platform.storage_objects(tenant_id,project_id,created_at);
CREATE INDEX jobs_project ON everonn_platform.jobs(tenant_id,project_id,state,created_at);

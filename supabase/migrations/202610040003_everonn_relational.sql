-- EverOnn's active tables belong only to everonn. Existing projects are never migrated.
-- Entity payloads retain optional/nested fields exactly; stored columns make rows
-- searchable in Table Editor. Compatibility views keep old deployments working.
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('everonn-relational-v1',0));

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='everonn') THEN
    IF to_regclass('everonn.schema_migrations') IS NULL THEN
      RAISE EXCEPTION 'Unrecognized everonn schema; migration stopped';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM everonn.schema_migrations WHERE version='202610040003' AND component='everonn-core') THEN
      RAISE EXCEPTION 'Unrecognized everonn migration; stopped';
    END IF;
  END IF;
END;
$guard$;
CREATE SCHEMA IF NOT EXISTS everonn;
REVOKE ALL ON SCHEMA everonn FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS everonn.schema_migrations (
  version text PRIMARY KEY, component text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE TABLE IF NOT EXISTS everonn.record_revisions (
  key text COLLATE "C" PRIMARY KEY CHECK (key ~ '^(auth/accounts|providers/google|workspaces/primary|workspaces/[a-f0-9]{64})$'),
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope)='object'),
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE TABLE IF NOT EXISTS everonn.workspaces (
  workspace_id text PRIMARY KEY,
  record_key text UNIQUE REFERENCES everonn.record_revisions(key) ON DELETE CASCADE,
  envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_primary boolean GENERATED ALWAYS AS (record_key='workspaces/primary') STORED
);
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_one_primary ON everonn.workspaces(is_primary) WHERE is_primary;

CREATE TABLE IF NOT EXISTS everonn.business_profiles (
  workspace_id text NOT NULL REFERENCES everonn.workspaces(workspace_id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position>=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  profile_id text GENERATED ALWAYS AS (payload ->> 'id') STORED,
  business_name text GENERATED ALWAYS AS (payload ->> 'businessName') STORED,
  business_type text GENERATED ALWAYS AS (payload ->> 'businessType') STORED,
  email text GENERATED ALWAYS AS (payload ->> 'email') STORED,
  phone text GENERATED ALWAYS AS (payload ->> 'phone') STORED,
  location text GENERATED ALWAYS AS (payload ->> 'location') STORED,
  time_zone text GENERATED ALWAYS AS (payload ->> 'timeZone') STORED,
  updated_at text GENERATED ALWAYS AS (payload ->> 'updatedAt') STORED,
  PRIMARY KEY (workspace_id)
);

CREATE TABLE IF NOT EXISTS everonn.business_services (
  workspace_id text NOT NULL REFERENCES everonn.workspaces(workspace_id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position>=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  service_id text GENERATED ALWAYS AS (payload ->> 'id') STORED,
  name text GENERATED ALWAYS AS (payload ->> 'name') STORED,
  description text GENERATED ALWAYS AS (payload ->> 'description') STORED,
  active boolean GENERATED ALWAYS AS ((payload ->> 'active')::boolean) STORED,
  PRIMARY KEY (workspace_id, service_id)
);

CREATE TABLE IF NOT EXISTS everonn.knowledge_items (
  workspace_id text NOT NULL REFERENCES everonn.workspaces(workspace_id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position>=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  knowledge_id text GENERATED ALWAYS AS (payload ->> 'id') STORED,
  category text GENERATED ALWAYS AS (payload ->> 'category') STORED,
  question text GENERATED ALWAYS AS (payload ->> 'question') STORED,
  answer text GENERATED ALWAYS AS (payload ->> 'answer') STORED,
  approved boolean GENERATED ALWAYS AS ((payload ->> 'approved')::boolean) STORED,
  updated_at text GENERATED ALWAYS AS (payload ->> 'updatedAt') STORED,
  PRIMARY KEY (workspace_id, knowledge_id)
);

CREATE TABLE IF NOT EXISTS everonn.team_members (
  workspace_id text NOT NULL REFERENCES everonn.workspaces(workspace_id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position>=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  member_id text GENERATED ALWAYS AS (payload ->> 'id') STORED,
  name text GENERATED ALWAYS AS (payload ->> 'name') STORED,
  email text GENERATED ALWAYS AS (payload ->> 'email') STORED,
  role text GENERATED ALWAYS AS (payload ->> 'role') STORED,
  status text GENERATED ALWAYS AS (payload ->> 'status') STORED,
  PRIMARY KEY (workspace_id, member_id)
);

CREATE TABLE IF NOT EXISTS everonn.contacts (
  workspace_id text NOT NULL REFERENCES everonn.workspaces(workspace_id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position>=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  contact_id text GENERATED ALWAYS AS (payload ->> 'id') STORED,
  name text GENERATED ALWAYS AS (payload ->> 'name') STORED,
  email text GENERATED ALWAYS AS (payload ->> 'email') STORED,
  phone text GENERATED ALWAYS AS (payload ->> 'phone') STORED,
  company text GENERATED ALWAYS AS (payload ->> 'company') STORED,
  last_contact_at text GENERATED ALWAYS AS (payload ->> 'lastContactAt') STORED,
  PRIMARY KEY (workspace_id, contact_id),
  CHECK (payload->>'workspaceId' IS NOT DISTINCT FROM workspace_id)
);

CREATE TABLE IF NOT EXISTS everonn.leads (
  workspace_id text NOT NULL REFERENCES everonn.workspaces(workspace_id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position>=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  lead_id text GENERATED ALWAYS AS (payload ->> 'id') STORED,
  contact_id text GENERATED ALWAYS AS (payload ->> 'contactId') STORED,
  caller_name text GENERATED ALWAYS AS (payload ->> 'callerName') STORED,
  caller_phone text GENERATED ALWAYS AS (payload ->> 'callerPhone') STORED,
  reason text GENERATED ALWAYS AS (payload ->> 'reason') STORED,
  source text GENERATED ALWAYS AS (payload ->> 'source') STORED,
  status text GENERATED ALWAYS AS (payload ->> 'status') STORED,
  urgency text GENERATED ALWAYS AS (payload ->> 'urgency') STORED,
  created_at text GENERATED ALWAYS AS (payload ->> 'createdAt') STORED,
  PRIMARY KEY (workspace_id, lead_id),
  CHECK (payload->>'workspaceId' IS NOT DISTINCT FROM workspace_id)
);

CREATE TABLE IF NOT EXISTS everonn.conversations (
  workspace_id text NOT NULL REFERENCES everonn.workspaces(workspace_id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position>=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  conversation_id text GENERATED ALWAYS AS (payload ->> 'id') STORED,
  channel text GENERATED ALWAYS AS (payload ->> 'channel') STORED,
  status text GENERATED ALWAYS AS (payload ->> 'status') STORED,
  contact_name text GENERATED ALWAYS AS (payload ->> 'contactName') STORED,
  contact_phone text GENERATED ALWAYS AS (payload ->> 'contactPhone') STORED,
  summary text GENERATED ALWAYS AS (payload ->> 'summary') STORED,
  created_at text GENERATED ALWAYS AS (payload ->> 'createdAt') STORED,
  PRIMARY KEY (workspace_id, conversation_id),
  CHECK (payload->>'workspaceId' IS NOT DISTINCT FROM workspace_id)
);

CREATE TABLE IF NOT EXISTS everonn.appointments (
  workspace_id text NOT NULL REFERENCES everonn.workspaces(workspace_id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position>=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  appointment_id text GENERATED ALWAYS AS (payload ->> 'id') STORED,
  contact_name text GENERATED ALWAYS AS (payload ->> 'contactName') STORED,
  contact_email text GENERATED ALWAYS AS (payload ->> 'contactEmail') STORED,
  service text GENERATED ALWAYS AS (payload ->> 'service') STORED,
  date text GENERATED ALWAYS AS (payload ->> 'date') STORED,
  time text GENERATED ALWAYS AS (payload ->> 'time') STORED,
  status text GENERATED ALWAYS AS (payload ->> 'status') STORED,
  provider text GENERATED ALWAYS AS (payload ->> 'provider') STORED,
  google_event_id text GENERATED ALWAYS AS (payload ->> 'googleEventId') STORED,
  created_at text GENERATED ALWAYS AS (payload ->> 'createdAt') STORED,
  PRIMARY KEY (workspace_id, appointment_id),
  CHECK (payload->>'workspaceId' IS NOT DISTINCT FROM workspace_id)
);

CREATE TABLE IF NOT EXISTS everonn.website_projects (
  workspace_id text NOT NULL REFERENCES everonn.workspaces(workspace_id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position>=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  project_id text GENERATED ALWAYS AS (payload ->> 'id') STORED,
  public_slug text GENERATED ALWAYS AS (payload ->> 'publicSlug') STORED,
  status text GENERATED ALWAYS AS (payload ->> 'status') STORED,
  selected_concept text GENERATED ALWAYS AS (payload ->> 'selectedConcept') STORED,
  created_at text GENERATED ALWAYS AS (payload ->> 'createdAt') STORED,
  updated_at text GENERATED ALWAYS AS (payload ->> 'updatedAt') STORED,
  PRIMARY KEY (workspace_id),
  CHECK (payload->>'workspaceId' IS NOT DISTINCT FROM workspace_id)
);

CREATE TABLE IF NOT EXISTS everonn.workspace_integrations (
  workspace_id text NOT NULL REFERENCES everonn.workspaces(workspace_id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position>=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  google_calendar text GENERATED ALWAYS AS (payload ->> 'googleCalendar') STORED,
  gmail text GENERATED ALWAYS AS (payload ->> 'gmail') STORED,
  elevenlabs text GENERATED ALWAYS AS (payload ->> 'elevenLabs') STORED,
  gemini text GENERATED ALWAYS AS (payload ->> 'gemini') STORED,
  PRIMARY KEY (workspace_id)
);

CREATE TABLE IF NOT EXISTS everonn.conversation_messages (
  workspace_id text NOT NULL, conversation_id text NOT NULL,
  position integer NOT NULL CHECK (position>=0), payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  message_id text GENERATED ALWAYS AS (payload->>'id') STORED,
  role text GENERATED ALWAYS AS (payload->>'role') STORED,
  text text GENERATED ALWAYS AS (payload->>'text') STORED,
  sent_at text GENERATED ALWAYS AS (payload->>'at') STORED,
  PRIMARY KEY (workspace_id,conversation_id,message_id),
  FOREIGN KEY (workspace_id,conversation_id) REFERENCES everonn.conversations(workspace_id,conversation_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS everonn.users (
  position integer NOT NULL CHECK (position>=0), payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  user_id text GENERATED ALWAYS AS (payload->>'userId') STORED PRIMARY KEY,
  workspace_id text GENERATED ALWAYS AS (payload->>'workspaceId') STORED NOT NULL REFERENCES everonn.workspaces(workspace_id),
  member_id text GENERATED ALWAYS AS (payload->>'memberId') STORED NOT NULL,
  name text GENERATED ALWAYS AS (payload->>'name') STORED,
  email text GENERATED ALWAYS AS (lower(payload->>'email')) STORED NOT NULL UNIQUE,
  role text GENERATED ALWAYS AS (payload->>'role') STORED CHECK (role IN ('owner','manager','agent','viewer')),
  status text GENERATED ALWAYS AS (payload->>'status') STORED CHECK (status IN ('active','disabled')),
  password_hash text GENERATED ALWAYS AS (payload->>'passwordHash') STORED,
  failed_login_count integer GENERATED ALWAYS AS ((payload->>'failedLoginCount')::integer) STORED,
  locked_until text GENERATED ALWAYS AS (payload->>'lockedUntil') STORED,
  created_at text GENERATED ALWAYS AS (payload->>'createdAt') STORED,
  updated_at text GENERATED ALWAYS AS (payload->>'updatedAt') STORED,
  UNIQUE (user_id,workspace_id)
);
CREATE INDEX IF NOT EXISTS users_workspace_idx ON everonn.users(workspace_id);
CREATE TABLE IF NOT EXISTS everonn.auth_sessions (
  position integer NOT NULL CHECK (position>=0), payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  token_hash text GENERATED ALWAYS AS (payload->>'tokenHash') STORED PRIMARY KEY,
  user_id text GENERATED ALWAYS AS (payload->>'userId') STORED NOT NULL,
  workspace_id text GENERATED ALWAYS AS (payload->>'workspaceId') STORED NOT NULL,
  created_at text GENERATED ALWAYS AS (payload->>'createdAt') STORED,
  expires_at text GENERATED ALWAYS AS (payload->>'expiresAt') STORED,
  FOREIGN KEY (user_id,workspace_id) REFERENCES everonn.users(user_id,workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON everonn.auth_sessions(user_id,workspace_id);
CREATE TABLE IF NOT EXISTS everonn.invitations (
  position integer NOT NULL CHECK (position>=0), payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  token_hash text GENERATED ALWAYS AS (payload->>'tokenHash') STORED PRIMARY KEY,
  workspace_id text GENERATED ALWAYS AS (payload->>'workspaceId') STORED NOT NULL REFERENCES everonn.workspaces(workspace_id),
  member_id text GENERATED ALWAYS AS (payload->>'memberId') STORED,
  email text GENERATED ALWAYS AS (payload->>'email') STORED,
  role text GENERATED ALWAYS AS (payload->>'role') STORED CHECK (role IN ('manager','agent','viewer')),
  created_by_user_id text GENERATED ALWAYS AS (payload->>'createdByUserId') STORED,
  created_at text GENERATED ALWAYS AS (payload->>'createdAt') STORED,
  expires_at text GENERATED ALWAYS AS (payload->>'expiresAt') STORED
);
CREATE INDEX IF NOT EXISTS invitations_workspace_idx ON everonn.invitations(workspace_id);
CREATE TABLE IF NOT EXISTS everonn.provider_connections (
  workspace_id text NOT NULL REFERENCES everonn.workspaces(workspace_id),
  provider text NOT NULL CHECK (provider='google'),
  encrypted_payload jsonb NOT NULL CHECK (jsonb_typeof(encrypted_payload)='object'),
  encryption_version integer GENERATED ALWAYS AS ((encrypted_payload->>'version')::integer) STORED,
  PRIMARY KEY (workspace_id,provider)
);

CREATE TABLE IF NOT EXISTS everonn.usage_events (
  key text COLLATE "C" PRIMARY KEY CHECK (key ~ '^(events|sessions|outbox|claims|billing|system)/[A-Za-z0-9_./-]+$' AND strpos(key,'..')=0 AND key LIKE 'events/%'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id text GENERATED ALWAYS AS (payload->>'workspaceId') STORED,
  event_id text GENERATED ALWAYS AS (payload ->> 'id') STORED,
  provider text GENERATED ALWAYS AS (payload ->> 'provider') STORED,
  feature text GENERATED ALWAYS AS (payload ->> 'feature') STORED,
  model text GENERATED ALWAYS AS (payload ->> 'model') STORED,
  status text GENERATED ALWAYS AS (payload ->> 'status') STORED,
  started_at text GENERATED ALWAYS AS (payload ->> 'startedAt') STORED,
  total_tokens bigint GENERATED ALWAYS AS ((payload #>> '{tokens,total}')::bigint) STORED,
  input_tokens bigint GENERATED ALWAYS AS ((payload #>> '{tokens,input}')::bigint) STORED,
  output_tokens bigint GENERATED ALWAYS AS ((payload #>> '{tokens,output}')::bigint) STORED,
  thinking_tokens bigint GENERATED ALWAYS AS ((payload #>> '{tokens,thinking}')::bigint) STORED,
  credits numeric GENERATED ALWAYS AS ((payload #>> '{voice,credits}')::numeric) STORED,
  duration_seconds numeric GENERATED ALWAYS AS ((payload #>> '{voice,durationSeconds}')::numeric) STORED,
  reported_cost_usd numeric GENERATED ALWAYS AS ((payload #>> '{voice,costUsd}')::numeric) STORED,
  estimated_cost_usd numeric GENERATED ALWAYS AS ((payload #>> '{estimatedCost,usd}')::numeric) STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS usage_events_prefix_idx ON everonn.usage_events(key text_pattern_ops);
CREATE INDEX IF NOT EXISTS usage_events_workspace_idx ON everonn.usage_events(workspace_id,key);

CREATE TABLE IF NOT EXISTS everonn.usage_sessions (
  key text COLLATE "C" PRIMARY KEY CHECK (key ~ '^(events|sessions|outbox|claims|billing|system)/[A-Za-z0-9_./-]+$' AND strpos(key,'..')=0 AND key LIKE 'sessions/%'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id text GENERATED ALWAYS AS (payload->>'workspaceId') STORED,
  session_id text GENERATED ALWAYS AS (payload ->> 'id') STORED,
  feature text GENERATED ALWAYS AS (payload ->> 'feature') STORED,
  agent_id text GENERATED ALWAYS AS (payload ->> 'agentId') STORED,
  complete boolean GENERATED ALWAYS AS ((payload ->> 'complete')::boolean) STORED,
  synced_at text GENERATED ALWAYS AS (payload ->> 'syncedAt') STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS usage_sessions_prefix_idx ON everonn.usage_sessions(key text_pattern_ops);
CREATE INDEX IF NOT EXISTS usage_sessions_workspace_idx ON everonn.usage_sessions(workspace_id,key);

CREATE TABLE IF NOT EXISTS everonn.usage_outbox (
  key text COLLATE "C" PRIMARY KEY CHECK (key ~ '^(events|sessions|outbox|claims|billing|system)/[A-Za-z0-9_./-]+$' AND strpos(key,'..')=0 AND key LIKE 'outbox/%'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id text GENERATED ALWAYS AS (payload->>'workspaceId') STORED,
  event_id text GENERATED ALWAYS AS (payload ->> 'id') STORED,
  provider text GENERATED ALWAYS AS (payload ->> 'provider') STORED,
  feature text GENERATED ALWAYS AS (payload ->> 'feature') STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS usage_outbox_prefix_idx ON everonn.usage_outbox(key text_pattern_ops);
CREATE INDEX IF NOT EXISTS usage_outbox_workspace_idx ON everonn.usage_outbox(workspace_id,key);

CREATE TABLE IF NOT EXISTS everonn.usage_claims (
  key text COLLATE "C" PRIMARY KEY CHECK (key ~ '^(events|sessions|outbox|claims|billing|system)/[A-Za-z0-9_./-]+$' AND strpos(key,'..')=0 AND key LIKE 'claims/%'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id text GENERATED ALWAYS AS (payload->>'workspaceId') STORED,
  event_id text GENERATED ALWAYS AS (payload ->> 'eventId') STORED,
  feature text GENERATED ALWAYS AS (payload ->> 'feature') STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS usage_claims_prefix_idx ON everonn.usage_claims(key text_pattern_ops);
CREATE INDEX IF NOT EXISTS usage_claims_workspace_idx ON everonn.usage_claims(workspace_id,key);

CREATE TABLE IF NOT EXISTS everonn.billing_reports (
  key text COLLATE "C" PRIMARY KEY CHECK (key ~ '^(events|sessions|outbox|claims|billing|system)/[A-Za-z0-9_./-]+$' AND strpos(key,'..')=0 AND key LIKE 'billing/%'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id text GENERATED ALWAYS AS (payload->>'workspaceId') STORED,
  refreshed_at text GENERATED ALWAYS AS (payload ->> 'refreshedAt') STORED,
  time_zone text GENERATED ALWAYS AS (payload ->> 'timeZone') STORED,
  error text GENERATED ALWAYS AS (payload ->> 'error') STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS billing_reports_prefix_idx ON everonn.billing_reports(key text_pattern_ops);
CREATE INDEX IF NOT EXISTS billing_reports_workspace_idx ON everonn.billing_reports(workspace_id,key);

CREATE TABLE IF NOT EXISTS everonn.usage_worker_state (
  key text COLLATE "C" PRIMARY KEY CHECK (key ~ '^(events|sessions|outbox|claims|billing|system)/[A-Za-z0-9_./-]+$' AND strpos(key,'..')=0 AND key='system/worker'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id text GENERATED ALWAYS AS (payload->>'workspaceId') STORED,
  last_started_at text GENERATED ALWAYS AS (payload ->> 'lastStartedAt') STORED,
  last_finished_at text GENERATED ALWAYS AS (payload ->> 'lastFinishedAt') STORED,
  error text GENERATED ALWAYS AS (payload ->> 'error') STORED,
  checked bigint GENERATED ALWAYS AS ((payload ->> 'checked')::bigint) STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS usage_worker_state_prefix_idx ON everonn.usage_worker_state(key text_pattern_ops);
CREATE INDEX IF NOT EXISTS usage_worker_state_workspace_idx ON everonn.usage_worker_state(workspace_id,key);

CREATE TABLE IF NOT EXISTS everonn.usage_job_nonces (
  key text COLLATE "C" PRIMARY KEY CHECK (key ~ '^(events|sessions|outbox|claims|billing|system)/[A-Za-z0-9_./-]+$' AND strpos(key,'..')=0 AND key LIKE 'system/job-auth/%'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id text GENERATED ALWAYS AS (payload->>'workspaceId') STORED,
  accepted_at text GENERATED ALWAYS AS (payload ->> 'acceptedAt') STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS usage_job_nonces_prefix_idx ON everonn.usage_job_nonces(key text_pattern_ops);
CREATE INDEX IF NOT EXISTS usage_job_nonces_workspace_idx ON everonn.usage_job_nonces(workspace_id,key);

CREATE TABLE IF NOT EXISTS everonn.usage_webhook_receipts (
  key text COLLATE "C" PRIMARY KEY CHECK (key ~ '^(events|sessions|outbox|claims|billing|system)/[A-Za-z0-9_./-]+$' AND strpos(key,'..')=0 AND key LIKE 'system/webhooks/%'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id text GENERATED ALWAYS AS (payload->>'workspaceId') STORED,
  received_at text GENERATED ALWAYS AS (payload ->> 'receivedAt') STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS usage_webhook_receipts_prefix_idx ON everonn.usage_webhook_receipts(key text_pattern_ops);
CREATE INDEX IF NOT EXISTS usage_webhook_receipts_workspace_idx ON everonn.usage_webhook_receipts(workspace_id,key);

CREATE TABLE IF NOT EXISTS everonn.usage_system_records (
  key text COLLATE "C" PRIMARY KEY CHECK (key ~ '^(events|sessions|outbox|claims|billing|system)/[A-Za-z0-9_./-]+$' AND strpos(key,'..')=0 AND key LIKE 'system/%'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id text GENERATED ALWAYS AS (payload->>'workspaceId') STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS usage_system_records_prefix_idx ON everonn.usage_system_records(key text_pattern_ops);
CREATE INDEX IF NOT EXISTS usage_system_records_workspace_idx ON everonn.usage_system_records(workspace_id,key);

CREATE TABLE IF NOT EXISTS everonn.worker_requests (
  request_id bigint PRIMARY KEY, requested_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

-- Reads rebuild the public app shapes from individual entity rows.
CREATE OR REPLACE VIEW everonn.app_records WITH (security_invoker=true) AS
SELECT r.key,
  CASE
  WHEN r.key='auth/accounts' THEN r.envelope || jsonb_build_object(
    'users',coalesce((SELECT jsonb_agg(u.payload ORDER BY u.position) FROM everonn.users u),'[]'::jsonb),
    'sessions',coalesce((SELECT jsonb_agg(s.payload ORDER BY s.position) FROM everonn.auth_sessions s),'[]'::jsonb),
    'invitations',coalesce((SELECT jsonb_agg(i.payload ORDER BY i.position) FROM everonn.invitations i),'[]'::jsonb))
  WHEN r.key='providers/google' THEN r.envelope || jsonb_build_object('google',
    coalesce((SELECT jsonb_object_agg(c.workspace_id,c.encrypted_payload) FROM everonn.provider_connections c WHERE c.provider='google'),'{}'::jsonb))
  ELSE w.envelope || jsonb_build_object(
    'profile',p.payload || jsonb_build_object(
      'services',coalesce((SELECT jsonb_agg(s.payload ORDER BY s.position) FROM everonn.business_services s WHERE s.workspace_id=w.workspace_id),'[]'::jsonb),
      'knowledge',coalesce((SELECT jsonb_agg(k.payload ORDER BY k.position) FROM everonn.knowledge_items k WHERE k.workspace_id=w.workspace_id),'[]'::jsonb)),
    'team',coalesce((SELECT jsonb_agg(t.payload ORDER BY t.position) FROM everonn.team_members t WHERE t.workspace_id=w.workspace_id),'[]'::jsonb),
    'contacts',coalesce((SELECT jsonb_agg(c.payload ORDER BY c.position) FROM everonn.contacts c WHERE c.workspace_id=w.workspace_id),'[]'::jsonb),
    'leads',coalesce((SELECT jsonb_agg(l.payload ORDER BY l.position) FROM everonn.leads l WHERE l.workspace_id=w.workspace_id),'[]'::jsonb),
    'conversations',coalesce((SELECT jsonb_agg(c.payload || jsonb_build_object('messages',
      coalesce((SELECT jsonb_agg(m.payload ORDER BY m.position) FROM everonn.conversation_messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.conversation_id),'[]'::jsonb))
      ORDER BY c.position) FROM everonn.conversations c WHERE c.workspace_id=w.workspace_id),'[]'::jsonb),
    'appointments',coalesce((SELECT jsonb_agg(a.payload ORDER BY a.position) FROM everonn.appointments a WHERE a.workspace_id=w.workspace_id),'[]'::jsonb),
    'websiteProject',(SELECT x.payload FROM everonn.website_projects x WHERE x.workspace_id=w.workspace_id),
    'integrations',(SELECT i.payload FROM everonn.workspace_integrations i WHERE i.workspace_id=w.workspace_id))
  END AS payload,
  r.revision,w.workspace_id,r.created_at,r.updated_at
FROM everonn.record_revisions r
LEFT JOIN everonn.workspaces w ON w.record_key=r.key
LEFT JOIN everonn.business_profiles p ON p.workspace_id=w.workspace_id
WHERE r.key IN ('auth/accounts','providers/google') OR p.workspace_id IS NOT NULL;

CREATE OR REPLACE FUNCTION everonn.write_app_record(
  p_key text,p_payload jsonb,p_expected_revision uuid DEFAULT NULL,p_insert_only boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
DECLARE changed integer; workspace text; old_workspace text; item jsonb; ordinal bigint;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_payload->>'version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Invalid versioned application payload';
  END IF;
  IF p_insert_only AND p_expected_revision IS NOT NULL THEN RAISE EXCEPTION 'Conflicting application write conditions'; END IF;
  IF p_insert_only THEN
    INSERT INTO everonn.record_revisions(key,envelope) VALUES(p_key,'{}'::jsonb) ON CONFLICT(key) DO NOTHING;
  ELSIF p_expected_revision IS NOT NULL THEN
    UPDATE everonn.record_revisions SET revision=gen_random_uuid(),updated_at=clock_timestamp()
    WHERE key=p_key AND revision=p_expected_revision;
  ELSE RAISE EXCEPTION 'Application writes require a revision or insert-only condition';
  END IF;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN RETURN false; END IF;

  IF p_key='auth/accounts' THEN
    IF jsonb_typeof(p_payload->'users') IS DISTINCT FROM 'array'
      OR jsonb_typeof(p_payload->'sessions') IS DISTINCT FROM 'array'
      OR jsonb_typeof(p_payload->'invitations') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid account collections';
    END IF;
    -- Legacy registration reserves the account before writing its workspace.
    -- A reservation has no profile/record_key and is never returned as a workspace.
    INSERT INTO everonn.workspaces(workspace_id)
    SELECT DISTINCT value->>'workspaceId' FROM jsonb_array_elements((p_payload->'users') || (p_payload->'invitations'))
    ON CONFLICT(workspace_id) DO NOTHING;
    DELETE FROM everonn.auth_sessions;
    DELETE FROM everonn.invitations;
    DELETE FROM everonn.users WHERE user_id NOT IN (SELECT value->>'userId' FROM jsonb_array_elements(p_payload->'users'));
    INSERT INTO everonn.users(position,payload)
    SELECT ordinality-1,value FROM jsonb_array_elements(p_payload->'users') WITH ORDINALITY
    ON CONFLICT(user_id) DO UPDATE SET position=EXCLUDED.position,payload=EXCLUDED.payload;
    INSERT INTO everonn.auth_sessions(position,payload)
    SELECT ordinality-1,value FROM jsonb_array_elements(p_payload->'sessions') WITH ORDINALITY;
    INSERT INTO everonn.invitations(position,payload)
    SELECT ordinality-1,value FROM jsonb_array_elements(p_payload->'invitations') WITH ORDINALITY;
    UPDATE everonn.record_revisions SET envelope=p_payload-ARRAY['users','sessions','invitations'] WHERE key=p_key;
  ELSIF p_key='providers/google' THEN
    IF jsonb_typeof(p_payload->'google') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid provider collection'; END IF;
    INSERT INTO everonn.workspaces(workspace_id) SELECT key FROM jsonb_each(p_payload->'google') ON CONFLICT(workspace_id) DO NOTHING;
    DELETE FROM everonn.provider_connections WHERE provider='google';
    INSERT INTO everonn.provider_connections(workspace_id,provider,encrypted_payload)
    SELECT key,'google',value FROM jsonb_each(p_payload->'google');
    UPDATE everonn.record_revisions SET envelope=p_payload-'google' WHERE key=p_key;
  ELSE
    workspace:=p_payload->>'workspaceId';
    IF workspace IS NULL OR workspace='' OR jsonb_typeof(p_payload->'profile') IS DISTINCT FROM 'object'
      OR p_payload->'profile'->>'workspaceId' IS DISTINCT FROM workspace
      OR jsonb_typeof(p_payload->'integrations') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Invalid workspace scope or profile';
    END IF;
    SELECT workspace_id INTO old_workspace FROM everonn.workspaces WHERE record_key=p_key;
    IF old_workspace IS NOT NULL AND old_workspace<>workspace THEN RAISE EXCEPTION 'Workspace identity cannot change'; END IF;
    IF EXISTS(SELECT 1 FROM everonn.workspaces WHERE workspace_id=workspace AND record_key IS NOT NULL AND record_key<>p_key) THEN
      RAISE EXCEPTION 'Workspace already has a different record';
    END IF;
    INSERT INTO everonn.workspaces(workspace_id,record_key,envelope)
    VALUES(workspace,p_key,p_payload-ARRAY['profile','team','contacts','leads','conversations','appointments','websiteProject','integrations'])
    ON CONFLICT(workspace_id) DO UPDATE SET record_key=EXCLUDED.record_key,envelope=EXCLUDED.envelope;
    DELETE FROM everonn.business_profiles WHERE workspace_id=workspace;
    IF jsonb_typeof((p_payload->'profile')-ARRAY['services','knowledge'])='object' THEN
      INSERT INTO everonn.business_profiles(workspace_id,payload) VALUES(workspace,(p_payload->'profile')-ARRAY['services','knowledge']);
    END IF;
    DELETE FROM everonn.website_projects WHERE workspace_id=workspace;
    IF jsonb_typeof(p_payload->'websiteProject')='object' THEN
      INSERT INTO everonn.website_projects(workspace_id,payload) VALUES(workspace,p_payload->'websiteProject');
    END IF;
    DELETE FROM everonn.workspace_integrations WHERE workspace_id=workspace;
    IF jsonb_typeof(p_payload->'integrations')='object' THEN
      INSERT INTO everonn.workspace_integrations(workspace_id,payload) VALUES(workspace,p_payload->'integrations');
    END IF;
    IF jsonb_typeof(p_payload->'profile'->'services') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid business_services collection'; END IF;
    DELETE FROM everonn.business_services WHERE workspace_id=workspace;
    INSERT INTO everonn.business_services(workspace_id,position,payload)
    SELECT workspace,ordinality-1,value FROM jsonb_array_elements(p_payload->'profile'->'services') WITH ORDINALITY;
    IF jsonb_typeof(p_payload->'profile'->'knowledge') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid knowledge_items collection'; END IF;
    DELETE FROM everonn.knowledge_items WHERE workspace_id=workspace;
    INSERT INTO everonn.knowledge_items(workspace_id,position,payload)
    SELECT workspace,ordinality-1,value FROM jsonb_array_elements(p_payload->'profile'->'knowledge') WITH ORDINALITY;
    IF jsonb_typeof(p_payload->'team') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid team_members collection'; END IF;
    DELETE FROM everonn.team_members WHERE workspace_id=workspace;
    INSERT INTO everonn.team_members(workspace_id,position,payload)
    SELECT workspace,ordinality-1,value FROM jsonb_array_elements(p_payload->'team') WITH ORDINALITY;
    IF jsonb_typeof(p_payload->'contacts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid contacts collection'; END IF;
    DELETE FROM everonn.contacts WHERE workspace_id=workspace;
    INSERT INTO everonn.contacts(workspace_id,position,payload)
    SELECT workspace,ordinality-1,value FROM jsonb_array_elements(p_payload->'contacts') WITH ORDINALITY;
    IF jsonb_typeof(p_payload->'leads') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid leads collection'; END IF;
    DELETE FROM everonn.leads WHERE workspace_id=workspace;
    INSERT INTO everonn.leads(workspace_id,position,payload)
    SELECT workspace,ordinality-1,value FROM jsonb_array_elements(p_payload->'leads') WITH ORDINALITY;
    IF jsonb_typeof(p_payload->'conversations') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid conversations collection'; END IF;
    DELETE FROM everonn.conversations WHERE workspace_id=workspace;
    INSERT INTO everonn.conversations(workspace_id,position,payload)
    SELECT workspace,ordinality-1,value-'messages' FROM jsonb_array_elements(p_payload->'conversations') WITH ORDINALITY;
    IF jsonb_typeof(p_payload->'appointments') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid appointments collection'; END IF;
    DELETE FROM everonn.appointments WHERE workspace_id=workspace;
    INSERT INTO everonn.appointments(workspace_id,position,payload)
    SELECT workspace,ordinality-1,value FROM jsonb_array_elements(p_payload->'appointments') WITH ORDINALITY;

    FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'conversations') LOOP
      IF jsonb_typeof(item->'messages') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid conversation messages'; END IF;
      INSERT INTO everonn.conversation_messages(workspace_id,conversation_id,position,payload)
      SELECT workspace,item->>'id',ordinality-1,value FROM jsonb_array_elements(item->'messages') WITH ORDINALITY;
    END LOOP;
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION everonn.remove_app_record(p_key text,p_revision uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
DECLARE changed integer;
BEGIN
  PERFORM 1 FROM everonn.record_revisions WHERE key=p_key AND revision=p_revision FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_key='auth/accounts' THEN
    DELETE FROM everonn.auth_sessions; DELETE FROM everonn.invitations; DELETE FROM everonn.users;
  ELSIF p_key='providers/google' THEN DELETE FROM everonn.provider_connections WHERE provider='google';
  END IF;
  DELETE FROM everonn.record_revisions WHERE key=p_key AND revision=p_revision;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END;
$function$;

CREATE OR REPLACE VIEW everonn.usage_records WITH (security_invoker=true) AS
SELECT key,payload,revision,split_part(key,'/',1) AS record_type,workspace_id,created_at,updated_at FROM everonn.usage_events
UNION ALL
SELECT key,payload,revision,split_part(key,'/',1) AS record_type,workspace_id,created_at,updated_at FROM everonn.usage_sessions
UNION ALL
SELECT key,payload,revision,split_part(key,'/',1) AS record_type,workspace_id,created_at,updated_at FROM everonn.usage_outbox
UNION ALL
SELECT key,payload,revision,split_part(key,'/',1) AS record_type,workspace_id,created_at,updated_at FROM everonn.usage_claims
UNION ALL
SELECT key,payload,revision,split_part(key,'/',1) AS record_type,workspace_id,created_at,updated_at FROM everonn.billing_reports
UNION ALL
SELECT key,payload,revision,split_part(key,'/',1) AS record_type,workspace_id,created_at,updated_at FROM everonn.usage_worker_state
UNION ALL
SELECT key,payload,revision,split_part(key,'/',1) AS record_type,workspace_id,created_at,updated_at FROM everonn.usage_job_nonces
UNION ALL
SELECT key,payload,revision,split_part(key,'/',1) AS record_type,workspace_id,created_at,updated_at FROM everonn.usage_webhook_receipts
UNION ALL
SELECT key,payload,revision,split_part(key,'/',1) AS record_type,workspace_id,created_at,updated_at FROM everonn.usage_system_records;

CREATE OR REPLACE FUNCTION everonn.usage_record_table(p_key text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=''
AS $function$
BEGIN
  IF p_key IS NULL OR p_key !~ '^(events|sessions|outbox|claims|billing|system)/[A-Za-z0-9_./-]+$' OR strpos(p_key,'..')<>0 THEN
    RAISE EXCEPTION 'Invalid usage record key';
  END IF;
  IF p_key LIKE 'events/%' THEN RETURN 'usage_events'; END IF;
  IF p_key LIKE 'sessions/%' THEN RETURN 'usage_sessions'; END IF;
  IF p_key LIKE 'outbox/%' THEN RETURN 'usage_outbox'; END IF;
  IF p_key LIKE 'claims/%' THEN RETURN 'usage_claims'; END IF;
  IF p_key LIKE 'billing/%' THEN RETURN 'billing_reports'; END IF;
  IF p_key = 'system/worker' THEN RETURN 'usage_worker_state'; END IF;
  IF p_key LIKE 'system/job-auth/%' THEN RETURN 'usage_job_nonces'; END IF;
  IF p_key LIKE 'system/webhooks/%' THEN RETURN 'usage_webhook_receipts'; END IF;
  RETURN 'usage_system_records';
END;
$function$;

CREATE OR REPLACE FUNCTION everonn.write_usage_record(
  p_key text,p_payload jsonb,p_expected_revision uuid DEFAULT NULL,p_insert_only boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
DECLARE target text; changed integer;
BEGIN
  target:=everonn.usage_record_table(p_key);
  IF p_insert_only AND p_expected_revision IS NOT NULL THEN RAISE EXCEPTION 'Conflicting usage write conditions'; END IF;
  IF p_insert_only THEN
    EXECUTE format('INSERT INTO everonn.%I(key,payload) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',target) USING p_key,p_payload;
  ELSIF p_expected_revision IS NOT NULL THEN
    EXECUTE format('UPDATE everonn.%I SET payload=$2,revision=gen_random_uuid(),updated_at=clock_timestamp() WHERE key=$1 AND revision=$3',target)
    USING p_key,p_payload,p_expected_revision;
  ELSE
    EXECUTE format('INSERT INTO everonn.%I(key,payload) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload,revision=gen_random_uuid(),updated_at=clock_timestamp()',target)
    USING p_key,p_payload;
  END IF;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END;
$function$;

CREATE OR REPLACE FUNCTION everonn.remove_usage_record(p_key text,p_revision uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
DECLARE target text; changed integer;
BEGIN
  target:=everonn.usage_record_table(p_key);
  EXECUTE format('DELETE FROM everonn.%I WHERE key=$1 AND ($2::uuid IS NULL OR revision=$2)',target) USING p_key,p_revision;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END;
$function$;

-- Lock and migrate only the two recognized EverOnn record stores.
-- Backups retain original payloads and revisions; they are never active stores.
DO $migrate$
DECLARE row record; target text; definition text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM everonn.schema_migrations WHERE version='202610040003' AND component='everonn-core') THEN
    IF NOT EXISTS(SELECT 1 FROM everonn_app.schema_migrations WHERE version='202610040002' AND component='everonn-app')
      OR NOT EXISTS(SELECT 1 FROM everonn_usage.schema_migrations WHERE version='202610030001' AND component='everonn-usage') THEN
      RAISE EXCEPTION 'Apply recognized legacy EverOnn migrations before consolidation';
    END IF;
    LOCK TABLE everonn_app.app_records,everonn_usage.usage_records IN ACCESS EXCLUSIVE MODE;
    FOR row IN SELECT * FROM everonn_app.app_records ORDER BY CASE WHEN key LIKE 'workspaces/%' THEN 0 ELSE 1 END,key LOOP
      PERFORM everonn.write_app_record(row.key,row.payload,NULL,true);
      UPDATE everonn.record_revisions SET revision=row.revision,created_at=row.created_at,updated_at=row.updated_at WHERE key=row.key;
    END LOOP;
    FOR row IN SELECT * FROM everonn_usage.usage_records LOOP
      PERFORM everonn.write_usage_record(row.key,row.payload,NULL,true);
      target:=everonn.usage_record_table(row.key);
      EXECUTE format('UPDATE everonn.%I SET revision=$2,created_at=$3,updated_at=$4 WHERE key=$1',target)
      USING row.key,row.revision,row.created_at,row.updated_at;
    END LOOP;
    IF EXISTS(
      (SELECT key,payload,revision,created_at,updated_at FROM everonn_app.app_records
       EXCEPT SELECT key,payload,revision,created_at,updated_at FROM everonn.app_records)
      UNION ALL
      (SELECT key,payload,revision,created_at,updated_at FROM everonn.app_records
       EXCEPT SELECT key,payload,revision,created_at,updated_at FROM everonn_app.app_records)
    ) THEN RAISE EXCEPTION 'Application round-trip mismatch; migration rolled back'; END IF;
    IF EXISTS(
      (SELECT key,payload,revision,created_at,updated_at FROM everonn_usage.usage_records
       EXCEPT SELECT key,payload,revision,created_at,updated_at FROM everonn.usage_records)
      UNION ALL
      (SELECT key,payload,revision,created_at,updated_at FROM everonn.usage_records
       EXCEPT SELECT key,payload,revision,created_at,updated_at FROM everonn_usage.usage_records)
    ) THEN RAISE EXCEPTION 'Usage round-trip mismatch; migration rolled back'; END IF;
    INSERT INTO everonn.schema_migrations SELECT * FROM everonn_app.schema_migrations;
    INSERT INTO everonn.schema_migrations SELECT * FROM everonn_usage.schema_migrations ON CONFLICT(version) DO NOTHING;
    ALTER TABLE everonn_app.app_records RENAME TO legacy_app_records;
    ALTER TABLE everonn_app.legacy_app_records SET SCHEMA everonn;
    ALTER TABLE everonn_usage.usage_records RENAME TO legacy_usage_records;
    ALTER TABLE everonn_usage.legacy_usage_records SET SCHEMA everonn;
    -- Schema migration tables contain metadata only, with no application data.
    DROP TABLE everonn_app.schema_migrations;
    DROP TABLE everonn_usage.schema_migrations;
    IF to_regclass('everonn_usage.worker_requests') IS NOT NULL THEN
      LOCK TABLE everonn_usage.worker_requests IN ACCESS EXCLUSIVE MODE;
      INSERT INTO everonn.worker_requests SELECT * FROM everonn_usage.worker_requests;
      ALTER TABLE everonn_usage.worker_requests RENAME TO legacy_worker_requests;
      ALTER TABLE everonn_usage.legacy_worker_requests RENAME CONSTRAINT worker_requests_pkey TO legacy_worker_requests_pkey;
      ALTER TABLE everonn_usage.legacy_worker_requests SET SCHEMA everonn;
    END IF;
    IF to_regprocedure('everonn_usage.invoke_usage_worker()') IS NOT NULL THEN
      SELECT pg_get_functiondef(to_regprocedure('everonn_usage.invoke_usage_worker()')) INTO definition;
      definition:=replace(definition,'FUNCTION everonn_usage.invoke_usage_worker','FUNCTION everonn.invoke_usage_worker');
      definition:=replace(definition,'everonn_usage.worker_requests','everonn.worker_requests');
      definition:=replace(definition,'everonn_usage.usage_records','everonn.usage_records');
      EXECUTE definition;
      EXECUTE 'CREATE OR REPLACE FUNCTION everonn_usage.invoke_usage_worker() RETURNS bigint LANGUAGE sql SECURITY INVOKER SET search_path='''' AS ''SELECT everonn.invoke_usage_worker()''';
      EXECUTE 'REVOKE ALL ON FUNCTION everonn.invoke_usage_worker() FROM PUBLIC,anon,authenticated,service_role';
      EXECUTE 'REVOKE ALL ON FUNCTION everonn_usage.invoke_usage_worker() FROM PUBLIC,anon,authenticated,service_role';
    END IF;
  END IF;
END;
$migrate$;

CREATE OR REPLACE VIEW everonn_app.app_records WITH (security_invoker=true) AS SELECT * FROM everonn.app_records;
CREATE OR REPLACE VIEW everonn_app.schema_migrations WITH (security_invoker=true) AS
SELECT * FROM everonn.schema_migrations WHERE component='everonn-app';
CREATE OR REPLACE VIEW everonn_usage.usage_records WITH (security_invoker=true) AS SELECT * FROM everonn.usage_records;
CREATE OR REPLACE VIEW everonn_usage.schema_migrations WITH (security_invoker=true) AS
SELECT * FROM everonn.schema_migrations WHERE component IN ('everonn-usage','everonn-usage-scheduler');
CREATE OR REPLACE VIEW everonn_usage.worker_requests WITH (security_invoker=true) AS SELECT * FROM everonn.worker_requests;

CREATE OR REPLACE FUNCTION everonn_app.write_app_record(p_key text,p_payload jsonb,p_expected_revision uuid DEFAULT NULL,p_insert_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT everonn.write_app_record(p_key,p_payload,p_expected_revision,p_insert_only) $function$;
CREATE OR REPLACE FUNCTION everonn_usage.write_usage_record(p_key text,p_payload jsonb,p_expected_revision uuid DEFAULT NULL,p_insert_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT everonn.write_usage_record(p_key,p_payload,p_expected_revision,p_insert_only) $function$;

CREATE OR REPLACE FUNCTION everonn.delete_app_view() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
BEGIN
  IF everonn.remove_app_record(OLD.key,OLD.revision) THEN RETURN OLD; END IF;
  RETURN NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION everonn.delete_usage_view() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
BEGIN
  IF everonn.remove_usage_record(OLD.key,OLD.revision) THEN RETURN OLD; END IF;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS app_records_delete ON everonn.app_records;
CREATE TRIGGER app_records_delete INSTEAD OF DELETE ON everonn.app_records FOR EACH ROW EXECUTE FUNCTION everonn.delete_app_view();
DROP TRIGGER IF EXISTS app_records_delete ON everonn_app.app_records;
CREATE TRIGGER app_records_delete INSTEAD OF DELETE ON everonn_app.app_records FOR EACH ROW EXECUTE FUNCTION everonn.delete_app_view();
DROP TRIGGER IF EXISTS usage_records_delete ON everonn.usage_records;
CREATE TRIGGER usage_records_delete INSTEAD OF DELETE ON everonn.usage_records FOR EACH ROW EXECUTE FUNCTION everonn.delete_usage_view();
DROP TRIGGER IF EXISTS usage_records_delete ON everonn_usage.usage_records;
CREATE TRIGGER usage_records_delete INSTEAD OF DELETE ON everonn_usage.usage_records FOR EACH ROW EXECUTE FUNCTION everonn.delete_usage_view();

-- Browser roles cannot use this private schema. The service role can reach
-- metering only; it cannot read accounts, password hashes or provider secrets.
REVOKE ALL ON ALL TABLES IN SCHEMA everonn FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA everonn FROM PUBLIC,anon,authenticated,service_role;
DO $security$
DECLARE row record;
BEGIN
  FOR row IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='everonn' AND c.relkind IN ('r','p') LOOP
    EXECUTE format('ALTER TABLE everonn.%I ENABLE ROW LEVEL SECURITY',row.relname);
  END LOOP;
END;
$security$;
GRANT USAGE ON SCHEMA everonn TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON everonn.usage_events,everonn.usage_sessions,everonn.usage_outbox,everonn.usage_claims,everonn.billing_reports,everonn.usage_worker_state,everonn.usage_job_nonces,everonn.usage_webhook_receipts,everonn.usage_system_records TO service_role;
GRANT SELECT,DELETE ON everonn.usage_records,everonn_usage.usage_records TO service_role;
GRANT SELECT ON everonn.schema_migrations,everonn_usage.schema_migrations TO service_role;
GRANT EXECUTE ON FUNCTION everonn.usage_record_table(text),everonn.write_usage_record(text,jsonb,uuid,boolean),everonn.remove_usage_record(text,uuid),everonn.delete_usage_view(),everonn_usage.write_usage_record(text,jsonb,uuid,boolean) TO service_role;
REVOKE ALL ON everonn_usage.worker_requests FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON everonn_app.app_records,everonn_app.schema_migrations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION everonn_app.write_app_record(text,jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA everonn REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA everonn REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO everonn.schema_migrations(version,component) VALUES('202610040003','everonn-core') ON CONFLICT(version) DO NOTHING;
COMMIT;

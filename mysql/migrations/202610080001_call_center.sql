-- EverOnn Live Agent Desk (call center) schema for MySQL 8.0+ / 8.4 LTS.
--
-- Implements the human-operations tables of the platform specification
-- (§16 HIL/DSK, §21.1 "Human operations and desk", §21.5 DDL excerpts) under
-- the §21.2 conventions:
--   * IDs are UUIDv7 stored as BINARY(16); the API exposes prefixed strings.
--   * Tenant-owned tables lead every key with tenant_id and every foreign key
--     carries tenant_id, so cross-tenant references are impossible.
--   * Timestamps are DATETIME(3) UTC; mutable aggregates carry `version`.
--   * JSON columns are validated; anything filtered on is a real column.
--   * Platform-level tables (operators, grants, presence) are not tenant-owned.
--
-- Time partitioning of high-volume tables (§21.3) is intentionally deferred:
-- InnoDB does not allow foreign keys on partitioned tables, and these tables
-- rely on composite tenant foreign keys for isolation.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Tenancy (desk-relevant subset of §21.1 "Tenancy and identity")
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id                 BINARY(16)   NOT NULL,
  slug               VARCHAR(63)  NOT NULL,
  display_name       VARCHAR(200) NOT NULL,
  brand_name         VARCHAR(120) NOT NULL DEFAULT 'EverOnn',
  vertical           VARCHAR(48)  NOT NULL DEFAULT 'general',
  state              ENUM('prospect','preview','trial','active','past_due','suspended','closed') NOT NULL DEFAULT 'active',
  desk_mode          ENUM('owner','managed','shadow') NOT NULL DEFAULT 'managed',
  time_zone          VARCHAR(64)  NOT NULL,
  workspace_ref      VARCHAR(120) NULL COMMENT 'Existing EverOnn workspace id, when linked',
  created_at         DATETIME(3)  NOT NULL,
  updated_at         DATETIME(3)  NOT NULL,
  version            INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenants_slug (slug),
  KEY ix_tenants_workspace (workspace_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Telephony and channels: a "line" is a channel endpoint (DSK-003 routing key)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS phone_numbers (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  e164               VARCHAR(16)  NOT NULL,
  carrier            VARCHAR(48)  NOT NULL DEFAULT 'unassigned',
  capabilities       JSON         NOT NULL,
  status             ENUM('active','porting','released') NOT NULL DEFAULT 'active',
  created_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_phone_numbers_e164 (e164),
  CONSTRAINT fk_phone_numbers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT ck_phone_numbers_e164 CHECK (e164 REGEXP '^\\+[1-9][0-9]{6,14}$'),
  CONSTRAINT ck_phone_numbers_caps CHECK (JSON_VALID(capabilities))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS channel_endpoints (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  kind               ENUM('voice','sms','chat') NOT NULL,
  label              VARCHAR(120) NOT NULL COMMENT 'Shown to operators, e.g. "After-hours emergency line"',
  phone_number_id    BINARY(16)   NULL,
  widget_key         VARCHAR(64)  NULL,
  hours_mode         ENUM('business_hours','after_hours','any') NOT NULL DEFAULT 'any',
  status             ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_channel_endpoints_widget (widget_key),
  KEY ix_channel_endpoints_number (tenant_id, phone_number_id),
  CONSTRAINT fk_channel_endpoints_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_channel_endpoints_number FOREIGN KEY (tenant_id, phone_number_id) REFERENCES phone_numbers (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Client desk configuration (§21.5 client_desk_profiles, DSK-006/007/008)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS client_desk_profiles (
  tenant_id          BINARY(16)   NOT NULL,
  spoken_name        VARCHAR(200) NOT NULL,
  pronunciation      VARCHAR(200) NULL,
  brand_color        CHAR(7)      NOT NULL,
  authority_matrix   JSON         NOT NULL COMMENT 'capability -> allowed | requires_owner_approval | not_allowed',
  operator_notes     TEXT         NULL,
  special_handling   JSON         NOT NULL COMMENT 'VIP list, blocked addresses, special instructions',
  business_facts     JSON         NOT NULL COMMENT 'hours, services, service area, pricing policy, payment methods',
  do_not_say         JSON         NOT NULL,
  coverage           JSON         NOT NULL COMMENT 'Weekly windows in which operators may take this client',
  visible_fields     JSON         NOT NULL COMMENT 'Request fields exposed to operators (DSK-010)',
  required_wrap_fields JSON       NOT NULL COMMENT 'Wrap-up fields this client requires (DSK-019)',
  playbook_slots     JSON         NOT NULL COMMENT 'Checklist slots the operator completes (DSK-007)',
  canned_replies     JSON         NOT NULL,
  announcement_enabled TINYINT(1) NOT NULL DEFAULT 1,
  wrap_up_seconds    SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  version            INT          NOT NULL DEFAULT 1,
  updated_at         DATETIME(3)  NOT NULL,
  updated_by         VARCHAR(80)  NOT NULL,
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_client_desk_profiles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT ck_cdp_color CHECK (brand_color REGEXP '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT ck_cdp_json CHECK (JSON_VALID(authority_matrix) AND JSON_VALID(special_handling) AND JSON_VALID(business_facts)
    AND JSON_VALID(do_not_say) AND JSON_VALID(coverage) AND JSON_VALID(visible_fields) AND JSON_VALID(required_wrap_fields)
    AND JSON_VALID(playbook_slots) AND JSON_VALID(canned_replies))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Versioned greeting scripts per language and hours mode (DSK-006).
CREATE TABLE IF NOT EXISTS greeting_scripts (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  language           CHAR(2)      NOT NULL,
  hours_mode         ENUM('business_hours','after_hours','callback','outbound') NOT NULL,
  script_version     INT          NOT NULL,
  body               VARCHAR(600) NOT NULL COMMENT 'Variables: {client_name} {operator_first_name} {line_label}',
  status             ENUM('draft','approved','retired') NOT NULL DEFAULT 'draft',
  approved_by        VARCHAR(80)  NULL,
  approved_at        DATETIME(3)  NULL,
  created_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_greeting_version (tenant_id, language, hours_mode, script_version),
  KEY ix_greeting_active (tenant_id, language, hours_mode, status),
  CONSTRAINT fk_greeting_scripts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT ck_greeting_approval CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The client's own people the operator may transfer to (DSK-007 Contacts).
CREATE TABLE IF NOT EXISTS client_transfer_contacts (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  name               VARCHAR(120) NOT NULL,
  role_label         VARCHAR(80)  NOT NULL,
  phone_e164         VARCHAR(16)  NOT NULL,
  priority           TINYINT UNSIGNED NOT NULL DEFAULT 1,
  on_call            TINYINT(1)   NOT NULL DEFAULT 0,
  created_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT fk_ctc_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT ck_ctc_e164 CHECK (phone_e164 REGEXP '^\\+[1-9][0-9]{6,14}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Operators (platform-level, §21.4)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS operator_orgs (
  id                 BINARY(16)   NOT NULL,
  name               VARCHAR(160) NOT NULL,
  kind               ENUM('everonn','partner') NOT NULL DEFAULT 'everonn',
  status             ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS operators (
  id                 BINARY(16)   NOT NULL,
  org_id             BINARY(16)   NOT NULL,
  auth_user_id       VARCHAR(80)  NULL COMMENT 'EverOnn sign-in user id',
  email              VARCHAR(254) NOT NULL,
  display_name       VARCHAR(120) NOT NULL,
  first_name         VARCHAR(60)  NOT NULL,
  role               ENUM('operator','operator_lead') NOT NULL DEFAULT 'operator',
  languages          JSON         NOT NULL,
  max_voice          TINYINT UNSIGNED NOT NULL DEFAULT 1,
  max_chat           TINYINT UNSIGNED NOT NULL DEFAULT 3,
  announcement_enabled TINYINT(1) NOT NULL DEFAULT 1,
  missed_offer_limit TINYINT UNSIGNED NOT NULL DEFAULT 2,
  status             ENUM('active','suspended','offboarded') NOT NULL DEFAULT 'active',
  created_at         DATETIME(3)  NOT NULL,
  updated_at         DATETIME(3)  NOT NULL,
  version            INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_operators_email (email),
  UNIQUE KEY uq_operators_auth_user (auth_user_id),
  CONSTRAINT fk_operators_org FOREIGN KEY (org_id) REFERENCES operator_orgs (id),
  CONSTRAINT ck_operators_languages CHECK (JSON_VALID(languages) AND JSON_TYPE(languages) = 'ARRAY'),
  CONSTRAINT ck_operators_capacity CHECK (max_voice BETWEEN 0 AND 2 AND max_chat BETWEEN 0 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Client roster (§21.5 operator_client_grants, DSK-002, BRL-019).
CREATE TABLE IF NOT EXISTS operator_client_grants (
  operator_id        BINARY(16)   NOT NULL,
  tenant_id          BINARY(16)   NOT NULL,
  skills             JSON         NOT NULL,
  training_completed_at DATETIME(3) NULL,
  certified_at       DATETIME(3)  NULL,
  granted_by         BINARY(16)   NOT NULL,
  granted_at         DATETIME(3)  NOT NULL,
  expires_at         DATETIME(3)  NULL,
  revoked_at         DATETIME(3)  NULL,
  revoked_by         BINARY(16)   NULL,
  version            INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (operator_id, tenant_id),
  KEY ix_grants_tenant (tenant_id, revoked_at),
  CONSTRAINT fk_grants_operator FOREIGN KEY (operator_id) REFERENCES operators (id),
  CONSTRAINT fk_grants_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_grants_granted_by FOREIGN KEY (granted_by) REFERENCES operators (id),
  CONSTRAINT ck_grants_skills CHECK (JSON_VALID(skills)),
  -- A grant may only be certified after client-specific training (BRL-019).
  CONSTRAINT ck_grants_training CHECK (certified_at IS NULL OR training_completed_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Presence and capacity (DSK-014, DSK-026). Server-authoritative; heartbeats
-- expire through the sweep job instead of an in-memory scheduler.
CREATE TABLE IF NOT EXISTS operator_presence (
  operator_id        BINARY(16)   NOT NULL,
  status             ENUM('available','on_call','wrap_up','away','break','offline') NOT NULL DEFAULT 'offline',
  status_since       DATETIME(3)  NOT NULL,
  idle_since         DATETIME(3)  NULL COMMENT 'Longest-idle routing key',
  last_heartbeat_at  DATETIME(3)  NULL,
  desk_session_id    CHAR(36)     NULL COMMENT 'Single active desk session per operator',
  missed_offers      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  shift_checks       JSON         NULL,
  version            INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (operator_id),
  KEY ix_presence_routing (status, idle_since),
  CONSTRAINT fk_presence_operator FOREIGN KEY (operator_id) REFERENCES operators (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS operator_shifts (
  id                 BINARY(16)   NOT NULL,
  operator_id        BINARY(16)   NOT NULL,
  started_at         DATETIME(3)  NOT NULL,
  ended_at           DATETIME(3)  NULL,
  checks             JSON         NOT NULL COMMENT 'Microphone, network and client-notice acknowledgement',
  PRIMARY KEY (id),
  KEY ix_shifts_operator (operator_id, started_at),
  CONSTRAINT fk_shifts_operator FOREIGN KEY (operator_id) REFERENCES operators (id),
  CONSTRAINT ck_shifts_checks CHECK (JSON_VALID(checks))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Conversations (desk-relevant subset of §21.1 "Conversations")
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contacts (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  display_name       VARCHAR(160) NULL,
  phone_e164         VARCHAR(16)  NULL,
  email              VARCHAR(254) NULL,
  language           CHAR(2)      NOT NULL DEFAULT 'en',
  is_vip             TINYINT(1)   NOT NULL DEFAULT 0,
  created_at         DATETIME(3)  NOT NULL,
  updated_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_contacts_phone (tenant_id, phone_e164),
  CONSTRAINT fk_contacts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT ck_contacts_e164 CHECK (phone_e164 IS NULL OR phone_e164 REGEXP '^\\+[1-9][0-9]{6,14}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS conversations (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  line_id            BINARY(16)   NOT NULL,
  contact_id         BINARY(16)   NULL,
  channel            ENUM('voice','chat','sms') NOT NULL,
  status             ENUM('active','with_human','ended') NOT NULL DEFAULT 'active',
  language           CHAR(2)      NOT NULL DEFAULT 'en',
  ai_summary         VARCHAR(1000) NULL,
  recording_state    ENUM('none','announced','recording','refused','stored','deleted') NOT NULL DEFAULT 'none',
  started_at         DATETIME(3)  NOT NULL,
  ended_at           DATETIME(3)  NULL,
  PRIMARY KEY (tenant_id, id),
  KEY ix_conversations_contact (tenant_id, contact_id, started_at),
  CONSTRAINT fk_conversations_line FOREIGN KEY (tenant_id, line_id) REFERENCES channel_endpoints (tenant_id, id),
  CONSTRAINT fk_conversations_contact FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Transcript turns and chat/SMS messages for the conversation.
CREATE TABLE IF NOT EXISTS messages (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  conversation_id    BINARY(16)   NOT NULL,
  speaker            ENUM('caller','ai','operator','system') NOT NULL,
  operator_id        BINARY(16)   NULL,
  body               TEXT         NOT NULL,
  occurred_at        DATETIME(3)  NOT NULL,
  PRIMARY KEY (tenant_id, id),
  KEY ix_messages_conversation (tenant_id, conversation_id, occurred_at),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id),
  CONSTRAINT fk_messages_operator FOREIGN KEY (operator_id) REFERENCES operators (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Structured Request (Appendix D). Fields the AI captured carry confidence
-- and confirmation state; operators correct them during the interaction.
CREATE TABLE IF NOT EXISTS requests (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  conversation_id    BINARY(16)   NOT NULL,
  contact_id         BINARY(16)   NULL,
  source_channel     ENUM('voice','chat','sms') NOT NULL,
  status             ENUM('new','contacted','quoted','booked','done','lost','spam') NOT NULL DEFAULT 'new',
  urgency            ENUM('emergency','urgent','standard','info') NOT NULL DEFAULT 'standard',
  service_type       VARCHAR(80)  NULL,
  summary            VARCHAR(1000) NULL,
  captured_fields    JSON         NOT NULL COMMENT '[{field,value,confidence,confirmed}]',
  outcome            VARCHAR(48)  NULL,
  created_at         DATETIME(3)  NOT NULL,
  updated_at         DATETIME(3)  NOT NULL,
  version            INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_requests_conversation (tenant_id, conversation_id),
  CONSTRAINT fk_requests_conversation FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id),
  CONSTRAINT fk_requests_contact FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id),
  CONSTRAINT ck_requests_fields CHECK (JSON_VALID(captured_fields) AND JSON_TYPE(captured_fields) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Escalation, offers and handling (§21.5, §16.6 state machines)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS escalations (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  conversation_id    BINARY(16)   NOT NULL,
  line_id            BINARY(16)   NOT NULL,
  channel            ENUM('voice','chat','sms') NOT NULL,
  language           CHAR(2)      NOT NULL DEFAULT 'en',
  trigger_code       VARCHAR(48)  NOT NULL,
  trigger_detail     VARCHAR(300) NULL,
  severity           TINYINT      NOT NULL,
  mode               ENUM('owner','managed','shadow') NOT NULL,
  state              ENUM('created','notified','acknowledged','in_progress','escalated','resolved','auto_resolved','reviewed','closed') NOT NULL,
  cascade_step       TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 skills pool, 1 overflow, 2 owner, 3 message capture',
  sla_due_at         DATETIME(3)  NOT NULL,
  assigned_type      ENUM('user','operator','pool') NULL,
  assigned_id        BINARY(16)   NULL,
  context_snapshot   JSON         NOT NULL,
  resolution_code    VARCHAR(48)  NULL,
  resolution_notes   VARCHAR(1000) NULL,
  acknowledged_at    DATETIME(3)  NULL,
  resolved_at        DATETIME(3)  NULL,
  created_at         DATETIME(3)  NOT NULL,
  updated_at         DATETIME(3)  NOT NULL,
  version            INT          NOT NULL DEFAULT 1,
  -- Generated flag so the router's "waiting for a human" scan is one index range.
  is_waiting         TINYINT(1) AS (state IN ('created','notified','escalated')) STORED,
  PRIMARY KEY (tenant_id, id),
  KEY ix_sla (state, sla_due_at),
  KEY ix_escalations_waiting (is_waiting, severity, sla_due_at),
  KEY ix_escalations_conversation (tenant_id, conversation_id),
  CONSTRAINT fk_escalations_conversation FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id),
  CONSTRAINT fk_escalations_line FOREIGN KEY (tenant_id, line_id) REFERENCES channel_endpoints (tenant_id, id),
  CONSTRAINT ck_escalations_severity CHECK (severity BETWEEN 1 AND 4),
  CONSTRAINT ck_escalations_snapshot CHECK (JSON_VALID(context_snapshot)),
  CONSTRAINT ck_escalations_auto_reason CHECK (state <> 'auto_resolved' OR resolution_code IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS escalation_events (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  escalation_id      BINARY(16)   NOT NULL,
  event_type         VARCHAR(48)  NOT NULL,
  from_state         VARCHAR(24)  NULL,
  to_state           VARCHAR(24)  NULL,
  actor_type         ENUM('system','operator','user','ai') NOT NULL,
  actor_id           VARCHAR(80)  NULL,
  detail             JSON         NOT NULL,
  occurred_at        DATETIME(3)  NOT NULL,
  PRIMARY KEY (tenant_id, id),
  KEY ix_escalation_events_escalation (tenant_id, escalation_id, occurred_at),
  CONSTRAINT fk_escalation_events_escalation FOREIGN KEY (tenant_id, escalation_id) REFERENCES escalations (tenant_id, id),
  CONSTRAINT ck_escalation_events_detail CHECK (JSON_VALID(detail))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS call_offers (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  escalation_id      BINARY(16)   NOT NULL,
  operator_id        BINARY(16)   NOT NULL,
  cascade_step       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  offered_at         DATETIME(3)  NOT NULL,
  expires_at         DATETIME(3)  NOT NULL,
  outcome            ENUM('pending','accepted','declined','timed_out','cancelled') NOT NULL,
  decline_reason     VARCHAR(120) NULL,
  responded_at       DATETIME(3)  NULL,
  -- At most one pending offer per escalation (ring-one strategies at P1).
  pending_escalation_id BINARY(16) AS (IF(outcome = 'pending', escalation_id, NULL)) STORED,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_offers_one_pending (tenant_id, pending_escalation_id),
  KEY ix_pending (outcome, expires_at),
  KEY ix_offers_operator (operator_id, outcome),
  KEY ix_offers_escalation (tenant_id, escalation_id),
  CONSTRAINT fk_offers_escalation FOREIGN KEY (tenant_id, escalation_id) REFERENCES escalations (tenant_id, id),
  CONSTRAINT fk_offers_operator FOREIGN KEY (operator_id) REFERENCES operators (id),
  CONSTRAINT ck_offers_window CHECK (expires_at > offered_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS desk_handlings (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  escalation_id      BINARY(16)   NOT NULL,
  offer_id           BINARY(16)   NULL,
  conversation_id    BINARY(16)   NOT NULL,
  line_id            BINARY(16)   NOT NULL,
  operator_id        BINARY(16)   NOT NULL,
  channel            ENUM('voice','chat','sms','callback') NOT NULL,
  state              ENUM('accepted','connecting','active','on_hold','ended','wrap_up','completed','failed') NOT NULL,
  muted              TINYINT(1)   NOT NULL DEFAULT 0,
  offered_at         DATETIME(3)  NOT NULL,
  accepted_at        DATETIME(3)  NULL,
  connected_at       DATETIME(3)  NULL,
  hold_started_at    DATETIME(3)  NULL,
  hold_seconds       INT UNSIGNED NOT NULL DEFAULT 0,
  ended_at           DATETIME(3)  NULL,
  wrap_started_at    DATETIME(3)  NULL,
  wrap_due_at        DATETIME(3)  NULL,
  wrap_ended_at      DATETIME(3)  NULL,
  greeting_script_id BINARY(16)   NULL,
  greeting_script_version INT     NULL,
  greeting_delivered TINYINT(1)   NOT NULL DEFAULT 0,
  disposition        ENUM('resolved','message_taken','transferred_to_owner','callback_scheduled','handed_back_to_ai','spam','wrong_number','wrong_client','other','auto_released') NULL,
  transferred_to     VARCHAR(64)  NULL,
  operator_notes     VARCHAR(2000) NULL,
  client_notes       VARCHAR(2000) NULL COMMENT 'Visible to the client (DSK-023)',
  wrong_client_flag  TINYINT(1)   NOT NULL DEFAULT 0,
  version            INT          NOT NULL DEFAULT 1,
  -- One open handling per escalation: "at most one active handling" (§21.4).
  open_escalation_id BINARY(16) AS (IF(state IN ('completed','failed'), NULL, escalation_id)) STORED,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_handlings_one_open (tenant_id, open_escalation_id),
  KEY ix_operator (operator_id, offered_at),
  KEY ix_handlings_operator_state (operator_id, state),
  KEY ix_handlings_wrap (state, wrap_due_at),
  CONSTRAINT fk_handlings_escalation FOREIGN KEY (tenant_id, escalation_id) REFERENCES escalations (tenant_id, id),
  CONSTRAINT fk_handlings_offer FOREIGN KEY (tenant_id, offer_id) REFERENCES call_offers (tenant_id, id),
  CONSTRAINT fk_handlings_conversation FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id),
  CONSTRAINT fk_handlings_line FOREIGN KEY (tenant_id, line_id) REFERENCES channel_endpoints (tenant_id, id),
  CONSTRAINT fk_handlings_operator FOREIGN KEY (operator_id) REFERENCES operators (id),
  CONSTRAINT fk_handlings_greeting FOREIGN KEY (tenant_id, greeting_script_id) REFERENCES greeting_scripts (tenant_id, id),
  CONSTRAINT ck_handlings_completed CHECK (state <> 'completed' OR disposition IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Every hold, transfer, greeting, authority action and wrap-up (DSK-024).
CREATE TABLE IF NOT EXISTS handling_events (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  handling_id        BINARY(16)   NOT NULL,
  event_type         VARCHAR(48)  NOT NULL,
  operator_id        BINARY(16)   NULL,
  detail             JSON         NOT NULL,
  occurred_at        DATETIME(3)  NOT NULL,
  PRIMARY KEY (tenant_id, id),
  KEY ix_handling_events_handling (tenant_id, handling_id, occurred_at),
  CONSTRAINT fk_handling_events_handling FOREIGN KEY (tenant_id, handling_id) REFERENCES desk_handlings (tenant_id, id),
  CONSTRAINT ck_handling_events_detail CHECK (JSON_VALID(detail))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Sensitive actions beyond the operator's authority (HIL-007, DSK-008).
CREATE TABLE IF NOT EXISTS approvals (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  escalation_id      BINARY(16)   NOT NULL,
  handling_id        BINARY(16)   NULL,
  capability         VARCHAR(48)  NOT NULL,
  request_detail     VARCHAR(600) NOT NULL,
  state              ENUM('pending','approved','rejected','expired') NOT NULL DEFAULT 'pending',
  requested_by       BINARY(16)   NOT NULL,
  decided_by_type    ENUM('owner','operator_lead') NULL,
  decided_by         VARCHAR(80)  NULL,
  decision_note      VARCHAR(600) NULL,
  created_at         DATETIME(3)  NOT NULL,
  decided_at         DATETIME(3)  NULL,
  PRIMARY KEY (tenant_id, id),
  KEY ix_approvals_state (state, created_at),
  CONSTRAINT fk_approvals_escalation FOREIGN KEY (tenant_id, escalation_id) REFERENCES escalations (tenant_id, id),
  CONSTRAINT fk_approvals_handling FOREIGN KEY (tenant_id, handling_id) REFERENCES desk_handlings (tenant_id, id),
  CONSTRAINT fk_approvals_requested_by FOREIGN KEY (requested_by) REFERENCES operators (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Follow-up work, including the promised callback of HIL-003 (§21.1 "tasks").
CREATE TABLE IF NOT EXISTS tasks (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  kind               ENUM('callback','follow_up') NOT NULL,
  escalation_id      BINARY(16)   NULL,
  contact_id         BINARY(16)   NULL,
  title              VARCHAR(200) NOT NULL,
  notes              VARCHAR(1000) NULL,
  severity           TINYINT      NOT NULL DEFAULT 3,
  due_at             DATETIME(3)  NOT NULL,
  state              ENUM('open','in_progress','done','cancelled') NOT NULL DEFAULT 'open',
  claimed_by         BINARY(16)   NULL,
  created_by_type    ENUM('system','operator','user') NOT NULL,
  created_by         VARCHAR(80)  NULL,
  created_at         DATETIME(3)  NOT NULL,
  completed_at       DATETIME(3)  NULL,
  version            INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  KEY ix_tasks_open (state, kind, due_at),
  CONSTRAINT fk_tasks_escalation FOREIGN KEY (tenant_id, escalation_id) REFERENCES escalations (tenant_id, id),
  CONSTRAINT fk_tasks_contact FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id),
  CONSTRAINT fk_tasks_claimed_by FOREIGN KEY (claimed_by) REFERENCES operators (id),
  CONSTRAINT ck_tasks_severity CHECK (severity BETWEEN 1 AND 4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Wrong-client incidents (DSK-009); target under 0.1% of interactions.
CREATE TABLE IF NOT EXISTS wrong_client_incidents (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  handling_id        BINARY(16)   NOT NULL,
  operator_id        BINARY(16)   NOT NULL,
  source             ENUM('operator','quality_review','caller') NOT NULL,
  notes              VARCHAR(600) NULL,
  created_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT fk_wci_handling FOREIGN KEY (tenant_id, handling_id) REFERENCES desk_handlings (tenant_id, id),
  CONSTRAINT fk_wci_operator FOREIGN KEY (operator_id) REFERENCES operators (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Calls whose dialed line could not be resolved (DSK-003): never guess a client.
CREATE TABLE IF NOT EXISTS unresolved_line_incidents (
  id                 BINARY(16)   NOT NULL,
  dialed_e164        VARCHAR(16)  NULL,
  caller_e164        VARCHAR(16)  NULL,
  channel            ENUM('voice','chat','sms') NOT NULL,
  signaling          JSON         NOT NULL COMMENT 'To / Diversion / History-Info headers as received',
  state              ENUM('open','acknowledged','closed') NOT NULL DEFAULT 'open',
  acknowledged_by    BINARY(16)   NULL,
  created_at         DATETIME(3)  NOT NULL,
  acknowledged_at    DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY ix_unresolved_state (state, created_at),
  CONSTRAINT fk_unresolved_ack FOREIGN KEY (acknowledged_by) REFERENCES operators (id),
  CONSTRAINT ck_unresolved_signaling CHECK (JSON_VALID(signaling))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- QA sampling and scoring (HIL-009).
CREATE TABLE IF NOT EXISTS qa_reviews (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  handling_id        BINARY(16)   NOT NULL,
  reviewer_id        BINARY(16)   NOT NULL,
  scores             JSON         NOT NULL COMMENT 'accuracy, safety, tone, outcome: 1..5',
  greeting_correct   TINYINT(1)   NOT NULL,
  overall            TINYINT      NOT NULL,
  notes              VARCHAR(1000) NULL,
  created_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_qa_handling_reviewer (tenant_id, handling_id, reviewer_id),
  CONSTRAINT fk_qa_handling FOREIGN KEY (tenant_id, handling_id) REFERENCES desk_handlings (tenant_id, id),
  CONSTRAINT fk_qa_reviewer FOREIGN KEY (reviewer_id) REFERENCES operators (id),
  CONSTRAINT ck_qa_scores CHECK (JSON_VALID(scores)),
  CONSTRAINT ck_qa_overall CHECK (overall BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Platform: metering, outbox, idempotency and the hash-chained audit log
-- ---------------------------------------------------------------------------

-- HITL minutes (BIL-004, HIL-012). Immutable; idempotent per source.
CREATE TABLE IF NOT EXISTS usage_events (
  tenant_id          BINARY(16)   NOT NULL,
  id                 BINARY(16)   NOT NULL,
  meter              VARCHAR(48)  NOT NULL,
  quantity           DECIMAL(18,6) NOT NULL,
  unit               VARCHAR(16)  NOT NULL,
  occurred_at        DATETIME(3)  NOT NULL,
  source_type        VARCHAR(32)  NOT NULL,
  source_id          BINARY(16)   NOT NULL,
  provider_cost_micros BIGINT     NOT NULL DEFAULT 0,
  idempotency_key    VARCHAR(96)  NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_idem (tenant_id, idempotency_key),
  CONSTRAINT fk_usage_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT ck_usage_quantity CHECK (quantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Domain events (Appendix C) written in the same transaction as the change.
CREATE TABLE IF NOT EXISTS outbox_events (
  id                 BINARY(16)   NOT NULL,
  tenant_id          BINARY(16)   NULL,
  event_type         VARCHAR(64)  NOT NULL,
  event_version      SMALLINT     NOT NULL DEFAULT 1,
  aggregate_id       VARCHAR(40)  NOT NULL,
  actor              JSON         NOT NULL,
  data               JSON         NOT NULL,
  occurred_at        DATETIME(3)  NOT NULL,
  published_at       DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY ix_outbox_unpublished (published_at, occurred_at),
  CONSTRAINT ck_outbox_json CHECK (JSON_VALID(actor) AND JSON_VALID(data))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Desk command idempotency (Appendix J: every command carries a key).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope              VARCHAR(40)  NOT NULL COMMENT 'operator id or service name',
  idem_key           VARCHAR(96)  NOT NULL,
  command            VARCHAR(48)  NOT NULL,
  response           JSON         NOT NULL,
  created_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (scope, idem_key),
  KEY ix_idempotency_created (created_at),
  CONSTRAINT ck_idempotency_response CHECK (JSON_VALID(response))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Append-only, hash-chained audit trail (HIL-011, SEC-009). The single-row
-- head table serializes appends; appends are always the last write of a
-- transaction so lock order cannot form a cycle.
CREATE TABLE IF NOT EXISTS audit_log (
  seq                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id          BINARY(16)   NULL,
  actor_type         ENUM('system','operator','user','service') NOT NULL,
  actor_id           VARCHAR(80)  NULL,
  action             VARCHAR(64)  NOT NULL,
  entity_type        VARCHAR(40)  NOT NULL,
  entity_id          VARCHAR(40)  NOT NULL,
  before_state       JSON         NULL,
  after_state        JSON         NULL,
  occurred_at        DATETIME(3)  NOT NULL,
  prev_hash          BINARY(32)   NOT NULL,
  hash               BINARY(32)   NOT NULL,
  PRIMARY KEY (seq),
  KEY ix_audit_tenant (tenant_id, occurred_at),
  KEY ix_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_chain_head (
  id                 TINYINT      NOT NULL,
  last_seq           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_hash          BINARY(32)   NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT ck_audit_head_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO audit_chain_head (id, last_seq, last_hash) VALUES (1, 0, UNHEX(REPEAT('00', 32)));

-- Immutability of audit_log and usage_events is enforced by privileges
-- (mysql/hardening/call_center_privileges.sql) and verified by walking the
-- hash chain; triggers are optional because they need SUPER on binlogged servers.

-- ---------------------------------------------------------------------------
-- Reporting views (DSK-020 wall board, ANL-003 escalation reporting)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_desk_queue_by_client AS
SELECT
  e.tenant_id,
  t.display_name                                   AS client_name,
  COUNT(*)                                         AS waiting,
  SUM(e.severity <= 2)                             AS urgent_waiting,
  MIN(e.created_at)                                AS oldest_created_at,
  SUM(e.sla_due_at < UTC_TIMESTAMP(3))             AS breached
FROM escalations e
JOIN tenants t ON t.id = e.tenant_id
WHERE e.is_waiting = 1
GROUP BY e.tenant_id, t.display_name;

CREATE OR REPLACE VIEW v_handling_metrics AS
SELECT
  h.tenant_id,
  h.operator_id,
  DATE(h.offered_at)                                           AS day,
  COUNT(*)                                                     AS handlings,
  SUM(h.state = 'completed')                                   AS completed,
  AVG(TIMESTAMPDIFF(SECOND, h.connected_at, h.ended_at))       AS avg_talk_seconds,
  AVG(TIMESTAMPDIFF(SECOND, h.wrap_started_at, h.wrap_ended_at)) AS avg_wrap_seconds,
  AVG(h.greeting_delivered)                                    AS greeting_compliance,
  SUM(h.wrong_client_flag)                                     AS wrong_client
FROM desk_handlings h
GROUP BY h.tenant_id, h.operator_id, DATE(h.offered_at);

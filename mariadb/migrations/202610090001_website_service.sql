-- EverOnn Website as a Service (Website Studio) schema for MariaDB 10.11 LTS / 11.4 LTS.
--
-- Scope: only objects owned by Website as a Service. It normalizes the shapes the
-- application keeps today inside the workspace record (see features/everonn/types.ts,
-- features/website-studio/*, features/agent-runtime/memory.ts):
--
--   EverOnnWorkspace.websiteProject     -> website_projects (+ website_versions content)
--   WebsiteProject.spec (WebsiteSpec)   -> website_versions, website_version_services,
--                                          website_version_service_sections,
--                                          website_version_blocks, website_media_assets
--   WebsiteSpec.code (WebsiteCode)      -> website_code_concepts, website_code_pages
--   WebsiteProject.qa                   -> website_qa_runs, website_qa_checks
--   publishedWebsite / websiteReleases  -> website_releases, website_release_events
--   websiteGeneration (resumable job)   -> website_generation_jobs
--   aiMemory "website-preferences"      -> website_design_preferences,
--                                          website_design_preference_requests
--   public address uniqueness           -> website_slugs
--
-- Not included (owned by other modules, referenced only by value or snapshot):
--   business profile/services/knowledge (source facts), leads and conversations created
--   by the public site assistant (CRM), usage metering, Gemini/Pexels credentials.
--
-- Status: design DDL. The running application still persists these shapes in
-- PostgreSQL (supabase/migrations/202610040003_everonn_relational.sql); nothing in the
-- app reads or writes this MariaDB schema yet.
--
-- Conventions:
--   * Every table leads its keys with workspace_id; every foreign key carries
--     workspace_id, so cross-workspace references are impossible.
--   * Timestamps are DATETIME(3) in UTC, supplied by the application or by
--     UTC_TIMESTAMP(3) in triggers/procedures.
--   * Mutable aggregates carry a `revision` UUID for optimistic concurrency
--     (UPDATE ... WHERE revision = ?); triggers rotate it on every update.
--   * Generated content (website_versions and children, QA runs) is write-once.
--     A release references an immutable version, so rollback is a pointer swap.
--   * JSON columns are LONGTEXT aliases in MariaDB; their shape is checked with
--     JSON_TYPE. Anything filtered on is a real column.
--
-- Run with the mariadb client (uses DELIMITER). Procedures open their own
-- transaction, so call them outside an application transaction.

SET NAMES utf8mb4;
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- ---------------------------------------------------------------------------
-- Prerequisite anchor (owned by the core workspace schema, not by this module).
-- Created only if absent so this file can be applied to an empty database.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS website_schema_migrations (
  version            VARCHAR(20)  NOT NULL,
  component          VARCHAR(64)  NOT NULL,
  applied_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ---------------------------------------------------------------------------
-- 1. Public addresses: /sites/{public_slug}
--    A slug belongs to exactly one workspace for life. The draft and the live
--    release of one workspace share it; another workspace can never take it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS website_slugs (
  public_slug        VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  reserved_at        DATETIME(3)  NOT NULL,
  PRIMARY KEY (public_slug),
  UNIQUE KEY uq_website_slugs_workspace (workspace_id, public_slug),
  CONSTRAINT fk_website_slugs_workspace FOREIGN KEY (workspace_id)
    REFERENCES workspaces (workspace_id) ON DELETE CASCADE,
  -- websiteSlug(): lowercase ASCII words joined by single hyphens, max 64.
  CONSTRAINT ck_website_slugs_format CHECK (public_slug REGEXP '^[a-z0-9]+(-[a-z0-9]+)*$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT='Website as a Service: public site addresses owned by a workspace';

-- ---------------------------------------------------------------------------
-- 2. Content versions (immutable WebsiteSpec snapshots)
--    One row per generation result. project_id is kept by value: a regenerated
--    draft gets a new project id while releases keep pointing at old versions.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS website_versions (
  workspace_id               VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  version_id                 UUID         NOT NULL,
  project_id                 VARCHAR(48)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  spec_schema_version        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  origin                     ENUM('generation','legacy_import') NOT NULL DEFAULT 'generation',

  -- Generation provenance (WebsiteProject.generation, profileSnapshot)
  generation_provider        ENUM('gemini') NULL,
  generation_model           VARCHAR(120) NULL COMMENT 'Model of the last successful content unit',
  generated_at               DATETIME(3)  NULL,
  generation_skills          JSON         NULL COMMENT 'SkillTrace[]: {id, version, digest}',
  profile_snapshot           JSON         NULL COMMENT 'BusinessProfile the content was grounded in',
  profile_fingerprint        CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'SHA-256 of profile_snapshot, computed by the app',

  -- WebsiteSpec scalar sections
  design_rationale           TEXT         NULL,
  seo_title                  VARCHAR(255) NOT NULL,
  seo_description            VARCHAR(500) NOT NULL,
  brand_tagline              VARCHAR(255) NOT NULL,
  brand_positioning          TEXT         NOT NULL,
  primary_color              CHAR(7)      CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  accent_color               CHAR(7)      CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  visual_mood                VARCHAR(255) NOT NULL,
  media_hero_query           VARCHAR(255) NOT NULL,
  media_gallery_query        VARCHAR(255) NOT NULL,
  media_hero_alt             VARCHAR(500) NOT NULL,
  media_story_alt            VARCHAR(500) NOT NULL,
  hero_eyebrow               VARCHAR(255) NOT NULL,
  hero_headline              VARCHAR(500) NOT NULL,
  hero_subheadline           TEXT         NOT NULL,
  hero_primary_cta           VARCHAR(120) NOT NULL,
  hero_secondary_cta         VARCHAR(120) NOT NULL,
  services_intro_eyebrow     VARCHAR(255) NOT NULL,
  services_intro_title       VARCHAR(500) NOT NULL,
  services_intro_copy        TEXT         NOT NULL,
  about_eyebrow              VARCHAR(255) NOT NULL,
  about_title                VARCHAR(500) NOT NULL,
  about_body                 TEXT         NOT NULL,
  contact_eyebrow            VARCHAR(255) NOT NULL,
  contact_title              VARCHAR(500) NOT NULL,
  contact_copy               TEXT         NOT NULL,
  contact_cta_label          VARCHAR(120) NOT NULL,

  -- WebsiteSpec.code header; NULL means a legacy pre-code publication
  code_schema_version        TINYINT UNSIGNED NULL,
  code_validated_at          DATETIME(3)  NULL,

  created_at                 DATETIME(3)  NOT NULL,
  PRIMARY KEY (workspace_id, version_id),
  UNIQUE KEY uq_website_versions_id (version_id),
  KEY ix_website_versions_project (workspace_id, project_id, created_at),
  CONSTRAINT fk_website_versions_workspace FOREIGN KEY (workspace_id)
    REFERENCES workspaces (workspace_id) ON DELETE CASCADE,
  CONSTRAINT ck_website_versions_project_id CHECK (project_id REGEXP '^website_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CONSTRAINT ck_website_versions_schema CHECK (spec_schema_version = 1),
  CONSTRAINT ck_website_versions_colors CHECK (primary_color REGEXP '^#[0-9A-Fa-f]{6}$' AND accent_color REGEXP '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT ck_website_versions_code CHECK ((code_schema_version IS NULL AND code_validated_at IS NULL)
                                          OR (code_schema_version = 1 AND code_validated_at IS NOT NULL)),
  CONSTRAINT ck_website_versions_generation CHECK ((generation_provider IS NULL AND generation_model IS NULL AND generated_at IS NULL)
                                                OR (generation_provider IS NOT NULL AND generation_model IS NOT NULL AND generated_at IS NOT NULL)),
  CONSTRAINT ck_website_versions_skills CHECK (generation_skills IS NULL OR JSON_TYPE(generation_skills) = 'ARRAY'),
  CONSTRAINT ck_website_versions_profile CHECK (profile_snapshot IS NULL OR JSON_TYPE(profile_snapshot) = 'OBJECT'),
  CONSTRAINT ck_website_versions_fingerprint CHECK (profile_fingerprint IS NULL OR profile_fingerprint REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT='Website as a Service: immutable generated content snapshot (WebsiteSpec)';

-- WebsiteSpec.services[]: one detail page per active business service.
CREATE TABLE IF NOT EXISTS website_version_services (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  version_id         UUID         NOT NULL,
  service_id         VARCHAR(80)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'BusinessProfile service id (grounding key)',
  position           SMALLINT UNSIGNED NOT NULL,
  slug               VARCHAR(80)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Route /services/{slug}',
  name               VARCHAR(120) NOT NULL,
  summary            TEXT         NOT NULL,
  details            JSON         NOT NULL COMMENT 'string[]',
  ideal_for          VARCHAR(500) NOT NULL,
  cta_label          VARCHAR(120) NOT NULL,
  image_query        VARCHAR(255) NOT NULL,
  image_alt          VARCHAR(500) NOT NULL,
  page_headline      VARCHAR(500) NOT NULL,
  page_intro         TEXT         NOT NULL,
  PRIMARY KEY (workspace_id, version_id, service_id),
  UNIQUE KEY uq_website_version_services_slug (workspace_id, version_id, slug),
  UNIQUE KEY uq_website_version_services_position (workspace_id, version_id, position),
  CONSTRAINT fk_website_version_services_version FOREIGN KEY (workspace_id, version_id)
    REFERENCES website_versions (workspace_id, version_id) ON DELETE CASCADE,
  CONSTRAINT ck_website_version_services_slug CHECK (slug REGEXP '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_website_version_services_details CHECK (JSON_TYPE(details) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- WebsiteServiceSpec.pageSections[] (QA requires at least two per service).
CREATE TABLE IF NOT EXISTS website_version_service_sections (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  version_id         UUID         NOT NULL,
  service_id         VARCHAR(80)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  position           SMALLINT UNSIGNED NOT NULL,
  title              VARCHAR(500) NOT NULL,
  copy               TEXT         NOT NULL,
  PRIMARY KEY (workspace_id, version_id, service_id, position),
  CONSTRAINT fk_website_version_service_sections_service FOREIGN KEY (workspace_id, version_id, service_id)
    REFERENCES website_version_services (workspace_id, version_id, service_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- WebsiteSpec.benefits[], process[], faq[] share one ordered shape.
CREATE TABLE IF NOT EXISTS website_version_blocks (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  version_id         UUID         NOT NULL,
  kind               ENUM('benefit','process_step','faq') NOT NULL,
  position           SMALLINT UNSIGNED NOT NULL,
  heading            VARCHAR(500) NOT NULL COMMENT 'title, or question for faq',
  body               TEXT         NOT NULL COMMENT 'copy, or answer for faq',
  PRIMARY KEY (workspace_id, version_id, kind, position),
  CONSTRAINT fk_website_version_blocks_version FOREIGN KEY (workspace_id, version_id)
    REFERENCES website_versions (workspace_id, version_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- WebsiteSpec.media: hero, story, gallery[] and services{serviceId}.
CREATE TABLE IF NOT EXISTS website_media_assets (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  version_id         UUID         NOT NULL,
  slot               ENUM('hero','story','gallery','service') NOT NULL,
  position           SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Gallery order; 0 for single slots',
  service_id         VARCHAR(80)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  provider           ENUM('pexels') NOT NULL DEFAULT 'pexels',
  provider_asset_id  VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'WebsiteMediaAsset.id',
  url                VARCHAR(2048) NOT NULL,
  alt                VARCHAR(500) NOT NULL,
  photographer       VARCHAR(200) NOT NULL,
  source_url         VARCHAR(2048) NOT NULL,
  PRIMARY KEY (workspace_id, version_id, slot, position),
  UNIQUE KEY uq_website_media_assets_service (workspace_id, version_id, service_id),
  CONSTRAINT fk_website_media_assets_version FOREIGN KEY (workspace_id, version_id)
    REFERENCES website_versions (workspace_id, version_id) ON DELETE CASCADE,
  CONSTRAINT fk_website_media_assets_service FOREIGN KEY (workspace_id, version_id, service_id)
    REFERENCES website_version_services (workspace_id, version_id, service_id) ON DELETE CASCADE,
  CONSTRAINT ck_website_media_assets_slot CHECK (
       (slot IN ('hero','story') AND position = 0 AND service_id IS NULL)
    OR (slot = 'gallery' AND service_id IS NULL)
    OR (slot = 'service' AND position = 0 AND service_id IS NOT NULL)),
  CONSTRAINT ck_website_media_assets_urls CHECK (url LIKE 'https://%' AND source_url LIKE 'https://%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ---------------------------------------------------------------------------
-- 3. Generated code (WebsiteSpec.code): three design concepts, each with its own
--    stylesheet and one HTML document per route (Home, Services, About, Contact
--    and every service page). Validated before insert; never executed.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS website_code_concepts (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  version_id         UUID         NOT NULL,
  concept            ENUM('editorial','momentum','aura') NOT NULL,
  concept_name       VARCHAR(120) NOT NULL,
  rationale          TEXT         NOT NULL,
  css                MEDIUMTEXT   NOT NULL,
  models             JSON         NULL COMMENT 'Successful code model ids for this concept',
  PRIMARY KEY (workspace_id, version_id, concept),
  CONSTRAINT fk_website_code_concepts_version FOREIGN KEY (workspace_id, version_id)
    REFERENCES website_versions (workspace_id, version_id) ON DELETE CASCADE,
  CONSTRAINT ck_website_code_concepts_css CHECK (CHAR_LENGTH(css) > 0),
  CONSTRAINT ck_website_code_concepts_models CHECK (models IS NULL OR (JSON_TYPE(models) = 'ARRAY' AND JSON_LENGTH(models) BETWEEN 1 AND 5))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS website_code_pages (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  version_id         UUID         NOT NULL,
  concept            ENUM('editorial','momentum','aura') NOT NULL,
  route_path         VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '/, /services, /about, /contact, /services/{slug}',
  position           SMALLINT UNSIGNED NOT NULL,
  title              VARCHAR(255) NOT NULL,
  description        VARCHAR(500) NOT NULL,
  html               MEDIUMTEXT   NOT NULL,
  PRIMARY KEY (workspace_id, version_id, concept, route_path),
  UNIQUE KEY uq_website_code_pages_position (workspace_id, version_id, concept, position),
  CONSTRAINT fk_website_code_pages_concept FOREIGN KEY (workspace_id, version_id, concept)
    REFERENCES website_code_concepts (workspace_id, version_id, concept) ON DELETE CASCADE,
  CONSTRAINT ck_website_code_pages_route CHECK (route_path REGEXP '^/([a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*)?$'),
  CONSTRAINT ck_website_code_pages_html CHECK (CHAR_LENGTH(html) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ---------------------------------------------------------------------------
-- 4. Quality checks (runWebsiteQa). A run is recorded at generation and again at
--    publish; publishing requires a passing run for the exact version.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS website_qa_runs (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  qa_run_id          UUID         NOT NULL,
  version_id         UUID         NOT NULL,
  trigger_point      ENUM('generation','publish','legacy_import') NOT NULL,
  passed             BOOLEAN      NOT NULL,
  checked_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (workspace_id, qa_run_id),
  KEY ix_website_qa_runs_version (workspace_id, version_id, checked_at),
  CONSTRAINT fk_website_qa_runs_version FOREIGN KEY (workspace_id, version_id)
    REFERENCES website_versions (workspace_id, version_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS website_qa_checks (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  qa_run_id          UUID         NOT NULL,
  check_key          VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'e.g. business-verified, no-unsupported-claims, generated-code',
  position           SMALLINT UNSIGNED NOT NULL,
  passed             BOOLEAN      NOT NULL,
  message            VARCHAR(1000) NOT NULL,
  PRIMARY KEY (workspace_id, qa_run_id, check_key),
  KEY ix_website_qa_checks_failed (workspace_id, check_key, passed),
  CONSTRAINT fk_website_qa_checks_run FOREIGN KEY (workspace_id, qa_run_id)
    REFERENCES website_qa_runs (workspace_id, qa_run_id) ON DELETE CASCADE,
  CONSTRAINT ck_website_qa_checks_key CHECK (check_key REGEXP '^[a-z0-9]+(-[a-z0-9]+)*$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ---------------------------------------------------------------------------
-- 5. Current draft project: exactly one per workspace (EverOnnWorkspace.websiteProject).
--    Status moves generated -> claimed -> verified -> approved -> published, one
--    step at a time; a new current_version_id (regeneration) resets the flow.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS website_projects (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  project_id         VARCHAR(48)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  private_token      CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Private preview credential; rotated on regeneration',
  public_slug        VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status             ENUM('draft','generated','claimed','verified','approved','published') NOT NULL DEFAULT 'generated'
                     COMMENT 'ENUM index order is the workflow rank',
  concepts           SET('editorial','momentum','aura') NOT NULL DEFAULT 'editorial,momentum,aura',
  selected_concept   ENUM('editorial','momentum','aura') NULL,
  current_version_id UUID         NOT NULL,
  current_qa_run_id  UUID         NULL,
  revision           UUID         NOT NULL,
  created_at         DATETIME(3)  NOT NULL,
  updated_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (workspace_id, project_id),
  UNIQUE KEY uq_website_projects_one_per_workspace (workspace_id),
  UNIQUE KEY uq_website_projects_id (project_id),
  UNIQUE KEY uq_website_projects_private_token (private_token),
  KEY ix_website_projects_slug (workspace_id, public_slug),
  KEY ix_website_projects_version (workspace_id, current_version_id),
  KEY ix_website_projects_qa (workspace_id, current_qa_run_id),
  CONSTRAINT fk_website_projects_workspace FOREIGN KEY (workspace_id)
    REFERENCES workspaces (workspace_id) ON DELETE CASCADE,
  CONSTRAINT fk_website_projects_slug FOREIGN KEY (workspace_id, public_slug)
    REFERENCES website_slugs (workspace_id, public_slug),
  CONSTRAINT fk_website_projects_version FOREIGN KEY (workspace_id, current_version_id)
    REFERENCES website_versions (workspace_id, version_id),
  CONSTRAINT fk_website_projects_qa FOREIGN KEY (workspace_id, current_qa_run_id)
    REFERENCES website_qa_runs (workspace_id, qa_run_id),
  CONSTRAINT ck_website_projects_id CHECK (project_id REGEXP '^website_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CONSTRAINT ck_website_projects_token CHECK (private_token REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_website_projects_concept CHECK (selected_concept IS NULL OR FIND_IN_SET(selected_concept, concepts) > 0),
  CONSTRAINT ck_website_projects_published CHECK (status <> 'published' OR selected_concept IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT='Website as a Service: current editable draft per workspace';

-- ---------------------------------------------------------------------------
-- 6. Releases: one live release per workspace plus up to three previous
--    releases for rollback (publishWebsiteRevision / rollbackWebsiteRelease).
--    Older releases are retired, not deleted, so their versions stay auditable.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS website_releases (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  release_id         UUID         NOT NULL,
  project_id         VARCHAR(48)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Draft id at publish time (by value)',
  version_id         UUID         NOT NULL,
  qa_run_id          UUID         NULL COMMENT 'Passing publish-time QA run; NULL only for legacy imports',
  public_slug        VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selected_concept   ENUM('editorial','momentum','aura') NULL COMMENT 'NULL only for legacy pre-code releases',
  profile_snapshot   JSON         NOT NULL COMMENT 'Presentation facts (BusinessProfile) frozen at publish',
  origin             ENUM('publish','legacy_import') NOT NULL DEFAULT 'publish',
  state              ENUM('live','previous','retired') NOT NULL,
  history_position   TINYINT UNSIGNED NULL COMMENT '1 = most recent previous release',
  published_at       DATETIME(3)  NOT NULL,
  live_workspace_id  VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                     AS (IF(state = 'live', workspace_id, NULL)) PERSISTENT,
  PRIMARY KEY (workspace_id, release_id),
  UNIQUE KEY uq_website_releases_id (release_id),
  UNIQUE KEY uq_website_releases_one_live (live_workspace_id),
  UNIQUE KEY uq_website_releases_history (workspace_id, history_position),
  KEY ix_website_releases_state (workspace_id, state, published_at),
  KEY ix_website_releases_slug (public_slug, state),
  KEY ix_website_releases_version (workspace_id, version_id),
  KEY ix_website_releases_qa (workspace_id, qa_run_id),
  CONSTRAINT fk_website_releases_workspace FOREIGN KEY (workspace_id)
    REFERENCES workspaces (workspace_id) ON DELETE CASCADE,
  CONSTRAINT fk_website_releases_slug FOREIGN KEY (workspace_id, public_slug)
    REFERENCES website_slugs (workspace_id, public_slug),
  -- RESTRICT: a released version (and therefore its content) cannot be deleted.
  CONSTRAINT fk_website_releases_version FOREIGN KEY (workspace_id, version_id)
    REFERENCES website_versions (workspace_id, version_id),
  CONSTRAINT fk_website_releases_qa FOREIGN KEY (workspace_id, qa_run_id)
    REFERENCES website_qa_runs (workspace_id, qa_run_id),
  CONSTRAINT ck_website_releases_history CHECK (
       (state = 'previous' AND history_position BETWEEN 1 AND 3)
    OR (state <> 'previous' AND history_position IS NULL)),
  CONSTRAINT ck_website_releases_origin CHECK (
       origin = 'legacy_import'
    OR (qa_run_id IS NOT NULL AND selected_concept IS NOT NULL)),
  CONSTRAINT ck_website_releases_profile CHECK (JSON_TYPE(profile_snapshot) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT='Website as a Service: published releases (live + rollback history)';

CREATE TABLE IF NOT EXISTS website_release_events (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  event_id           UUID         NOT NULL,
  release_id         UUID         NOT NULL,
  action             ENUM('publish','rollback','retire','legacy_import') NOT NULL,
  replaced_release_id UUID        NULL COMMENT 'Release that was live before this action',
  actor_user_id      VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NULL,
  occurred_at        DATETIME(3)  NOT NULL,
  PRIMARY KEY (workspace_id, event_id),
  KEY ix_website_release_events_release (workspace_id, release_id, occurred_at),
  KEY ix_website_release_events_time (workspace_id, occurred_at),
  CONSTRAINT fk_website_release_events_release FOREIGN KEY (workspace_id, release_id)
    REFERENCES website_releases (workspace_id, release_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT='Website as a Service: append-only publish/rollback audit trail';

-- ---------------------------------------------------------------------------
-- 7. Resumable generation jobs (EverOnnWorkspace.websiteGeneration).
--    Each request advances one saved unit under a 60 s lease. The checkpoint is
--    opaque, versioned working state (profile, memory, partial content/designs,
--    attempt counters) and is only ever read back whole by the job runner.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS website_generation_jobs (
  workspace_id          VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  job_id                UUID         NOT NULL,
  job_schema_version    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  status                ENUM('running','failed','completed') NOT NULL,
  stage                 ENUM('content','media','code','saving') NOT NULL,
  progress_message      VARCHAR(500) NOT NULL,
  progress_concept      ENUM('editorial','momentum','aura') NULL,
  completed_pages       SMALLINT UNSIGNED NULL,
  total_pages           SMALLINT UNSIGNED NULL,
  error_message         TEXT         NULL,
  retry_at              DATETIME(3)  NULL COMMENT 'Server-enforced provider cooldown',
  lease_token           UUID         NULL,
  lease_expires_at      DATETIME(3)  NULL,
  models                JSON         NULL COMMENT 'Configured Gemini model ids (1-5)',
  checkpoint_fingerprint CHAR(64)    CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'Facts/memory/draft fingerprint; mismatch fails the job',
  checkpoint            JSON         NULL,
  completed_project_id  VARCHAR(48)  CHARACTER SET ascii COLLATE ascii_bin NULL,
  revision              UUID         NOT NULL,
  created_at            DATETIME(3)  NOT NULL,
  updated_at            DATETIME(3)  NOT NULL,
  running_workspace_id  VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                        AS (IF(status = 'running', workspace_id, NULL)) PERSISTENT,
  PRIMARY KEY (workspace_id, job_id),
  UNIQUE KEY uq_website_generation_jobs_id (job_id),
  UNIQUE KEY uq_website_generation_jobs_one_running (running_workspace_id),
  KEY ix_website_generation_jobs_recent (workspace_id, created_at),
  KEY ix_website_generation_jobs_lease (status, lease_expires_at),
  CONSTRAINT fk_website_generation_jobs_workspace FOREIGN KEY (workspace_id)
    REFERENCES workspaces (workspace_id) ON DELETE CASCADE,
  CONSTRAINT ck_website_generation_jobs_schema CHECK (job_schema_version = 1),
  CONSTRAINT ck_website_generation_jobs_checkpoint CHECK (
       (status = 'completed')
    OR (checkpoint IS NOT NULL AND JSON_TYPE(checkpoint) = 'OBJECT')),
  CONSTRAINT ck_website_generation_jobs_lease CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT ck_website_generation_jobs_lease_running CHECK (lease_token IS NULL OR status = 'running'),
  CONSTRAINT ck_website_generation_jobs_pages CHECK (completed_pages IS NULL OR total_pages IS NULL OR completed_pages <= total_pages),
  CONSTRAINT ck_website_generation_jobs_models CHECK (models IS NULL OR (JSON_TYPE(models) = 'ARRAY' AND JSON_LENGTH(models) BETWEEN 1 AND 5)),
  CONSTRAINT ck_website_generation_jobs_fingerprint CHECK (checkpoint_fingerprint IS NULL OR checkpoint_fingerprint REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT='Website as a Service: resumable AI website generation jobs';

-- ---------------------------------------------------------------------------
-- 8. Approved website design preferences (ScopedMemory, key website-preferences).
--    At most one record per workspace scope and one per project scope (main-site).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS website_design_preferences (
  workspace_id        VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  memory_id           VARCHAR(48)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'memory_{uuid}',
  scope               ENUM('workspace','project') NOT NULL,
  project_ref         VARCHAR(40)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' COMMENT '"main-site" for project scope',
  brief               TEXT         NOT NULL,
  primary_color       VARCHAR(7)   CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT '',
  accent_color        VARCHAR(7)   CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT '',
  hero_layout         ENUM('auto','split','immersive','centered') NOT NULL DEFAULT 'auto',
  service_layout      ENUM('auto','cards','editorial','featured') NOT NULL DEFAULT 'auto',
  typography          ENUM('auto','editorial','modern','technical') NOT NULL DEFAULT 'auto',
  density             ENUM('auto','airy','compact') NOT NULL DEFAULT 'auto',
  imagery             ENUM('auto','equipment','people','none') NOT NULL DEFAULT 'auto',
  priority_service_id VARCHAR(80)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  hidden_sections     SET('services','benefits','about','process','gallery','faq','contact') NOT NULL DEFAULT '',
  accepted            JSON         NOT NULL COMMENT 'string[] of accepted design choices',
  rejected            JSON         NOT NULL COMMENT 'string[] of rejected design choices',
  source              ENUM('owner-settings') NOT NULL DEFAULT 'owner-settings',
  approved            BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_by          VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'user_{uuid}',
  revision            UUID         NOT NULL,
  created_at          DATETIME(3)  NOT NULL,
  updated_at          DATETIME(3)  NOT NULL,
  PRIMARY KEY (workspace_id, memory_id),
  UNIQUE KEY uq_website_design_preferences_id (memory_id),
  UNIQUE KEY uq_website_design_preferences_scope (workspace_id, scope, project_ref),
  CONSTRAINT fk_website_design_preferences_workspace FOREIGN KEY (workspace_id)
    REFERENCES workspaces (workspace_id) ON DELETE CASCADE,
  CONSTRAINT ck_website_design_preferences_scope CHECK (
       (scope = 'workspace' AND project_ref = '')
    OR (scope = 'project' AND project_ref = 'main-site')),
  CONSTRAINT ck_website_design_preferences_colors CHECK (
        (primary_color = '' OR primary_color REGEXP '^#[0-9A-Fa-f]{6}$')
    AND (accent_color = '' OR accent_color REGEXP '^#[0-9A-Fa-f]{6}$')),
  CONSTRAINT ck_website_design_preferences_lists CHECK (JSON_TYPE(accepted) = 'ARRAY' AND JSON_TYPE(rejected) = 'ARRAY'),
  CONSTRAINT ck_website_design_preferences_approved CHECK (approved = TRUE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT='Website as a Service: owner-approved design preferences per scope';

-- Chronological owner requests; the application keeps the latest twenty.
CREATE TABLE IF NOT EXISTS website_design_preference_requests (
  workspace_id       VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  memory_id          VARCHAR(48)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  position           TINYINT UNSIGNED NOT NULL,
  request_text       VARCHAR(2000) NOT NULL,
  requested_at       DATETIME(3)  NOT NULL,
  PRIMARY KEY (workspace_id, memory_id, position),
  CONSTRAINT fk_website_design_preference_requests_memory FOREIGN KEY (workspace_id, memory_id)
    REFERENCES website_design_preferences (workspace_id, memory_id) ON DELETE CASCADE,
  CONSTRAINT ck_website_design_preference_requests_cap CHECK (position < 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ---------------------------------------------------------------------------
-- 9. Triggers
-- ---------------------------------------------------------------------------

DELIMITER $$

-- Generated content and QA evidence are write-once.
CREATE OR REPLACE TRIGGER trg_website_versions_immutable BEFORE UPDATE ON website_versions FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'website_versions rows are immutable; insert a new version'; END$$
CREATE OR REPLACE TRIGGER trg_website_version_services_immutable BEFORE UPDATE ON website_version_services FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'website content is immutable; insert a new version'; END$$
CREATE OR REPLACE TRIGGER trg_website_version_service_sections_immutable BEFORE UPDATE ON website_version_service_sections FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'website content is immutable; insert a new version'; END$$
CREATE OR REPLACE TRIGGER trg_website_version_blocks_immutable BEFORE UPDATE ON website_version_blocks FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'website content is immutable; insert a new version'; END$$
CREATE OR REPLACE TRIGGER trg_website_media_assets_immutable BEFORE UPDATE ON website_media_assets FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'website content is immutable; insert a new version'; END$$
CREATE OR REPLACE TRIGGER trg_website_code_concepts_immutable BEFORE UPDATE ON website_code_concepts FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'website code is immutable; insert a new version'; END$$
CREATE OR REPLACE TRIGGER trg_website_code_pages_immutable BEFORE UPDATE ON website_code_pages FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'website code is immutable; insert a new version'; END$$
CREATE OR REPLACE TRIGGER trg_website_qa_runs_immutable BEFORE UPDATE ON website_qa_runs FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'website QA runs are immutable'; END$$
CREATE OR REPLACE TRIGGER trg_website_qa_checks_immutable BEFORE UPDATE ON website_qa_checks FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'website QA checks are immutable'; END$$

-- Releases only change state/history; their content pointers are fixed.
CREATE OR REPLACE TRIGGER trg_website_releases_pointer_fixed BEFORE UPDATE ON website_releases FOR EACH ROW
BEGIN
  IF NOT (NEW.version_id <=> OLD.version_id) OR NOT (NEW.qa_run_id <=> OLD.qa_run_id)
     OR NEW.public_slug <> OLD.public_slug OR NOT (NEW.selected_concept <=> OLD.selected_concept)
     OR NEW.project_id <> OLD.project_id OR NEW.published_at <> OLD.published_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A website release snapshot cannot be modified';
  END IF;
END$$

CREATE OR REPLACE TRIGGER trg_website_release_events_append_only BEFORE UPDATE ON website_release_events FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'website_release_events is append-only'; END$$

-- Workflow order (status route): stay or advance exactly one step; a new
-- version restarts at draft/generated; the live design cannot change in place.
CREATE OR REPLACE TRIGGER trg_website_projects_workflow BEFORE UPDATE ON website_projects FOR EACH ROW
BEGIN
  IF NEW.workspace_id <> OLD.workspace_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Website project workspace cannot change';
  END IF;
  IF NOT (NEW.current_version_id <=> OLD.current_version_id) THEN
    IF NEW.status NOT IN ('draft','generated') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A regenerated website draft restarts at generated';
    END IF;
  ELSE
    IF (NEW.status + 0) < (OLD.status + 0) OR (NEW.status + 0) > (OLD.status + 0) + 1 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Website publishing steps must be completed in order';
    END IF;
    IF OLD.status = 'published' AND NOT (NEW.selected_concept <=> OLD.selected_concept) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Regenerate and approve a new draft before changing the live design';
    END IF;
  END IF;
  SET NEW.revision = UUID(), NEW.updated_at = UTC_TIMESTAMP(3);
END$$

CREATE OR REPLACE TRIGGER trg_website_generation_jobs_touch BEFORE UPDATE ON website_generation_jobs FOR EACH ROW
BEGIN
  IF NEW.workspace_id <> OLD.workspace_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Website job workspace cannot change';
  END IF;
  IF OLD.status = 'completed' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A completed website job cannot change';
  END IF;
  SET NEW.revision = UUID(), NEW.updated_at = UTC_TIMESTAMP(3);
END$$

CREATE OR REPLACE TRIGGER trg_website_design_preferences_touch BEFORE UPDATE ON website_design_preferences FOR EACH ROW
BEGIN
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.scope <> OLD.scope OR NEW.project_ref <> OLD.project_ref THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Website preference scope cannot change';
  END IF;
  SET NEW.revision = UUID(), NEW.updated_at = UTC_TIMESTAMP(3);
END$$

-- ---------------------------------------------------------------------------
-- 10. Stored procedures (mirror the application's guarded state transitions)
-- ---------------------------------------------------------------------------

-- Reserve a public slug. If another workspace owns it, append the last eight
-- alphanumerics of the workspace id (same rule as features/website-studio/jobs.ts).
CREATE OR REPLACE PROCEDURE sp_website_reserve_slug(
  IN  p_workspace_id VARCHAR(120),
  IN  p_slug         VARCHAR(64),
  OUT p_public_slug  VARCHAR(64))
MODIFIES SQL DATA SQL SECURITY INVOKER
BEGIN
  DECLARE v_owner VARCHAR(120) DEFAULT NULL;
  SELECT workspace_id INTO v_owner FROM website_slugs WHERE public_slug = p_slug;
  IF v_owner IS NULL OR v_owner = p_workspace_id THEN
    SET p_public_slug = p_slug;
  ELSE
    SET p_public_slug = CONCAT(TRIM(TRAILING '-' FROM LEFT(p_slug, 54)), '-',
      LOWER(RIGHT(REGEXP_REPLACE(p_workspace_id, '[^A-Za-z0-9]', ''), 8)));
  END IF;
  INSERT INTO website_slugs (public_slug, workspace_id, reserved_at)
  VALUES (p_public_slug, p_workspace_id, UTC_TIMESTAMP(3))
  ON DUPLICATE KEY UPDATE public_slug = public_slug;
  IF (SELECT workspace_id FROM website_slugs WHERE public_slug = p_public_slug) <> p_workspace_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Website address is already in use';
  END IF;
END$$

-- Atomically claim the next unit of a running job (60 s lease by default).
CREATE OR REPLACE PROCEDURE sp_website_claim_job(
  IN  p_workspace_id VARCHAR(120),
  IN  p_job_id       UUID,
  IN  p_lease_token  UUID,
  IN  p_lease_ms     INT UNSIGNED,
  OUT p_claimed      BOOLEAN)
MODIFIES SQL DATA SQL SECURITY INVOKER
BEGIN
  UPDATE website_generation_jobs
     SET lease_token = p_lease_token,
         lease_expires_at = UTC_TIMESTAMP(3) + INTERVAL COALESCE(p_lease_ms, 60000) * 1000 MICROSECOND,
         retry_at = NULL
   WHERE workspace_id = p_workspace_id AND job_id = p_job_id AND status = 'running'
     AND (lease_expires_at IS NULL OR lease_expires_at <= UTC_TIMESTAMP(3))
     AND (retry_at IS NULL OR retry_at <= UTC_TIMESTAMP(3));
  SET p_claimed = (ROW_COUNT() = 1);
END$$

-- Publish the approved draft: requires a passing QA run for the current version,
-- a selected concept and generated code. Demotes the live release into history
-- (max three), retires the oldest, inserts the new live release, audits it.
CREATE OR REPLACE PROCEDURE sp_website_publish(
  IN  p_workspace_id      VARCHAR(120),
  IN  p_project_id        VARCHAR(48),
  IN  p_expected_revision UUID,
  IN  p_qa_run_id         UUID,
  IN  p_profile_snapshot  LONGTEXT,
  IN  p_actor_user_id     VARCHAR(64),
  OUT p_release_id        UUID)
MODIFIES SQL DATA SQL SECURITY INVOKER
BEGIN
  DECLARE v_found      TINYINT DEFAULT 0;
  DECLARE v_status     VARCHAR(16);
  DECLARE v_concept    VARCHAR(16);
  DECLARE v_slug       VARCHAR(64);
  DECLARE v_version    UUID;
  DECLARE v_qa_version UUID DEFAULT NULL;
  DECLARE v_qa_passed  BOOLEAN DEFAULT FALSE;
  DECLARE v_live       UUID DEFAULT NULL;
  DECLARE v_now        DATETIME(3) DEFAULT UTC_TIMESTAMP(3);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  SELECT 1, status, selected_concept, public_slug, current_version_id
    INTO v_found, v_status, v_concept, v_slug, v_version
    FROM website_projects
   WHERE workspace_id = p_workspace_id AND project_id = p_project_id AND revision = p_expected_revision
   FOR UPDATE;
  IF v_found = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The website draft changed. Refresh before publishing';
  END IF;
  IF v_status <> 'approved' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approve a generated website before publishing';
  END IF;
  IF v_concept IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Select an approved concept before publishing';
  END IF;
  SELECT version_id, passed INTO v_qa_version, v_qa_passed
    FROM website_qa_runs WHERE workspace_id = p_workspace_id AND qa_run_id = p_qa_run_id;
  IF NOT (v_qa_version <=> v_version) OR NOT v_qa_passed THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Website quality checks must pass for this draft before publishing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM website_code_pages
                  WHERE workspace_id = p_workspace_id AND version_id = v_version AND concept = v_concept) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The selected concept has no generated pages';
  END IF;
  IF p_profile_snapshot IS NULL OR NOT JSON_VALID(p_profile_snapshot) OR JSON_TYPE(p_profile_snapshot) <> 'OBJECT' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A business profile snapshot is required';
  END IF;

  SELECT release_id INTO v_live FROM website_releases
   WHERE workspace_id = p_workspace_id AND state = 'live' FOR UPDATE;
  SELECT COUNT(*) INTO v_found FROM website_releases
   WHERE workspace_id = p_workspace_id AND state = 'previous' FOR UPDATE;

  IF v_live IS NOT NULL THEN
    UPDATE website_releases SET state = 'retired', history_position = NULL
     WHERE workspace_id = p_workspace_id AND state = 'previous' AND history_position = 3;
    UPDATE website_releases SET history_position = history_position + 1
     WHERE workspace_id = p_workspace_id AND state = 'previous'
     ORDER BY history_position DESC;
    UPDATE website_releases SET state = 'previous', history_position = 1
     WHERE workspace_id = p_workspace_id AND release_id = v_live;
  END IF;

  SET p_release_id = UUID();
  INSERT INTO website_releases (workspace_id, release_id, project_id, version_id, qa_run_id, public_slug,
                                selected_concept, profile_snapshot, origin, state, history_position, published_at)
  VALUES (p_workspace_id, p_release_id, p_project_id, v_version, p_qa_run_id, v_slug,
          v_concept, p_profile_snapshot, 'publish', 'live', NULL, v_now);
  UPDATE website_projects SET status = 'published', current_qa_run_id = p_qa_run_id
   WHERE workspace_id = p_workspace_id AND project_id = p_project_id;
  INSERT INTO website_release_events (workspace_id, event_id, release_id, action, replaced_release_id, actor_user_id, occurred_at)
  VALUES (p_workspace_id, UUID(), p_release_id, 'publish', v_live, p_actor_user_id, v_now);
  COMMIT;
END$$

-- Restore a previous release on the same public address. Fails if the live
-- release is no longer the one the caller saw (expectedLiveReleaseId).
CREATE OR REPLACE PROCEDURE sp_website_rollback(
  IN p_workspace_id      VARCHAR(120),
  IN p_release_id        UUID,
  IN p_expected_live_id  UUID,
  IN p_actor_user_id     VARCHAR(64))
MODIFIES SQL DATA SQL SECURITY INVOKER
BEGIN
  DECLARE v_live       UUID DEFAULT NULL;
  DECLARE v_live_slug  VARCHAR(64);
  DECLARE v_state      VARCHAR(16) DEFAULT NULL;
  DECLARE v_slug       VARCHAR(64);
  DECLARE v_position   TINYINT UNSIGNED;
  DECLARE v_now        DATETIME(3) DEFAULT UTC_TIMESTAMP(3);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  SELECT release_id, public_slug INTO v_live, v_live_slug FROM website_releases
   WHERE workspace_id = p_workspace_id AND state = 'live' FOR UPDATE;
  IF v_live IS NULL OR NOT (v_live <=> p_expected_live_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The live website changed. Refresh before restoring a release';
  END IF;
  SELECT state, public_slug, history_position INTO v_state, v_slug, v_position FROM website_releases
   WHERE workspace_id = p_workspace_id AND release_id = p_release_id FOR UPDATE;
  IF v_state IS NULL OR v_state <> 'previous' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The requested website release is unavailable';
  END IF;
  IF v_slug <> v_live_slug THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The release belongs to a different public address';
  END IF;

  -- Park the target, shift newer history down, demote live to position 1, promote target.
  UPDATE website_releases SET state = 'retired', history_position = NULL
   WHERE workspace_id = p_workspace_id AND release_id = p_release_id;
  UPDATE website_releases SET history_position = history_position + 1
   WHERE workspace_id = p_workspace_id AND state = 'previous' AND history_position < v_position
   ORDER BY history_position DESC;
  UPDATE website_releases SET state = 'previous', history_position = 1
   WHERE workspace_id = p_workspace_id AND release_id = v_live;
  UPDATE website_releases SET state = 'live'
   WHERE workspace_id = p_workspace_id AND release_id = p_release_id;
  INSERT INTO website_release_events (workspace_id, event_id, release_id, action, replaced_release_id, actor_user_id, occurred_at)
  VALUES (p_workspace_id, UUID(), p_release_id, 'rollback', v_live, p_actor_user_id, v_now);
  COMMIT;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- 11. Read views
-- ---------------------------------------------------------------------------

-- Public renderer: /sites/{slug} resolves only to the live release.
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_website_live_sites AS
SELECT r.public_slug,
       r.workspace_id,
       r.release_id,
       r.version_id,
       r.selected_concept,
       r.published_at,
       v.seo_title,
       v.seo_description,
       (v.code_validated_at IS NULL) AS is_legacy_render
  FROM website_releases r
  JOIN website_versions v ON v.workspace_id = r.workspace_id AND v.version_id = r.version_id
 WHERE r.state = 'live';

-- Private preview: resolves the current draft by its preview token (noindex).
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_website_private_previews AS
SELECT p.private_token,
       p.workspace_id,
       p.project_id,
       p.current_version_id AS version_id,
       p.status,
       p.selected_concept,
       p.public_slug
  FROM website_projects p;

-- Website Studio dashboard summary per workspace.
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_website_studio_overview AS
SELECT p.workspace_id,
       p.project_id,
       p.status,
       p.selected_concept,
       p.public_slug,
       p.current_version_id,
       q.passed                 AS draft_qa_passed,
       q.checked_at             AS draft_qa_checked_at,
       live.release_id          AS live_release_id,
       live.published_at        AS live_published_at,
       (SELECT COUNT(*) FROM website_releases h
         WHERE h.workspace_id = p.workspace_id AND h.state = 'previous') AS rollback_options,
       j.job_id                 AS running_job_id,
       j.stage                  AS running_job_stage,
       j.progress_message       AS running_job_message,
       j.retry_at               AS running_job_retry_at,
       p.revision,
       p.updated_at
  FROM website_projects p
  LEFT JOIN website_qa_runs q
         ON q.workspace_id = p.workspace_id AND q.qa_run_id = p.current_qa_run_id
  LEFT JOIN website_releases live
         ON live.workspace_id = p.workspace_id AND live.state = 'live'
  LEFT JOIN website_generation_jobs j
         ON j.workspace_id = p.workspace_id AND j.status = 'running';

-- ---------------------------------------------------------------------------
-- 12. Roles (least privilege). Grant the roles to concrete accounts separately:
--       GRANT everonn_website_app TO 'everonn_app'@'%';
--       SET DEFAULT ROLE everonn_website_app FOR 'everonn_app'@'%';
-- ---------------------------------------------------------------------------

CREATE ROLE IF NOT EXISTS everonn_website_app;
CREATE ROLE IF NOT EXISTS everonn_website_renderer;

-- Studio/API: writes drafts, content, jobs, preferences; release changes go
-- through the procedures (no direct DELETE on releases or their audit trail).
GRANT SELECT, INSERT, UPDATE, DELETE ON website_slugs                      TO everonn_website_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON website_projects                   TO everonn_website_app;
GRANT SELECT, INSERT, DELETE         ON website_versions                   TO everonn_website_app;
GRANT SELECT, INSERT                 ON website_version_services           TO everonn_website_app;
GRANT SELECT, INSERT                 ON website_version_service_sections   TO everonn_website_app;
GRANT SELECT, INSERT                 ON website_version_blocks             TO everonn_website_app;
GRANT SELECT, INSERT                 ON website_media_assets               TO everonn_website_app;
GRANT SELECT, INSERT                 ON website_code_concepts              TO everonn_website_app;
GRANT SELECT, INSERT                 ON website_code_pages                 TO everonn_website_app;
GRANT SELECT, INSERT                 ON website_qa_runs                    TO everonn_website_app;
GRANT SELECT, INSERT                 ON website_qa_checks                  TO everonn_website_app;
GRANT SELECT, INSERT, UPDATE         ON website_releases                   TO everonn_website_app;
GRANT SELECT, INSERT                 ON website_release_events             TO everonn_website_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON website_generation_jobs            TO everonn_website_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON website_design_preferences         TO everonn_website_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON website_design_preference_requests TO everonn_website_app;
GRANT SELECT ON v_website_live_sites       TO everonn_website_app;
GRANT SELECT ON v_website_private_previews TO everonn_website_app;
GRANT SELECT ON v_website_studio_overview  TO everonn_website_app;
GRANT EXECUTE ON PROCEDURE sp_website_reserve_slug TO everonn_website_app;
GRANT EXECUTE ON PROCEDURE sp_website_claim_job    TO everonn_website_app;
GRANT EXECUTE ON PROCEDURE sp_website_publish      TO everonn_website_app;
GRANT EXECUTE ON PROCEDURE sp_website_rollback     TO everonn_website_app;

-- Public site renderer: read-only access to live content.
GRANT SELECT ON v_website_live_sites               TO everonn_website_renderer;
GRANT SELECT ON website_releases                   TO everonn_website_renderer;
GRANT SELECT ON website_versions                   TO everonn_website_renderer;
GRANT SELECT ON website_version_services           TO everonn_website_renderer;
GRANT SELECT ON website_version_service_sections   TO everonn_website_renderer;
GRANT SELECT ON website_version_blocks             TO everonn_website_renderer;
GRANT SELECT ON website_media_assets               TO everonn_website_renderer;
GRANT SELECT ON website_code_concepts              TO everonn_website_renderer;
GRANT SELECT ON website_code_pages                 TO everonn_website_renderer;

INSERT INTO website_schema_migrations (version, component, applied_at)
VALUES ('202610090001', 'everonn-website-service', UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE version = version;

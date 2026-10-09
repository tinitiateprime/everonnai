-- Apply to your own PostgreSQL database. This package does not provision a database.
BEGIN;
CREATE SCHEMA IF NOT EXISTS waas;
CREATE TABLE IF NOT EXISTS waas.records (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS waas_public_slug ON waas.records
  ((coalesce(payload #>> '{publishedWebsite,project,publicSlug}', payload #>> '{websiteProject,publicSlug}')))
  WHERE key LIKE 'sites/%';
REVOKE ALL ON SCHEMA waas FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA waas FROM PUBLIC;
COMMIT;

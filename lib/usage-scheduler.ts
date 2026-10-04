import type { UsageQuery } from "./usage-postgres";

export const usageSchedulerName = "everonn_usage_worker_v1";
export const usageSchedulerCommand = "SELECT everonn_usage.invoke_usage_worker();";
const description = "EverOnn usage scheduler v1";
const migrationVersion = "202610040001";

export function usageSchedulerOrigin(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Supply the deployed HTTPS app origin with --origin."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || !/^[A-Za-z0-9.-]+$/.test(url.hostname) || !url.hostname.includes(".")
    || /(^localhost$|\.localhost$|\.local$|\.internal$|^\d+\.\d+\.\d+\.\d+$)/i.test(url.hostname)) {
    throw new Error("The scheduler requires a public HTTPS origin without a path or credentials.");
  }
  return url.origin;
}

const existingProjectMetadata = `
  SELECT 'schema' AS kind, nspname AS schema, nspname AS name, oid::text, nspacl::text AS privileges
  FROM pg_catalog.pg_namespace WHERE nspname IN ('public', 'agentic_that')
  UNION ALL
  SELECT 'relation', n.nspname, c.relname, c.oid::text, c.relacl::text
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'agentic_that')
  UNION ALL
  SELECT 'function', n.nspname, p.proname, p.oid::text, p.proacl::text
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'agentic_that')
  ORDER BY kind, schema, name, oid`;

async function dependencies(query: UsageQuery) {
  return query<{ name: string; installed: boolean }>(`
    SELECT name, installed_version IS NOT NULL AS installed FROM pg_catalog.pg_available_extensions
    WHERE name IN ('pg_cron','pg_net','supabase_vault') ORDER BY name`);
}

async function recognizedMigration(query: UsageQuery) {
  const [row] = await query<{ recognized: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM everonn_usage.schema_migrations
    WHERE version = $1 AND component = 'everonn-usage-scheduler') AS recognized`, [migrationVersion]);
  return row?.recognized === true;
}

async function ownJob(query: UsageQuery) {
  const rows = await query<{ jobid: number; active: boolean; command: string; username: string; database: string; owner: string; db: string }>(`
    SELECT jobid, active, command, username, database, CURRENT_USER AS owner, pg_catalog.current_database() AS db
    FROM cron.job WHERE jobname = $1`, [usageSchedulerName]);
  if (rows.length > 1 || rows.some(row => row.command !== usageSchedulerCommand || row.username !== row.owner || row.database !== row.db)) {
    throw new Error("An unrecognized job already uses the EverOnn scheduler name. It was not changed.");
  }
  return rows[0];
}

async function verifySecretAccess(query: UsageQuery) {
  const rows = await query<{ denied: boolean }>(`
    SELECT NOT pg_catalog.has_table_privilege(role, 'vault.decrypted_secrets','SELECT')
      AND NOT pg_catalog.has_table_privilege(role, 'everonn_usage.worker_requests','SELECT')
      AND NOT pg_catalog.has_function_privilege(role,'everonn_usage.invoke_usage_worker()','EXECUTE') AS denied
    FROM (VALUES ('anon'),('authenticated')) AS r(role)`);
  if (rows.length !== 2 || rows.some(row => !row.denied)) {
    throw new Error("Browser roles can access scheduler secrets or functions. Setup stopped; existing extension grants were not modified.");
  }
}

// Caller supplies a transaction-bound query. All changes, collision checks and
// before/after comparisons must commit together, including extension setup.
export async function configureUsageScheduler(query: UsageQuery, options: { origin: string; secret: string; migration: string; installExtensions?: boolean }) {
  const origin = usageSchedulerOrigin(options.origin);
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(options.secret)) throw new Error("USAGE_CRON_SECRET must contain 32–256 URL-safe characters.");
  await query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('everonn-usage-scheduler-v1',0))");
  const before = await query(existingProjectMetadata);
  const extensions = await dependencies(query);
  if (!extensions.find(row => row.name === "supabase_vault")?.installed) throw new Error("Enable Supabase Vault before configuring the usage scheduler.");
  const recognized = await recognizedMigration(query);
  const [existingSecret] = await query<{ id: string; description: string }>("SELECT id, description FROM vault.secrets WHERE name = $1", [usageSchedulerName]);
  if (existingSecret && (!recognized || existingSecret.description !== description)) throw new Error("An unrecognized Vault secret uses the scheduler name. It was not changed.");
  const otherSecretsBefore = await query("SELECT id, name, description, updated_at FROM vault.secrets WHERE name IS DISTINCT FROM $1 ORDER BY id", [usageSchedulerName]);
  const cronInstalled = extensions.find(row => row.name === "pg_cron")?.installed;
  const otherJobsBefore = cronInstalled ? await query("SELECT * FROM cron.job WHERE jobname IS DISTINCT FROM $1 ORDER BY jobid", [usageSchedulerName]) : [];
  if (cronInstalled) {
    const job = await ownJob(query);
    if (job && !recognized) throw new Error("An unrecognized scheduler job exists. It was not changed.");
  }
  for (const [name, schema, statement] of [
    ["pg_cron", "cron", "CREATE EXTENSION pg_cron"],
    ["pg_net", "net", "CREATE EXTENSION pg_net WITH SCHEMA extensions"],
  ]) {
    if (extensions.find(row => row.name === name)?.installed) continue;
    if (!options.installExtensions) throw new Error("Cron/pg_net are missing. Re-run --apply with --install-extensions to enable them.");
    const [occupied] = await query<{ present: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1) AS present", [schema]);
    if (occupied.present) throw new Error("An unrecognized extension schema exists. It was not changed.");
    await query(statement);
    // Supabase owns the extensions' ACLs. pg_net's public queue receives only
    // short-lived one-use HMAC signatures; the permanent secret stays in Vault.
    // Do not alter managed grants, shared settings or other cron jobs.
  }
  const [core] = await query<{ present: boolean }>("SELECT pg_catalog.to_regclass('everonn.schema_migrations') IS NOT NULL AS present");
  let migration = options.migration;
  if (core?.present) {
    // Keep the existing Cron command stable while moving its private tables.
    migration = migration.replaceAll(usageSchedulerCommand, "__EVERONN_CRON_COMMAND__")
      .replaceAll("everonn_usage.", "everonn.")
      .replaceAll("__EVERONN_CRON_COMMAND__", usageSchedulerCommand)
      .replace("AND (pg_catalog.to_regclass('everonn.worker_requests')", "AND NOT EXISTS (SELECT 1 FROM everonn.schema_migrations WHERE version='202610040003' AND component='everonn-core')\n     AND (pg_catalog.to_regclass('everonn.worker_requests')");
    migration += "\nCREATE OR REPLACE FUNCTION everonn_usage.invoke_usage_worker() RETURNS bigint LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT everonn.invoke_usage_worker() $$;\nREVOKE ALL ON FUNCTION everonn_usage.invoke_usage_worker() FROM PUBLIC,anon,authenticated,service_role;";
  }
  await query(migration);
  await verifySecretAccess(query);
  const configuration = JSON.stringify({ applicationUrl: origin, cronSecret: options.secret });
  if (existingSecret) await query("SELECT vault.update_secret($1::uuid,$2::text,$3::text,$4::text)", [existingSecret.id, configuration, usageSchedulerName, description]);
  else await query("SELECT vault.create_secret($1::text,$2::text,$3::text)", [configuration, usageSchedulerName, description]);
  const [scheduled] = await query<{ jobid: number }>("SELECT cron.schedule($1::text,'* * * * *',$2::text) AS jobid", [usageSchedulerName, usageSchedulerCommand]);
  await query("SELECT cron.alter_job($1::bigint,active := false)", [scheduled.jobid]);
  const otherJobsAfter = await query("SELECT * FROM cron.job WHERE jobname IS DISTINCT FROM $1 ORDER BY jobid", [usageSchedulerName]);
  const otherSecretsAfter = await query("SELECT id, name, description, updated_at FROM vault.secrets WHERE name IS DISTINCT FROM $1 ORDER BY id", [usageSchedulerName]);
  if (JSON.stringify(before) !== JSON.stringify(await query(existingProjectMetadata))
    || JSON.stringify(otherJobsBefore) !== JSON.stringify(otherJobsAfter)
    || JSON.stringify(otherSecretsBefore) !== JSON.stringify(otherSecretsAfter)) {
    throw new Error("Existing project metadata changed during setup; transaction must roll back.");
  }
  return { jobId: scheduled.jobid, name: usageSchedulerName, active: false, origin, existingProjectMetadataUnchanged: true };
}

export async function changeUsageScheduler(query: UsageQuery, active: boolean, expected?: { origin: string; secret: string }) {
  await query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('everonn-usage-scheduler-v1',0))");
  if (!await recognizedMigration(query)) throw new Error("The usage scheduler has not been configured.");
  const job = await ownJob(query);
  if (!job) throw new Error("The usage scheduler job is missing.");
  if (active) {
    await verifySecretAccess(query);
    if (!expected) throw new Error("Verify the live app and its current cron secret before enabling the scheduler.");
    const [matches] = await query<{ valid: boolean }>(`
      SELECT decrypted_secret::jsonb ->> 'applicationUrl' = $1 AND decrypted_secret::jsonb ->> 'cronSecret' = $2 AS valid
      FROM vault.decrypted_secrets WHERE name = $3 AND description = $4`, [usageSchedulerOrigin(expected.origin), expected.secret, usageSchedulerName, description]);
    if (!matches?.valid) throw new Error("Vault and the live scheduler settings do not match. Configure while disabled first.");
  }
  await query("SELECT cron.alter_job($1::bigint,active := $2::boolean)", [job.jobid, active]);
  return { name: usageSchedulerName, jobId: job.jobid, active };
}

export async function usageSchedulerStatus(query: UsageQuery) {
  const extensions = await dependencies(query);
  if (extensions.some(row => !row.installed) || extensions.length !== 3 || !await recognizedMigration(query)) return { configured: false, extensions };
  const job = await ownJob(query);
  const requests = await query(`
    SELECT r.request_id, r.requested_at, h.status_code, h.timed_out,
      h.error_msg IS NOT NULL AS transport_error, h.created AS responded_at
    FROM everonn_usage.worker_requests r LEFT JOIN net._http_response h ON h.id = r.request_id
    ORDER BY r.requested_at DESC LIMIT 5`);
  const runs = job ? await query("SELECT status, start_time, end_time FROM cron.job_run_details WHERE jobid = $1 ORDER BY start_time DESC LIMIT 5", [job.jobid]) : [];
  return { configured: Boolean(job), name: usageSchedulerName, jobId: job?.jobid, active: job?.active, extensions, requests, runs };
}

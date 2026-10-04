import { loadEnvConfig } from "@next/env";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import postgres from "postgres";
import { createAppRecords, type AppQuery } from "../lib/app-records";
import { usageDatabaseTls } from "../lib/usage-postgres";

async function main() {
  loadEnvConfig(process.cwd());
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("Save SUPABASE_DB_URL before applying the dedicated application migration.");
  const options = { prepare: false, max: 1, max_pipeline: 1, connect_timeout: 15, ssl: usageDatabaseTls(), onnotice: () => {} };
  const sql = postgres(url, options);
  try {
    const source = (await readFile(new URL("../supabase/migrations/202610040002_everonn_app.sql", import.meta.url), "utf8"))
      .replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "");
    const result = await sql.begin(async (transaction) => {
      async function existingMetadata() {
        return transaction.unsafe(`
          SELECT 'schema' AS kind, n.oid::text AS id, n.nspname AS name, n.nspacl::text AS permissions
          FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('public','agentic_that','everonn_usage','auth')
          UNION ALL
          SELECT 'relation', c.oid::text, n.nspname || '.' || c.relname,
            coalesce(c.relacl::text,'') || '/' || c.relrowsecurity::text || '/' || c.relforcerowsecurity::text
          FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname IN ('public','agentic_that','everonn_usage','auth')
          UNION ALL
          SELECT 'function', p.oid::text, n.nspname || '.' || p.proname,
            coalesce(p.proacl::text,'') || '/' || md5(pg_catalog.pg_get_functiondef(p.oid))
          FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','agentic_that','everonn_usage','auth') AND p.prokind IN ('f','p')
          ORDER BY kind, id
        `);
      }
      const before = await existingMetadata();
      await transaction.unsafe(source);
      const [security] = await transaction.unsafe(`
        SELECT
          NOT has_schema_privilege('anon','everonn_app','USAGE') AS anonymous_denied,
          NOT has_schema_privilege('authenticated','everonn_app','USAGE') AS browser_users_denied,
          NOT has_schema_privilege('service_role','everonn_app','USAGE') AS data_api_denied,
          (SELECT relrowsecurity FROM pg_class WHERE oid='everonn_app.app_records'::regclass) AS rls_enabled,
          NOT (SELECT prosecdef FROM pg_proc WHERE oid='everonn_app.write_app_record(text,jsonb,uuid,boolean)'::regprocedure) AS invoker_function,
          NOT has_function_privilege('anon','everonn_app.write_app_record(text,jsonb,uuid,boolean)','EXECUTE') AS anonymous_function_denied,
          NOT has_function_privilege('service_role','everonn_app.write_app_record(text,jsonb,uuid,boolean)','EXECUTE') AS data_api_function_denied
      `);
      if (!security || Object.values(security).some((value) => value !== true)) throw new Error("Application schema security verification failed.");
      const query: AppQuery = async <T extends Record<string, unknown>>(statement: string, parameters: unknown[] = []) =>
        [...await transaction.unsafe<T[]>(statement, parameters as postgres.ParameterOrJSON<never>[])];
      const store = createAppRecords(query);
      const migration = await store.checkMigration();
      const key = `workspaces/${createHash("sha256").update(randomUUID()).digest("hex")}`;
      if (!await store.write(key, { probe: true }, { new: true })) throw new Error("Application probe collided.");
      const initial = await store.read<{ probe: boolean }>(key);
      if (!initial?.data.probe || !await store.write(key, { probe: true, updated: true }, { revision: initial.revision })) throw new Error("Application conditional write probe failed.");
      if (await store.write(key, { probe: false }, { revision: initial.revision })) throw new Error("Application stale write was accepted.");
      const latest = await store.read(key);
      if (!latest || !await store.remove(key, latest.revision)) throw new Error("Application probe cleanup failed.");
      const after = await existingMetadata();
      if (!isDeepStrictEqual(before, after)) throw new Error("Existing project metadata changed; application migration rolled back.");
      return { schema: "everonn_app", migration, security, existingMetadataUnchanged: true, conditionalWriteProbePassed: true, localAccountsImported: false };
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code) throw new Error(`Application migration failed (${/^[A-Z0-9_]{1,40}$/.test(code) ? code : "database error"}); its transaction was rolled back.`);
    throw error;
  } finally { await sql.end({ timeout: 2 }); }
}
main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });

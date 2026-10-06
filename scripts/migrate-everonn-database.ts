import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import postgres from "postgres";
import { usageDatabaseTls } from "../lib/usage-postgres";

const version = "202610060004";
const foreignSchemas = ["public","agentic_that","agenticthat","auth"];
const metadata = `
  SELECT 'schema' AS kind,n.oid::text AS id,n.nspname AS name,n.nspacl::text AS details
  FROM pg_namespace n WHERE n.nspname=ANY($1::text[])
  UNION ALL
  SELECT 'relation',c.oid::text,n.nspname||'.'||c.relname,
    coalesce(c.relacl::text,'')||'/'||c.relrowsecurity::text||'/'||c.relforcerowsecurity::text
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[])
  UNION ALL
  SELECT 'column',a.attrelid::text||'/'||a.attnum::text,n.nspname||'.'||c.relname||'.'||a.attname,
    a.atttypid::text||'/'||a.attnotnull::text||'/'||coalesce(a.attacl::text,'')
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint',x.oid::text,n.nspname||'.'||x.conname,pg_get_constraintdef(x.oid)
  FROM pg_constraint x JOIN pg_namespace n ON n.oid=x.connamespace WHERE n.nspname=ANY($1::text[])
  UNION ALL
  SELECT 'function',p.oid::text,n.nspname||'.'||p.proname,coalesce(p.proacl::text,'')||'/'||md5(pg_get_functiondef(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1::text[]) AND p.prokind IN ('f','p')
  UNION ALL
  SELECT 'policy',p.oid::text,n.nspname||'.'||p.polname,
    coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'/'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')||'/'||p.polroles::text
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[])
  ORDER BY kind,id`;

export async function migrateEveronnDatabase(apply = false) {
  loadEnvConfig(process.cwd());
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("Save SUPABASE_DB_URL before checking or migrating EverOnn tables.");
  const options = {prepare:false,max:1,max_pipeline:1,connect_timeout:15,ssl:usageDatabaseTls(),onnotice:()=>{}};
  const sql = postgres(url,options);
  try {
    const [present] = await sql.unsafe("SELECT to_regclass('everonn.schema_migrations') IS NOT NULL AS core, to_regclass('everonn.project_repositories') IS NOT NULL AS projects, to_regclass('everonn_app.app_records') IS NOT NULL AS app, to_regclass('everonn_usage.usage_records') IS NOT NULL AS usage, to_regclass('everonn_usage.worker_requests') IS NOT NULL AS scheduler");
    if (!apply) {
      const tables = await sql.unsafe("SELECT table_name FROM information_schema.tables WHERE table_schema='everonn' AND table_type='BASE TABLE' ORDER BY table_name");
      return {schema:"everonn",migration:version,applied:present.core && present.projects,tables:tables.map(row=>row.table_name),action:"Use --apply to migrate only EverOnn's recognized stores."};
    }
    const files = [
      ...(!present.usage ? ["202610030001_everonn_usage.sql"] : []),
      ...(!present.app ? ["202610040002_everonn_app.sql"] : []),
      "202610040003_everonn_relational.sql",
      "202610060004_project_repositories.sql",
    ];
    const sources = await Promise.all(files.map(async name => (await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8")).replace(/^BEGIN;\s*$/m,"").replace(/^COMMIT;\s*$/m,"")));
    const result = await sql.begin("isolation level repeatable read", async tx => {
      await tx.unsafe("SET LOCAL statement_timeout='90s'");
      await tx.unsafe("SET LOCAL lock_timeout='15s'");
      // LOCK does not establish a data snapshot. Lock the old stores before the
      // first SELECT, so in-flight writes are included in the migration snapshot.
      if (!present.core) {
        const locks = [...(present.scheduler ? ["everonn_usage.worker_requests"] : []),...(present.app ? ["everonn_app.app_records"] : []),...(present.usage ? ["everonn_usage.usage_records"] : [])];
        if (locks.length) await tx.unsafe("LOCK TABLE "+locks.join(",")+" IN ACCESS EXCLUSIVE MODE");
      }
      const beforeMetadata = await tx.unsafe(metadata,[foreignSchemas]);
      const foreignTables = await tx.unsafe<{schema:string;name:string}[]>(`
        SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=ANY($1::text[]) AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY n.nspname,c.relname`,[foreignSchemas]);
      async function fingerprints() {
        const values = [];
        for (const table of foreignTables) {
          const identifier = (name:string) => '"'+name.replaceAll('"','""')+'"';
          const [digest] = await tx.unsafe(`SELECT count(*)::text AS rows, md5(coalesce(string_agg(digest,'' ORDER BY digest),'')) AS digest
            FROM (SELECT md5(to_jsonb(t)::text) AS digest FROM ${identifier(table.schema)}.${identifier(table.name)} t) x`);
          values.push({schema:table.schema,table:table.name,...digest});
        }
        return values;
      }
      const beforeData = await fingerprints();
      for (const source of sources) await tx.unsafe(source);
      if (!isDeepStrictEqual(beforeMetadata,await tx.unsafe(metadata,[foreignSchemas]))
        || !isDeepStrictEqual(beforeData,await fingerprints())) {
        throw new Error("Other-project data or metadata changed; the EverOnn migration was rolled back.");
      }
      const [security] = await tx.unsafe(`
        SELECT NOT has_schema_privilege('anon','everonn','USAGE') AS anonymous_denied,
          NOT has_schema_privilege('authenticated','everonn','USAGE') AS browser_denied,
          NOT has_table_privilege('service_role','everonn.users','SELECT') AS account_api_denied,
          NOT has_table_privilege('service_role','everonn.provider_connections','SELECT') AS credentials_api_denied,
          NOT has_table_privilege('service_role','everonn.legacy_app_records','SELECT') AS backups_api_denied,
          NOT has_function_privilege('anon','everonn.write_app_record(text,jsonb,uuid,boolean)','EXECUTE') AS anonymous_write_denied,
          NOT (SELECT prosecdef FROM pg_proc WHERE oid='everonn.write_app_record(text,jsonb,uuid,boolean)'::regprocedure) AS invoker_function,
          NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='everonn' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity) AS all_tables_rls,
          EXISTS(SELECT 1 FROM everonn.schema_migrations WHERE version='202610040003' AND component='everonn-core') AS migration_verified`);
      if (!security || Object.values(security).some(value=>value!==true)) throw new Error("Private table security verification failed; migration rolled back.");
      const counts = await tx.unsafe(`
        SELECT 'users' AS table_name,count(*)::int AS rows FROM everonn.users
        UNION ALL SELECT 'auth_sessions',count(*)::int FROM everonn.auth_sessions
        UNION ALL SELECT 'contacts',count(*)::int FROM everonn.contacts
        UNION ALL SELECT 'leads',count(*)::int FROM everonn.leads
        UNION ALL SELECT 'appointments',count(*)::int FROM everonn.appointments
        UNION ALL SELECT 'conversations',count(*)::int FROM everonn.conversations
        UNION ALL SELECT 'usage_events',count(*)::int FROM everonn.usage_events
        UNION ALL SELECT 'project_repositories',count(*)::int FROM everonn.project_repositories
        ORDER BY table_name`);
      return {schema:"everonn",migration:version,applied:true,counts,security,otherProjectTablesVerified:foreignTables.length,otherProjectDataAndMetadataUnchanged:true,legacyDeploymentCompatible:true};
    });
    return result;
  } catch(error) {
    const code=(error as {code?:string}).code;
    if(code) throw new Error("EverOnn migration failed ("+(/^[A-Z0-9_]{1,40}$/.test(code)?code:"database error")+"); its transaction was rolled back.");
    throw error;
  } finally { await sql.end({timeout:2}); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  migrateEveronnDatabase(process.argv.includes("--apply")).then(result=>console.log(JSON.stringify(result))).catch((error:Error)=>{console.error(error.message);process.exitCode=1;});
}

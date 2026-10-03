import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { usageDatabaseTls } from "../lib/usage-postgres";

async function main() {
  loadEnvConfig(process.cwd());
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("Add SUPABASE_DB_URL to .env.local, or run the dedicated migration in Supabase's SQL Editor.");
  if ((process.env.SUPABASE_USAGE_SCHEMA || "everonn_usage") !== "everonn_usage") throw new Error("The migration is restricted to everonn_usage.");
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15, ssl: usageDatabaseTls(), onnotice: () => {} });
  try {
    const source = await readFile(new URL("../supabase/migrations/202610030001_everonn_usage.sql", import.meta.url), "utf8");
    await sql.unsafe(source);
    const [security] = await sql`
      SELECT
        NOT has_schema_privilege('anon', 'everonn_usage', 'USAGE') AS anonymous_denied,
        NOT has_schema_privilege('authenticated', 'everonn_usage', 'USAGE') AS browser_users_denied,
        has_table_privilege('service_role', 'everonn_usage.usage_records', 'SELECT,INSERT,UPDATE,DELETE') AS server_access,
        (SELECT relrowsecurity FROM pg_class WHERE oid = 'everonn_usage.usage_records'::regclass) AS rls_enabled,
        NOT has_function_privilege('anon', 'everonn_usage.write_usage_record(text,jsonb,uuid,boolean)', 'EXECUTE') AS anonymous_rpc_denied`;
    if (!security || Object.values(security).some((value) => value !== true)) throw new Error("Usage schema security verification failed.");
    console.log(JSON.stringify({ schema: "everonn_usage", migration: "202610030001", security, privatePostgresAccess: true }));
  } catch (error) {
    await sql.unsafe("ROLLBACK").catch(() => undefined);
    const code = (error as { code?: string }).code;
    if (code) throw new Error(`Usage migration failed (${/^[A-Z0-9_]{1,40}$/.test(code) ? code : "database error"}). Existing-schema conflicts stop the transaction; no other app schema is migrated.`);
    throw error;
  } finally { await sql.end({ timeout: 2 }); }
}
main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });

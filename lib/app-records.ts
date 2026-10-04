import postgres from "postgres";
import { usageDatabaseTls } from "./usage-postgres";

export const appMigrationVersion = "202610040002";
export type AppQuery = <T extends Record<string, unknown>>(query: string, parameters?: unknown[]) => Promise<T[]>;
const keyPattern = /^(auth\/accounts|workspaces\/primary|workspaces\/[a-f0-9]{64}|providers\/google)$/;
let cached: { url: string; sql: ReturnType<typeof postgres> } | undefined;

export function appDatabaseConfigured() {
  if (process.env.SUPABASE_DB_URL) return true;
  if (process.env.EVERONN_REQUIRE_DURABLE_STORAGE === "true" || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw Object.assign(new Error("Account and workspace storage requires the server Supabase database connection."), { status: 503 });
  }
  return false;
}

export async function closeAppDatabase() {
  const previous = cached;
  cached = undefined;
  if (previous) await previous.sql.end({ timeout: 2 });
}

export function appRecords() {
  const url = process.env.SUPABASE_DB_URL || "";
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw Object.assign(new Error("Configure SUPABASE_DB_URL for account and workspace storage."), { status: 503 }); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.password || /YOUR.PASSWORD|\.\.\./i.test(url)) {
    throw Object.assign(new Error("Configure a complete PostgreSQL connection for account and workspace storage."), { status: 503 });
  }
  if (!cached || cached.url !== url) {
    const previous = cached;
    const options = { prepare: false, max: 2, max_pipeline: 0, connect_timeout: 10, idle_timeout: 15, ssl: usageDatabaseTls(), onnotice: () => {} };
    cached = { url, sql: postgres(url, options) };
    if (previous) void previous.sql.end({ timeout: 1 }).catch(() => undefined);
  }
  const sql = cached.sql;
  const query: AppQuery = async <T extends Record<string, unknown>>(statement: string, parameters: unknown[] = []) => {
    try { return [...await sql.unsafe<T[]>(statement, parameters as postgres.ParameterOrJSON<never>[])]; }
    catch (error) {
      const code = (error as { code?: string }).code;
      const safeCode = code && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "unavailable";
      const setup = ["42P01", "3F000", "42883"].includes(safeCode) ? " Apply the dedicated EverOnn application migration." : "";
      throw Object.assign(new Error(`Account and workspace database request failed (${safeCode}).${setup}`), { status: 503 });
    }
  };
  return createAppRecords(query);
}

export function createAppRecords(query: AppQuery) {
  const validateKey = (key: string) => { if (!keyPattern.test(key)) throw new Error("Invalid application record key."); };
  const store = {
    async read<T>(key: string): Promise<{ data: T; revision: string } | null> {
      validateKey(key);
      const [row] = await query<{ payload: T; revision: string }>("SELECT payload, revision FROM everonn_app.app_records WHERE key = $1", [key]);
      return row ? { data: row.payload, revision: row.revision } : null;
    },
    async write(key: string, value: unknown, condition: { revision: string } | { new: true }) {
      validateKey(key);
      const [row] = await query<{ accepted: boolean }>("SELECT everonn_app.write_app_record($1, $2::text::jsonb, $3::uuid, $4::boolean) AS accepted", [
        key, JSON.stringify(value), "revision" in condition ? condition.revision : null, "new" in condition,
      ]);
      if (typeof row?.accepted !== "boolean") throw new Error("Invalid application database acknowledgement.");
      return row.accepted;
    },
    async listWorkspaces<T>(): Promise<T[]> {
      const result: T[] = [];
      let cursor = "";
      for (;;) {
        const rows = await query<{ key: string; payload: T }>("SELECT key, payload FROM everonn_app.app_records WHERE key LIKE 'workspaces/%' AND key <> 'workspaces/primary' AND key > $1 ORDER BY key LIMIT 500", [cursor]);
        if (!rows.length) return result;
        for (const row of rows) {
          validateKey(row.key);
          if (!row.key.startsWith("workspaces/") || row.key === "workspaces/primary" || row.key <= cursor) throw new Error("Invalid application workspace listing.");
          cursor = row.key;
          result.push(row.payload);
        }
      }
    },
    async remove(key: string, revision: string) {
      validateKey(key);
      const rows = await query<{ key: string }>("DELETE FROM everonn_app.app_records WHERE key = $1 AND revision = $2::uuid RETURNING key", [key, revision]);
      return rows.length === 1;
    },
    async mutate<T, R>(key: string, empty: () => T, validate: (value: unknown) => asserts value is T, update: (value: T) => R | Promise<R>) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const current = await store.read<T>(key);
        const value = current ? structuredClone(current.data) : empty();
        validate(value);
        const result = await update(value);
        validate(value);
        if (await store.write(key, value, current ? { revision: current.revision } : { new: true })) return result;
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
      }
      throw Object.assign(new Error("The account or workspace changed repeatedly. Please retry."), { status: 409 });
    },
    async checkMigration() {
      const [row] = await query<{ version: string }>("SELECT version FROM everonn_app.schema_migrations WHERE version = $1 AND component = 'everonn-app'", [appMigrationVersion]);
      if (row?.version !== appMigrationVersion) throw new Error("The dedicated EverOnn application migration has not been verified.");
      return row.version;
    },
  };
  return store;
}

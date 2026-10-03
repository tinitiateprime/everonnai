import postgres from "postgres";
import { rootCertificates } from "node:tls";
import { supabaseDatabaseCa } from "./supabase-ca";

export const usageDatabaseTls = () => ({ rejectUnauthorized: true, ca: [...rootCertificates, supabaseDatabaseCa] });

export type UsageQuery = <T extends Record<string, unknown>>(query: string, parameters?: unknown[]) => Promise<T[]>;
const keyPattern = /^(events|sessions|outbox|claims|billing|system)\/[A-Za-z0-9_./-]+$/;
let cached: { url: string; sql: ReturnType<typeof postgres> } | undefined;

export async function closeUsagePostgres() {
  const previous = cached;
  cached = undefined;
  if (previous) await previous.sql.end({ timeout: 2 });
}

export function usagePostgres() {
  const url = process.env.SUPABASE_DB_URL || "";
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Configure a valid SUPABASE_DB_URL for the private usage schema."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.password || /YOUR.PASSWORD|\.\.\./i.test(url)) throw new Error("Configure a complete PostgreSQL connection string for usage storage.");
  if (!cached || cached.url !== url) {
    const previous = cached;
    const configuration = { prepare: false, max: 2, max_pipeline: 0, connect_timeout: 10, idle_timeout: 15, ssl: usageDatabaseTls(), onnotice: () => {} };
    cached = { url, sql: postgres(url, configuration) };
    if (previous) void previous.sql.end({ timeout: 1 }).catch(() => undefined);
  }
  const sql = cached.sql;
  const query: UsageQuery = async <T extends Record<string, unknown>>(statement: string, parameters: unknown[] = []) => {
    try { return [...await sql.unsafe<T[]>(statement, parameters as postgres.ParameterOrJSON<never>[])]; }
    catch (error) {
      const code = (error as { code?: string }).code;
      const safeCode = code && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "unavailable";
      const setup = ["42P01", "3F000", "42883"].includes(safeCode) ? " Apply supabase/migrations/202610030001_everonn_usage.sql." : "";
      throw new Error(`Usage PostgreSQL request failed (${safeCode}).${setup}`);
    }
  };
  return createUsagePostgres(query);
}

export function createUsagePostgres(query: UsageQuery) {
  const validateKey = (key: string) => { if (!keyPattern.test(key) || key.includes("..")) throw new Error("Invalid usage record key."); };
  return {
    async read<T>(key: string): Promise<{ data: T; revision: string } | null> {
      validateKey(key);
      const [row] = await query<{ payload: T; revision: string }>("SELECT payload, revision FROM everonn_usage.usage_records WHERE key = $1", [key]);
      return row ? { data: row.payload, revision: row.revision } : null;
    },
    async write(key: string, value: unknown, condition?: { revision: string } | { new: true }) {
      validateKey(key);
      // Send serialized JSON as a text parameter: a jsonb-typed parameter makes
      // Postgres.js serialize the already-serialized string a second time.
      const [row] = await query<{ accepted: boolean }>("SELECT everonn_usage.write_usage_record($1, $2::text::jsonb, $3::uuid, $4::boolean) AS accepted", [
        key, JSON.stringify(value), condition && "revision" in condition ? condition.revision : null, Boolean(condition && "new" in condition),
      ]);
      if (typeof row?.accepted !== "boolean") throw new Error("Invalid usage database write acknowledgement.");
      return row.accepted;
    },
    async list<T>(prefix: string): Promise<T[]> {
      if (!/^(events|sessions|outbox|claims|billing|system)(\/[A-Za-z0-9_-]+)*$/.test(prefix)) throw new Error("Invalid usage record prefix.");
      const result: T[] = [];
      const pattern = `${prefix}/`.replace(/[%_\\]/g, "\\$&") + "%";
      let cursor = "";
      for (;;) {
        const rows = await query<{ key: string; payload: T }>("SELECT key, payload FROM everonn_usage.usage_records WHERE key LIKE $1 AND key > $2 ORDER BY key LIMIT 500", [pattern, cursor]);
        if (!rows.length) return result;
        for (const row of rows) {
          if (!row.key.startsWith(`${prefix}/`) || row.key <= cursor) throw new Error("Usage database listing scope or cursor mismatch.");
          cursor = row.key;
          result.push(row.payload);
        }
      }
    },
    async remove(key: string) {
      validateKey(key);
      await query("DELETE FROM everonn_usage.usage_records WHERE key = $1", [key]);
    },
    async checkMigration() {
      const [row] = await query<{ version: string }>("SELECT version FROM everonn_usage.schema_migrations WHERE version = $1 AND component = $2", ["202610030001", "everonn-usage"]);
      if (row?.version !== "202610030001") throw new Error("The EverOnn usage migration has not been verified.");
      return row.version;
    },
  };
}

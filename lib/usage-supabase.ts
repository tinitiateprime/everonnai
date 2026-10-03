import { usagePostgres } from "./usage-postgres";

const schemaName = "everonn_usage";
export const usageMigrationVersion = "202610030001";
const keyPattern = /^(events|sessions|outbox|claims|billing|system)\/[A-Za-z0-9_./-]+$/;
type Row = { key: string; payload: Record<string, unknown>; revision: string };
type Condition = { revision: string } | { new: true };

export function usageSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_USAGE_SCHEMA);
}

export function usageSupabase() {
  if ((process.env.SUPABASE_USAGE_SCHEMA || schemaName) !== schemaName) throw new Error("SUPABASE_USAGE_SCHEMA must be everonn_usage; other project schemas are not permitted.");
  if (process.env.SUPABASE_DB_URL) return usagePostgres();
  return createUsageSupabase({
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    secretKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    schema: process.env.SUPABASE_USAGE_SCHEMA || schemaName,
  });
}

export class UsageDatabaseError extends Error {
  constructor(public readonly status: number, public readonly code: string | null) {
    const setup = code === "PGRST106" ? " Add everonn_usage to Supabase's Exposed schemas while preserving existing entries."
      : ["PGRST202", "PGRST205", "42P01"].includes(code || "") ? " Apply supabase/migrations/202610030001_everonn_usage.sql."
      : status === 401 || status === 403 ? " Check the server Supabase key and usage-schema permissions." : "";
    super(`Usage database request failed (HTTP ${status}${code ? `; ${code}` : ""}).${setup}`);
  }
}

export function createUsageSupabase(options: { url: string; secretKey: string; schema?: string; fetch?: typeof fetch }) {
  if (!options.url || !options.secretKey) throw new Error("Configure SUPABASE_URL and the server-only SUPABASE_SECRET_KEY for usage storage.");
  let origin: URL;
  try { origin = new URL(options.url); } catch { throw new Error("Invalid Supabase project URL."); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || !["", "/"].includes(origin.pathname)) throw new Error("Use the exact HTTPS Supabase project origin.");
  if ((options.schema || schemaName) !== schemaName) throw new Error("SUPABASE_USAGE_SCHEMA must be everonn_usage; other project schemas are not permitted.");
  const legacy = options.secretKey.startsWith("eyJ");
  if (legacy) {
    let role: unknown;
    try { role = JSON.parse(Buffer.from(options.secretKey.split(".")[1], "base64url").toString("utf8")).role; } catch { /* Reject malformed credentials without printing them. */ }
    if (role !== "service_role") throw new Error("Usage storage requires a server secret or service_role key, not a public key.");
  } else if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(options.secretKey)) throw new Error("Usage storage requires a Supabase server secret key.");
  const requestFetch = options.fetch || fetch;
  const validateKey = (key: string) => { if (!keyPattern.test(key) || key.includes("..")) throw new Error("Invalid usage record key."); };
  const validateRow = (value: unknown): Row => {
    const row = value as Row;
    if (!row || typeof row.key !== "string" || !row.payload || typeof row.payload !== "object" || Array.isArray(row.payload) || typeof row.revision !== "string" || !/^[a-f0-9-]{36}$/i.test(row.revision)) throw new Error("Invalid usage database record.");
    return row;
  };
  async function request(resource: string, parameters: URLSearchParams, method = "GET", body?: unknown) {
    const url = new URL(`/rest/v1/${resource}`, origin);
    url.search = parameters.toString();
    let response: Response;
    try {
      response = await requestFetch(url, {
        method, cache: "no-store", signal: AbortSignal.timeout(15_000),
        headers: {
          apikey: options.secretKey, ...(legacy ? { Authorization: `Bearer ${options.secretKey}` } : {}),
          "Accept-Profile": schemaName, "Content-Profile": schemaName, "Content-Type": "application/json",
          ...(method === "DELETE" ? { Prefer: "return=minimal" } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error("Usage database could not be reached. Retry after checking the Supabase connection."); }
    if (!response.ok) {
      let code: string | null = null;
      try { const data = await response.json(); if (typeof data.code === "string" && /^[A-Z0-9_]{1,40}$/.test(data.code)) code = data.code; } catch { /* Never surface database payloads or credential-bearing messages. */ }
      throw new UsageDatabaseError(response.status, code);
    }
    if (method === "DELETE") return null;
    try { return await response.json() as unknown; } catch { throw new Error("Invalid usage database response."); }
  }
  return {
    async read<T>(key: string): Promise<{ data: T; revision: string } | null> {
      validateKey(key);
      const rows = await request("usage_records", new URLSearchParams({ key: `eq.${key}`, select: "key,payload,revision", limit: "1" }));
      if (!Array.isArray(rows) || rows.length > 1) throw new Error("Invalid usage database response.");
      if (!rows.length) return null;
      const row = validateRow(rows[0]);
      if (row.key !== key) throw new Error("Usage database record scope mismatch.");
      return { data: row.payload as T, revision: row.revision };
    },
    async write(key: string, value: unknown, condition?: Condition) {
      validateKey(key);
      const result = await request("rpc/write_usage_record", new URLSearchParams(), "POST", {
        p_key: key, p_payload: value,
        p_expected_revision: condition && "revision" in condition ? condition.revision : null,
        p_insert_only: Boolean(condition && "new" in condition),
      });
      if (typeof result !== "boolean") throw new Error("Invalid usage database write acknowledgement.");
      return result;
    },
    async list<T>(prefix: string): Promise<T[]> {
      if (!/^(events|sessions|outbox|claims|billing|system)(\/[A-Za-z0-9_-]+)*$/.test(prefix)) throw new Error("Invalid usage record prefix.");
      const result: T[] = [];
      const literalPrefix = `${prefix}/`;
      const pattern = literalPrefix.replace(/[%_\\]/g, "\\$&") + "*";
      let cursor = "";
      // Keyset pagination also works when the project's max-row setting is
      // below our requested page size. Do not stop merely on a short page.
      for (;;) {
        const parameters = new URLSearchParams({ select: "key,payload,revision", key: `like.${pattern}`, order: "key.asc", limit: "500" });
        if (cursor) parameters.append("key", `gt.${cursor}`);
        const rows = await request("usage_records", parameters);
        if (!Array.isArray(rows)) throw new Error("Invalid usage database response.");
        if (!rows.length) return result;
        for (const value of rows) {
          const row = validateRow(value);
          if (!row.key.startsWith(literalPrefix) || (cursor && row.key <= cursor)) throw new Error("Usage database listing scope or cursor mismatch.");
          cursor = row.key;
          result.push(row.payload as T);
        }
      }
    },
    async remove(key: string) {
      validateKey(key);
      await request("usage_records", new URLSearchParams({ key: `eq.${key}` }), "DELETE");
    },
    async checkMigration() {
      const rows = await request("schema_migrations", new URLSearchParams({ select: "version,component", version: `eq.${usageMigrationVersion}`, component: "eq.everonn-usage", limit: "1" }));
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.version !== usageMigrationVersion || rows[0]?.component !== "everonn-usage") throw new Error("The EverOnn usage migration has not been verified. Apply the dedicated usage-schema migration.");
      return usageMigrationVersion;
    },
  };
}

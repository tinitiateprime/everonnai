import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { localPlatformMode, PlatformError } from "./config";
import { migrateDatabase } from "./migrations";

export interface SqlClient {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
}
export interface PlatformDatabase {
  kind: "postgresql" | "local";
  transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function embeddedDatabase(
  directory?: string,
): Promise<PlatformDatabase> {
  if (directory) await mkdir(directory, { recursive: true });
  const pg = await PGlite.create(directory ?? "memory://");
  return {
    kind: "local",
    transaction: (work) =>
      pg.transaction(async (tx) =>
        work({
          query: async <T>(sql: string, values?: unknown[]) => ({
            rows: (await tx.query(sql, values)).rows as T[],
          }),
          exec: async (sql) => {
            await tx.exec(sql);
          },
        }),
      ),
    close: () => pg.close(),
  };
}

export function postgresDatabase(connectionString: string): PlatformDatabase {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new PlatformError("DATABASE_URL must use PostgreSQL.", 503);
  }
  const pool = new Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  return {
    kind: "postgresql",
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work({
          query: async <T>(sql: string, values?: unknown[]) => ({
            rows: (await client.query(sql, values)).rows as T[],
          }),
          exec: async (sql) => {
            await client.query(sql);
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

const state = globalThis as typeof globalThis & {
  everonnPlatformDatabase?: Promise<PlatformDatabase>;
};
export async function getPlatformDatabase() {
  if (!state.everonnPlatformDatabase) {
    state.everonnPlatformDatabase = (async () => {
      if (localPlatformMode()) {
        let db: PlatformDatabase;
        try {
          db = await embeddedDatabase(
            path.resolve(
              /* turbopackIgnore: true */
              process.env.PLATFORM_DATABASE_DIR || "data/platform/database",
            ),
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : "";
          const code =
            typeof error === "object" && error && "code" in error
              ? String(error.code)
              : "";
          const cause = /ENOENT|not found|no such/i.test(detail + code)
            ? "missing database files"
            : /EACCES|EPERM|permission/i.test(detail + code)
              ? "database directory permission"
              : /wasm|WebAssembly/i.test(detail)
                ? "database runtime initialization"
                : /lock|already.*open/i.test(detail)
                  ? "database already open"
                  : /url|protocol/i.test(detail)
                    ? "database directory format"
                    : "database initialization";
          throw new PlatformError(
            `Local workspace could not start: ${cause}${code && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : ""}.`,
            503,
          );
        }
        try {
          await migrateDatabase(db);
        } catch (error) {
          await db.close();
          throw error;
        }
        return db;
      }
      const connection = process.env.DATABASE_URL?.trim();
      if (!connection)
        throw new PlatformError(
          "The workspace database is not configured.",
          503,
        );
      return postgresDatabase(connection);
    })().catch((error) => {
      state.everonnPlatformDatabase = undefined;
      throw error;
    });
  }
  const db = await state.everonnPlatformDatabase;
  // A dev server can outlive a schema addition during hot reload.
  if (localPlatformMode()) await migrateDatabase(db);
  return db;
}

export async function actorTransaction<T>(
  db: PlatformDatabase,
  actorId: string,
  work: (client: SqlClient) => Promise<T>,
) {
  return db.transaction(async (client) => {
    await client.exec("SET LOCAL ROLE everonn_platform_app");
    await client.query("SELECT set_config('everonn.actor_id', $1, true)", [
      actorId,
    ]);
    return work(client);
  });
}

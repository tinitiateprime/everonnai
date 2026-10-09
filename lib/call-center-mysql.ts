import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

// MySQL access for the Live Agent Desk. One small pool per process; every
// session runs in UTC so DATETIME(3) values are UTC end to end (§21.2).
export type DeskRow = RowDataPacket & Record<string, unknown>;
export type DeskTx = {
  rows<T = DeskRow>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<ResultSetHeader>;
};

let cached: { url: string; pool: Pool } | undefined;

export function callCenterDatabaseConfigured() {
  return Boolean(process.env.CALL_CENTER_DATABASE_URL);
}

export function callCenterPool() {
  const url = process.env.CALL_CENTER_DATABASE_URL || "";
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Configure CALL_CENTER_DATABASE_URL (mysql://user:password@host:3306/everonn_call_center)."); }
  if (parsed.protocol !== "mysql:" || !parsed.hostname || !parsed.pathname.slice(1)) throw new Error("CALL_CENTER_DATABASE_URL must be a mysql:// URL that names the database.");
  if (!cached || cached.url !== url) {
    const previous = cached;
    const pool = mysql.createPool({
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: decodeURIComponent(parsed.pathname.slice(1)),
      connectionLimit: Number(process.env.CALL_CENTER_DATABASE_POOL_SIZE || 5),
      timezone: "Z",
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      charset: "utf8mb4_0900_ai_ci",
      ssl: process.env.CALL_CENTER_DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
    });
    pool.on("connection", (connection) => { connection.query("SET time_zone = '+00:00'"); });
    cached = { url, pool };
    if (previous) void previous.pool.end().catch(() => undefined);
  }
  return cached.pool;
}

export async function closeCallCenterPool() {
  const previous = cached;
  cached = undefined;
  if (previous) await previous.pool.end();
}

function wrap(connection: PoolConnection | Pool): DeskTx {
  return {
    async rows<T>(sql: string, params: unknown[] = []) {
      const [rows] = await connection.query(sql, params);
      return rows as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      const [result] = await connection.query(sql, params);
      return result as ResultSetHeader;
    },
  };
}

const retryableCodes = new Set(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);

// Runs fn in a REPEATABLE READ transaction, retrying deadlock victims. The
// callback must be safe to re-run (all writes happen inside the transaction).
export async function withDeskTransaction<T>(fn: (tx: DeskTx) => Promise<T>, pool: Pool = callCenterPool()): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await fn(wrap(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      const code = (error as { code?: string }).code || "";
      if (retryableCodes.has(code) && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 15 * attempt + Math.random() * 25));
        continue;
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}

export async function withDeskConnection<T>(fn: (tx: DeskTx) => Promise<T>, pool: Pool = callCenterPool()): Promise<T> {
  const connection = await pool.getConnection();
  try { return await fn(wrap(connection)); }
  finally { connection.release(); }
}

import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

// Applies mysql/migrations/*.sql in order and records each in
// schema_migrations with a checksum, refusing to continue if an applied
// migration was edited afterwards.
loadEnvConfig(process.cwd());

async function main() {
  const url = process.env.CALL_CENTER_DATABASE_URL;
  if (!url) throw new Error("Set CALL_CENTER_DATABASE_URL (mysql://user:password@host:3306/everonn_call_center).");
  const parsed = new URL(url);
  const connection = await mysql.createConnection({
    host: parsed.hostname, port: Number(parsed.port || 3306), user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)), multipleStatements: true, timezone: "Z",
    ssl: process.env.CALL_CENTER_DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  });
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    const directory = path.join(process.cwd(), "mysql", "migrations");
    const files = (await readdir(directory)).filter((file) => /^\d{12}_[a-z0-9_]+\.sql$/.test(file)).sort();
    const [rows] = await connection.query("SELECT version, checksum FROM schema_migrations");
    const applied = new Map((rows as Array<{ version: string; checksum: string }>).map((row) => [row.version, row.checksum]));
    const result: string[] = [];
    for (const file of files) {
      const sql = await readFile(path.join(directory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) {
        if (applied.get(version) !== checksum) throw new Error(`Migration ${file} changed after it was applied. Add a new migration instead.`);
        continue;
      }
      // MySQL DDL auto-commits; each file is written to be re-runnable.
      await connection.query(sql);
      await connection.query("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))", [version, checksum]);
      result.push(version);
    }
    console.log(JSON.stringify({ applied: result, total: files.length }));
  } finally {
    await connection.end();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});

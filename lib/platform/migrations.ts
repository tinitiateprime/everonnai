import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { PlatformDatabase } from "./database";

export async function migrateDatabase(db: PlatformDatabase) {
  const root = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(root))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  await db.transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(173540112, 1)");
    await client.exec(
      "CREATE SCHEMA IF NOT EXISTS everonn_platform; CREATE TABLE IF NOT EXISTS everonn_platform.schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of files) {
      const sql = await readFile(path.join(root, name), "utf8");
      const sha256 = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ sha256: string }>(
        "SELECT sha256 FROM everonn_platform.schema_migrations WHERE name = $1",
        [name],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].sha256 !== sha256)
          throw new Error("Applied platform migration has changed: " + name);
        continue;
      }
      await client.exec(sql);
      await client.query(
        "INSERT INTO everonn_platform.schema_migrations (name, sha256) VALUES ($1, $2)",
        [name, sha256],
      );
    }
  });
  return files.length;
}

import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { database, closeDatabase } from "../lib/database";
loadEnvConfig(process.cwd());
async function main() {
try {
  const sql = await readFile(path.join(process.cwd(), "database/schema.sql"), "utf8");
  await database().unsafe(sql);
  console.log("WAAS schema is ready in your configured database. Other schemas were not changed.");
} catch {
  console.error("Migration failed. Check DATABASE_URL, TLS settings and schema/table creation permissions.");
  process.exitCode = 1;
} finally { await closeDatabase(); }
}
void main();

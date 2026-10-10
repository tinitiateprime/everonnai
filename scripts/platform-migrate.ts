import { loadEnvConfig } from "@next/env";
import { embeddedDatabase, postgresDatabase } from "../lib/platform/database";
import { localPlatformMode } from "../lib/platform/config";
import { migrateDatabase } from "../lib/platform/migrations";
async function main() {
  loadEnvConfig(process.cwd());
  const connection =
    process.env.DATABASE_MIGRATION_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!localPlatformMode() && !connection)
    throw new Error("Configure the platform migration database first.");
  const db = localPlatformMode()
    ? await embeddedDatabase(
        process.env.PLATFORM_DATABASE_DIR || "data/platform/database",
      )
    : postgresDatabase(connection!);
  try {
    console.log(
      `Platform migrations applied/verified: ${await migrateDatabase(db)} (${db.kind}).`,
    );
  } finally {
    await db.close();
  }
}
main().catch(() => {
  console.error(
    "Platform migration failed. Check the database configuration and migration-role privileges.",
  );
  process.exitCode = 1;
});

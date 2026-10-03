import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { usageSupabase } from "../lib/usage-supabase";
import { closeUsagePostgres } from "../lib/usage-postgres";

async function main() {
  loadEnvConfig(process.cwd());
  const store = usageSupabase();
  const migration = await store.checkMigration();
  const probe = process.argv.includes("--probe");
  if (probe) {
    const key = `system/probes/${randomUUID()}`;
    try {
      if (!await store.write(key, { probe: 1 }, { new: true })) throw new Error("Probe creation failed.");
      const first = await store.read<{ probe: number }>(key);
      if (!first || first.data.probe !== 1) throw new Error("Probe read failed.");
      if (await store.write(key, { probe: 2 }, { new: true })) throw new Error("Insert-only protection failed.");
      if (!await store.write(key, { probe: 2 }, { revision: first.revision })) throw new Error("Conditional write failed.");
      if (await store.write(key, { probe: 3 }, { revision: first.revision })) throw new Error("Stale-write protection failed.");
      if ((await store.read<{ probe: number }>(key))?.data.probe !== 2) throw new Error("Probe update verification failed.");
    } finally { await store.remove(key); }
    if (await store.read(key)) throw new Error("Probe cleanup failed.");
  }
  console.log(JSON.stringify({ schema: "everonn_usage", transport: process.env.SUPABASE_DB_URL ? "private-postgres" : "data-api", migration, connection: "verified", conditionalWriteProbe: probe ? "passed-and-removed" : "not-requested" }));
}
main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; }).finally(closeUsagePostgres);

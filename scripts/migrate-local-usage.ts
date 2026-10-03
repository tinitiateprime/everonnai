import { loadEnvConfig } from "@next/env";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { enqueueUsage, recordUsage, saveGeminiBilling, saveUsageSession } from "../lib/usage-store";
import { usageSupabase } from "../lib/usage-supabase";
import { closeUsagePostgres } from "../lib/usage-postgres";
import type { GeminiBillingReport, UsageEvent, UsageSession } from "../features/usage/types";

async function main() {
  loadEnvConfig(process.cwd());
  const root = path.resolve(process.env.EVERONN_USAGE_DIR || path.join(path.dirname(process.env.EVERONN_DATA_FILE || path.join(process.cwd(), "data", "everonn.json")), "usage"));
  const records: Array<{ type: string; data: UsageEvent | UsageSession | GeminiBillingReport }> = [];
  async function visit(directory: string, type: string) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file, type);
      else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".json")) {
        if (entry.isSymbolicLink()) {
          const relative = path.relative(await realpath(root), await realpath(file));
          if (relative.startsWith("..") || path.isAbsolute(relative) || !(await stat(file)).isFile()) throw new Error("Local usage file resolves outside the intended source directory.");
        }
        const data = JSON.parse(await readFile(file, "utf8"));
        if (!data || typeof data.workspaceId !== "string" || !data.workspaceId || (type !== "billing" && typeof data.id !== "string")) throw new Error("Local usage data failed validation; import stopped.");
        records.push({ type, data });
      }
    }
  }
  for (const type of ["events", "sessions", "outbox", "billing"]) await visit(path.join(root, type), type);
  const apply = process.argv.includes("--apply");
  if (apply) {
    await usageSupabase().checkMigration();
    for (const { type, data } of records) {
      if (type === "events") await recordUsage(data as UsageEvent);
      else if (type === "sessions") await saveUsageSession(data as UsageSession);
      else if (type === "outbox") await enqueueUsage(data as UsageEvent);
      else await saveGeminiBilling(data as GeminiBillingReport);
    }
  }
  console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", records: records.length, namespaces: Object.fromEntries(["events", "sessions", "outbox", "billing"].map((type) => [type, records.filter((record) => record.type === type).length])), localFiles: "retained" }));
}
main().catch((error: Error & { code?: string }) => { console.error(`Local usage migration failed (${error.code && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : error.name}). Check the dedicated schema, record validity and workspace/provider ownership. The command is safe to re-run after correcting the failure.`); process.exitCode = 1; }).finally(closeUsagePostgres);

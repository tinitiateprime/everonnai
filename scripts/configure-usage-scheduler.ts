import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { usageDatabaseTls, type UsageQuery } from "../lib/usage-postgres";
import { changeUsageScheduler, configureUsageScheduler, usageSchedulerOrigin, usageSchedulerStatus } from "../lib/usage-scheduler";
import { usageJobSignedHeaders } from "../features/usage/job-auth";

async function main() {
  loadEnvConfig(process.cwd());
  const args = process.argv.slice(2);
  const originIndex = args.indexOf("--origin");
  const originArgument = originIndex >= 0 ? args[originIndex + 1] : undefined;
  const flags = args.filter((_, index) => originIndex < 0 || (index !== originIndex && index !== originIndex + 1));
  if (flags.some(flag => !["--status", "--apply", "--enable", "--disable", "--install-extensions"].includes(flag))) throw new Error("Unknown scheduler option.");
  const actions = flags.filter(flag => ["--apply", "--enable", "--disable"].includes(flag));
  if (actions.length > 1) throw new Error("Configure, enable or disable the scheduler in separate commands.");
  if (flags.includes("--install-extensions") && !flags.includes("--apply")) throw new Error("--install-extensions requires --apply.");
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is required for Supabase Cron.");
  if ((process.env.SUPABASE_USAGE_SCHEMA || "everonn_usage") !== "everonn_usage") throw new Error("Scheduler setup is restricted to everonn_usage.");
  // Postgres.js requires a positive pipeline limit for begin() to reserve its
  // connection. Each transaction query below is awaited sequentially.
  const configuration = { prepare: false, max: 1, max_pipeline: 1, connect_timeout: 15, ssl: usageDatabaseTls(), onnotice: () => {} };
  const sql = postgres(process.env.SUPABASE_DB_URL, configuration);
  const query: UsageQuery = async <T extends Record<string, unknown>>(statement: string, parameters: unknown[] = []) => [...await sql.unsafe<T[]>(statement, parameters as postgres.ParameterOrJSON<never>[])];
  try {
    if (!actions.length) { console.log(JSON.stringify(await usageSchedulerStatus(query), null, 2)); return; }
    const active = flags.includes("--enable");
    const origin = flags.includes("--disable") ? undefined : usageSchedulerOrigin(originArgument || "");
    const secret = process.env.USAGE_CRON_SECRET || "";
    if (active) {
      const response = await fetch(`${origin}/api/usage/jobs`, { method: "POST", headers: usageJobSignedHeaders(secret), body: "{}", redirect: "error", signal: AbortSignal.timeout(65_000) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || result.error !== null) throw new Error(`The deployed usage worker is not healthy (HTTP ${response.status}). Scheduler remains disabled.`);
    }
    const migration = flags.includes("--apply") ? await readFile(new URL("../supabase/migrations/202610040001_everonn_usage_scheduler.sql", import.meta.url), "utf8") : "";
    const result = await sql.begin(async transaction => {
      const query: UsageQuery = async <T extends Record<string, unknown>>(statement: string, parameters: unknown[] = []) => [...await transaction.unsafe<T[]>(statement, parameters as postgres.ParameterOrJSON<never>[])];
      return flags.includes("--apply")
        ? configureUsageScheduler(query, { origin: origin!, secret, migration, installExtensions: flags.includes("--install-extensions") })
        : changeUsageScheduler(query, active, active ? { origin: origin!, secret } : undefined);
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { await sql.end({ timeout: 2 }); }
}

main().catch(error => {
  // Driver/network errors may contain query parameters or connection details.
  const code = (error as { code?: string }).code;
  const safeCode = code && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "unavailable";
  const safeMessage = error instanceof Error && !code && !/postgres|fetch failed|certificate|connect|timeout/i.test(error.message) ? error.message : `Usage scheduler operation failed (${safeCode}); credentials were not printed.`;
  console.error(safeMessage);
  process.exitCode = 1;
});

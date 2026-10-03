import { loadEnvConfig } from "@next/env";
import { runUsageWorker } from "../features/usage/worker";
import { closeUsagePostgres } from "../lib/usage-postgres";

loadEnvConfig(process.cwd());
async function tick() {
  const result = await runUsageWorker();
  console.log(JSON.stringify({ checked: result.checked, delivered: result.delivered, error: result.error }));
  if (result.error && process.argv.includes("--once")) process.exitCode = 1;
}
async function main() {
  await tick();
  if (!process.argv.includes("--once") && !process.exitCode) {
    const timer = setInterval(() => { void tick().catch(() => console.error("Usage worker failed; the next run will retry.")); }, 60_000);
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { clearInterval(timer); process.exit(0); });
  }
}
void main().catch(() => { console.error("Usage worker failed. Check usage storage and provider permissions."); process.exitCode = 1; }).finally(async () => { if (process.argv.includes("--once")) await closeUsagePostgres(); });

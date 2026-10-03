import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { importGeminiUsage } from "../features/usage/import";
import { importElevenLabsUsage } from "../features/usage/import-elevenlabs";

loadEnvConfig(process.cwd());
async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("Pass a provider usage manifest path. Add --apply after reviewing the dry run.");
  const input = JSON.parse(await readFile(file, "utf8"));
  const apply = process.argv.includes("--apply");
  console.log(JSON.stringify(input.provider === "elevenlabs" ? await importElevenLabsUsage(input, apply) : await importGeminiUsage(input, apply)));
}
void main().catch(() => { console.error("Usage import failed. Check the manifest and storage configuration; no provider payload is logged."); process.exitCode = 1; });

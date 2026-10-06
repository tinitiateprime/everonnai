import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import test from "node:test";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const writer = path.resolve("scripts/write-amplify-env.mjs");
const keys = ["NEXT_PUBLIC_APP_URL", "SUPABASE_DB_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_USAGE_SCHEMA", "GEMINI_API_KEY", "GEMINI_WEBSITE_TIMEOUT_MS", "GEMINI_WEBSITE_CODE_TIMEOUT_MS", "EVERONN_REQUIRE_DURABLE_STORAGE", "USAGE_REQUIRE_DURABLE_STORAGE", "USAGE_BACKGROUND_MODE"];
function cleanEnvironment() {
  const environment = { ...process.env };
  for (const key of keys) delete environment[key];
  delete environment.__NEXT_PROCESSED_ENV;
  return environment;
}

test("Amplify build configuration stops before publication when usage storage is missing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "everonn-amplify-env-"));
  try {
    await assert.rejects(execute(process.execPath, [writer], { cwd: directory, env: { ...cleanEnvironment(), NEXT_PUBLIC_APP_URL: "https://app.example.com" }, windowsHide: true }), /Configure SUPABASE_DB_URL/);
    await assert.rejects(readFile(path.join(directory, ".env.production")), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Amplify server environment preserves literal-dollar secrets and excludes AWS build credentials", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "everonn-amplify-env-"));
  const values = { NEXT_PUBLIC_APP_URL: "https://app.example.com", SUPABASE_DB_URL: "fixture-database-setting", SUPABASE_USAGE_SCHEMA: "everonn_usage", GEMINI_API_KEY: "fixture_$UNSET_VARIABLE_${OTHER_UNSET}\nsecond-line", GEMINI_WEBSITE_TIMEOUT_MS: "165000", GEMINI_WEBSITE_CODE_TIMEOUT_MS: "180000" };
  try {
    const result = await execute(process.execPath, [writer], { cwd: directory, env: { ...cleanEnvironment(), ...values, AWS_ACCESS_KEY_ID: "fixture-build-key", AWS_SECRET_ACCESS_KEY: "fixture-build-secret" }, windowsHide: true });
    assert.ok(!result.stdout.includes(values.GEMINI_API_KEY));
    const source = await readFile(path.join(directory, ".env.production"), "utf8");
    assert.ok(!source.includes("AWS_ACCESS_KEY_ID") && !source.includes("fixture-build-secret"));
    const parser = "const env=require(process.argv[1]);env.loadEnvConfig(process.cwd());console.log(JSON.stringify(Object.fromEntries(JSON.parse(process.argv[2]).map(key=>[key,process.env[key]]))));";
    const parsed = await execute(process.execPath, ["-e", parser, require.resolve("@next/env"), JSON.stringify([...Object.keys(values), "EVERONN_REQUIRE_DURABLE_STORAGE", "USAGE_REQUIRE_DURABLE_STORAGE", "USAGE_BACKGROUND_MODE"])], { cwd: directory, env: cleanEnvironment(), windowsHide: true });
    assert.deepEqual(JSON.parse(parsed.stdout), { ...values, EVERONN_REQUIRE_DURABLE_STORAGE: "true", USAGE_REQUIRE_DURABLE_STORAGE: "true", USAGE_BACKGROUND_MODE: "external" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createDemoWorkspace } from "../features/everonn/demo-data";
import { createWebsiteProject, generateDeterministicWebsiteSpec } from "../features/website-studio/generator";
import type { UsageSummary } from "../features/usage/summary";

// Runs against a production build with disposable stores and mocked server-side
// providers. No real provider calls, bills, business records, or secrets are used.
async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "everonn-usage-smoke-"));
  const port = Number(process.env.SMOKE_USAGE_PORT || 3000);
  const baseURL = `http://localhost:${port}`;
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, () => probe.close(() => resolve())); });
  const workspace = createDemoWorkspace();
  workspace.contacts = []; workspace.leads = []; workspace.conversations = []; workspace.appointments = [];
  workspace.profile.timeZone = "Asia/Kolkata";
  const spec = generateDeterministicWebsiteSpec(workspace.profile);
  workspace.websiteProject = createWebsiteProject(workspace.profile, spec);
  workspace.websiteProject.status = "published";
  workspace.websiteProject.selectedConcept = "editorial";
  const dataFile = path.join(directory, "workspace.json");
  const preload = path.join(directory, "mock-providers.cjs");
  await writeFile(dataFile, JSON.stringify(workspace));
  await writeFile(path.join(directory, "website-spec.json"), JSON.stringify(spec));
  await writeFile(preload, `
const fs = require("node:fs");
const path = require("node:path");
const originalFetch = globalThis.fetch;
const conversations = new Map();
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url || input.toString());
  if (url.hostname === "generativelanguage.googleapis.com") {
    const body = JSON.parse(init.body);
    const website = body.generationConfig?.responseSchema?.properties?.hero;
    const text = website ? fs.readFileSync(path.join(__dirname, "website-spec.json"), "utf8") : "Our approved services are available through the business team.";
    return Response.json({ usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40, thoughtsTokenCount: 30, cachedContentTokenCount: 20, totalTokenCount: 190 }, candidates: [{ content: { parts: [{ text }] } }] });
  }
  if (url.hostname === "api.elevenlabs.io") {
    if (url.pathname.endsWith("/conversation/token")) return Response.json({ token: "fixture-token" });
    if (url.pathname.endsWith("/conversation/get-signed-url")) return Response.json({ signed_url: "wss://fixture.example/session" });
    if (url.pathname.endsWith("/conversations")) {
      const userId = url.searchParams.get("user_id");
      const id = "conv_" + userId.slice(-16);
      conversations.set(id, userId);
      return Response.json({ conversations: [{ conversation_id: id }], has_more: false });
    }
    const id = url.pathname.split("/").at(-1);
    if (!conversations.has(id)) return Response.json({ error: "unknown fixture" }, { status: 404 });
    return Response.json({ agent_id: "fixture-agent", conversation_id: id, user_id: conversations.get(id), status: "done", metadata: { start_time_unix_secs: Math.floor(Date.now() / 1000), call_duration_secs: 60, cost: 250, cost_fiat: 0.05, charging: { tts_usage: { total_characters: 100, total_audio_output_seconds: 20 }, asr_usage: { total_audio_input_seconds: 15 } } } });
  }
  return originalFetch(input, init);
};
`);
  const environment: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: "production", NEXT_PUBLIC_APP_URL: baseURL,
    EVERONN_DATA_FILE: dataFile, EVERONN_WORKSPACES_FILE: path.join(directory, "workspaces.json"),
    EVERONN_AUTH_FILE: path.join(directory, "auth.json"), EVERONN_CONNECTIONS_FILE: path.join(directory, "connections.json"),
    EVERONN_USAGE_DIR: path.join(directory, "usage"), EVERONN_AUTH_SETUP_TOKEN: "usage-smoke-setup",
    GEMINI_API_KEY: "fixture-key", GOOGLE_API_KEY: "", GEMINI_WEBSITE_MODELS: "gemini-3.8-flash", GEMINI_WEBSITE_MODEL: "", GEMINI_MODEL: "", GEMINI_WEBSITE_RETRY_DELAY_MS: "0", GEMINI_BILLING_TIER: "list-price",
    ELEVENLABS_API_KEY: "fixture-key", ELEVENLABS_AGENT_ID: "fixture-agent", PEXELS_API_KEY: "",
    GOOGLE_OAUTH_CLIENT_ID: "", GOOGLE_OAUTH_CLIENT_SECRET: "", NETLIFY: "false", NETLIFY_BLOBS_CONTEXT: "", SITE_NAME: "",
    SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_USAGE_SCHEMA: "", SUPABASE_DB_URL: "",
    USAGE_REQUIRE_DURABLE_STORAGE: "false", AWS_LAMBDA_FUNCTION_NAME: "", USAGE_BACKGROUND_MODE: "external",
    USAGE_CRON_SECRET: "usage-smoke-scheduler-secret-at-least-32", ELEVENLABS_WEBHOOK_SECRET: "usage-smoke-webhook-secret", GEMINI_BILLING_SERVICE_ACCOUNT_BASE64: "",
  };
  const server = spawn(process.execPath, ["--require", preload, "node_modules/next/dist/bin/next", "start", "--port", String(port)], { env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  server.stdout.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-20000); });
  server.stderr.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-20000); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await fetch(`${baseURL}/login`).then((response) => response.ok).catch(() => false)) break;
      if (server.exitCode !== null || attempt === 79) throw new Error(`Usage test server failed: ${logs}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal((await fetch(`${baseURL}/api/usage`)).status, 401);
    browser = await chromium.launch({ headless: true, executablePath: process.env.SMOKE_CHROME_PATH || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : undefined) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const setup = await context.request.post(`${baseURL}/api/auth/setup`, { data: { name: "Usage Owner", email: "usage-owner@example.com", password: "UsageFixture123!", setupToken: "usage-smoke-setup" } });
    assert.equal(setup.status(), 201, await setup.text());
    const empty = (await (await context.request.get(`${baseURL}/api/usage`)).json()).summary as UsageSummary;
    assert.equal(empty.totals.requests, 0);
    assert.equal(empty.totals.totalTokens, 0);
    const headers = { "x-everonn-workspace": workspace.workspaceId };
    const chat = await context.request.post(`${baseURL}/api/assistant/message`, { headers, data: { messages: [{ role: "caller", text: "What services do you offer?" }] } });
    assert.equal(chat.status(), 200, await chat.text());
    const generation = await context.request.post(`${baseURL}/api/website-studio`, { data: { profile: workspace.profile } });
    assert.equal(generation.status(), 200, await generation.text());
    const project = (await generation.json()).project;
    const siteChat = await context.request.post(`${baseURL}/api/assistant/message`, { data: { previewToken: project.privateToken, messages: [{ role: "caller", text: "What services do you offer?" }] } });
    assert.equal(siteChat.status(), 200, await siteChat.text());
    const voice = await context.request.post(`${baseURL}/api/voice/session`, { headers, data: {} });
    assert.equal(voice.status(), 200, await voice.text());
    const voiceTicket = (await voice.json()).usageSessionId as string;
    for (const mode of ["voice", "chat"]) {
      const session = await context.request.post(`${baseURL}/api/site-assistant/session`, { data: { previewToken: project.privateToken, mode } });
      assert.equal(session.status(), 200, await session.text());
    }
    assert.equal((await context.request.post(`${baseURL}/api/usage/jobs`)).status(), 401, "scheduled jobs must require the server credential");
    const job = await context.request.post(`${baseURL}/api/usage/jobs`, { headers: { authorization: `Bearer ${environment.USAGE_CRON_SECRET}` } });
    assert.equal(job.status(), 200, await job.text());
    assert.equal((await job.json()).checked, 3, "recovery must run without the Usage page or connection callbacks");
    const webhook = JSON.stringify({ type: "post_call_transcription", data: { agent_id: "fixture-agent", conversation_id: `conv_${voiceTicket.slice(-16)}`, user_id: voiceTicket, metadata: { start_time_unix_secs: Math.floor(Date.now() / 1000), call_duration_secs: 60, cost: 250, cost_fiat: 0.05 } } });
    assert.equal((await context.request.post(`${baseURL}/api/usage/elevenlabs/webhook`, { data: webhook, headers: { "elevenlabs-signature": "invalid" } })).status(), 401);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = `t=${timestamp},v0=${createHmac("sha256", environment.ELEVENLABS_WEBHOOK_SECRET!).update(`${timestamp}.${webhook}`).digest("hex")}`;
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await context.request.post(`${baseURL}/api/usage/elevenlabs/webhook`, { data: webhook, headers: { "elevenlabs-signature": signature } })).status(), 200);
    const sync = await context.request.post(`${baseURL}/api/usage/sync`);
    assert.equal(sync.status(), 200, await sync.text());
    assert.equal((await sync.json()).error, null);
    const summary = (await (await context.request.get(`${baseURL}/api/usage?period=all`)).json()).summary as UsageSummary;
    assert.equal(summary.totals.requests, 9, "three Gemini calls and six credential setup requests");
    assert.equal(summary.totals.totalTokens, 570);
    assert.ok(Math.abs(summary.totals.estimatedGeminiCostUsd! - 0.001017) < 1e-12, "pricing must include cached input and thinking exactly once");
    assert.equal(summary.totals.conversations, 3);
    assert.equal(summary.totals.voiceSeconds, 120, "text chat time must not appear as voice time");
    assert.equal(summary.totals.credits, 750);
    assert.ok(Math.abs(summary.totals.costUsd! - 0.15) < 1e-9);
    assert.equal(JSON.stringify(summary).includes("fixture-key"), false);
    assert.equal(JSON.stringify(summary).includes("usageSessionId"), false);
    const another = await browser.newContext();
    const signup = await another.request.post(`${baseURL}/api/auth/register`, { data: { name: "Other Owner", email: "other-usage@example.com", password: "OtherUsage123!", businessName: "Other Business", businessType: "Home services", timeZone: "Asia/Kolkata" } });
    assert.equal(signup.status(), 201, await signup.text());
    const isolated = (await (await another.request.get(`${baseURL}/api/usage?period=all`, { headers })).json()).summary as UsageSummary;
    assert.equal(isolated.totals.requests, 0, "a spoofed workspace header must not leak another workspace's usage");
    await another.close();
    const invalid = await context.request.post(`${baseURL}/api/usage/elevenlabs/session`, { data: { sessionId: "../../auth", conversationId: "conv_fixture" } });
    assert.equal(invalid.status(), 404);

    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${baseURL}/dashboard/usage`);
    await page.getByRole("heading", { name: "See where your AI usage goes." }).waitFor();
    await page.locator(".eo-usage-metrics").getByText("570", { exact: true }).waitFor();
    await page.locator(".eo-usage-gemini").getByText("$0.001017", { exact: true }).waitFor();
    assert.equal(await page.locator(".eo-usage-table").first().locator("tbody tr").count(), 7);
    await page.getByLabel("Filter provider").selectOption("elevenlabs");
    assert.equal(await page.locator(".eo-usage-table").first().locator("tbody tr").count(), 3);
    await page.getByLabel("Chart metric").selectOption("credits");
    await page.getByLabel("Reporting period").selectOption("7d");
    await page.locator(".eo-usage-metrics").getByText("750", { exact: true }).waitFor();
    assert.equal(await page.locator(".eo-usage-chart-day").count(), 7);
    assert.equal(await page.locator(".eo-usage-chart-axis span").count(), 5);
    assert.ok(await page.locator(".eo-usage-chart-unknown").count(), "days before recording must be marked as untracked");
    await page.locator(".eo-usage-chart-day b").getByText("750", { exact: true }).waitFor();
    await page.getByText("Background reconciliation is running.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Refresh usage" }).click();
    await page.getByRole("button", { name: "Refresh usage" }).waitFor();
    assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
    assert.equal(await page.locator(".eo-usage-notice").count(), 0, "usage reads and browser synchronization must succeed");
    await page.screenshot({ path: path.join(directory, "usage-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => window.innerWidth === 390 && matchMedia("(max-width: 560px)").matches);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.waitForFunction(() => document.querySelector(".eo-sidebar")!.getBoundingClientRect().right <= 0);
    await page.screenshot({ path: path.join(directory, "usage-mobile.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile document must not overflow horizontally");
    assert.equal(JSON.parse(await readFile(dataFile, "utf8")).profile.businessName, workspace.profile.businessName);
    console.log("Usage smoke passed: exact fixture metrics, unattended jobs, signed duplicate webhooks, tenant isolation, numeric chart, desktop/mobile UI and filters.");
    if (process.env.SMOKE_USAGE_ARTIFACTS === "keep") console.log(`Preview screenshots: ${directory}`);
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    await browser?.close();
    server.kill();
    if (server.exitCode === null) await new Promise<void>((resolve) => server.once("exit", () => resolve()));
    if (process.env.SMOKE_USAGE_ARTIFACTS !== "keep") {
      assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()), "cleanup must remain inside the explicitly allocated temporary directory");
      await rm(directory, { recursive: true, force: true });
    }
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });

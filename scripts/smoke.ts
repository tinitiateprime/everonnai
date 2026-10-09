import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { createSite, readSite, publishSite } from "../features/waas/service";
import { createWebsiteProject, WEBSITE_CONCEPTS } from "../features/website-studio/generator";
import { updateRecord } from "../lib/record-store";
import { exportSite } from "../features/waas/render";
import type { WaasSite } from "../features/waas/types";
import { createDemoWorkspace } from "../tests/fixtures/demo-workspace";
import { generateDeterministicWebsiteSpec } from "../tests/fixtures/website";
import { websiteCodeFixture } from "../tests/fixtures/website-code";
import { createWaasClient } from "../sdk/index.mjs";

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port available.");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}
async function chromePath() {
  const candidates = [process.env.SMOKE_CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean) as string[];
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch { /* Try the next installed browser. */ } }
  throw new Error("Install Chrome or set SMOKE_CHROME_PATH to its executable.");
}
async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "waas-smoke-"));
  process.env.WAAS_DATA_DIR = directory;
  process.env.DATABASE_URL = "";
  process.env.WAAS_ALLOW_LOCAL_STORAGE = "true";
  process.env.WAAS_API_KEY = "isolated-smoke-key-" + randomUUID();
  process.env.GEMINI_API_KEY = ""; process.env.GOOGLE_API_KEY = ""; process.env.PEXELS_API_KEY = "";
  const port = await freePort(), origin = "http://localhost:" + port;
  process.env.WAAS_PUBLIC_URL = origin;
  const fixture = createDemoWorkspace().profile;
  const site = await createSite({ profile: {
    businessName: fixture.businessName, businessType: fixture.businessType, description: fixture.description,
    email: fixture.email, phone: fixture.phone, services: fixture.services, knowledge: fixture.knowledge, verified: true,
  }, actions: { booking: "https://client.example/contact" } });
  const saved = await updateRecord<WaasSite>("sites/" + site.id, (current) => {
    const spec = generateDeterministicWebsiteSpec(current!.profile);
    spec.code = { schemaVersion: 1, validatedAt: new Date().toISOString(), concepts: Object.fromEntries(WEBSITE_CONCEPTS.map((concept) => [concept, websiteCodeFixture(spec, current!.profile, concept)])) as NonNullable<typeof spec.code>["concepts"] };
    return { ...current!, websiteProject: { ...createWebsiteProject(current!.profile, spec), profileSnapshot: structuredClone(current!.profile) } };
  });
  const live = await publishSite(site.id, { approved: true, concept: "editorial", draftId: saved.websiteProject!.id, expectedLiveReleaseId: null });
  const standalone = process.argv.includes("--standalone");
  const server = spawn(process.execPath, standalone ? [path.join(process.cwd(), ".next/standalone/server.js")] : [path.join(process.cwd(), "node_modules/next/dist/bin/next"), "start", "-p", String(port)], {
    cwd: standalone ? path.join(process.cwd(), ".next/standalone") : process.cwd(),
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOSTNAME: "0.0.0.0" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout?.on("data", (chunk) => { serverOutput = (serverOutput + chunk.toString()).slice(-8000); });
  server.stderr?.on("data", (chunk) => { serverOutput = (serverOutput + chunk.toString()).slice(-8000); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* Startup in progress. */ }
      if (server.exitCode !== null) throw new Error("Production server exited before startup: " + serverOutput);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, "Production server must start.");
    const client = createWaasClient({ baseUrl: origin, apiKey: process.env.WAAS_API_KEY! });
    assert.equal((await fetch(origin + "/api/waas/v1/sites")).status, 401);
    assert.equal((await client.getSite(site.id)).publicUrl, live.publicUrl);
    assert.equal((await client.exportSite(site.id)).pages.length, fixture.services.length + 4);
    await assert.rejects(client.buildStep(site.id, { operation: "start" }), /configuration|storage|service/i);
    assert.equal((await fetch(origin + "/sites/missing")).status, 404);
    const publicResponse = await fetch(origin + live.publicUrl);
    assert.equal(publicResponse.status, 200);
    assert.match(publicResponse.headers.get("content-security-policy")!, /frame-ancestors \*/);
    browser = await chromium.launch({ executablePath: await chromePath(), headless: true });
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    const page = await context.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.goto(origin);
    await page.getByLabel("Studio access key").fill(process.env.WAAS_API_KEY!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: fixture.businessName, exact: true }).waitFor();
    await page.getByRole("button", { name: fixture.businessName, exact: true }).click();
    await page.getByRole("heading", { level: 2, name: fixture.businessName, exact: true }).waitFor();
    assert.equal(await page.getByLabel("Business name", { exact: true }).inputValue(), fixture.businessName);
    await page.frameLocator("iframe").getByRole("heading", { level: 1 }).waitFor();
    await page.getByRole("button", { name: "+ New website", exact: true }).click();
    await page.getByRole("heading", { level: 2, name: "Create your website", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Business name", { exact: true }).inputValue(), "");
    await page.getByLabel("Business name", { exact: true }).fill("Smoke client");
    await page.getByLabel("Business type", { exact: true }).fill("Carpentry");
    await page.getByLabel("Business description").fill("We repair residential doors and install cabinets for customers in Hyderabad.");
    await page.getByLabel("Email", { exact: true }).fill("hello@smoke.example");
    await page.getByLabel("Services", { exact: false }).fill("Door repair | Residential door repair.");
    await page.getByLabel("The business owner has verified these facts.").check();
    await page.getByRole("button", { name: "Save business details", exact: true }).click();
    await page.getByRole("button", { name: "Smoke client", exact: true }).waitFor();
    assert.equal((await client.listSites()).length, 2);
    const pages = saved.websiteProject!.spec.code!.concepts.editorial.pages;
    let rendered = 0;
    for (const width of [1365, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of pages) {
        await page.goto(origin + live.publicUrl + (route.path === "/" ? "" : route.path));
        assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "No horizontal overflow at " + width + " " + route.path);
        rendered++;
      }
      if (width === 390) {
        await page.goto(origin + live.publicUrl);
        await page.locator("details.mobile-menu summary").click();
        await page.locator("details.mobile-menu").getByRole("link", { name: "Services", exact: true }).click();
        assert.ok(page.url().endsWith("/services"));
      }
    }
    const bundle = exportSite(await readSite(site.id));
    const exportDirectory = path.join(directory, "export");
    for (const asset of bundle.pages) { const file = path.join(exportDirectory, asset.path); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, asset.html); }
    await page.goto(pathToFileURL(path.join(exportDirectory, "index.html")).href);
    await page.locator("details.mobile-menu summary").click();
    await page.locator("details.mobile-menu").getByRole("link", { name: "Services", exact: true }).click();
    assert.ok(page.url().endsWith("/services/index.html"));
    assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
    await page.locator("details.mobile-menu summary").click();
    await page.locator("details.mobile-menu").getByRole("link", { name: "Home", exact: true }).click();
    assert.ok(page.url().endsWith("/export/index.html"), "Exported Home navigation must return to the export root.");
    assert.equal(failures.length, 0, failures.join("\n"));
    console.log("Production smoke passed: operator login/create, API auth, live/preview/export, mobile navigation and " + rendered + " desktop/mobile page checks. No paid calls.");
  } finally {
    await browser?.close();
    if (server.exitCode === null) {
      server.kill();
      await Promise.race([new Promise((resolve) => server.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    await rm(directory, { recursive: true, force: true });
  }
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "Smoke failed."); process.exitCode = 1; });

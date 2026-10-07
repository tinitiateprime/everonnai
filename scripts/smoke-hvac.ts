import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { createDemoWorkspace } from "../features/everonn/demo-data";
import { generateDeterministicWebsiteSpec } from "../tests/fixtures/website";
import { websiteCodeFixture } from "../tests/fixtures/website-code";
import { createWebsiteProject } from "../features/website-studio/generator";

// Production-route/browser regression using disposable accounts and a local Gemini fixture.
// No shared database, live provider, customer data, or paid API is contacted.
async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "everonn-hvac-"));
  const dataFile = path.join(directory, "workspace.json");
  const port = Number(process.env.SMOKE_HVAC_PORT || 3097);
  const baseURL = `http://localhost:${port}`;
  const workspace = createDemoWorkspace();
  workspace.contacts = []; workspace.leads = []; workspace.conversations = []; workspace.appointments = [];
  const spec = generateDeterministicWebsiteSpec(workspace.profile);
  spec.hero.headline = "Comfort, in every season.";
  spec.hero.subheadline = "Heating and cooling repair, seasonal maintenance, and replacement guidance for homes in Denver and nearby communities.";
  spec.brand.tagline = "Your home. Your comfort.";
  spec.brand.positioning = "Heating and cooling care, with a clear next step.";
  spec.servicesIntro.title = "The right care for your home.";
  spec.benefits = [
    { title: "Start with your concern", copy: "Tell us what has changed in your home's comfort. The team can review your service request." },
    { title: "Explore your options", copy: "Find repair, seasonal maintenance, and replacement estimate services in one place." },
    { title: "Agree on the next step", copy: "Share a preferred time and contact details. Availability and pricing are confirmed by the team." },
  ];
  workspace.websiteProject = createWebsiteProject(workspace.profile, spec);
  workspace.websiteProject.status = "published";
  workspace.websiteProject.selectedConcept = "editorial";
  await writeFile(dataFile, JSON.stringify(workspace));
  await writeFile(path.join(directory, "gemini.json"), JSON.stringify(spec));
  await writeFile(path.join(directory, "code.json"), JSON.stringify(Object.fromEntries((["editorial", "momentum", "aura"] as const).map((concept) => [concept, websiteCodeFixture(spec, workspace.profile, concept)]))));
  const preload = path.join(directory, "provider-fixture.cjs");
  await writeFile(preload, String.raw`
const fs = require('node:fs');
const originalFetch = globalThis.fetch;
globalThis.fetch = async function(input, init) {
  const url = String(input);
  if (url.startsWith('https://generativelanguage.googleapis.com/')) {
    const body = JSON.parse(String(init?.body || '{}'));
    if (!body.systemInstruction?.parts?.[0]?.text.includes('Website building')) return Response.json({error:{message:'Unexpected paid-provider request blocked'}},{status:503});
    if (!body.systemInstruction.parts[0].text.includes('Approved memory policy') || !body.systemInstruction.parts[0].text.includes('Available application actions') || !body.contents[0].parts[0].text.includes('DOMAIN_REFERENCE_CATALOG') || body.systemInstruction.parts[0].text.includes('website.memory-forget-and-concurrency')) return Response.json({error:{message:'Runtime instruction boundary failed'}},{status:503});
    if (/WEBSITE_(CODE|DESIGN)_TASK/.test(body.contents[0].parts[0].text)) {
      const concept = body.contents[0].parts[0].text.match(/Create the (editorial|momentum|aura) design/)[1];
      const code = JSON.parse(fs.readFileSync(process.env.HVAC_FIXTURE_CODE, 'utf8'))[concept];
      const requested = body.generationConfig.responseSchema.properties.pages?.items.properties.path.enum || [];
      if (requested.length) code.pages = code.pages.filter(page => requested.includes(page.path));
      else delete code.pages;
      if (requested.includes('/')) await new Promise(resolve => setTimeout(resolve, 250));
      return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(code)}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:200,totalTokenCount:300}});
    }
    const spec = JSON.parse(fs.readFileSync(process.env.HVAC_FIXTURE_SPEC, 'utf8'));
    const context = body.contents[0].parts[0].text;
    spec.visualDirection = {primaryColor:'#111111',accentColor:context.includes('Use green instead')?'#93BC86':'#D4AF37',mood:'premium'};
    const serviceId = body.generationConfig.responseSchema.properties.service?.properties.id.enum[0];
    const content = serviceId ? {service:spec.services.find(service=>service.id===serviceId)} : spec;
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(content)}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:200,totalTokenCount:300}});
  }
  if (/^https:\/\/(?:api\.elevenlabs\.io|api\.pexels\.com|[^/]*googleapis\.com)/.test(url)) throw new Error('Live provider blocked by isolated smoke fixture');
  return originalFetch(input, init);
};
`);
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: "production", NEXT_PUBLIC_APP_URL: baseURL,
    EVERONN_DATA_FILE: dataFile, EVERONN_WORKSPACES_FILE: path.join(directory, "workspaces.json"), EVERONN_AUTH_FILE: path.join(directory, "auth.json"),
    EVERONN_CONNECTIONS_FILE: path.join(directory, "connections.json"), EVERONN_AUTH_SETUP_TOKEN: "isolated-hvac-smoke",
    GEMINI_API_KEY: "local-fixture-only", GOOGLE_API_KEY: "", GEMINI_WEBSITE_MODELS: "fixture-model", GEMINI_WEBSITE_MODEL: "fixture-model", GEMINI_MODEL: "fixture-model",
    ELEVENLABS_API_KEY: "", ELEVENLABS_AGENT_ID: "", PEXELS_API_KEY: "", GOOGLE_OAUTH_CLIENT_ID: "", GOOGLE_OAUTH_CLIENT_SECRET: "",
    NETLIFY: "false", NETLIFY_BLOBS_CONTEXT: "", SITE_NAME: "", SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_USAGE_SCHEMA: "", SUPABASE_DB_URL: "",
    EVERONN_REQUIRE_DURABLE_STORAGE: "false", EVERONN_USAGE_DIR: path.join(directory, "usage"), USAGE_REQUIRE_DURABLE_STORAGE: "false", AWS_LAMBDA_FUNCTION_NAME: "", USAGE_BACKGROUND_MODE: "external", PHONE_FRONT_DESK_FOLLOW_UP_ENABLED: "false",
    HVAC_FIXTURE_SPEC: path.join(directory, "gemini.json"), HVAC_FIXTURE_CODE: path.join(directory, "code.json"),
  };
  const server = spawn(process.execPath, ["--require", preload, "node_modules/next/dist/bin/next", "start", "--port", String(port)], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  server.stdout.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-10000); });
  server.stderr.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-10000); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let ownerPage: Page | undefined;
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await fetch(`${baseURL}/login`).then((response) => response.ok).catch(() => false)) break;
      if (server.exitCode !== null || attempt === 59) throw new Error(`Fixture server failed: ${logs}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.SMOKE_CHROME_PATH || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : undefined) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    // The production build may have a different baked public origin. Forward
    // local browser API traffic through Playwright's non-browser HTTP client.
    // Origin-policy behavior is independently covered by request-origin tests.
    let droppedGenerationResponse = false;
    await context.route(`${baseURL}/api/**`, async (route) => {
      const headers = { ...await route.request().allHeaders() };
      delete headers.origin;
      const response = await route.fetch({ headers });
      if (!droppedGenerationResponse && route.request().url() === `${baseURL}/api/website-studio` && route.request().method() === "POST"
        && route.request().postDataJSON()?.operation === "advance" && response.status() === 202) {
        const data = await response.json();
        if (data.job?.progress.completedPages === 1) {
          droppedGenerationResponse = true;
          await route.fulfill({ status: 504, body: "" });
          return;
        }
      }
      await route.fulfill({ response });
    });
    const setup = await context.request.post(`${baseURL}/api/auth/setup`, { data: { name: "HVAC Fixture Owner", email: "hvac-owner@example.test", password: "IsolatedSmoke123!", setupToken: "isolated-hvac-smoke" } });
    assert.equal(setup.status(), 201, await setup.text());
    const page = await context.newPage();
    ownerPage = page;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", async (response) => {
      if (response.url().includes("/api/") && response.status() >= 400) logs += `\n${response.status()} ${response.url()}: ${await response.text().catch(() => "")}`;
    });
    await page.goto(`${baseURL}/dashboard/website`);
    await page.getByLabel("Request changes", { exact: true }).waitFor();
    await page.locator(".eo-design-options summary").click();
    await page.getByLabel("Photography", { exact: true }).selectOption("none");
    await page.getByLabel("Typography", { exact: true }).selectOption("editorial");
    await page.getByLabel("gallery", { exact: true }).check();
    await page.getByLabel("Request changes", { exact: true }).fill("Make it premium black and gold, no photography.");
    await page.waitForFunction(() => document.querySelector('.eo-page-heading button')?.textContent?.includes('Regenerate'));
    await page.getByRole("button", { name: "Apply changes & regenerate" }).click();
    await page.getByRole("status").filter({ hasText: "Larger service catalogues take several minutes." }).waitFor();
    await page.getByText("Your new private preview is ready to review.").waitFor({ timeout: 60_000 });
    const stored = (await (await context.request.get(`${baseURL}/api/workspace`)).json()).workspace;
    assert.equal(stored.aiMemory.length, 1);
    assert.equal(stored.aiMemory[0].value.imagery, "none");
    assert.ok(stored.websiteProject.spec.code.concepts.editorial.css);
    assert.equal(droppedGenerationResponse, true);
    assert.equal(stored.websiteGeneration, undefined, "Internal checkpoints cannot enter dashboard responses");
    assert.equal(stored.websiteProject.generation.skills.some((skill: { id: string }) => skill.id === "domain:hvac"), true);
    const screenshots = process.argv.includes("--screenshots");
    const artifactDirectory = path.join(process.cwd(), "artifacts", "hvac");
    if (screenshots) await mkdir(artifactDirectory, { recursive: true });
    const preview = await context.newPage();
    preview.on("pageerror", (error) => errors.push(error.message));
    for (const theme of ["editorial", "momentum", "aura"]) {
      await preview.goto(`${baseURL}/preview/${stored.websiteProject.privateToken}?theme=${theme}`);
      await preview.locator(`.site.${theme}`).waitFor();
      assert.equal(await preview.locator(".client-hero").count(), 0);
      assert.equal(await preview.locator(".site img").count(), 0);
      assert.equal(await preview.locator(".site main h1").count(), 1);
      if (screenshots) await preview.screenshot({ path: path.join(artifactDirectory, `${theme}-desktop.png`), fullPage: false });
      await preview.setViewportSize({ width: 390, height: 844 });
      assert.ok(await preview.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${theme} mobile overflow`);
      if (screenshots) await preview.screenshot({ path: path.join(artifactDirectory, `${theme}-mobile.png`), fullPage: false });
      await preview.locator(".mobile-menu summary").click();
      await preview.locator(".mobile-menu nav").getByRole("link", { name: "Services", exact: true }).click();
      await preview.getByRole("heading", { level: 1, name: spec.servicesIntro.title }).waitFor();
      for (const service of spec.services) assert.ok(await preview.locator(`a[href*="/services/${service.slug}"]`).count());
      await preview.getByRole("link", { name: "Request service" }).click();
      await preview.locator(".website-request-dialog[open]").waitFor();
      await preview.getByRole("button", { name: "Close request form" }).click();
      await preview.setViewportSize({ width: 1440, height: 1000 });
    }
    // Legacy live pages and visitor access remain available while the new draft is private.
    await preview.goto(`${baseURL}/sites/${stored.websiteProject.publicSlug}`);
    await preview.locator(".client-preview").waitFor();
    const safety = await context.request.post(`${baseURL}/api/assistant/message`, { data: { publicSlug: stored.websiteProject.publicSlug, messages: [{ role: "caller", text: "I smell gas near the furnace" }] } });
    assert.equal(safety.status(), 200);
    assert.match((await safety.json()).reply, /emergency/);
    async function publish(project: { privateToken: string }, concept = "editorial") {
      for (const status of ["claimed", "verified", "approved", "published"]) {
        const transition = await context.request.post(`${baseURL}/api/website-studio/status`, { headers: { "x-everonn-workspace": workspace.workspaceId }, data: { privateToken: project.privateToken, status, selectedConcept: concept } });
        assert.equal(transition.status(), 200, await transition.text());
      }
      return (await (await context.request.get(`${baseURL}/api/workspace`)).json()).workspace;
    }
    const firstPublished = await publish(stored.websiteProject);
    await preview.goto(`${baseURL}/sites/${stored.websiteProject.publicSlug}/contact`);
    await preview.locator(".site.editorial").waitFor();
    await preview.getByRole("link", { name: "Request service" }).click();
    await preview.getByLabel("Your name", { exact: true }).fill("Website Fixture Customer");
    await preview.getByLabel("Email", { exact: true }).fill("fixture-customer@example.test");
    await preview.getByLabel("How can we help?", { exact: true }).fill("Please call me about heating and cooling repair.");
    await preview.getByLabel("Request an appointment", { exact: true }).uncheck();
    await preview.getByRole("button", { name: "Send request" }).click();
    await preview.locator(".website-request-success").waitFor();
    await preview.getByRole("button", { name: "Close request form" }).click();
    const captured = (await (await context.request.get(`${baseURL}/api/workspace`)).json()).workspace;
    assert.equal(captured.leads.length, 1);
    assert.equal(captured.leads[0].callerName, "Website Fixture Customer");
    await preview.getByRole("link", { name: "Ask our assistant" }).click();
    await preview.locator(".client-assistant-panel").waitFor();
    // Use the actual owner autosave route before changing the next draft.
    await page.reload();
    await page.getByLabel("Request changes", { exact: true }).waitFor();
    await page.getByLabel("Request changes", { exact: true }).fill("Use green instead");
    await page.getByRole("button", { name: "Apply changes & regenerate" }).click();
    await page.getByText("Your new private preview is ready to review.").waitFor({ timeout: 60_000 });
    const revised = (await (await context.request.get(`${baseURL}/api/workspace`)).json()).workspace;
    assert.equal(revised.aiMemory[0].requests.length, 2);
    assert.equal(revised.websiteProject.spec.visualDirection.accentColor, "#93BC86");
    assert.equal(revised.publishedWebsite.id, firstPublished.publishedWebsite.id);
    await preview.goto(`${baseURL}/sites/${revised.websiteProject.publicSlug}`);
    await preview.locator(".site.editorial").waitFor();
    assert.equal(await preview.locator(".ai-website").evaluate((element) => getComputedStyle(element).getPropertyValue("--brand-accent").trim()), "#D4AF37");
    const secondPublished = await publish(revised.websiteProject, "aura");
    const rollback = await context.request.post(`${baseURL}/api/website-studio/status`, { headers: { "x-everonn-workspace": workspace.workspaceId }, data: { rollbackReleaseId: firstPublished.publishedWebsite.id, expectedLiveReleaseId: secondPublished.publishedWebsite.id } });
    assert.equal(rollback.status(), 200, await rollback.text());
    await preview.goto(`${baseURL}/sites/${revised.websiteProject.publicSlug}`);
    await preview.locator(".site.editorial").waitFor();
    const stale = await context.request.put(`${baseURL}/api/workspace`, { headers: { "x-everonn-workspace": workspace.workspaceId }, data: { workspace: stored } });
    assert.equal(stale.status(), 200, await stale.text());
    const retained = (await stale.json()).workspace;
    assert.equal(retained.aiMemory[0].revision, revised.aiMemory[0].revision);
    assert.equal(retained.websiteProject.id, revised.websiteProject.id);
    const stalePreferences = await context.request.put(`${baseURL}/api/agent-runtime/memory`, { headers: { "x-everonn-workspace": workspace.workspaceId }, data: { preferences: revised.aiMemory[0].value, expectedRevision: "stale-revision" } });
    assert.equal(stalePreferences.status(), 409);
    const forged = await context.request.put(`${baseURL}/api/agent-runtime/memory`, { headers: { "x-everonn-workspace": workspace.workspaceId }, data: {
      preferences: revised.aiMemory[0].value, expectedRevision: revised.aiMemory[0].revision,
      actor: { workspaceId: workspace.workspaceId, role: "owner", userId: "forged-owner" }, records: [], profile: { services: [] },
    } });
    assert.equal(forged.status(), 200, await forged.text());
    assert.equal((await forged.json()).memory[0].updatedBy, (await setup.json()).actor.userId);
    const visitor = await browser.newContext();
    assert.equal((await visitor.request.put(`${baseURL}/api/agent-runtime/memory`, { data: { preferences: {} } })).status(), 401);
    const registered = await visitor.request.post(`${baseURL}/api/auth/register`, { data: { name: "Second Fixture Owner", businessName: "Second HVAC", businessType: "HVAC", email: "second-hvac@example.test", password: "IsolatedSmoke123!", timeZone: "Asia/Kolkata" } });
    assert.equal(registered.status(), 201, await registered.text());
    assert.equal((await visitor.request.put(`${baseURL}/api/agent-runtime/memory`, { headers: { "x-everonn-workspace": workspace.workspaceId }, data: { preferences: {} } })).status(), 403);
    assert.deepEqual((await (await visitor.request.get(`${baseURL}/api/agent-runtime/memory`)).json()).memory, []);
    await visitor.close();
    // A short request starts a saved build; a reload resumes its completed pages.
    const buildHeaders = { "x-everonn-workspace": workspace.workspaceId };
    const startedBuild = await context.request.post(`${baseURL}/api/website-studio`, { headers: buildHeaders, data: { workspaceId: workspace.workspaceId } });
    assert.equal(startedBuild.status(), 202);
    const startedJob = (await startedBuild.json()).job;
    assert.ok(startedJob.id);
    for (let step = 0; step < 7; step++) {
      const advanced = await context.request.post(`${baseURL}/api/website-studio`, { headers: buildHeaders, data: { operation: "advance", jobId: startedJob.id } });
      assert.equal(advanced.status(), 202, await advanced.text());
      assert.match(advanced.headers()["content-type"], /application\/json/);
    }
    await page.reload();
    await page.getByRole("button", { name: "Resume saved build", exact: true }).waitFor();
    await page.getByRole("button", { name: "Resume saved build", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.eo-page-heading button')?.textContent?.includes('Regenerate concepts'), undefined, { timeout: 60000 });
    const resumed = (await (await context.request.get(`${baseURL}/api/workspace`)).json()).workspace;
    assert.notEqual(resumed.websiteProject.id, revised.websiteProject.id);
    assert.equal(resumed.publishedWebsite.id, retained.publishedWebsite.id);
    const storedBuild = JSON.parse(await readFile(dataFile, "utf8")).websiteGeneration;
    assert.equal(storedBuild.status, "completed");
    assert.equal(storedBuild.checkpoint, undefined);
    // Clear the current project's memory through the actual UI/API and retain the published release.
    await page.reload();
    await page.getByLabel("Request changes", { exact: true }).waitFor();
    await page.locator(".eo-design-options summary").click();
    const beforeForget = (await (await context.request.get(`${baseURL}/api/workspace`)).json()).workspace;
    const staleForget = await context.request.delete(`${baseURL}/api/agent-runtime/memory`, { headers: { "x-everonn-workspace": workspace.workspaceId }, data: { scope: "project", expectedRevision: "stale" } });
    assert.equal(staleForget.status(), 409);
    const noRevision = await context.request.delete(`${baseURL}/api/agent-runtime/memory`, { headers: { "x-everonn-workspace": workspace.workspaceId }, data: { scope: "project" } });
    assert.equal(noRevision.status(), 400);
    await page.getByRole("button", { name: "Clear saved choices for this scope" }).click();
    await page.getByText("Saved choices cleared for this scope. Your published website is unchanged.").waitFor();
    const forgotten = (await (await context.request.get(`${baseURL}/api/workspace`)).json()).workspace;
    assert.deepEqual(forgotten.aiMemory, []);
    assert.equal(forgotten.publishedWebsite.id, beforeForget.publishedWebsite.id);
    const noSession = await browser.newContext();
    assert.equal((await noSession.request.delete(`${baseURL}/api/agent-runtime/memory`, { data: { scope: "project", expectedRevision: null } })).status(), 401);
    await noSession.close();
    assert.deepEqual(errors, [], `Browser errors: ${errors.join(", ")}`);
    assert.deepEqual(JSON.parse(await readFile(dataFile, "utf8")).aiMemory, []);
    console.log("HVAC smoke passed: saved generation steps, empty gateway-response recovery, resume after reload, original HTML/CSS, owner revisions, live/draft isolation, callback submission, desktop/mobile concepts, publishing/rollback and scope/security. Gemini used a local fixture; no live provider was called.");
  } catch (error) { console.error(logs); console.error((await ownerPage?.locator("body").innerText().catch(() => ""))?.slice(-7000)); throw error; }
  finally {
    await browser?.close();
    if (server.exitCode === null) { server.kill(); await new Promise((resolve) => server.once("exit", resolve)); }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("everonn-hvac-"));
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

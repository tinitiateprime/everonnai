import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { createDemoWorkspace } from "../features/everonn/demo-data";

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "everonn-project-smoke-"));
  const reviewDirectory = process.argv.includes("--screenshots") ? await mkdtemp(path.join(tmpdir(), "everonn-project-review-")) : null;
  const port = Number(process.env.SMOKE_PROJECT_PORT || 3098), baseURL = `http://localhost:${port}`;
  const workspace = createDemoWorkspace(), dataFile = path.join(directory, "workspace.json"), projectsFile = path.join(directory, "projects.json");
  await writeFile(dataFile, JSON.stringify(workspace));
  const contents: Record<string, Buffer> = {
    "README.md": Buffer.from('# Customer project\n\nWelcome, team.\n\n[Project tasks](docs/TASKS.md)\n\n![Project logo](images/logo.png)\n\n```typescript\nconst ready = true;\n```\n\n<script>window.projectUnsafe=true</script>\n[unsafe](javascript:alert(1))\n'),
    "docs/TASKS.md": Buffer.from('# Project tasks\n\n- [x] Connect repository\n- [ ] Improve website\n\n[Overview](../README.md)\n'),
    "docs/flow.mmd": Buffer.from('flowchart LR\n Customer[Customer] --> Docs[Project documentation]\n'),
    "images/logo.png": Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4Z0AAAAASUVORK5CYII=', 'base64'),
  };
  const blob = (value: Buffer) => ({ sha: createHash("sha1").update(`blob ${value.length}\0`).update(value).digest("hex"), size: value.length, content: value.toString("base64"), encoding: "base64" });
  const files = Object.entries(contents).map(([name, value]) => ({ path: name, type: "blob", mode: "100644", ...blob(value) }));
  const updated = blob(Buffer.from('# Synced customer project\n\nLatest project documentation.\n'));
  await writeFile(path.join(directory, "github.json"), JSON.stringify({ files, updated }));
  const preload = path.join(directory, "github-fixture.cjs");
  await writeFile(preload, String.raw`
const fs = require('node:fs');
const fixture = JSON.parse(fs.readFileSync(process.env.PROJECT_GITHUB_FIXTURE,'utf8'));
const original = globalThis.fetch;
const versions = new Map();
globalThis.fetch = async function(input,init) {
  const value=String(input);
  if(value.startsWith('https://api.github.com/')) {
    const url=new URL(value), parts=url.pathname.split('/'), name=parts[3];
    if(!['public-project','private-project'].includes(name)) return Response.json({}, {status:404});
    if(name==='private-project' && init?.headers?.Authorization!=='Bearer fixture-github-token') return Response.json({}, {status:401});
    if(parts.length===4) return Response.json({default_branch:'main',private:name==='private-project'});
    if(parts[4]==='git' && parts[5]==='trees') {
      const version=(versions.get(name)||0)+1; versions.set(name,version);
      const tree=fixture.files.map(file=>file.path==='README.md'&&version>1?{...file,...fixture.updated}:file);
      tree.push({path:'.env.local',type:'blob',mode:'100644',sha:'e'.repeat(40),size:20});
      return Response.json({sha:'b'.repeat(40),tree,truncated:false});
    }
    if(parts[4]==='git' && parts[5]==='blobs') {
      const file=[...fixture.files,fixture.updated].find(file=>file.sha===parts[6]);
      return file?Response.json(file):Response.json({}, {status:404});
    }
    return Response.json({}, {status:404});
  }
  if(/^https:\/\/(?:api\.pexels\.com|api\.elevenlabs\.io|[^/]*googleapis\.com)/.test(value)) throw new Error('Live provider blocked by project smoke fixture');
  return original(input,init);
};
`);
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: process.env.SMOKE_PROJECT_DEV ? "development" : "production", NEXT_PUBLIC_APP_URL: baseURL,
    EVERONN_DATA_FILE: dataFile, EVERONN_WORKSPACES_FILE: path.join(directory, "workspaces.json"), EVERONN_AUTH_FILE: path.join(directory, "auth.json"), EVERONN_PROJECTS_FILE: projectsFile,
    EVERONN_CONNECTIONS_FILE: path.join(directory, "connections.json"), EVERONN_AUTH_SETUP_TOKEN: "isolated-project-smoke", CREDENTIAL_ENCRYPTION_KEY: "isolated-project-encryption-key-32-characters", PROJECT_GITHUB_FIXTURE: path.join(directory, "github.json"),
    GEMINI_API_KEY: "", GOOGLE_API_KEY: "", ELEVENLABS_API_KEY: "", ELEVENLABS_AGENT_ID: "", PEXELS_API_KEY: "", GOOGLE_OAUTH_CLIENT_ID: "", GOOGLE_OAUTH_CLIENT_SECRET: "",
    NETLIFY: "false", NETLIFY_BLOBS_CONTEXT: "", SITE_NAME: "", SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_USAGE_SCHEMA: "", SUPABASE_DB_URL: "",
    EVERONN_REQUIRE_DURABLE_STORAGE: "false", EVERONN_USAGE_DIR: path.join(directory, "usage"), USAGE_REQUIRE_DURABLE_STORAGE: "false", AWS_LAMBDA_FUNCTION_NAME: "", USAGE_BACKGROUND_MODE: "external", PHONE_FRONT_DESK_FOLLOW_UP_ENABLED: "false",
  };
  const server = spawn(process.execPath, ["--require", preload, "node_modules/next/dist/bin/next", process.env.SMOKE_PROJECT_DEV ? "dev" : "start", "--port", String(port)], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  server.stdout.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-10000); }); server.stderr.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-10000); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  async function localOrigin(context: BrowserContext) {
    await context.route(`${baseURL}/api/**`, async (route) => {
      const headers = { ...await route.request().allHeaders() }; delete headers.origin;
      await route.fulfill({ response: await route.fetch({ headers }) });
    });
  }
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await fetch(`${baseURL}/login`).then((response) => response.ok).catch(() => false)) break;
      if (server.exitCode !== null || attempt === 59) throw new Error(`Project fixture server failed: ${logs}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.SMOKE_CHROME_PATH || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : undefined) });
    const anonymous = await browser.newContext();
    assert.equal((await anonymous.request.get(`${baseURL}/api/project-workspace`)).status(), 401);
    const anonymousPage = await anonymous.newPage(); await anonymousPage.goto(`${baseURL}/workspace`); assert.match(anonymousPage.url(), /\/login\?/); await anonymous.close();
    const owner = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await localOrigin(owner);
    const setup = await owner.request.post(`${baseURL}/api/auth/setup`, { data: { name: "Project Fixture Owner", email: "project-owner@example.test", password: "IsolatedSmoke123!", setupToken: "isolated-project-smoke" } }); assert.equal(setup.status(), 201, await setup.text());
    const page = await owner.newPage(), errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseURL}/dashboard`); await page.getByRole("link", { name: "Project workspace", exact: true }).click();
    await page.getByRole("button", { name: "Connect your first repository" }).click();
    await page.getByLabel("Repository URL", { exact: true }).fill("https://github.com/acme/public-project");
    await page.getByRole("dialog").getByRole("button", { name: "Connect repository", exact: true }).click();
    await page.getByRole("heading", { name: "Customer project", exact: true }).waitFor();
    if (reviewDirectory) await page.screenshot({ path: path.join(reviewDirectory, "desktop.png") });
    const repos = (await (await owner.request.get(`${baseURL}/api/project-workspace`)).json()).repositories;
    assert.equal(repos.length, 1); const publicId = repos[0].id;
    assert.doesNotMatch(JSON.stringify(repos), /credential|ciphertext|fixture-github-token/);
    const response = await owner.request.get(`${baseURL}/api/project-workspace?repositoryId=${publicId}`); assert.equal(response.headers()["cache-control"], "private, no-store");
    for (const name of [".env.local", "../README.md", "docs/../README.md"]) assert.ok([400, 404].includes((await owner.request.get(`${baseURL}/api/project-workspace?repositoryId=${publicId}&path=${encodeURIComponent(name)}`)).status()));
    const asset = await owner.request.get(`${baseURL}/api/project-workspace?repositoryId=${publicId}&asset=images%2Flogo.png`); assert.equal(asset.status(), 200); assert.equal(asset.headers()["content-type"], "image/png");
    assert.equal(await page.locator(".markdown-body script").count(), 0); assert.equal(await page.locator('.markdown-body a[href^="javascript:"]').count(), 0); assert.equal(await page.evaluate(() => "projectUnsafe" in window), false);
    await page.getByRole("button", { name: "Copy code", exact: true }).waitFor();
    await page.getByRole("link", { name: "Project tasks", exact: true }).click(); await page.getByRole("heading", { name: "Project tasks", exact: true }).waitFor(); assert.match(await page.locator(".pw-document-meta").innerText(), /1 of 2 tasks complete/);
    await page.getByLabel("Search project documents").fill("flow"); await page.getByTitle("docs/flow.mmd", { exact: true }).click();
    await page.locator(".mermaid-diagram svg").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Source", exact: true }).click(); assert.match(await page.locator(".mermaid-source").innerText(), /flowchart LR/);
    await page.getByRole("button", { name: "Diagram", exact: true }).click(); await page.getByRole("button", { name: "Use dark theme" }).click(); await page.locator(".pw-dark .mermaid-diagram svg").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Use light theme" }).click();
    await page.getByLabel("Search project documents").fill(""); await page.getByTitle("README.md", { exact: true }).click(); await page.getByRole("heading", { name: "Customer project", exact: true }).waitFor();
    await page.getByRole("button", { name: "Sync repository" }).click(); await page.getByRole("heading", { name: "Synced customer project", exact: true }).waitFor();
    assert.equal((await owner.request.post(`${baseURL}/api/project-workspace`, { headers: { origin: "https://evil.example" }, data: { action: "sync", repositoryId: publicId } })).status(), 403);
    await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Project mobile overflow");
    await page.getByRole("button", { name: "Open project navigation", exact: true }).click(); await page.getByLabel("Search project documents").fill("TASKS"); await page.getByTitle("docs/TASKS.md", { exact: true }).click(); await page.getByRole("heading", { name: "Project tasks", exact: true }).waitFor(); assert.equal(await page.locator(".pw-sidebar-open").count(), 0);
    await page.locator(".pw-sidebar").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    if (reviewDirectory) await page.screenshot({ path: path.join(reviewDirectory, "mobile.png") });

    const customer = await browser.newContext(); await localOrigin(customer);
    const registered = await customer.request.post(`${baseURL}/api/auth/register`, { data: { name: "Customer Fixture Owner", businessName: "Customer HVAC", businessType: "HVAC", email: "project-customer@example.test", password: "IsolatedSmoke123!" } }); assert.equal(registered.status(), 201, await registered.text());
    assert.deepEqual((await (await customer.request.get(`${baseURL}/api/project-workspace`, { headers: { "x-everonn-workspace": workspace.workspaceId } })).json()).repositories, []);
    assert.equal((await customer.request.get(`${baseURL}/api/project-workspace?repositoryId=${publicId}`)).status(), 404);
    const privateConnection = await customer.request.post(`${baseURL}/api/project-workspace`, { data: { action: "connect", url: "https://github.com/acme/private-project", token: "fixture-github-token" } }); assert.equal(privateConnection.status(), 201, await privateConnection.text());
    const privateCatalog = await privateConnection.json(); assert.equal(privateCatalog.repository.authenticated, true); assert.doesNotMatch(JSON.stringify(privateCatalog), /credential|ciphertext|fixture-github-token/);
    const privateId = privateCatalog.repository.id;
    assert.equal((await owner.request.get(`${baseURL}/api/project-workspace?repositoryId=${privateId}&path=README.md`)).status(), 404);
    assert.equal((await customer.request.get(`${baseURL}/api/project-workspace?repositoryId=${privateId}&path=README.md`)).status(), 200);
    assert.doesNotMatch(await readFile(projectsFile, "utf8"), /fixture-github-token/);
    const customerPage = await customer.newPage(); await customerPage.goto(`${baseURL}/workspace`);
    const privateRepositoryButton = customerPage.getByRole("button", { name: "Open repository acme/private-project", exact: true });
    await privateRepositoryButton.waitFor({ state: "visible" });
    assert.equal(await customerPage.getByRole("combobox").count(), 0);
    const searchBounds = await customerPage.getByLabel("Search project documents").boundingBox(), repositoryBounds = await privateRepositoryButton.boundingBox();
    assert.ok(searchBounds && repositoryBounds && repositoryBounds.y > searchBounds.y + searchBounds.height, "Connected repository must be visible below search");
    if (reviewDirectory) await customerPage.screenshot({ path: path.join(reviewDirectory, "visible-repository.png") });
    await privateRepositoryButton.click(); await customerPage.getByRole("heading", { name: "Customer project", exact: true }).waitFor();
    assert.equal(await privateRepositoryButton.getAttribute("aria-pressed"), "true");
    const secondConnection = await customer.request.post(`${baseURL}/api/project-workspace`, { data: { action: "connect", url: "https://github.com/acme/public-project" } });
    assert.equal(secondConnection.status(), 201, await secondConnection.text());
    await customerPage.reload();
    const publicRepositoryButton = customerPage.getByRole("button", { name: "Open repository acme/public-project", exact: true });
    await privateRepositoryButton.waitFor({ state: "visible" }); await publicRepositoryButton.waitFor({ state: "visible" });
    await publicRepositoryButton.click(); await customerPage.getByRole("heading", { name: "Synced customer project", exact: true }).waitFor();
    await customerPage.getByLabel("Search project documents").fill("does-not-match-any-file");
    await customerPage.getByText("No matching documents", { exact: true }).waitFor();
    assert.ok(await privateRepositoryButton.isVisible(), "Repository choices must remain visible while filtering files");
    await privateRepositoryButton.click(); await customerPage.getByRole("heading", { name: "Customer project", exact: true }).waitFor();
    assert.equal(await customerPage.getByLabel("Search project documents").inputValue(), "");
    assert.equal(await publicRepositoryButton.getAttribute("aria-pressed"), "false");
    const invite = await owner.request.post(`${baseURL}/api/auth/invitations`, { data: { name: "Viewer Fixture", email: "project-viewer@example.test", role: "viewer" } }); assert.equal(invite.status(), 201, await invite.text());
    const viewer = await browser.newContext(); const accepted = await viewer.request.post((await invite.json()).inviteUrl.replace(/\/join\//, "/api/auth/invitations/"), { data: { password: "IsolatedSmoke123!" } }); assert.equal(accepted.status(), 200, await accepted.text());
    assert.equal((await viewer.request.get(`${baseURL}/api/project-workspace?repositoryId=${publicId}&path=README.md`)).status(), 200);
    assert.equal((await viewer.request.post(`${baseURL}/api/project-workspace`, { data: { action: "connect", url: "https://github.com/acme/private-project", token: "fixture-github-token" } })).status(), 403);
    assert.equal((await viewer.request.delete(`${baseURL}/api/project-workspace`, { data: { repositoryId: publicId, revision: repos[0].revision } })).status(), 403);
    const viewerPage = await viewer.newPage(); await viewerPage.goto(`${baseURL}/workspace`); assert.equal(await viewerPage.getByRole("button", { name: "Connect repository", exact: true }).count(), 0);
    const viewerRepositoryButton = viewerPage.getByRole("button", { name: "Open repository acme/public-project", exact: true });
    await viewerRepositoryButton.waitFor({ state: "visible" }); await viewerRepositoryButton.click();
    await viewerPage.getByRole("heading", { name: "Synced customer project", exact: true }).waitFor();
    await customer.request.delete(`${baseURL}/api/project-workspace`, { data: { repositoryId: privateId, revision: privateCatalog.repository.revision } });
    assert.deepEqual((await (await customer.request.get(`${baseURL}/api/project-workspace`)).json()).repositories.map((repository: { name: string }) => repository.name), ["public-project"]);
    assert.equal((await owner.request.get(`${baseURL}/api/project-workspace`)).status(), 200);
    await viewer.close(); await customer.close(); await owner.close(); assert.deepEqual(errors, []);
    if (reviewDirectory) console.log(`Project review screenshots: ${reviewDirectory}`);
    console.log("Customer Project Workspace smoke passed: public/private GitHub connections, encrypted tokens, tenant/member isolation, file/asset scope, Markdown safety, tasks, search, diagrams/source, light/dark, sync, mobile navigation, and disconnect. Disposable stores and mocked GitHub; no live provider or shared database was used.");
  } catch (error) { console.error(logs); throw error; }
  finally { await browser?.close(); if (server.exitCode === null) { server.kill(); await new Promise((resolve) => server.once("exit", resolve)); } assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith("everonn-project-smoke-")); await rm(directory, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

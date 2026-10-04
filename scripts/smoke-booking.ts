import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
import { createDemoWorkspace } from "../features/everonn/demo-data";
import type { EverOnnWorkspace } from "../features/everonn/types";
import { createWebsiteProject, generateDeterministicWebsiteSpec } from "../features/website-studio/generator";

// This smoke test uses a disposable workspace/auth store and disables every live provider.
async function main() {
const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "everonn-booking-"));
const dataFile = path.join(fixtureDirectory, "workspace.json");
const port = Number(process.env.SMOKE_BOOKING_PORT || 3000);
const baseURL = `http://localhost:${port}`;
await new Promise<void>((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(port, () => probe.close(() => resolve()));
});
const workspace = createDemoWorkspace();
const primary = JSON.parse(await readFile(path.join(process.cwd(), "data", "everonn.json"), "utf8")) as EverOnnWorkspace;
workspace.profile = { ...primary.profile, workspaceId: workspace.workspaceId };
workspace.profile.email = "fixture-business@example.com";
const selectedService = workspace.profile.services.find((service) => service.active)!;
assert.ok(selectedService, "Configure at least one active service before running the booking smoke test.");
workspace.contacts = [];
workspace.leads = [];
workspace.conversations = [];
workspace.appointments = [];
workspace.profile.timeZone = "Asia/Kolkata";
workspace.websiteProject = createWebsiteProject(workspace.profile, generateDeterministicWebsiteSpec(workspace.profile));
workspace.websiteProject.status = "published";
workspace.websiteProject.selectedConcept = "editorial";
await writeFile(dataFile, JSON.stringify(workspace));
const environment: NodeJS.ProcessEnv = {
  ...process.env, NODE_ENV: "production", NEXT_PUBLIC_APP_URL: baseURL,
  EVERONN_DATA_FILE: dataFile, EVERONN_WORKSPACES_FILE: path.join(fixtureDirectory, "workspaces.json"),
  EVERONN_AUTH_FILE: path.join(fixtureDirectory, "auth.json"), EVERONN_CONNECTIONS_FILE: path.join(fixtureDirectory, "connections.json"),
  EVERONN_AUTH_SETUP_TOKEN: "isolated-booking-smoke", PHONE_FRONT_DESK_FOLLOW_UP_ENABLED: "false",
  GEMINI_API_KEY: "", GOOGLE_API_KEY: "", ELEVENLABS_API_KEY: "", ELEVENLABS_AGENT_ID: "", PEXELS_API_KEY: "",
  GOOGLE_OAUTH_CLIENT_ID: "", GOOGLE_OAUTH_CLIENT_SECRET: "", NETLIFY: "false", NETLIFY_BLOBS_CONTEXT: "", SITE_NAME: "",
  SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_USAGE_SCHEMA: "", SUPABASE_DB_URL: "", EVERONN_REQUIRE_DURABLE_STORAGE: "false",
  EVERONN_USAGE_DIR: path.join(fixtureDirectory, "usage"), USAGE_REQUIRE_DURABLE_STORAGE: "false", AWS_LAMBDA_FUNCTION_NAME: "", USAGE_BACKGROUND_MODE: "external",
};
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port)], { env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
server.stdout.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-10000); });
server.stderr.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-10000); });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await fetch(`${baseURL}/login`).then((response) => response.ok).catch(() => false);
    if (ready) break;
    if (server.exitCode !== null) throw new Error(`Test server exited: ${logs}`);
    if (attempt === 59) throw new Error(`Test server did not start: ${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.SMOKE_CHROME_PATH || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : undefined) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", async (response) => {
    if (response.url().includes("/api/") && response.status() >= 400) logs += `\n${response.status()} ${response.url()}: ${await response.text().catch(() => "")}`;
  });
  const setup = await context.request.post(`${baseURL}/api/auth/setup`, { data: { name: "Booking Test Owner", email: "booking-test@example.com", password: "IsolatedSmoke123!", setupToken: "isolated-booking-smoke" } });
  assert.equal(setup.status(), 201, await setup.text());
  await page.goto(`${baseURL}/dashboard/ai-agent`);
  await page.locator(".eo-agent-console input").waitFor();
  await page.locator(".eo-agent-console input").fill(`My name is Sam and my callback number is +91 9876543210. Book ${selectedService.name} tomorrow.`);
  await page.locator(".eo-agent-console input").press("Enter");
  await page.getByText(/What exact time would you prefer/).waitFor();
  await page.waitForFunction(async () => (await (await fetch("/api/workspace")).json()).workspace.leads.length === 1);
  const collecting = (await (await context.request.get(`${baseURL}/api/workspace`)).json()).workspace;
  assert.equal(collecting.leads[0].captureStatus, "collecting");
  assert.equal(collecting.leads[0].automation, undefined);
  assert.equal(collecting.appointments.length, 0);
  await page.getByRole("button", { name: "Finish & save summary" }).click();
  await page.getByRole("button", { name: "Saved to inbox" }).waitFor();
  await page.goto(`${baseURL}/dashboard/appointments`);
  await page.getByText("Requests without a booking").waitFor();
  await page.locator(".eo-schedule-request summary").click();
  const date = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  assert.equal(await page.getByLabel("Preferred date").inputValue(), "");
  assert.equal(await page.getByLabel("Preferred time").inputValue(), "");
  assert.equal(await page.getByLabel("Requested service").inputValue(), "");
  await page.getByLabel("Requested service").selectOption(selectedService.id);
  await page.getByLabel("Preferred date").fill(date);
  await page.getByLabel("Preferred time").fill("14:30");
  await page.getByRole("button", { name: "Submit appointment request" }).click();
  await page.locator(".eo-appointment-grid article").waitFor();
  await page.getByText(`${date} at 14:30`, { exact: false }).waitFor();
  const stored = (await (await context.request.get(`${baseURL}/api/workspace`)).json()).workspace;
  assert.equal(stored.appointments[0].service, selectedService.name);
  assert.equal(stored.appointments[0].time, "14:30");
  assert.equal(stored.appointments[0].status, "requested");
  assert.ok(stored.appointments[0].requestDetails.includes(`Book ${selectedService.name} tomorrow`));
  const staleSave = await context.request.put(`${baseURL}/api/workspace`, { headers: { "x-everonn-workspace": workspace.workspaceId }, data: { workspace: collecting } });
  assert.equal(staleSave.status(), 200, await staleSave.text());
  const retained = (await staleSave.json()).workspace;
  assert.ok(retained.leads[0].automation);
  assert.equal(retained.appointments.length, 1);

  const site = await context.newPage();
  site.on("pageerror", (error) => errors.push(error.message));
  await site.goto(`${baseURL}/sites/${workspace.websiteProject.publicSlug}`);
  await site.getByRole("button", { name: /Chat with/ }).click();
  const chat = site.getByLabel("Message the AI assistant");
  await chat.waitFor({ state: "visible" });
  await site.waitForFunction(() => !document.querySelector<HTMLInputElement>("[aria-label='Message the AI assistant']")?.disabled);
  await chat.fill(`My name is Lee and my email is lee@example.com. Book ${selectedService.name} tomorrow.`);
  await chat.press("Enter");
  await site.getByText(/What exact time would you prefer/).waitFor();
  await site.getByRole("button", { name: "Send request to team" }).waitFor();
  await site.getByText("Choose an appointment date and time").click();
  assert.equal(await site.getByLabel("Preferred time").inputValue(), "");
  await site.getByLabel("Requested service").selectOption(selectedService.id);
  await site.getByLabel("Preferred date").fill(date);
  await site.getByLabel("Preferred time").fill("16:45");
  await site.getByRole("button", { name: "Submit appointment request" }).click();
  await site.locator(".client-captured").filter({ hasText: "Google Calendar is disconnected" }).waitFor();
  await site.getByRole("button", { name: "Close assistant" }).click();
  await site.setViewportSize({ width: 390, height: 844 });
  await site.getByRole("button", { name: /Chat with/ }).click();
  await site.getByLabel("Message the AI assistant").waitFor();
  const overflow = await site.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, "Mobile page should not overflow horizontally");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("heading", { name: "Real service requests, with the customer's preferred time." }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseURL}/dashboard/contacts`);
  await page.getByRole("button", { name: "Add contact" }).click();
  await page.getByLabel("Contact name").fill("Casework Contact");
  await page.getByLabel("Contact email").fill("casework@example.com");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.getByRole("heading", { name: "Casework Contact" }).waitFor();
  await page.waitForFunction(async () => (await (await fetch("/api/workspace")).json()).workspace.contacts.some((contact: { email: string }) => contact.email === "casework@example.com"));
  await page.goto(`${baseURL}/dashboard/inbox`);
  await page.getByLabel("Status for Sam").selectOption("closed");
  await page.getByRole("button", { name: /Needs follow-up/ }).click();
  assert.equal(await page.getByLabel("Status for Sam").count(), 0);
  await page.getByRole("button", { name: /^All/ }).click();
  await page.getByLabel("Status for Sam").waitFor();
  const final = JSON.parse(await readFile(dataFile, "utf8"));
  assert.equal(final.leads.length, 2);
  assert.equal(final.appointments.length, 2);
  assert.equal(final.leads.every((lead: { automation?: { gmailStatus: string } }) => !lead.automation || lead.automation.gmailStatus === "not_configured"), true);
  assert.deepEqual(errors, []);
  process.stdout.write("Booking smoke passed: carpentry request details, required date/time, progressive capture, final submission, stale-save protection, contact creation, inbox filtering, and mobile layouts. No live provider calls or user-data changes.\n");
} catch (error) {
  process.stderr.write(logs);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await new Promise<void>((resolve) => { if (server.exitCode !== null) resolve(); else server.once("exit", () => resolve()); });
  if (!path.resolve(fixtureDirectory).startsWith(path.resolve(tmpdir(), "everonn-booking-"))) throw new Error("Refusing cleanup outside the booking smoke directory.");
  await rm(fixtureDirectory, { recursive: true, force: true });
}
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });

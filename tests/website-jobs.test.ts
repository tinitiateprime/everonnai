import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createDemoWorkspace } from "@/features/everonn/demo-data";
import type { EverOnnWorkspace } from "@/features/everonn/types";
import { createWebsiteJobRunner, type WebsiteJobStore } from "@/features/website-studio/jobs";
import { createWebsiteProject } from "@/features/website-studio/generator";
import { readWebsiteGeneration, runWebsiteGeneration } from "@/features/website-studio/progress";
import { generateDeterministicWebsiteSpec } from "./fixtures/website";
import { websiteCodeFixture } from "./fixtures/website-code";

const usageDirectory = mkdtempSync(path.join(tmpdir(), "everonn-website-jobs-usage-"));
process.env.EVERONN_USAGE_DIR = usageDirectory;
for (const key of ["SUPABASE_DB_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_USAGE_SCHEMA", "AWS_LAMBDA_FUNCTION_NAME", "NETLIFY_BLOBS_CONTEXT"]) process.env[key] = "";
process.env.NETLIFY = "false"; process.env.USAGE_BACKGROUND_MODE = "external";
process.env.USAGE_REQUIRE_DURABLE_STORAGE = "false";
after(() => rmSync(usageDirectory, { recursive: true, force: true }));

function fixture() {
  let saved = createDemoWorkspace();
  const spec = generateDeterministicWebsiteSpec(saved.profile);
  saved.websiteProject = createWebsiteProject(saved.profile, spec);
  saved.websiteProject.status = "published";
  saved.websiteProject.selectedConcept = "editorial";
  const actor = { workspaceId: saved.workspaceId, role: "owner" as const };
  const requests: Array<{ concept?: string; paths?: string[]; model: string; repair: boolean }> = [];
  const store: WebsiteJobStore = {
    read: async (id) => { assert.equal(id, saved.workspaceId); return structuredClone(saved); },
    update: async (id, change) => { assert.equal(id, saved.workspaceId); saved = structuredClone(change(structuredClone(saved))); return structuredClone(saved); },
    slugUsed: async () => false,
  };
  const fetchImpl = (async (url, init) => {
    const body = JSON.parse(String(init?.body));
    const prompt = body.contents[0].parts[0].text as string;
    const model = new URL(String(url)).pathname.split("/").at(-1)!.split(":")[0];
    if (/WEBSITE_(CODE|DESIGN)_TASK/.test(prompt)) {
      const concept = prompt.match(/Create the (editorial|momentum|aura) design/)![1] as "editorial";
      const paths = (body.generationConfig.responseSchema.properties.pages?.items.properties.path.enum || []) as string[];
      requests.push({ concept, paths, model, repair: body.contents.length > 1 });
      const code = websiteCodeFixture(spec, saved.profile, concept);
      code.pages = code.pages.filter((page) => paths.includes(page.path));
      return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(code) }] } }] });
    }
    requests.push({ model, repair: body.contents.length > 1 });
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(spec) }] } }] });
  }) as typeof fetch;
  const config = { apiKey: "fixture-only", models: ["fixture-model"], timeoutMs: 10000, retryDelayMs: 0 };
  const runner = () => createWebsiteJobRunner({ store, fetchImpl, config });
  return { actor, store, fetchImpl, requests, config, runner, read: () => saved, change: (edit: (workspace: EverOnnWorkspace) => void) => edit(saved) };
}

test("saved page units survive runner restarts and replace only the private draft after final QA", async () => {
  const f = fixture();
  const original = structuredClone(f.read().websiteProject);
  let result = await f.runner().start(f.actor);
  const id = result.job!.id;
  assert.equal(f.requests.length, 0);
  const repeated = await f.runner().start(f.actor);
  assert.equal(repeated.job!.id, id);
  for (let step = 0; step < 40 && result.job?.status !== "completed"; step++) {
    const before = f.requests.length;
    result = await f.runner().advance(f.actor, id);
    assert.ok(f.requests.length - before <= 1, "One AI request per HTTP step");
    if (!result.project) assert.deepEqual(f.read().websiteProject, original);
  }
  assert.equal(result.job!.status, "completed");
  assert.ok(result.project?.qa.passed);
  assert.notEqual(result.project!.id, original!.id);
  assert.deepEqual(f.read().publishedWebsite?.project, original);
  assert.equal(f.read().websiteGeneration?.checkpoint, undefined);
  assert.equal(f.requests.filter((call) => call.paths?.length).length, 21);
  assert.equal(f.requests.filter((call) => call.paths?.length === 0).length, 3);
  assert.ok(f.requests.filter((call) => call.paths?.length).every((call) => call.paths!.length === 1));
  assert.equal((await f.runner().advance(f.actor, id)).project!.id, result.project!.id);
  assert.equal(f.requests.length, 25, "Completed requests cannot charge again");
});

test("workspace lease prevents duplicate AI calls from concurrent tabs and rejects unauthorized access", async () => {
  const f = fixture();
  const started = await f.runner().start(f.actor);
  const id = started.job!.id;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const startedFetch = new Promise<void>((resolve) => { entered = resolve; });
  const fetchImpl = (async (...args: Parameters<typeof fetch>) => { entered(); await waiting; return f.fetchImpl(...args); }) as typeof fetch;
  const runner = createWebsiteJobRunner({ store: f.store, config: f.config, fetchImpl });
  const first = runner.advance(f.actor, id);
  await startedFetch;
  const second = await runner.advance(f.actor, id);
  assert.equal(second.job!.retryAfterMs, 1000);
  release(); await first;
  assert.equal(f.requests.length, 1);
  await assert.rejects(runner.advance({ ...f.actor, role: "viewer" }, id), /cannot perform/);
  await assert.rejects(runner.status({ ...f.actor, workspaceId: "other" }, id));
  await assert.rejects(runner.advance(f.actor, "00000000-0000-0000-0000-000000000000"), /replaced/);
});

test("changes during a provider request invalidate the build without replacing any website", async () => {
  const f = fixture();
  const original = structuredClone(f.read().websiteProject);
  const id = (await f.runner().start(f.actor)).job!.id;
  const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
    const response = await f.fetchImpl(...args);
    f.change((workspace) => { workspace.profile.description += " Changed while generating."; });
    return response;
  }) as typeof fetch;
  const result = await createWebsiteJobRunner({ store: f.store, config: f.config, fetchImpl }).advance(f.actor, id);
  assert.equal(result.job!.status, "failed");
  assert.equal(result.job!.canResume, false);
  assert.match(result.job!.error!, /changed during generation/);
  assert.deepEqual(f.read().websiteProject, original);
  await assert.rejects(f.runner().resume(f.actor, id), /Business information changed/);
});

test("model fallback and a page repair are separate saved requests with unchanged safety checks", async () => {
  const f = fixture();
  let rejectFirst = true, invalidPage = true;
  const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
    if (rejectFirst) { rejectFirst = false; return Response.json({ error: { message: "Busy" } }, { status: 503 }); }
    const response = await f.fetchImpl(...args);
    const body = JSON.parse(String(args[1]?.body));
    if (invalidPage && body.contents[0].parts[0].text.includes("WEBSITE_CODE_TASK")) {
      invalidPage = false;
      const data = await response.json();
      const code = JSON.parse(data.candidates[0].content.parts[0].text);
      code.pages[0].html += "<script>unsafe()</script>";
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(code) }] } }] });
    }
    return response;
  }) as typeof fetch;
  const runner = createWebsiteJobRunner({ store: f.store, config: { ...f.config, models: ["busy-model", "working-model"] }, fetchImpl });
  let result = await runner.start(f.actor);
  const id = result.job!.id;
  result = await runner.advance(f.actor, id);
  assert.equal(f.read().websiteGeneration!.checkpoint!.contentAttempt.modelIndex, 1);
  result = await runner.advance(f.actor, id);
  assert.equal(result.job!.progress.stage, "media");
  await runner.advance(f.actor, id);
  await runner.advance(f.actor, id);
  result = await runner.advance(f.actor, id);
  assert.equal(result.job!.progress.completedPages, 0);
  assert.equal(f.read().websiteGeneration!.checkpoint!.codeAttempt!.validationAttempt, 1);
  result = await runner.advance(f.actor, id);
  assert.equal(result.job!.progress.completedPages, 1);
  assert.equal(f.requests.at(-1)!.repair, true);
  assert.doesNotMatch(f.read().websiteGeneration!.checkpoint!.designs.editorial!.pages[0].html, /<script>/);
});

test("exhausted provider failures can resume a saved build without rebuilding completed pages", async () => {
  const f = fixture();
  const id = (await f.runner().start(f.actor)).job!.id;
  for (let step = 0; step < 5; step++) await f.runner().advance(f.actor, id);
  const page = structuredClone(f.read().websiteGeneration!.checkpoint!.designs.editorial!.pages[0]);
  const offline = createWebsiteJobRunner({ store: f.store, config: f.config, fetchImpl: async () => Response.json({ error: { message: "Offline" } }, { status: 503 }) });
  const failed = await offline.advance(f.actor, id);
  assert.equal(failed.job!.status, "failed");
  assert.equal(failed.job!.canResume, true);
  await f.runner().resume(f.actor, id);
  const result = await f.runner().advance(f.actor, id);
  assert.equal(result.job!.progress.completedPages, 3);
  assert.deepEqual(f.read().websiteGeneration!.checkpoint!.designs.editorial!.pages[0], page);
});

test("an expired lease can be recovered and the old request cannot overwrite the newer checkpoint", async () => {
  const f = fixture();
  let time = new Date("2026-10-07T04:00:00Z").getTime();
  const now = () => new Date(time);
  let release!: () => void, enter!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const slowFetch = (async (...args: Parameters<typeof fetch>) => { enter(); await waiting; return f.fetchImpl(...args); }) as typeof fetch;
  const slow = createWebsiteJobRunner({ store: f.store, config: f.config, fetchImpl: slowFetch, now });
  const id = (await slow.start(f.actor)).job!.id;
  const stale = slow.advance(f.actor, id);
  const assertion = assert.rejects(stale, /superseded/);
  await entered;
  time += 61_000;
  const next = await createWebsiteJobRunner({ store: f.store, config: f.config, fetchImpl: f.fetchImpl, now }).advance(f.actor, id);
  assert.equal(next.job!.progress.stage, "media");
  release(); await assertion;
  assert.equal(f.read().websiteGeneration!.progress.stage, "media");
});

test("billing and permission errors stop without calling another model or substituting a template", async () => {
  const f = fixture();
  let attempts = 0;
  const runner = createWebsiteJobRunner({ store: f.store, config: { ...f.config, models: ["first", "second"] },
    fetchImpl: async () => { attempts++; return Response.json({ error: { message: "Prepayment credits depleted" } }, { status: 402 }); } });
  const original = structuredClone(f.read().websiteProject);
  const id = (await runner.start(f.actor)).job!.id;
  const result = await runner.advance(f.actor, id);
  assert.equal(result.job!.status, "failed");
  assert.match(result.job!.error!, /credits depleted/);
  assert.equal(attempts, 1);
  assert.deepEqual(f.read().websiteProject, original);
});

test("empty, HTML and truncated generation responses produce a resumable error without raw payloads", async () => {
  for (const response of [new Response("", { status: 504 }), new Response("<html>private gateway details</html>", { status: 502 }), new Response('{"project":'), new Response('{"type":"result","data":', { headers: { "Content-Type": "application/x-ndjson" } })]) {
    await assert.rejects(readWebsiteGeneration(response, () => {}), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Resume the saved build/);
      assert.doesNotMatch(error.message, /Unexpected end|private gateway details/);
      return true;
    });
  }
});

test("browser recovery reads saved state after a lost response and never restarts the paid build", async () => {
  const f = fixture();
  let starts = 0, dropped = false;
  const fetchImpl = (async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const runner = f.runner();
    let result;
    if (body.operation === "start") { starts++; result = await runner.start(f.actor); }
    else if (body.operation === "advance") {
      result = await runner.advance(f.actor, body.jobId);
      if (!dropped && result.job!.progress.completedPages === 1) { dropped = true; return new Response("", { status: 504 }); }
    } else result = await runner.status(f.actor);
    return Response.json(result, { status: result.job?.status === "running" ? 202 : 200 });
  }) as typeof fetch;
  const result = await runWebsiteGeneration({ workspaceId: f.actor.workspaceId, onProgress: () => {}, fetchImpl });
  assert.ok(result.project?.qa.passed);
  assert.equal(starts, 1);
  assert.equal(f.requests.length, 25);
});

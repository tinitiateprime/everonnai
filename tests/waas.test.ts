import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { handleApi } from "@/features/waas/http";
import { authorize, sessionToken } from "@/features/waas/auth";
import { createSite, readSite, updateSite, publishSite, rollbackSite, siteSummary } from "@/features/waas/service";
import { exportSite, servePage } from "@/features/waas/render";
import { updateRecord, readRecord, changeDatabaseRecord } from "@/lib/record-store";
import { createWebsiteProject, WEBSITE_CONCEPTS } from "@/features/website-studio/generator";
import type { WaasSite } from "@/features/waas/types";
import { createDemoWorkspace } from "./fixtures/demo-workspace";
import { generateDeterministicWebsiteSpec } from "./fixtures/website";
import { websiteCodeFixture } from "./fixtures/website-code";
import { createWaasClient, WaasError } from "../sdk/index.mjs";

const directory = mkdtempSync(path.join(tmpdir(), "waas-package-tests-"));
process.env.WAAS_DATA_DIR = directory;
process.env.DATABASE_URL = "";
process.env.WAAS_API_KEY = "test-only-key-" + randomUUID();
process.env.WAAS_PUBLIC_URL = "http://localhost:3000";
after(() => rm(directory, { recursive: true, force: true }));
function input(verified = true) {
  const demo = createDemoWorkspace().profile;
  return { profile: { businessName: demo.businessName, businessType: demo.businessType, description: demo.description, email: demo.email, phone: demo.phone, location: demo.location, serviceArea: demo.serviceArea, hours: demo.hours, skillId: demo.skillId, knowledge: demo.knowledge, services: demo.services, verified } };
}
async function draft(id: string) {
  return updateRecord<WaasSite>("sites/" + id, (site) => {
    const current = site!;
    const spec = generateDeterministicWebsiteSpec(current.profile);
    spec.code = { schemaVersion: 1, validatedAt: new Date().toISOString(), concepts: Object.fromEntries(WEBSITE_CONCEPTS.map((concept) => [concept, websiteCodeFixture(spec, current.profile, concept)])) as NonNullable<typeof spec.code>["concepts"] };
    return { ...current, websiteProject: { ...createWebsiteProject(current.profile, spec), profileSnapshot: structuredClone(current.profile), publicSlug: "business-" + id } };
  });
}
function http(route: string, method = "GET", value?: unknown, auth = true) {
  return new Request("http://localhost:3000/api/waas/v1/" + route, { method, headers: { ...(auth ? { Authorization: "Bearer " + process.env.WAAS_API_KEY } : {}), "Content-Type": "application/json" }, ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
}
test("the public management API fails closed and never returns a credential", async () => {
  const response = await handleApi(http("sites", "GET", undefined, false), ["sites"]);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.ok(!(await response.text()).includes(process.env.WAAS_API_KEY!));
  const wrong = new Request("http://localhost/api", { headers: { Authorization: "Bearer wrong" } });
  assert.throws(() => authorize(wrong), /Invalid API key/);
});
test("signed Studio cookies expire and cookie writes require the exact origin", () => {
  const cookie = "waas_admin=" + sessionToken();
  authorize(new Request("http://localhost:3000/api", { headers: { cookie } }));
  authorize(new Request("http://localhost:3000/api", { method: "POST", headers: { cookie, origin: "http://localhost:3000" } }));
  assert.throws(() => authorize(new Request("http://localhost:3000/api", { method: "POST", headers: { cookie, origin: "https://untrusted.example" } })), /origin/);
  assert.throws(() => authorize(new Request("http://localhost:3000/api", { headers: { cookie: "waas_admin=" + sessionToken(Date.now() - 1) } })), /Sign in/);
  assert.throws(() => authorize(new Request("http://localhost:3000/api", { headers: { cookie: cookie + "0" } })), /Sign in/);
});
test("site creation is empty of customers, rejects server-owned fields and validates action URLs", async () => {
  const created = await createSite(input());
  const saved = await readSite(created.id);
  assert.equal(saved.websiteProject, null);
  assert.equal(saved.leads.length + saved.contacts.length + saved.conversations.length, 0);
  await assert.rejects(createSite({ profile: { ...input().profile, workspaceId: "someone-else" } }), /Profile fields/);
  await assert.rejects(createSite({ ...input(), actions: { booking: "javascript:alert(1)" } }), /HTTPS/);
  await assert.rejects(createSite({ ...input(), actions: { booking: "https://user:secret@example.com" } }), /credentials/);
  await assert.rejects(createSite({ profile: { ...input().profile, verified: "true" } }), /boolean/);
});
test("concurrent profile changes reject stale writers and do not replace another site", async () => {
  const one = await createSite(input()), two = await createSite(input());
  const results = await Promise.allSettled([updateSite(one.id, { expectedRevision: one.revision, profile: { location: "First edit" } }), updateSite(one.id, { expectedRevision: one.revision, profile: { location: "Second edit" } })]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await readSite(two.id)).profile.location, two.profile.location);
  await assert.rejects(readSite("../../env"), /not found/);
});
test("publish requires owner review, verified facts, the current draft and current live release", async () => {
  const created = await createSite(input()), saved = await draft(created.id);
  const approval = { concept: "editorial", approved: true, draftId: saved.websiteProject!.id, expectedLiveReleaseId: null };
  await assert.rejects(publishSite(created.id, { ...approval, approved: false }), /approval/);
  await assert.rejects(publishSite(created.id, { ...approval, draftId: "stale" }), /Draft changed/);
  const published = await publishSite(created.id, approval);
  assert.ok(published.publicUrl);
  await assert.rejects(publishSite(created.id, approval), /Live website changed/);
  const unverified = await createSite(input(false)), other = await draft(unverified.id);
  await assert.rejects(publishSite(unverified.id, { ...approval, draftId: other.websiteProject!.id }), /quality checks/);
});
test("public pages and rollback keep the approved snapshot while a new private draft is reviewed", async () => {
  const created = await createSite(input()), first = await draft(created.id);
  const live = await publishSite(created.id, { approved: true, concept: "editorial", draftId: first.websiteProject!.id, expectedLiveReleaseId: null });
  const original = await (await servePage(first.websiteProject!.publicSlug, [], false)).text();
  await updateSite(created.id, { expectedRevision: live.revision, profile: { businessName: "Changed business name" } });
  const second = await draft(created.id);
  assert.equal(await (await servePage(first.websiteProject!.publicSlug, [], false)).text(), original);
  assert.match(await (await servePage(second.websiteProject!.privateToken, [], true, "aura")).text(), /Changed business name/);
  const replacement = await publishSite(created.id, { approved: true, concept: "aura", draftId: second.websiteProject!.id, expectedLiveReleaseId: live.liveReleaseId });
  const restored = await rollbackSite(created.id, { releaseId: live.liveReleaseId, expectedLiveReleaseId: replacement.liveReleaseId });
  assert.equal(restored.liveReleaseId, live.liveReleaseId);
  await assert.rejects(rollbackSite(created.id, { releaseId: replacement.liveReleaseId, expectedLiveReleaseId: replacement.liveReleaseId }), /Live website changed/);
});
test("generated action links open client services, with honest contact fallback and no app dependencies", async () => {
  const created = await createSite({ ...input(), actions: { booking: "https://client.example.com/contact" } });
  const saved = await draft(created.id);
  const page = await servePage(saved.websiteProject!.privateToken, [], true);
  const html = await page.text();
  assert.match(html, /https:\/\/client\.example\.com\/contact/);
  assert.match(html, /Contact the team/);
  assert.ok(!html.includes("action:") && !html.includes("data-everonn-action") && !html.includes("#everonn-request"));
  assert.match(page.headers.get("Content-Security-Policy")!, /script-src 'none'/);
  assert.equal(page.headers.get("X-Robots-Tag"), "noindex, nofollow");
  await assert.rejects(servePage(saved.websiteProject!.privateToken + "invalid", [], true), /not found/);
});
test("every exported internal link resolves to an included HTML file, including nested service routes", async () => {
  const created = await createSite(input()), saved = await draft(created.id);
  await assert.rejects(async () => exportSite(saved), /Publish/);
  await publishSite(created.id, { approved: true, concept: "momentum", draftId: saved.websiteProject!.id, expectedLiveReleaseId: null });
  const bundle = exportSite(await readSite(created.id));
  const files = new Set(bundle.pages.map((page) => page.path));
  assert.equal(files.size, saved.profile.services.length + 4);
  for (const page of bundle.pages) {
    assert.ok(!page.html.includes("/preview/") && !page.html.includes("/sites/"));
    for (const [, href] of page.html.matchAll(/href="([^"]*)"/g)) {
      if (/^(https?:|mailto:|tel:|#)/.test(href)) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(page.path), href.split("#")[0]));
      assert.ok(files.has(resolved), page.path + " has broken link " + href);
    }
  }
});
test("the SQL migration is repeatable, private, and prevents duplicate public slugs", async () => {
  const db = new PGlite();
  try {
    const sql = await readFile(path.join(process.cwd(), "database/schema.sql"), "utf8");
    await db.exec(sql); await db.exec(sql);
    await db.query("insert into waas.records(key,payload) values ($1,$2::jsonb)", ["sites/one", JSON.stringify({ websiteProject: { publicSlug: "unique" } })]);
    await assert.rejects(db.query("insert into waas.records(key,payload) values ($1,$2::jsonb)", ["sites/two", JSON.stringify({ websiteProject: { publicSlug: "unique" } })]), /duplicate/);
    const permissions = await db.query<{ acl: string }>("select nspacl::text as acl from pg_namespace where nspname = 'waas'");
    assert.ok(!/(?:^|[,{}])=/.test(permissions.rows[0].acl), "The PUBLIC role has no schema ACL.");
  } finally { await db.close(); }
});
test("the SDK works through the actual service handler and propagates authentication and revision errors", async () => {
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    const request = new Request(url, init);
    return handleApi(request, new URL(request.url).pathname.split("/").slice(4));
  }) as typeof fetch;
  const client = createWaasClient({ baseUrl: "http://localhost:3000", apiKey: process.env.WAAS_API_KEY!, fetch: transport });
  const created = await client.createSite(input());
  assert.equal((await client.getSite(created.id)).id, created.id);
  const changed = await client.updateSite(created.id, { expectedRevision: created.revision, preferences: { brief: "Use generous spacing and clear service navigation." } });
  assert.notEqual(changed.revision, created.revision);
  await assert.rejects(client.updateSite(created.id, { expectedRevision: created.revision, profile: { location: "Stale" } }), (error: unknown) => error instanceof WaasError && error.status === 409);
  const wrong = createWaasClient({ baseUrl: "http://localhost:3000", apiKey: "wrong-key-with-more-than-thirty-two-characters", fetch: transport });
  await assert.rejects(wrong.listSites(), (error: unknown) => error instanceof WaasError && error.status === 401);
  const saved = await readRecord<WaasSite>("sites/" + created.id);
  assert.equal(saved!.websiteGeneration, undefined);
  assert.equal(siteSummary(saved!).preferences.brief, "Use generous spacing and clear service navigation.");
});
test("database record transactions roll back failed first inserts and stale updates without losing saved state", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(path.join(process.cwd(), "database/schema.sql"), "utf8"));
    const change = (key: string, callback: (current: { revision: string; value: string } | null) => { revision: string; value: string }) =>
      db.transaction((transaction) => changeDatabaseRecord({
        unsafe: async (query, parameters) => (await transaction.query<{ payload?: unknown }>(query, parameters)).rows,
      }, key, callback));
    await assert.rejects(change("sites/failed", () => { throw new Error("Rejected input"); }), /Rejected/);
    assert.equal((await db.query("select key from waas.records")).rows.length, 0);
    await change("sites/one", (current) => { assert.equal(current, null); return { revision: "one", value: "First" }; });
    await change("sites/one", (current) => { assert.equal(current!.value, "First"); return { revision: "two", value: "Second" }; });
    await assert.rejects(change("sites/one", (current) => { if (current!.revision !== "one") throw new Error("Stale revision"); return current!; }), /Stale/);
    const rows = await db.query<{ payload: { value: string } }>("select payload from waas.records where key = 'sites/one'");
    assert.equal(rows.rows[0].payload.value, "Second");
  } finally { await db.close(); }
});
test("SDK generation recovers a lost start response without starting a second paid build", async () => {
  let starts = 0, advances = 0;
  const job = { id: randomUUID(), status: "running", progress: { stage: "content", message: "Saved content" } };
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /\/api\/waas\/v1\/sites\/site-id\/build/);
    const operation = init?.body ? JSON.parse(String(init.body)).operation : undefined;
    if (operation === "start") { starts++; return new Response("", { status: 202 }); }
    if (operation === "advance") { advances++; return Response.json({ job: { ...job, status: "completed" }, project: { id: "draft", status: "generated" } }); }
    return Response.json({ job });
  }) as typeof fetch;
  const client = createWaasClient({ baseUrl: "https://studio.example.com", apiKey: process.env.WAAS_API_KEY!, fetch: transport });
  const result = await client.generate("site-id");
  assert.equal(result.project!.id, "draft"); assert.equal(starts, 1); assert.equal(advances, 1);
});
test("SDK resume uses the saved failed job and never creates a replacement build", async () => {
  const operations: string[] = [];
  const jobId = randomUUID();
  const transport = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (!init?.body) return Response.json({ job: { id: jobId, status: "failed", progress: { stage: "code", message: "Retry saved code" } } });
    const input = JSON.parse(String(init.body));
    operations.push(input.operation); assert.equal(input.jobId, jobId);
    return Response.json({ project: { id: "retained-draft", status: "generated" } });
  }) as typeof fetch;
  const client = createWaasClient({ baseUrl: "https://studio.example.com", apiKey: process.env.WAAS_API_KEY!, fetch: transport });
  assert.equal((await client.generate("site-id", { resume: true })).project!.id, "retained-draft");
  assert.deepEqual(operations, ["resume"]);
});

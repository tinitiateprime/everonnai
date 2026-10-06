import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { ProjectGitHubClient, repositoryLocation, repositoryPath } from "@/features/project-workspace/github";
import { catalogFor, repositorySummary, repositoryToken, describeDocument } from "@/features/project-workspace/repositories";
import { encryptProviderPayload } from "@/lib/provider-credentials";
import { createProjectRepositoryDatabase, projectRepositoryStore } from "@/lib/project-repository-store";
import { createAppRecords, type AppQuery } from "@/lib/app-records";
import { createDemoWorkspace } from "@/features/everonn/demo-data";
import type { RepositoryRecord } from "@/features/project-workspace/types";

const sha = "a".repeat(40);
const secret = "isolated-encryption-key-32-characters";
const record = (workspaceId = "customer-a"): RepositoryRecord => ({ id: randomUUID(), workspaceId, revision: "", createdAt: new Date().toISOString(), owner: "acme", name: "project", branch: "main", scopePath: "", treeSha: sha, syncedAt: new Date().toISOString(), private: true, url: "https://github.com/acme/project", files: [{ path: "README.md", sha, size: 20 }], assets: [] });
const tree = [
  { path: "README.md", type: "blob", mode: "100644", sha, size: 20 },
  { path: "docs/flow.mmd", type: "blob", mode: "100644", sha, size: 20 },
  { path: "docs/linked.md", type: "blob", mode: "120000", sha, size: 20 },
  { path: "node_modules/package/README.md", type: "blob", mode: "100644", sha, size: 20 },
  { path: ".env.local", type: "blob", mode: "100644", sha, size: 20 },
  { path: "images/logo.png", type: "blob", mode: "100644", sha, size: 20 },
];

test("GitHub inputs cannot select alternate hosts, credentials, arbitrary URLs or traversed paths", () => {
  assert.deepEqual(repositoryLocation("https://github.com/acme/project.git"), { owner: "acme", name: "project", url: "https://github.com/acme/project" });
  for (const value of ["http://github.com/acme/project", "https://localhost/acme/project", "https://github.com.evil.test/acme/project", "https://user:token@github.com/acme/project", "https://github.com:8443/acme/project", "https://github.com/acme/project?token=secret", "https://github.com/acme/project/tree/main/docs"]) assert.throws(() => repositoryLocation(value));
  for (const value of ["../README.md", "/README.md", "docs/../README.md", "docs\\README.md", "docs/README.md\0"]) assert.throws(() => repositoryPath(value));
});

test("GitHub snapshots fetch only fixed API endpoints and filter docs, assets, generated folders and symlinks", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    return Response.json(url.includes("/git/trees/") ? { sha, tree, truncated: false } : { default_branch: "main", private: true });
  };
  const snapshot = await new ProjectGitHubClient(transport).snapshot("https://github.com/acme/project", "", "", "fake-github-token");
  assert.deepEqual(snapshot.files.map((item) => item.path), ["docs/flow.mmd", "README.md"]);
  assert.deepEqual(snapshot.assets.map((item) => item.path), ["images/logo.png"]);
  assert.ok(calls.every((call) => call.url.startsWith("https://api.github.com/repos/acme/project") && call.init?.redirect === "error"));
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer fake-github-token");
  const scoped = await new ProjectGitHubClient(transport).snapshot("https://github.com/acme/project", "main", "docs", "fake-github-token");
  assert.deepEqual(scoped.files.map((item) => item.path), ["docs/flow.mmd"]);
  assert.deepEqual(scoped.assets, [], "A documentation folder cannot expose images outside its scope");
});

test("truncated trees and oversized documents fail instead of silently importing incomplete documentation", async () => {
  const make = (value: unknown) => new ProjectGitHubClient(async (input) => Response.json(String(input).includes("/git/trees/") ? value : { default_branch: "main" }));
  await assert.rejects(make({ sha, tree, truncated: true }).snapshot("https://github.com/acme/project", "", ""), /too large/);
  await assert.rejects(make({ sha, tree: [{ ...tree[0], size: 3 * 1024 * 1024 }], truncated: false }).snapshot("https://github.com/acme/project", "", ""), /2 MB/);
});

test("GitHub failures are useful and do not forward provider bodies or secrets", async () => {
  const client = new ProjectGitHubClient(async () => Response.json({ message: "PRIVATE_PROVIDER_DETAIL fake-github-token" }, { status: 403 }));
  await assert.rejects(client.snapshot("https://github.com/acme/project", "", "", "fake-github-token"), (failure: unknown) => {
    const error = failure as Error & { status: number }; assert.equal(error.status, 429); assert.doesNotMatch(error.message, /PRIVATE_PROVIDER_DETAIL|fake-github-token/); return true;
  });
});

test("credentials are bound to the customer workspace and repository, and never enter summary/catalog responses", () => {
  const row = record();
  row.credential = encryptProviderPayload({ workspaceId: row.workspaceId, repositoryId: row.id, token: "fake-github-token" }, secret);
  assert.equal(repositoryToken(row, secret), "fake-github-token");
  assert.throws(() => repositoryToken({ ...row, workspaceId: "customer-b" }, secret), /scope mismatch/);
  assert.throws(() => repositoryToken({ ...row, id: randomUUID() }, secret), /scope mismatch/);
  assert.doesNotMatch(JSON.stringify(repositorySummary(row)), /credential|ciphertext|fake-github-token/);
  assert.doesNotMatch(JSON.stringify(catalogFor(row)), /credential|ciphertext|fake-github-token/);
  const document = describeDocument("docs/TASKS.md", "# Tasks\n- [x] Done\n- [ ] Next\n```md\n- [ ] Example only\n```\n", row.syncedAt);
  assert.deepEqual(document.tasks, { complete: 1, total: 2 });
});

test("local repository persistence retains encrypted tokens and prevents duplicates, stale writes and cross-customer reads", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "everonn-project-store-"));
  const keys = ["EVERONN_PROJECTS_FILE", "SUPABASE_DB_URL", "EVERONN_REQUIRE_DURABLE_STORAGE", "AWS_LAMBDA_FUNCTION_NAME", "NETLIFY", "NETLIFY_BLOBS_CONTEXT"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.EVERONN_PROJECTS_FILE = path.join(directory, "projects.json");
  try {
    const row = record(); row.credential = encryptProviderPayload({ workspaceId: row.workspaceId, repositoryId: row.id, token: "fake-github-token" }, secret);
    await projectRepositoryStore.save(row, null);
    const saved = (await projectRepositoryStore.list(row.workspaceId))[0];
    assert.equal(repositoryToken(saved, secret), "fake-github-token");
    assert.deepEqual(await projectRepositoryStore.list("customer-b"), []);
    assert.doesNotMatch(await readFile(process.env.EVERONN_PROJECTS_FILE, "utf8"), /fake-github-token/);
    await assert.rejects(projectRepositoryStore.save({ ...row, id: randomUUID() }, null), /already connected/);
    await projectRepositoryStore.save({ ...saved, treeSha: "b".repeat(40) }, saved.revision);
    await assert.rejects(projectRepositoryStore.save(saved, saved.revision), /changed/);
    await assert.rejects(projectRepositoryStore.remove("customer-b", saved.id, saved.revision), /changed/);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("everonn-project-store-"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("PostgreSQL repository migration preserves existing stores, enforces scope/CAS and denies browser and service roles", async () => {
  const db = new PGlite();
  const q: AppQuery = async <T extends Record<string, unknown>>(sql: string, parameters: unknown[] = []) => (await db.query<T>(sql, parameters)).rows;
  const migration = (name: string) => readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8");
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE public.other_project(id text); INSERT INTO public.other_project VALUES('keep');");
    for (const name of ["202610030001_everonn_usage.sql", "202610040002_everonn_app.sql", "202610040003_everonn_relational.sql"]) await db.exec(await migration(name));
    const seed = createDemoWorkspace();
    await createAppRecords(q).write("workspaces/primary", seed, { new: true });
    const before = (await db.query("SELECT * FROM everonn.app_records")).rows;
    const source = await migration("202610060004_project_repositories.sql");
    await db.exec(source);
    const row = record(seed.workspaceId), store = createProjectRepositoryDatabase(q);
    await store.save(row, null);
    let saved = (await store.list(seed.workspaceId))[0];
    assert.equal(saved.id, row.id);
    assert.deepEqual(await store.list("different-customer"), []);
    await assert.rejects(store.save({ ...row, id: randomUUID() }, null), /already connected/);
    await store.save({ ...saved, treeSha: "b".repeat(40) }, saved.revision);
    await assert.rejects(store.save(saved, saved.revision), /changed/);
    await assert.rejects(store.remove("different-customer", row.id, saved.revision), /changed/);
    saved = (await store.list(seed.workspaceId))[0];
    await db.exec(source);
    assert.equal((await createProjectRepositoryDatabase(q).list(seed.workspaceId))[0].treeSha, saved.treeSha);
    assert.deepEqual((await db.query("SELECT * FROM everonn.app_records")).rows, before);
    assert.deepEqual((await db.query("SELECT * FROM public.other_project")).rows, [{ id: "keep" }]);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const [result] = (await db.query<{ allowed: boolean }>("SELECT has_table_privilege($1,'everonn.project_repositories','SELECT') AS allowed", [role])).rows;
      assert.equal(result.allowed, false);
    }
    await store.remove(seed.workspaceId, row.id, saved.revision);
    assert.deepEqual(await store.list(seed.workspaceId), []);
    for (let index = 0; index < 12; index++) await store.save({ ...record(seed.workspaceId), name: `project-${index}` }, null);
    await assert.rejects(store.save({ ...record(seed.workspaceId), name: "project-over-limit" }, null), /12-repository limit/);
  } finally { await db.close(); }
});

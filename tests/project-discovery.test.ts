import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { embeddedDatabase } from "../lib/platform/database";
import { migrateDatabase } from "../lib/platform/migrations";
import { createSession } from "../lib/auth/sessions";
import {
  createTenant,
  createProject,
  projectTransaction,
  projectDetail,
} from "../lib/projects/service";
import {
  LocalObjectStore,
  loadArtifact,
  type ObjectStore,
} from "../lib/storage/artifacts";
import {
  startScan,
  runScanBatch,
  scanDetail,
  scanPages,
  freezeSnapshot,
  snapshotDetail,
  snapshotPage,
  pauseScan,
  listScans,
  type DiscoveryRuntime,
} from "../lib/discovery/service";
import { platformRequest } from "../lib/platform/http";
import type { safeResource } from "../lib/network";

const origin = "https://discovery-business.example.com";
function fixture(total = 7) {
  let version = 1,
    failedPage = -1;
  const calls = new Map<string, number>();
  const resource: typeof safeResource = async (url, options) => {
    if (options?.signal?.aborted) throw new Error("aborted");
    const route = new URL(url).pathname;
    calls.set(route, (calls.get(route) ?? 0) + 1);
    let html = "",
      status = 200,
      contentType = "text/html";
    if (route === "/robots.txt") {
      contentType = "text/plain";
      html = "User-agent: *\nAllow: /\nDisallow: /private\n";
    } else if (route.includes("sitemap")) {
      status = 404;
      html = "";
    } else {
      const index = route === "/" ? 0 : Number(route.slice(6));
      if (index === failedPage) status = 503;
      html = `<html><head><title>Business ${index} v${version}</title></head><body><h1>Page ${index}</h1><p>${"Complete archived business information. ".repeat(450)}FULL_TEXT_END_v${version}</p><a href="mailto:owner@example.com">Email</a>${Array.from({ length: total }, (_, n) => `<a href="${n ? `/page-${n}` : "/"}">Page ${n}</a>`).join("")}</body></html>`;
    }
    return {
      url,
      status,
      headers: { "content-type": contentType },
      body: Buffer.from(html),
    };
  };
  const runtime: DiscoveryRuntime = {
    resource,
    browser: null,
    evidenceMode: "fixture",
    settings: { maxPages: 3, batchPages: 2, batchMs: 10_000, concurrency: 1 },
  };
  return {
    runtime,
    calls,
    setVersion: (n: number) => {
      version = n;
    },
    failPage: (n: number) => {
      failedPage = n;
    },
  };
}
test("project discovery persists source evidence, isolates tenants and freezes exact revisions", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "everonn-discovery-test-"),
  );
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "test",
    PLATFORM_LOCAL_MODE: "1",
    AUTH_BASE_URL: "http://localhost:3000",
  });
  const db = await embeddedDatabase(),
    store = new LocalObjectStore(path.join(directory, "objects"));
  t.after(async () => {
    await db.close();
    for (const key of Object.keys(process.env))
      if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("everonn-discovery-test-"));
    await rm(resolved, { recursive: true, force: true });
  });
  await migrateDatabase(db);
  const session = await createSession(db, {
    issuer: "urn:discovery:test",
    subject: "alice",
    displayName: "Alice",
  });
  const other = await createSession(db, {
    issuer: "urn:discovery:test",
    subject: "bob",
    displayName: "Bob",
  });
  const viewer = await createSession(db, {
    issuer: "urn:discovery:test",
    subject: "viewer",
    displayName: "Viewer",
  });
  const tenant = await createTenant(db, session.user, "Discovery workspace");
  const anotherTenant = await createTenant(db, other.user, "Other workspace");
  const project = await createProject(db, session.user, tenant.id, {
    name: "Discovery business",
    sourceUrl: origin,
  });
  const otherProject = await createProject(db, other.user, anotherTenant.id, {
    name: "Discovery business",
    sourceUrl: origin,
  });
  await db.transaction(async (client) => {
    await client.query(
      "INSERT INTO everonn_platform.tenant_memberships (id,tenant_id,user_id,role) VALUES ($1,$2,$3,'member')",
      [randomUUID(), tenant.id, viewer.user.id],
    );
    await client.query(
      "INSERT INTO everonn_platform.project_memberships (id,tenant_id,project_id,user_id,permissions) VALUES ($1,$2,$3,$4,ARRAY['view'])",
      [randomUUID(), tenant.id, project.id, viewer.user.id],
    );
  });
  const site = fixture();
  const requestKey = randomUUID();
  const run = await startScan(
    db,
    session.user,
    project.id,
    requestKey,
    site.runtime,
  );
  assert.equal(
    (await startScan(db, session.user, project.id, requestKey, site.runtime))
      .id,
    run.id,
  );
  await t.test(
    "bounded scans archive full text and immutable raw bytes with hashes and capture times",
    async () => {
      const progress = await runScanBatch(
        db,
        store,
        session.user,
        project.id,
        run.id,
        {},
        undefined,
        site.runtime,
      );
      assert.equal(progress.status, "paused");
      assert.equal(progress.coverage.captured, 2);
      await assert.rejects(
        freezeSnapshot(db, store, session.user, project.id, run.id),
        /incomplete coverage/,
      );
      const partial = await freezeSnapshot(
        db,
        store,
        session.user,
        project.id,
        run.id,
        true,
      );
      assert.equal(partial.coverage.captured, 2);
      assert.equal(partial.coverage.complete, false);
      assert.equal(
        (
          await freezeSnapshot(
            db,
            store,
            session.user,
            project.id,
            run.id,
            true,
          )
        ).id,
        partial.id,
      );
      const frozen = await snapshotDetail(
        db,
        store,
        session.user,
        project.id,
        partial.id,
      );
      const page = frozen.pages.find((p) => p.captureId)!;
      const content = await snapshotPage(
        db,
        store,
        session.user,
        project.id,
        partial.id,
        page.captureId!,
      );
      assert.ok(content.evidence.page.text.length > 12000);
      assert.match(content.evidence.page.text, /FULL_TEXT_END_v1/);
      assert.equal(content.capture.summary.truncated, true);
      assert.equal(content.capture.summary.text.length, 12000);
      assert.ok(
        Date.parse(content.capture.capturedAt) >=
          Date.parse(content.capture.captureStartedAt),
      );
      const raw = await loadArtifact(
        db,
        store,
        session.user,
        project.id,
        content.capture.rawObjectId,
      );
      assert.equal(raw.record.sha256, content.capture.rawSha256);
      assert.match(Buffer.from(raw.bytes).toString(), /FULL_TEXT_END_v1/);
      assert.equal(
        (await projectDetail(db, session.user, project.id)).artifacts.length,
        0,
      );
    },
  );
  const firstSnapshot = (
    await db.transaction((client) =>
      client.query<{ id: string }>(
        "SELECT id FROM everonn_platform.source_snapshots WHERE crawl_run_id=$1",
        [run.id],
      ),
    )
  ).rows[0].id;
  await t.test(
    "resume, page-limit extension and recrawl preserve earlier frozen evidence",
    async () => {
      let progress = await runScanBatch(
        db,
        store,
        session.user,
        project.id,
        run.id,
        {},
        undefined,
        site.runtime,
      );
      assert.equal(progress.status, "limit");
      assert.equal(progress.coverage.captured, 3);
      assert.equal(progress.coverage.canExtend, true);
      progress = await runScanBatch(
        db,
        store,
        session.user,
        project.id,
        run.id,
        { extend: true },
        undefined,
        site.runtime,
      );
      while (progress.status !== "complete")
        progress = await runScanBatch(
          db,
          store,
          session.user,
          project.id,
          run.id,
          { extend: progress.status === "limit" },
          undefined,
          site.runtime,
        );
      assert.equal(progress.coverage.captured, 7);
      assert.equal(progress.coverage.complete, true);
      for (let index = 0; index < 7; index++)
        assert.equal(site.calls.get(index ? `/page-${index}` : "/"), 1);
      const frozen = await freezeSnapshot(
        db,
        store,
        session.user,
        project.id,
        run.id,
      );
      assert.equal(frozen.coverage.complete, true);
      assert.equal(frozen.coverage.captured, 7);
      assert.equal(
        (
          await snapshotDetail(
            db,
            store,
            session.user,
            project.id,
            firstSnapshot,
          )
        ).snapshot.coverage.captured,
        2,
      );
      site.setVersion(2);
      const newer = await startScan(
        db,
        session.user,
        project.id,
        randomUUID(),
        site.runtime,
      );
      await runScanBatch(
        db,
        store,
        session.user,
        project.id,
        newer.id,
        {},
        undefined,
        site.runtime,
      );
      const old = await snapshotDetail(
        db,
        store,
        session.user,
        project.id,
        firstSnapshot,
      );
      const oldPage = await snapshotPage(
        db,
        store,
        session.user,
        project.id,
        firstSnapshot,
        old.pages.find((p) => p.captureId)!.captureId!,
      );
      assert.match(oldPage.evidence.page.text, /FULL_TEXT_END_v1/);
      assert.doesNotMatch(oldPage.evidence.page.text, /FULL_TEXT_END_v2/);
      await assert.rejects(
        runScanBatch(
          db,
          store,
          session.user,
          project.id,
          run.id,
          {},
          undefined,
          site.runtime,
        ),
        /has finished/,
      );
    },
  );
  await t.test(
    "RLS, composite ownership, immutable SQL evidence and viewer permissions apply to every route",
    async () => {
      await assert.rejects(
        listScans(db, other.user, project.id),
        /do not have access/,
      );
      await assert.rejects(
        scanDetail(db, other.user, otherProject.id, run.id),
        /do not have access/,
      );
      assert.ok((await listScans(db, viewer.user, project.id)).length);
      await assert.rejects(
        startScan(db, viewer.user, project.id, randomUUID(), site.runtime),
        /do not have access/,
      );
      await assert.rejects(
        pauseScan(db, viewer.user, project.id, run.id),
        /do not have access/,
      );
      await assert.rejects(
        freezeSnapshot(db, store, viewer.user, project.id, run.id, true),
        /do not have access/,
      );
      await assert.rejects(
        snapshotDetail(db, store, other.user, otherProject.id, firstSnapshot),
        /do not have access/,
      );
      await assert.rejects(
        snapshotPage(
          db,
          store,
          session.user,
          project.id,
          randomUUID(),
          randomUUID(),
        ),
        /not part/,
      );
      for (const table of [
        "source_snapshots",
        "page_captures",
        "snapshot_pages",
      ])
        await assert.rejects(
          db.transaction((client) =>
            client.query(`DELETE FROM everonn_platform.${table}`),
          ),
          /immutable/,
        );
      await assert.rejects(
        projectTransaction(db, session.user, project.id, true, (client) =>
          client.query(
            "UPDATE everonn_platform.crawl_runs SET input_url='https://changed.example.com' WHERE id=$1",
            [run.id],
          ),
        ),
        /permission denied/,
      );
      const request = (
        route: string,
        method = "GET",
        body?: unknown,
        cookie = session.token,
      ) =>
        new Request(
          `http://localhost:3000/api/platform/projects/${project.id}/${route}`,
          {
            method,
            headers: {
              Origin: "http://localhost:3000",
              Cookie: `everonn-session=${cookie}`,
              "Content-Type": "application/json",
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          },
        );
      const deps = { database: db, store, discovery: site.runtime };
      assert.equal(
        (
          await platformRequest(
            request("discovery-runs"),
            ["projects", project.id, "discovery-runs"],
            deps,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await platformRequest(
            request("discovery-runs", "POST", {
              requestKey: randomUUID(),
              inputUrl: "http://127.0.0.1",
            }),
            ["projects", project.id, "discovery-runs"],
            deps,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await platformRequest(
            request(
              "discovery-runs",
              "POST",
              { requestKey: randomUUID() },
              viewer.token,
            ),
            ["projects", project.id, "discovery-runs"],
            deps,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await platformRequest(
            request("discovery-runs?offset=-1"),
            ["projects", project.id, "discovery-runs"],
            deps,
          )
        ).status,
        400,
      );
    },
  );
  await t.test(
    "request interruption retains accepted pages and resumes without fetching them again",
    async () => {
      const interruptedSite = fixture(4),
        controller = new AbortController();
      const normal = interruptedSite.runtime.resource!;
      interruptedSite.runtime.resource = async (url, options) => {
        if (new URL(url).pathname === "/page-1") controller.abort();
        return normal(url, options);
      };
      const scan = await startScan(
        db,
        session.user,
        project.id,
        randomUUID(),
        interruptedSite.runtime,
      );
      let result = await runScanBatch(
        db,
        store,
        session.user,
        project.id,
        scan.id,
        {},
        controller.signal,
        interruptedSite.runtime,
      );
      assert.equal(result.status, "paused");
      assert.equal(result.coverage.captured, 1);
      interruptedSite.runtime.resource = normal;
      result = await runScanBatch(
        db,
        store,
        session.user,
        project.id,
        scan.id,
        { extend: true },
        undefined,
        interruptedSite.runtime,
      );
      assert.equal(result.coverage.captured, 3);
      assert.equal(interruptedSite.calls.get("/"), 1);
    },
  );
  await t.test(
    "failed object uploads never mark pages captured; retry resumes the durable frontier",
    async () => {
      const failureSite = fixture(3);
      const scan = await startScan(
        db,
        session.user,
        project.id,
        randomUUID(),
        failureSite.runtime,
      );
      let failed = false;
      const faulty: ObjectStore = {
        get: (key, size) => store.get(key, size),
        put: async (key, bytes) => {
          if (!failed && Buffer.from(bytes).toString().startsWith("<html>")) {
            failed = true;
            throw new Error("Injected storage outage");
          }
          await store.put(key, bytes);
        },
      };
      await assert.rejects(
        runScanBatch(
          db,
          faulty,
          session.user,
          project.id,
          scan.id,
          {},
          undefined,
          failureSite.runtime,
        ),
        /could not finish/,
      );
      const failedRun = await scanDetail(db, session.user, project.id, scan.id);
      assert.equal(failedRun.status, "failed");
      assert.equal(failedRun.coverage.captured, 0);
      const resumed = await runScanBatch(
        db,
        store,
        session.user,
        project.id,
        scan.id,
        {},
        undefined,
        failureSite.runtime,
      );
      assert.equal(resumed.coverage.captured, 2);
      assert.equal(
        (
          await scanPages(db, store, session.user, project.id, scan.id)
        ).pages.filter((p) => p.outcome === "captured").length,
        2,
      );
    },
  );
  await t.test(
    "active leases reject overlap and expiry fences late processes while recovering accepted captures",
    async () => {
      const leasedSite = fixture(5);
      const normal = leasedSite.runtime.resource!;
      let release!: () => void, entered!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocked: DiscoveryRuntime = {
        ...leasedSite.runtime,
        resource: async (url, options) => {
          if (new URL(url).pathname === "/page-1") {
            entered();
            await gate;
          }
          return normal(url, options);
        },
      };
      const scan = await startScan(
        db,
        session.user,
        project.id,
        randomUUID(),
        blocked,
      );
      const oldBatch = runScanBatch(
        db,
        store,
        session.user,
        project.id,
        scan.id,
        {},
        undefined,
        blocked,
      );
      const observed = oldBatch.catch((error) => error); // Attach before intentionally invalidating the lease.
      await enteredPromise;
      await assert.rejects(
        runScanBatch(
          db,
          store,
          session.user,
          project.id,
          scan.id,
          {},
          undefined,
          leasedSite.runtime,
        ),
        /already running/,
      );
      await assert.rejects(
        startScan(db, session.user, project.id, randomUUID(), blocked),
        /already running/,
      );
      await assert.rejects(
        freezeSnapshot(db, store, session.user, project.id, scan.id, true),
        /Pause the scan/,
      );
      await db.transaction((client) =>
        client.query(
          "UPDATE everonn_platform.crawl_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
          [scan.id],
        ),
      );
      const resumed = await runScanBatch(
        db,
        store,
        session.user,
        project.id,
        scan.id,
        { extend: true },
        undefined,
        leasedSite.runtime,
      );
      assert.equal(resumed.coverage.captured, 3);
      release();
      assert.ok((await observed) instanceof Error);
      const final = await scanDetail(db, session.user, project.id, scan.id);
      assert.equal(final.status, resumed.status);
      assert.equal(final.coverage.captured, 3);
      assert.equal(leasedSite.calls.get("/"), 1);
    },
  );
  await t.test(
    "captures committed after the last durable checkpoint are reconciled without refetch",
    async () => {
      const gapSite = fixture(5);
      const scan = await startScan(
        db,
        session.user,
        project.id,
        randomUUID(),
        gapSite.runtime,
      );
      let injected = false;
      const checkpointFailure: ObjectStore = {
        get: (key, size) => store.get(key, size),
        put: async (key, bytes) => {
          const text = Buffer.from(bytes).toString();
          if (text.startsWith('{"id":')) {
            const value = JSON.parse(text);
            if (!injected && value.result && value.seen?.length === 2) {
              injected = true;
              throw new Error("Checkpoint failed after capture commit");
            }
          }
          await store.put(key, bytes);
        },
      };
      await assert.rejects(
        runScanBatch(
          db,
          checkpointFailure,
          session.user,
          project.id,
          scan.id,
          {},
          undefined,
          gapSite.runtime,
        ),
        /could not finish/,
      );
      assert.equal(
        (await scanDetail(db, session.user, project.id, scan.id)).coverage
          .captured,
        2,
      );
      const resumed = await runScanBatch(
        db,
        store,
        session.user,
        project.id,
        scan.id,
        { extend: true },
        undefined,
        gapSite.runtime,
      );
      assert.equal(resumed.coverage.captured, 4);
      assert.equal(gapSite.calls.get("/"), 1);
      assert.equal(gapSite.calls.get("/page-1"), 1);
    },
  );
  await t.test(
    "a scan changed during manifest upload rejects the freeze rather than changing snapshot requirements",
    async () => {
      const raceSite = fixture(5);
      const scan = await startScan(
        db,
        session.user,
        project.id,
        randomUUID(),
        raceSite.runtime,
      );
      await runScanBatch(
        db,
        store,
        session.user,
        project.id,
        scan.id,
        {},
        undefined,
        raceSite.runtime,
      );
      let injected = false;
      const racedStore: ObjectStore = {
        get: (key, size) => store.get(key, size),
        put: async (key, bytes) => {
          const text = Buffer.from(bytes).toString();
          if (
            !injected &&
            text.startsWith('{"version":1,') &&
            text.includes('"crawlRevision"')
          ) {
            injected = true;
            await runScanBatch(
              db,
              store,
              session.user,
              project.id,
              scan.id,
              { extend: true },
              undefined,
              raceSite.runtime,
            );
          }
          await store.put(key, bytes);
        },
      };
      await assert.rejects(
        freezeSnapshot(db, racedStore, session.user, project.id, scan.id, true),
        /changed while the snapshot/,
      );
      assert.equal(
        (await scanDetail(db, session.user, project.id, scan.id)).coverage
          .captured,
        4,
      );
      const frozen = await freezeSnapshot(
        db,
        store,
        session.user,
        project.id,
        scan.id,
        true,
      );
      assert.equal(frozen.coverage.captured, 4);
    },
  );
  await t.test(
    "skipped pages cannot pass coverage; retry failures and corruption remain visible",
    async () => {
      const skippedSite = fixture(3);
      skippedSite.failPage(1);
      skippedSite.runtime.settings!.maxPages = 10;
      const scan = await startScan(
        db,
        session.user,
        project.id,
        randomUUID(),
        skippedSite.runtime,
      );
      let current = await runScanBatch(
        db,
        store,
        session.user,
        project.id,
        scan.id,
        {},
        undefined,
        skippedSite.runtime,
      );
      while (current.status !== "complete")
        current = await runScanBatch(
          db,
          store,
          session.user,
          project.id,
          scan.id,
          {},
          undefined,
          skippedSite.runtime,
        );
      assert.equal(current.coverage.complete, false);
      assert.equal(current.coverage.skipped, 1);
      await assert.rejects(
        freezeSnapshot(db, store, session.user, project.id, scan.id),
        /incomplete coverage/,
      );
      skippedSite.failPage(-1);
      current = await runScanBatch(
        db,
        store,
        session.user,
        project.id,
        scan.id,
        { retrySkipped: true },
        undefined,
        skippedSite.runtime,
      );
      assert.equal(current.coverage.complete, true);
      assert.equal(current.coverage.captured, 3);
      const snapshot = await freezeSnapshot(
        db,
        store,
        session.user,
        project.id,
        scan.id,
      );
      const manifest = await loadArtifact(
        db,
        store,
        session.user,
        project.id,
        snapshot.manifestObjectId,
      );
      await writeFile(
        path.join(directory, "objects", ...manifest.record.key.split("/")),
        Buffer.alloc(manifest.bytes.byteLength, 120),
      );
      await assert.rejects(
        snapshotDetail(db, store, session.user, project.id, snapshot.id),
        /integrity verification/,
      );
    },
  );
  await t.test(
    "database and objects survive a process-style restart with a resumable partial scan",
    async () => {
      const restartSite = fixture(4);
      let durable = await embeddedDatabase(path.join(directory, "restart-db"));
      try {
        await migrateDatabase(durable);
        const identity = await createSession(durable, {
          issuer: "urn:discovery:test",
          subject: "restart",
          displayName: "Restart owner",
        });
        const workspace = await createTenant(
          durable,
          identity.user,
          "Persistent workspace",
        );
        const item = await createProject(durable, identity.user, workspace.id, {
          name: "Persistent source",
          sourceUrl: origin,
        });
        const scan = await startScan(
          durable,
          identity.user,
          item.id,
          randomUUID(),
          restartSite.runtime,
        );
        await runScanBatch(
          durable,
          store,
          identity.user,
          item.id,
          scan.id,
          {},
          undefined,
          restartSite.runtime,
        );
        const frozen = await freezeSnapshot(
          durable,
          store,
          identity.user,
          item.id,
          scan.id,
          true,
        );
        await durable.close();
        durable = await embeddedDatabase(path.join(directory, "restart-db"));
        assert.equal(
          (await scanDetail(durable, identity.user, item.id, scan.id)).coverage
            .captured,
          2,
        );
        assert.equal(
          (
            await snapshotDetail(
              durable,
              store,
              identity.user,
              item.id,
              frozen.id,
            )
          ).pages.filter((p) => p.captureId).length,
          2,
        );
        const continued = await runScanBatch(
          durable,
          store,
          identity.user,
          item.id,
          scan.id,
          { extend: true },
          undefined,
          restartSite.runtime,
        );
        assert.equal(continued.coverage.captured, 4);
        assert.equal(restartSite.calls.get("/"), 1);
      } finally {
        await durable.close();
      }
    },
  );
});

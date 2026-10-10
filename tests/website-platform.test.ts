import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { embeddedDatabase } from "../lib/platform/database";
import { migrateDatabase } from "../lib/platform/migrations";
import { createSession } from "../lib/auth/sessions";
import {
  createTenant,
  createProject,
  projectDetail,
} from "../lib/projects/service";
import { LocalObjectStore, loadArtifact } from "../lib/storage/artifacts";
import {
  startScan,
  runScanBatch,
  freezeSnapshot,
} from "../lib/discovery/service";
import {
  extractFacts,
  approveFacts,
  factSetDetail,
  createBlueprint,
  approveBlueprint,
  blueprintDetail,
} from "../lib/knowledge/service";
import {
  startBuild,
  runBuildStage,
  buildDetail,
  buildManifest,
  previewResponse,
  submitEnquiry,
  listEnquiries,
} from "../lib/builds/service";
import { validateDesign, createDesign } from "../lib/builds/design";
import { browserFixtureRuntime } from "../lib/discovery/testing";
import {
  recordBuildReview,
  listBuildReviews,
  buildReport,
} from "../lib/builds/reviews";

test("local workspace creates missing parent directories and three complete verified Next.js applications", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "everonn-website-pipeline-"),
  );
  const original = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "test",
    PLATFORM_LOCAL_MODE: "1",
    PLATFORM_TEST_OUTPUT: "1",
    PLATFORM_TEST_CRAWL_FIXTURE: "1",
    AUTH_BASE_URL: "http://localhost:3000",
  });
  const db = await embeddedDatabase(
      path.join(directory, "missing", "parents", "database"),
    ),
    store = new LocalObjectStore(path.join(directory, "objects"));
  t.after(async () => {
    await db.close();
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("everonn-website-pipeline-"));
    await rm(resolved, { recursive: true, force: true });
  });
  assert.equal(await migrateDatabase(db), 5);
  const { user } = await createSession(db, {
      issuer: "urn:pipeline:test",
      subject: "owner",
      displayName: "Owner",
    }),
    other = (
      await createSession(db, {
        issuer: "urn:pipeline:test",
        subject: "other",
        displayName: "Other",
      })
    ).user;
  const tenant = await createTenant(db, user, "Application workspace"),
    otherTenant = await createTenant(db, other, "Other workspace");
  const project = await createProject(db, user, tenant.id, {
      name: "Verified business",
      sourceUrl: "https://platform-discovery.example.com",
    }),
    otherProject = await createProject(db, other, otherTenant.id, {
      name: "Verified business",
    });
  const runtime = browserFixtureRuntime();
  runtime.settings = {
    maxPages: 40,
    batchPages: 40,
    batchMs: 10000,
    concurrency: 4,
  };
  const originalResource = runtime.resource!;
  runtime.resource = async (url, opts) => {
    const result = await originalResource(url, opts);
    if (
      result.headers["content-type"] === "text/html" &&
      !new URL(url).pathname.includes("sitemap")
    ) {
      result.status = 200;
      result.body = Buffer.from(
        `<html><head><title>${new URL(url).pathname === "/" ? "Verified business" : "Service page"}</title></head><body><h1>Verified business</h1><p>${"Critical complete source evidence. ".repeat(420)}FULL_SOURCE_END_MARKER ${"x".repeat(1500)}</p><a href="mailto:hello@example.com">Email</a><a href="/">Home</a><a href="/services/advice">Advice service</a></body></html>`,
      );
    }
    return result;
  };
  const scan = await startScan(db, user, project.id, randomUUID(), runtime);
  await runScanBatch(
    db,
    store,
    user,
    project.id,
    scan.id,
    {},
    undefined,
    runtime,
  );
  const snapshot = await freezeSnapshot(db, store, user, project.id, scan.id);
  const draftFacts = await extractFacts(
    db,
    store,
    user,
    project.id,
    snapshot.id,
  );
  const draft = await factSetDetail(db, store, user, project.id, draftFacts.id);
  const approvedFacts = await approveFacts(
    db,
    store,
    user,
    project.id,
    draftFacts.id,
    {
      decisions: draft.document.facts.map((f) => ({
        id: f.id,
        value: f.key === "business_name" ? "Verified business" : f.value,
        decision: f.value || f.required ? "confirm" : "omit",
      })),
    },
  );
  const draftBlueprint = await createBlueprint(
    db,
    store,
    user,
    project.id,
    approvedFacts.id,
  );
  const plan = await blueprintDetail(
    db,
    store,
    user,
    project.id,
    draftBlueprint.id,
  );
  await assert.rejects(
    approveBlueprint(db, store, user, project.id, draftBlueprint.id, {
      pages: [],
    }),
    /Every source page/,
  );
  const approved = await approveBlueprint(
    db,
    store,
    user,
    project.id,
    draftBlueprint.id,
    {
      pages: plan.document.pages.map((p) => ({
        id: p.id,
        path: p.path,
        outcome: p.outcome,
        target: p.target,
        reason: p.reason,
      })),
    },
  );
  assert.equal(
    (await factSetDetail(db, store, user, project.id, draftFacts.id)).record
      .status,
    "draft",
  );
  assert.equal(
    (await blueprintDetail(db, store, user, project.id, draftBlueprint.id))
      .record.status,
    "draft",
  );
  await assert.rejects(
    factSetDetail(db, store, other, otherProject.id, approvedFacts.id),
    /do not have access/,
  );
  await assert.rejects(
    db.transaction((client) =>
      client.query("DELETE FROM everonn_platform.fact_sets"),
    ),
    /immutable/,
  );
  await assert.rejects(
    db.transaction((client) =>
      client.query(
        "UPDATE everonn_platform.blueprint_revisions SET status='draft'",
      ),
    ),
    /immutable/,
  );
  await assert.rejects(
    Promise.resolve().then(() =>
      validateDesign({
        name: "Unsafe",
        rationale: "Unsafe test CSS must be rejected",
        navigation: "top",
        hero: "left",
        content: "article",
        css: "body{background:url(https://example.com/private)}".repeat(3),
      }),
    ),
    /unsupported external/,
  );
  const alternatives = (await projectDetail(db, user, project.id)).alternatives;
  for (const css of [
    ":root{--picture:url(https://example.com/private)}body{background:var(--picture)}",
    "body{background:u\\72l(https://example.com/private)}",
    '@\\69mport "https://example.com/private";body{color:red}',
  ]) {
    assert.throws(
      () =>
        validateDesign({
          name: "Unsafe",
          rationale: "Encoded URL must be rejected",
          navigation: "top",
          hero: "left",
          content: "article",
          css: css + " ".repeat(100),
        }),
      /unsupported external|safely parsed/,
    );
  }
  const seals: string[] = [];
  const readyIds: string[] = [];
  for (const alternative of alternatives) {
    await t.test(
      `alternative ${alternative.slot} compiles all approved pages and verifies its real enquiry backend`,
      async () => {
        const input = {
          blueprintId: approved.id,
          alternativeId: alternative.id,
          requestKey: randomUUID(),
        };
        const created = await startBuild(db, store, user, project.id, input);
        assert.equal(
          (await startBuild(db, store, user, project.id, input)).id,
          created.id,
        );
        await assert.rejects(
          startBuild(db, store, user, project.id, {
            ...input,
            alternativeId: alternatives.find(
              (row) => row.id !== alternative.id,
            )!.id,
          }),
          /different inputs/,
        );
        let result = await runBuildStage(
          db,
          store,
          user,
          project.id,
          created.id,
        );
        assert.equal(result.build.stage, 1);
        result = await runBuildStage(db, store, user, project.id, created.id);
        assert.equal(result.build.stage, 2);
        const { manifest } = await buildManifest(
          db,
          store,
          user,
          project.id,
          created.id,
        );
        assert.equal(
          manifest.routes.length,
          plan.document.pages.filter((p) => p.outcome === "render").length,
        );
        assert.equal(manifest.nextVersion, "16.3.8");
        if (alternative.slot === 1) {
          const executable = process.env.CHROMIUM_EXECUTABLE_PATH;
          process.env.CHROMIUM_EXECUTABLE_PATH = path.join(
            directory,
            "missing-chromium.exe",
          );
          try {
            const blocked = await runBuildStage(
              db,
              store,
              user,
              project.id,
              created.id,
            );
            assert.equal(blocked.build.status, "failed");
            assert.equal(blocked.build.stage, 2);
            assert.equal(
              blocked.build.sealSha256,
              (await buildDetail(db, user, project.id, created.id)).build
                .sealSha256,
            );
            assert.ok(
              blocked.checks[0].checks.some(
                (check) => check.outcome === "inconclusive",
              ),
            );
          } finally {
            if (executable === undefined)
              delete process.env.CHROMIUM_EXECUTABLE_PATH;
            else process.env.CHROMIUM_EXECUTABLE_PATH = executable;
          }
        }
        result = await runBuildStage(db, store, user, project.id, created.id);
        assert.equal(
          result.build.status,
          "ready",
          JSON.stringify(result.checks),
        );
        assert.ok(
          result.checks[0].checks.some(
            (c) => c.key === "enquiry_backend" && c.outcome === "pass",
          ),
        );
        seals.push(result.build.sealSha256!);
        readyIds.push(created.id);
        assert.equal(result.checks[0].suiteVersion, "website-preview-v2");
        assert.ok(
          result.checks[0].checks.some(
            (check) => check.key.endsWith(":768") && check.outcome === "pass",
          ),
        );
        for (const key of [
          "keyboard",
          "enquiry_validation",
          "enquiry_idempotency",
          "navigation_coverage",
        ])
          assert.ok(
            result.checks[0].checks.some(
              (check) => check.key === key && check.outcome === "pass",
            ),
            key,
          );
        const response = await previewResponse(
          db,
          store,
          user,
          project.id,
          created.id,
          [],
          new Request(
            `http://localhost:3000/api/platform/projects/${project.id}/builds/${created.id}/preview/`,
          ),
        );
        assert.equal(response.status, 200);
        assert.match(await response.text(), /FULL_SOURCE_END_MARKER/);
        const missing = await previewResponse(
          db,
          store,
          user,
          project.id,
          created.id,
          ["missing"],
          new Request(
            `http://localhost:3000/api/platform/projects/${project.id}/builds/${created.id}/preview/missing/`,
          ),
        );
        assert.equal(missing.status, 404);
        const lead = {
          requestKey: randomUUID(),
          name: "Real preview visitor",
          email: "visitor@example.com",
          message: "Please contact me about the service.",
        };
        const first = await submitEnquiry(
          db,
          user,
          project.id,
          created.id,
          lead,
        );
        assert.equal(
          (await submitEnquiry(db, user, project.id, created.id, lead))
            .enquiryId,
          first.enquiryId,
        );
        await assert.rejects(
          submitEnquiry(db, user, project.id, created.id, {
            ...lead,
            message: "Different content",
          }),
          /different content/,
        );
        await assert.rejects(
          buildDetail(db, other, otherProject.id, created.id),
          /do not have access/,
        );
        await assert.rejects(
          db.transaction((client) =>
            client.query(
              "UPDATE everonn_platform.website_builds SET status='queued' WHERE id=$1",
              [created.id],
            ),
          ),
          /immutable/,
        );
        const zip = await loadArtifact(
          db,
          store,
          user,
          project.id,
          manifest.sourceArchiveId,
        );
        assert.equal(Buffer.from(zip.bytes).readUInt32LE(0), 0x04034b50);
        assert.doesNotMatch(
          Buffer.from(zip.bytes).toString(),
          /OPENROUTER_API_KEY|AUTH_SESSION_SECRET|OBJECT_STORAGE_ACCESS_KEY_ID/,
        );
      },
    );
  }
  assert.equal(new Set(seals).size, 3);
  assert.equal((await listEnquiries(db, user, project.id)).length, 3);
  await t.test(
    "exact-seal human reviews, reviewer permissions and honest comparison reports",
    async () => {
      const reviewer = (
        await createSession(db, {
          issuer: "urn:website-tests",
          subject: "reviewer",
          displayName: "Reviewer",
        })
      ).user;
      await db.transaction(async (client) => {
        await client.query(
          "INSERT INTO everonn_platform.tenant_memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')",
          [randomUUID(), tenant.id, reviewer.id],
        );
        await client.query(
          "INSERT INTO everonn_platform.project_memberships(id,tenant_id,project_id,user_id,permissions) VALUES($1,$2,$3,$4,ARRAY['view','review'])",
          [randomUUID(), tenant.id, project.id, reviewer.id],
        );
      });
      const detail = await projectDetail(db, reviewer, project.id);
      assert.equal(detail.project.canEdit, false);
      assert.equal(detail.project.canReview, true);
      const checklist = {
        brandAndLayout: true,
        contentAndFacts: true,
        mobileAndKeyboard: true,
        featuresAndLimitations: true,
        distinctAlternatives: true,
      };
      const input = {
        requestKey: randomUUID(),
        sealSha256: seals[0],
        decision: "approved" as const,
        notes: "Reviewed source fidelity, layouts and working preview form.",
        checklist,
      };
      await assert.rejects(
        recordBuildReview(db, reviewer, project.id, readyIds[0], {
          ...input,
          checklist: { ...checklist, contentAndFacts: false },
        }),
        /every review item/,
      );
      await assert.rejects(
        recordBuildReview(db, reviewer, project.id, readyIds[0], {
          ...input,
          sealSha256: "0".repeat(64),
        }),
        /exact current seal/,
      );
      const review = await recordBuildReview(
        db,
        reviewer,
        project.id,
        readyIds[0],
        input,
      );
      assert.equal(
        (await recordBuildReview(db, reviewer, project.id, readyIds[0], input))
          .id,
        review.id,
      );
      await assert.rejects(
        recordBuildReview(db, reviewer, project.id, readyIds[0], {
          ...input,
          notes: "Different review decision content",
        }),
        /different decision/,
      );
      await assert.rejects(
        recordBuildReview(db, other, otherProject.id, readyIds[0], input),
        /do not have access/,
      );
      const report = await buildReport(
        db,
        store,
        user,
        project.id,
        readyIds[0],
      );
      assert.equal(report.previewVerified, true);
      assert.equal(report.humanReviewApproved, true);
      assert.equal(report.latestReview?.reviewerId, reviewer.id);
      assert.equal(
        report.coverage.requiredPages,
        report.coverage.exportedPages,
      );
      assert.equal(report.publication, "not_configured");
      assert.ok(
        report.limitations.some((item) => item.includes("test fixtures")),
      );
      assert.equal(
        report.claims.find((item) => item.key === "business_outcomes")?.outcome,
        "unassessed",
      );
      assert.equal(
        report.claims.find((item) => item.key === "enquiry")?.outcome,
        "verified",
      );
      const second = await buildReport(
        db,
        store,
        user,
        project.id,
        readyIds[1],
      );
      assert.equal(
        second.humanReviewApproved,
        false,
        "Approval cannot transfer to another alternative",
      );
      assert.equal(second.latestReview, null);
      await recordBuildReview(db, reviewer, project.id, readyIds[0], {
        ...input,
        requestKey: randomUUID(),
        decision: "changes_requested",
        notes: "Please adjust the brand treatment in a replacement build.",
      });
      const changed = await buildReport(
        db,
        store,
        user,
        project.id,
        readyIds[0],
      );
      assert.equal(changed.humanReviewApproved, false);
      assert.equal(
        changed.previewVerified,
        true,
        "A human judgment does not rewrite test evidence",
      );
      assert.notEqual(changed.evaluationSha256, report.evaluationSha256);
      assert.equal(
        (await listBuildReviews(db, user, project.id))[0].decision,
        "changes_requested",
      );
      await assert.rejects(
        db.transaction((client) =>
          client.query("DELETE FROM everonn_platform.build_reviews"),
        ),
        /immutable/,
      );
      await assert.rejects(
        buildReport(db, store, other, otherProject.id, readyIds[0]),
        /do not have access/,
      );
    },
  );
  const replacement = await startBuild(db, store, user, project.id, {
    blueprintId: approved.id,
    alternativeId: alternatives[0].id,
    requestKey: randomUUID(),
  });
  const malicious = {
    mode: "fixture" as const,
    design: async (...args: Parameters<typeof createDesign>) => {
      const result = await createDesign(...args);
      result.design.css +=
        "\n.source-content{max-height:20px!important;overflow:hidden!important}";
      return result;
    },
  };
  await runBuildStage(
    db,
    store,
    user,
    project.id,
    replacement.id,
    undefined,
    malicious,
  );
  await runBuildStage(db, store, user, project.id, replacement.id);
  const blocked = await runBuildStage(
    db,
    store,
    user,
    project.id,
    replacement.id,
  );
  assert.equal(blocked.build.status, "failed");
  assert.equal(blocked.build.stage, 2);
  const failedReport = await buildReport(
    db,
    store,
    user,
    project.id,
    replacement.id,
  );
  assert.equal(failedReport.previewVerified, false);
  assert.equal(failedReport.humanReviewApproved, false);
  await assert.rejects(
    recordBuildReview(db, user, project.id, replacement.id, {
      requestKey: randomUUID(),
      sealSha256: blocked.build.sealSha256,
      decision: "changes_requested",
      notes: "The content is clipped on this candidate.",
      checklist: {
        brandAndLayout: false,
        contentAndFacts: false,
        mobileAndKeyboard: false,
        featuresAndLimitations: false,
        distinctAlternatives: false,
      },
    }),
    /verified preview/,
  );
  assert.ok(
    blocked.checks[0].checks.some(
      (check) => check.key.startsWith("viewport:") && check.outcome === "fail",
    ),
  );
  const prior = (
    await db.transaction((client) =>
      client.query<{ id: string }>(
        "SELECT id FROM everonn_platform.website_builds WHERE alternative_id=$1 AND status='ready'",
        [alternatives[0].id],
      ),
    )
  ).rows[0];
  assert.equal(
    (await buildDetail(db, user, project.id, prior.id)).build.status,
    "ready",
  );
});

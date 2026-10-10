import { loadEnvConfig } from "@next/env";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { embeddedDatabase } from "../lib/platform/database";
import { migrateDatabase } from "../lib/platform/migrations";
import { createSession } from "../lib/auth/sessions";
import {
  createTenant,
  createProject,
  projectDetail,
} from "../lib/projects/service";
import { LocalObjectStore } from "../lib/storage/artifacts";
import {
  startScan,
  runScanBatch,
  freezeSnapshot,
} from "../lib/discovery/service";
import {
  extractFacts,
  factSetDetail,
  approveFacts,
  createBlueprint,
  blueprintDetail,
  approveBlueprint,
} from "../lib/knowledge/service";
import {
  startBuild,
  runBuildStage,
  buildManifest,
} from "../lib/builds/service";
loadEnvConfig(process.cwd(), true);
async function main() {
  if (
    process.env.PLATFORM_TEST_OUTPUT === "1" ||
    process.env.PLATFORM_TEST_CRAWL_FIXTURE === "1"
  )
    throw new Error(
      "Live verification requires test fixture flags to be disabled.",
    );
  const count = process.argv.includes("--three") ? 3 : 1;
  const directory = await mkdtemp(
      path.join(os.tmpdir(), "everonn-application-live-"),
    ),
    db = await embeddedDatabase(),
    store = new LocalObjectStore(path.join(directory, "objects"));
  try {
    await migrateDatabase(db);
    const { user } = await createSession(db, {
      issuer: "urn:everonn:live-application-probe",
      subject: randomUUID(),
      displayName: "Live probe owner",
    });
    const tenant = await createTenant(db, user, "Isolated live probe");
    const project = await createProject(db, user, tenant.id, {
      name: "Example Domain",
      sourceUrl: "https://example.com",
    });
    const settings = {
      maxPages: 5,
      batchPages: 5,
      batchMs: 30000,
      concurrency: 1,
    };
    const scan = await startScan(db, user, project.id, randomUUID(), {
      settings,
    });
    await runScanBatch(db, store, user, project.id, scan.id, {}, undefined, {
      settings,
    });
    const snapshot = await freezeSnapshot(db, store, user, project.id, scan.id);
    const draft = await extractFacts(db, store, user, project.id, snapshot.id),
      facts = await factSetDetail(db, store, user, project.id, draft.id);
    const approvedFacts = await approveFacts(
      db,
      store,
      user,
      project.id,
      draft.id,
      {
        decisions: facts.document.facts.map((fact) => ({
          id: fact.id,
          value: fact.value,
          decision: fact.value ? "confirm" : "omit",
        })),
      },
    );
    const blueprint = await createBlueprint(
        db,
        store,
        user,
        project.id,
        approvedFacts.id,
      ),
      plan = await blueprintDetail(db, store, user, project.id, blueprint.id);
    const approved = await approveBlueprint(
      db,
      store,
      user,
      project.id,
      blueprint.id,
      {
        pages: plan.document.pages.map(
          ({ id, path, title, outcome, target, reason }) => ({
            id,
            path,
            title,
            outcome,
            target,
            reason,
          }),
        ),
      },
    );
    const alternatives = (await projectDetail(db, user, project.id))
      .alternatives;
    for (const alternative of alternatives.slice(0, count)) {
      const build = await startBuild(db, store, user, project.id, {
        blueprintId: approved.id,
        alternativeId: alternative.id,
        requestKey: randomUUID(),
      });
      let result = await runBuildStage(db, store, user, project.id, build.id);
      console.log(`Alternative ${alternative.slot}: live design accepted.`);
      result = await runBuildStage(db, store, user, project.id, build.id);
      console.log(
        `Alternative ${alternative.slot}: Next.js application compiled.`,
      );
      result = await runBuildStage(db, store, user, project.id, build.id);
      assert.equal(result.build.status, "ready", JSON.stringify(result.checks));
      const { manifest } = await buildManifest(
        db,
        store,
        user,
        project.id,
        build.id,
      );
      console.log(
        JSON.stringify({
          alternative: alternative.slot,
          model: manifest.design.model,
          mode: manifest.design.mode,
          pages: manifest.routes.length,
          verified: result.checks[0].passed,
          browser: result.checks[0].browserVersion,
          seal: result.build.sealSha256,
        }),
      );
    }
  } finally {
    await db.close();
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("everonn-application-live-"));
    await rm(resolved, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Live website verification failed.",
  );
  process.exitCode = 1;
});

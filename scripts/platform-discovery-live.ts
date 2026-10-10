import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { embeddedDatabase } from "../lib/platform/database";
import { migrateDatabase } from "../lib/platform/migrations";
import { createSession } from "../lib/auth/sessions";
import { createProject, createTenant } from "../lib/projects/service";
import { LocalObjectStore } from "../lib/storage/artifacts";
import {
  startScan,
  runScanBatch,
  freezeSnapshot,
  snapshotDetail,
  snapshotPage,
} from "../lib/discovery/service";

async function main() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "everonn-discovery-live-"),
  );
  const db = await embeddedDatabase(),
    store = new LocalObjectStore(path.join(directory, "objects"));
  try {
    await migrateDatabase(db);
    const { user } = await createSession(db, {
      issuer: "urn:everonn:live-discovery-check",
      subject: randomUUID(),
      displayName: "Discovery check",
    });
    const tenant = await createTenant(
      db,
      user,
      "Isolated live discovery check",
    );
    const project = await createProject(db, user, tenant.id, {
      name: "Live source check",
      sourceUrl: process.argv[2] || "https://example.com",
    });
    const runtime = {
      settings: { maxPages: 5, batchPages: 2, batchMs: 30_000, concurrency: 1 },
    };
    const scan = await startScan(db, user, project.id, randomUUID(), runtime);
    let progress = await runScanBatch(
      db,
      store,
      user,
      project.id,
      scan.id,
      {},
      undefined,
      runtime,
    );
    for (
      let batch = 0;
      batch < 3 &&
      progress.status === "paused" &&
      progress.coverage.canContinue;
      batch++
    )
      progress = await runScanBatch(
        db,
        store,
        user,
        project.id,
        scan.id,
        {},
        undefined,
        runtime,
      );
    assert.ok((progress.coverage.captured ?? 0) > 0);
    const frozen = await freezeSnapshot(
      db,
      store,
      user,
      project.id,
      scan.id,
      true,
    );
    const detail = await snapshotDetail(db, store, user, project.id, frozen.id);
    const capture = detail.pages.find((page) => page.captureId)!;
    const evidence = await snapshotPage(
      db,
      store,
      user,
      project.id,
      frozen.id,
      capture.captureId!,
    );
    assert.ok(evidence.evidence.page.text.trim().length > 0);
    assert.equal(frozen.scope.evidenceMode, "live");
    console.log(
      JSON.stringify(
        {
          source: project.sourceUrl,
          captured: frozen.coverage.captured,
          skipped: frozen.coverage.skipped,
          pending: frozen.coverage.pending,
          completeWithinScope: frozen.coverage.complete,
          manifestSha256: frozen.manifestSha256,
          warnings: frozen.coverage.warnings,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.close();
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("everonn-discovery-live-"));
    await rm(resolved, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Live discovery check failed.",
  );
  process.exitCode = 1;
});

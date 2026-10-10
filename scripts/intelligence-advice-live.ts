// Explicit live probe: public URL -> crawl -> frozen snapshot -> intelligence report with
// live configured-provider growth advice -> owner correction -> memory-aware advice
// revision. Uses temporary database/object records that are deleted afterwards.
// Spends provider credit. Usage: npm run verify:advice:live -- https://example.com [maxPages]
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { embeddedDatabase } from "../lib/platform/database";
import { migrateDatabase } from "../lib/platform/migrations";
import { createSession } from "../lib/auth/sessions";
import { createProject, createTenant } from "../lib/projects/service";
import { LocalObjectStore } from "../lib/storage/artifacts";
import {
  startScan,
  runScanBatch,
  freezeSnapshot,
} from "../lib/discovery/service";
import {
  addAdviceCorrection,
  createAdviceRevision,
  intelligenceReport,
  runIntelligenceBatch,
  startIntelligence,
} from "../lib/intelligence/service";

loadEnvConfig(process.cwd());
const url = process.argv[2] || "https://example.com";
const maxPages = Number(process.argv[3] || 5);
const time = (start: number) => `${((Date.now() - start) / 1000).toFixed(0)}s`;

async function main() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "everonn-advice-live-"),
  );
  const db = await embeddedDatabase(),
    store = new LocalObjectStore(path.join(directory, "objects"));
  const started = Date.now();
  try {
    await migrateDatabase(db);
    const { user } = await createSession(db, {
      issuer: "urn:everonn:live-advice-check",
      subject: randomUUID(),
      displayName: "Advice check",
    });
    const tenant = await createTenant(db, user, "Isolated live advice check");
    const project = await createProject(db, user, tenant.id, {
      name: "Live advice check",
      sourceUrl: url,
    });
    const runtime = {
      settings: { maxPages, batchPages: 2, batchMs: 30_000, concurrency: 1 },
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
      batch < 10 &&
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
    assert.ok((progress.coverage.captured ?? 0) > 0, "no pages were captured");
    const snapshot = await freezeSnapshot(
      db,
      store,
      user,
      project.id,
      scan.id,
      true,
    );
    console.log(
      JSON.stringify({
        stage: "snapshot",
        url,
        captured: snapshot.coverage.captured,
        complete: snapshot.coverage.complete,
        elapsed: time(started),
      }),
    );

    let run = await startIntelligence(db, store, user, project.id, {
      snapshotId: snapshot.id,
      requestKey: randomUUID(),
    });
    console.log(
      JSON.stringify({
        stage: "run",
        mode: run.config.mode,
        provider: run.config.provider,
        model: run.config.model,
      }),
    );
    while (run.stage < 2)
      run = await runIntelligenceBatch(db, store, user, project.id, run.id);
    const { report } = await intelligenceReport(
      db,
      store,
      user,
      project.id,
      run.id,
    );
    console.log(
      JSON.stringify({
        stage: "report",
        status: report.status,
        pages: report.summary.pages,
        findings: report.summary.findings,
        browserAssessed: report.coverage.browserAssessed,
        gaps: report.coverage.assessmentGaps.length,
        elapsed: time(started),
      }),
    );
    const show = (label: string, advice: typeof report.advice) =>
      console.log(
        JSON.stringify(
          {
            stage: label,
            status: advice.status,
            model: advice.model,
            usage: advice.usage,
            summary: advice.summary,
            recommendations: advice.recommendations.length,
            growth: advice.growth,
            limitations: advice.limitations,
          },
          null,
          2,
        ),
      );
    show("advice", report.advice);
    assert.equal(
      report.advice.status,
      "available",
      "live advice did not validate",
    );

    const correction = await addAdviceCorrection(db, user, project.id, {
      body: "This is a reference/documentation domain, not a shop: do not suggest prices, bookings or checkout.",
      runId: run.id,
    });
    const revised = await createAdviceRevision(
      db,
      store,
      user,
      project.id,
      run.id,
      {
        requestKey: randomUUID(),
      },
    );
    show("revision", revised.advice);
    console.log(
      JSON.stringify({
        stage: "memory",
        correctionId: correction.id,
        revisionCorrectionIds: revised.revision.correctionIds,
        applied: revised.advice.growth?.appliedCorrectionIds,
        elapsed: time(started),
      }),
    );
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

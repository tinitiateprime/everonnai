import { randomUUID } from "node:crypto";
import type { Actor } from "../auth/sessions";
import type { PlatformDatabase, SqlClient } from "../platform/database";
import { PlatformError } from "../platform/config";
import {
  projectTransaction,
  audit,
  uuid,
  type Project,
} from "../projects/service";
import {
  digest,
  loadArtifact,
  prepareObject,
  registerObject,
  type ObjectStore,
  type PreparedObject,
} from "../storage/artifacts";
import { snapshotDetail, snapshotPage } from "../discovery/service";
import type { InventoryPage } from "../discovery/contracts";
import { websiteKeyName, websiteProvider } from "../api";
import { getModels } from "../openrouter";
import { inspectHtml } from "./extract";
import {
  inspectInBrowser,
  openIntelligenceBrowser,
  type IntelligenceRuntime,
} from "./browser";
import { aggregateReport, browserFindings } from "./aggregate";
import { adviseReport } from "./adviser";
import {
  adviceCorrectionInput,
  adviceRevisionInput,
  intelligenceInput,
  intelligenceVersion,
  type Advice,
  type AdviceCorrection,
  type AdviceRevision,
  type IntelligenceReport,
  type IntelligenceRun,
  type PageAssessment,
} from "./contracts";
const columns = `id,snapshot_id AS "snapshotId",snapshot_sha256 AS "snapshotSha256",request_key AS "requestKey",status,stage,lease_token::int AS "leaseToken",COALESCE(status='running' AND lease_expires_at>clock_timestamp(),false) AS "leaseActive",processed_pages AS "processedPages",required_pages AS "requiredPages",browser_pages AS "browserPages",report_object_id AS "reportObjectId",report_sha256 AS "reportSha256",error,config,created_at::text AS "createdAt"`;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
async function row(client: SqlClient, id: string) {
  uuid.parse(id);
  const run = (
    await client.query<IntelligenceRun>(
      `SELECT ${columns} FROM everonn_platform.intelligence_runs WHERE id=$1`,
      [id],
    )
  ).rows[0];
  if (!run)
    throw new PlatformError(
      "This intelligence run is unavailable or you do not have access.",
      404,
    );
  return run;
}
async function lease(client: SqlClient, id: string, token: number) {
  const run = await row(client, id);
  if (run.status !== "running" || run.leaseToken !== token || !run.leaseActive)
    throw new PlatformError(
      "The intelligence lease expired. Reload and resume accepted progress.",
      409,
    );
  return run;
}
async function job(
  client: SqlClient,
  id: string,
  state: string,
  reason: string,
) {
  await client.query(
    "UPDATE everonn_platform.jobs SET state=$2,reason=$3::jsonb WHERE stage='site_intelligence' AND target_key=$1",
    [id, state, JSON.stringify({ code: reason, execution: "request_batches" })],
  );
  await client.query(
    "UPDATE everonn_platform.pipeline_runs SET status=$2 WHERE id IN (SELECT pipeline_run_id FROM everonn_platform.jobs WHERE stage='site_intelligence' AND target_key=$1)",
    [
      id,
      state === "running"
        ? "running"
        : state === "succeeded"
          ? "succeeded"
          : state === "failed"
            ? "failed"
            : "queued",
    ],
  );
}
export async function listIntelligence(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
) {
  return projectTransaction(
    db,
    actor,
    projectId,
    false,
    async (client) =>
      (
        await client.query<IntelligenceRun>(
          `SELECT ${columns} FROM everonn_platform.intelligence_runs ORDER BY created_at DESC,id DESC LIMIT 100`,
        )
      ).rows,
  );
}
export async function intelligenceDetail(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  id: string,
) {
  return projectTransaction(db, actor, projectId, false, (client) =>
    row(client, id),
  );
}
export async function startIntelligence(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  input: unknown,
  runtime: IntelligenceRuntime = {},
) {
  const data = intelligenceInput.parse(input),
    previous = await projectTransaction(
      db,
      actor,
      projectId,
      true,
      async (client) =>
        (
          await client.query<IntelligenceRun>(
            `SELECT ${columns} FROM everonn_platform.intelligence_runs WHERE request_key=$1`,
            [data.requestKey],
          )
        ).rows[0],
    );
  if (previous) {
    if (previous.snapshotId !== data.snapshotId)
      throw new PlatformError(
        "This intelligence request key belongs to a different snapshot.",
        409,
      );
    return previous;
  }
  const { snapshot } = await snapshotDetail(
    db,
    store,
    actor,
    projectId,
    data.snapshotId,
  );
  const mode =
    runtime.mode === "fixture" || snapshot.scope.evidenceMode === "fixture"
      ? "fixture"
      : "live";
  let model: string | null = null;
  if (
    mode === "live" &&
    runtime.advice !== "disabled" &&
    process.env[websiteKeyName()]?.trim()
  ) {
    try {
      model = (await getModels(AbortSignal.timeout(15000)))[0]?.id || null;
    } catch {
      /* Deterministic evidence analysis remains available without a model catalogue. */
    }
  }
  const config: IntelligenceRun["config"] = {
    version: intelligenceVersion,
    mode,
    provider: model ? websiteProvider() : null,
    model,
    viewports: [1440, 768, 390],
    batchPages: 2,
    maxRequests: 180,
    maxNetworkBytes: 24_000_000,
    pageSeconds: 65,
    fullFeatureBackendTests: false,
  };
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, project) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [projectId],
      );
      const replay = (
        await client.query<IntelligenceRun>(
          `SELECT ${columns} FROM everonn_platform.intelligence_runs WHERE request_key=$1`,
          [data.requestKey],
        )
      ).rows[0];
      if (replay) {
        if (replay.snapshotId !== data.snapshotId)
          throw new PlatformError(
            "This intelligence request key belongs to a different snapshot.",
            409,
          );
        return replay;
      }
      const id = randomUUID(),
        pipeline = randomUUID(),
        jobId = randomUUID();
      await client.query(
        "INSERT INTO everonn_platform.pipeline_runs(id,tenant_id,project_id,status,requested_by) VALUES($1,$2,$3,'queued',$4)",
        [pipeline, project.tenantId, projectId, actor.id],
      );
      await client.query(
        "INSERT INTO everonn_platform.jobs(id,tenant_id,project_id,pipeline_run_id,stage,target_key,input_sha256,idempotency_key,state,reason) VALUES($1,$2,$3,$4,'site_intelligence',$5,$6,$7,'queued',$8::jsonb)",
        [
          jobId,
          project.tenantId,
          projectId,
          pipeline,
          id,
          digest(
            encode({
              snapshotId: data.snapshotId,
              snapshotSha256: snapshot.manifestSha256,
              config,
            }),
          ),
          `intelligence:${data.requestKey}`,
          JSON.stringify({ code: "awaiting_analysis_batch" }),
        ],
      );
      await client.query(
        "INSERT INTO everonn_platform.intelligence_runs(id,tenant_id,project_id,snapshot_id,snapshot_sha256,request_key,config,required_pages,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",
        [
          id,
          project.tenantId,
          projectId,
          data.snapshotId,
          snapshot.manifestSha256,
          data.requestKey,
          JSON.stringify(config),
          snapshot.coverage.captured,
          actor.id,
        ],
      );
      await audit(
        client,
        actor,
        project.tenantId,
        projectId,
        "intelligence.created",
        id,
      );
      return row(client, id);
    },
  );
}
async function inventory(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  snapshotId: string,
) {
  return projectTransaction(
    db,
    actor,
    projectId,
    false,
    async (client) =>
      (
        await client.query<InventoryPage>(
          `SELECT p.normalized_url AS url,p.outcome,p.capture_id AS "captureId",p.reason FROM everonn_platform.snapshot_pages p WHERE p.snapshot_id=$1 ORDER BY p.normalized_url`,
          [snapshotId],
        )
      ).rows,
  );
}
async function assessmentRecords(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  runId: string,
) {
  return projectTransaction(db, actor, projectId, false, async (client) => {
    await row(client, runId);
    return (
      await client.query<{
        captureId: string;
        objectId: string;
        sha256: string;
      }>(
        `SELECT capture_id AS "captureId",document_object_id AS "objectId",document_sha256 AS sha256 FROM everonn_platform.page_assessments WHERE run_id=$1 ORDER BY created_at,id`,
        [runId],
      )
    ).rows;
  });
}
export async function pageAssessment(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  runId: string,
  captureId: string,
) {
  uuid.parse(captureId);
  const record = await projectTransaction(
    db,
    actor,
    projectId,
    false,
    async (client) => {
      await row(client, runId);
      return (
        await client.query<{ objectId: string; sha256: string }>(
          `SELECT document_object_id AS "objectId",document_sha256 AS sha256 FROM everonn_platform.page_assessments WHERE run_id=$1 AND capture_id=$2`,
          [runId, captureId],
        )
      ).rows[0];
    },
  );
  if (!record)
    throw new PlatformError(
      "This page has no accepted assessment in that run.",
      404,
    );
  const artifact = await loadArtifact(
    db,
    store,
    actor,
    projectId,
    record.objectId,
  );
  if (artifact.record.sha256 !== record.sha256)
    throw new PlatformError("Page assessment integrity failed.", 503);
  const page = JSON.parse(
    Buffer.from(artifact.bytes).toString(),
  ) as PageAssessment;
  if (page.version !== 1 || page.captureId !== captureId)
    throw new PlatformError("Page assessment identity failed.", 503);
  return page;
}
export async function intelligenceReport(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  id: string,
) {
  const run = await intelligenceDetail(db, actor, projectId, id);
  if (!run.reportObjectId || !run.reportSha256)
    throw new PlatformError(
      "The report is still being prepared. Resume accepted analysis batches.",
      409,
    );
  const artifact = await loadArtifact(
    db,
    store,
    actor,
    projectId,
    run.reportObjectId,
  );
  if (artifact.record.sha256 !== run.reportSha256)
    throw new PlatformError("Intelligence report integrity failed.", 503);
  const report = JSON.parse(
    Buffer.from(artifact.bytes).toString(),
  ) as IntelligenceReport;
  if (
    report.runId !== id ||
    report.snapshotId !== run.snapshotId ||
    report.snapshotSha256 !== run.snapshotSha256
  )
    throw new PlatformError("Intelligence report identity failed.", 503);
  return { run, report };
}
async function acceptAssessment(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  project: Project,
  run: IntelligenceRun,
  token: number,
  page: PageAssessment,
  objects: PreparedObject[],
) {
  const document = await prepareObject(
    store,
    project,
    encode(page),
    "page-assessment.json",
  );
  await projectTransaction(
    db,
    actor,
    project.id,
    true,
    async (client, current) => {
      await lease(client, run.id, token);
      const member = (
        await client.query(
          "SELECT capture_id FROM everonn_platform.snapshot_pages WHERE snapshot_id=$1 AND capture_id=$2",
          [run.snapshotId, page.captureId],
        )
      ).rows[0];
      if (!member)
        throw new PlatformError(
          "The assessed page is not in the fixed snapshot.",
          409,
        );
      for (const object of [...objects, document])
        await registerObject(client, actor, current, object);
      await client.query(
        "INSERT INTO everonn_platform.page_assessments(id,tenant_id,project_id,run_id,capture_id,source_sha256,document_object_id,document_sha256,browser_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          randomUUID(),
          current.tenantId,
          current.id,
          run.id,
          page.captureId,
          page.sourceSha256,
          document.id,
          document.sha256,
          page.browser.status,
        ],
      );
      await client.query(
        "UPDATE everonn_platform.intelligence_runs SET processed_pages=processed_pages+1,browser_pages=browser_pages+$2,updated_at=clock_timestamp() WHERE id=$1",
        [run.id, page.browser.status === "observed" ? 1 : 0],
      );
    },
  );
}
export async function runIntelligenceBatch(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  id: string,
  externalSignal?: AbortSignal,
  runtime: IntelligenceRuntime = {},
) {
  const claim = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, project) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [projectId],
      );
      const current = await row(client, id);
      if (["complete", "partial"].includes(current.status))
        return { run: current, project, done: true };
      const active = (
        await client.query<{ id: string }>(
          "SELECT id FROM everonn_platform.intelligence_runs WHERE status='running' AND lease_expires_at>clock_timestamp()",
          [],
        )
      ).rows;
      if (active.length)
        throw new PlatformError(
          "An intelligence batch is already running for this project.",
          409,
        );
      await client.query(
        "UPDATE everonn_platform.intelligence_runs SET status='paused',lease_token=lease_token+1,lease_expires_at=NULL WHERE status='running' AND lease_expires_at<=clock_timestamp()",
      );
      if (current.config.version !== intelligenceVersion)
        throw new PlatformError(
          "This analysis uses an older rules version. Create a new report.",
          409,
        );
      await client.query(
        "UPDATE everonn_platform.intelligence_runs SET status='running',lease_token=lease_token+1,lease_expires_at=clock_timestamp()+interval '240 seconds',error=NULL WHERE id=$1",
        [id],
      );
      await job(client, id, "running", "analysis_batch_running");
      return { run: await row(client, id), project, done: false };
    },
  );
  if (claim.done) return claim.run;
  const run = claim.run,
    token = run.leaseToken,
    controller = new AbortController(),
    signal = externalSignal
      ? AbortSignal.any([externalSignal, controller.signal])
      : controller.signal;
  let heartbeat = Promise.resolve();
  const timer = setInterval(() => {
    heartbeat = heartbeat
      .then(() =>
        projectTransaction(db, actor, projectId, true, async (client) => {
          const current = await row(client, id);
          if (current.leaseToken === token && current.status !== "running")
            return;
          await lease(client, id, token);
          await client.query(
            "UPDATE everonn_platform.intelligence_runs SET lease_expires_at=clock_timestamp()+interval '240 seconds' WHERE id=$1",
            [id],
          );
        }),
      )
      .catch(() => {
        controller.abort();
      });
  }, 5000);
  try {
    const { snapshot } = await snapshotDetail(
      db,
      store,
      actor,
      projectId,
      run.snapshotId,
    );
    if (snapshot.manifestSha256 !== run.snapshotSha256)
      throw new PlatformError(
        "The fixed source snapshot failed integrity verification.",
        503,
      );
    const members = await inventory(db, actor, projectId, run.snapshotId),
      records = await assessmentRecords(db, actor, projectId, id),
      accepted = new Set(records.map((record) => record.captureId));
    if (run.stage === 0) {
      const pending = members
        .filter((member) => member.captureId && !accepted.has(member.captureId))
        .slice(0, run.config.batchPages);
      const ownedBrowser =
          runtime.browser === undefined
            ? await openIntelligenceBrowser()
            : null,
        browser =
          runtime.browser === undefined ? ownedBrowser : runtime.browser;
      try {
        for (const member of pending) {
          signal.throwIfAborted();
          const { capture } = await snapshotPage(
            db,
            store,
            actor,
            projectId,
            run.snapshotId,
            member.captureId!,
          );
          const raw = await loadArtifact(
            db,
            store,
            actor,
            projectId,
            capture.rawObjectId,
          );
          if (raw.record.sha256 !== capture.rawSha256)
            throw new PlatformError("Source HTML integrity failed.", 503);
          const renderedId = await projectTransaction(
            db,
            actor,
            projectId,
            false,
            async (client) =>
              (
                await client.query<{ id: string | null }>(
                  "SELECT rendered_object_id AS id FROM everonn_platform.page_captures WHERE id=$1",
                  [capture.id],
                )
              ).rows[0]?.id,
          );
          const source = renderedId
              ? await loadArtifact(db, store, actor, projectId, renderedId)
              : raw,
            html = Buffer.from(source.bytes).toString(),
            parsed = inspectHtml(html, capture.finalUrl, capture.id);
          const inspected = await inspectInBrowser(
            browser ?? null,
            html,
            capture.finalUrl,
            capture.textSha256,
            run.config,
            signal,
            runtime.resource,
          );
          signal.throwIfAborted();
          const objects: PreparedObject[] = [];
          for (const artifact of inspected.artifacts) {
            const object = await prepareObject(
              store,
              claim.project,
              artifact.bytes,
              artifact.key +
                (artifact.mediaType === "image/png"
                  ? ".png"
                  : artifact.mediaType === "text/css"
                    ? ".css"
                    : ".html"),
              artifact.mediaType,
            );
            objects.push(object);
            if (artifact.key.startsWith("screenshot-")) {
              const width = Number(artifact.key.slice(11));
              const view = inspected.observation.viewports.find(
                (view) => view.width === width,
              );
              if (view) view.screenshotObjectId = object.id;
            }
            if (artifact.resourceUrl) {
              const resource = inspected.observation.resources.find(
                (resource) =>
                  resource.url === artifact.resourceUrl &&
                  resource.type === "stylesheet",
              );
              if (resource) resource.objectId = object.id;
            }
          }
          parsed.inventory.tokens.push(...inspected.tokens);
          const rendered = inspected.renderedHtml
            ? inspectHtml(
                inspected.renderedHtml,
                capture.finalUrl,
                capture.id,
                "browser",
              )
            : null;
          const page: PageAssessment = {
            version: 1,
            captureId: capture.id,
            sourceSha256: source.record.sha256,
            textSha256: capture.textSha256,
            assessedAt: new Date().toISOString(),
            inventory: parsed.inventory,
            ...(rendered ? { renderedInventory: rendered.inventory } : {}),
            browser: inspected.observation,
            references: [...parsed.references, ...(rendered?.references ?? [])],
            findings: parsed.findings,
          };
          const browserIssues = browserFindings(page);
          page.findings.push(...browserIssues.findings);
          page.references.push(...browserIssues.references);
          await acceptAssessment(
            db,
            store,
            actor,
            claim.project,
            run,
            token,
            page,
            objects,
          );
        }
      } finally {
        await ownedBrowser?.close();
      }
      await projectTransaction(db, actor, projectId, true, async (client) => {
        const current = await lease(client, id, token);
        if (current.processedPages === current.requiredPages)
          await client.query(
            "UPDATE everonn_platform.intelligence_runs SET stage=1 WHERE id=$1",
            [id],
          );
      });
    } else {
      const pages: PageAssessment[] = [];
      for (const record of records) {
        signal.throwIfAborted();
        const page = await pageAssessment(
          db,
          store,
          actor,
          projectId,
          id,
          record.captureId,
        );
        // The full detail remains immutable in private storage. Aggregation does
        // not keep repeated section excerpts/JSON-LD bodies for every page in RAM.
        const lightweight = (value: PageAssessment["inventory"]) => ({
          ...value,
          sections: [],
          forms: [],
          structuredData: value.structuredData.map((item) => ({
            ...item,
            value: null,
          })),
        });
        pages.push({
          ...page,
          inventory: lightweight(page.inventory),
          ...(page.renderedInventory
            ? { renderedInventory: lightweight(page.renderedInventory) }
            : {}),
        });
      }
      const empty: Advice = {
        status: "not_configured",
        model: null,
        summary: "Evidence-based inventory and findings.",
        recommendations: [],
        limitations: [],
      };
      let report = aggregateReport(run, snapshot, members, pages, empty);
      const corrections = await projectTransaction(
        db,
        actor,
        projectId,
        false,
        (client) => activeCorrections(client),
      );
      const advice = await adviseReport(
        report,
        run.config,
        signal,
        corrections,
      );
      signal.throwIfAborted();
      report = { ...report, advice };
      const object = await prepareObject(
        store,
        claim.project,
        encode(report),
        "website-intelligence-report.json",
      );
      await projectTransaction(
        db,
        actor,
        projectId,
        true,
        async (client, project) => {
          await lease(client, id, token);
          await registerObject(client, actor, project, object);
          await client.query(
            "UPDATE everonn_platform.intelligence_runs SET status=$2,stage=2,report_object_id=$3,report_sha256=$4,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1",
            [
              id,
              report.status === "partial" ? "partial" : "complete",
              object.id,
              object.sha256,
            ],
          );
          await job(client, id, "succeeded", report.status);
          await audit(
            client,
            actor,
            project.tenantId,
            projectId,
            "intelligence.sealed",
            id,
          );
        },
      );
    }
    await projectTransaction(db, actor, projectId, true, async (client) => {
      const current = await row(client, id);
      if (current.leaseToken === token && current.status === "running") {
        await lease(client, id, token);
        await client.query(
          "UPDATE everonn_platform.intelligence_runs SET status='paused',lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1",
          [id],
        );
        await job(client, id, "queued", "analysis_batch_saved");
      }
    });
  } catch (error) {
    await projectTransaction(db, actor, projectId, true, async (client) => {
      const current = await row(client, id);
      // Fenced like accepted writes: an expired or superseded lease must not change
      // operational state that a newer batch may now own.
      if (
        current.leaseToken === token &&
        current.status === "running" &&
        current.leaseActive
      ) {
        await client.query(
          "UPDATE everonn_platform.intelligence_runs SET status=$2,lease_expires_at=NULL,error=$3 WHERE id=$1",
          [
            id,
            signal.aborted ? "paused" : "failed",
            error instanceof PlatformError
              ? error.message
              : signal.aborted
                ? "Inspection stopped; accepted page assessments can be resumed."
                : "This inspection batch failed. Accepted evidence was retained; resume or create a fresh report.",
          ],
        );
        await job(
          client,
          id,
          signal.aborted ? "queued" : "failed",
          signal.aborted ? "interrupted" : "assessment_failed",
        );
      }
    }).catch(() => {});
    if (error instanceof PlatformError) throw error;
  } finally {
    clearInterval(timer);
    await heartbeat;
  }
  return intelligenceDetail(db, actor, projectId, id);
}
export async function screenshotResponse(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  runId: string,
  captureId: string,
  width: number,
) {
  if (![390, 768, 1440].includes(width))
    throw new PlatformError("Unsupported inspection viewport.");
  const page = await pageAssessment(
      db,
      store,
      actor,
      projectId,
      runId,
      captureId,
    ),
    objectId = page.browser.viewports.find(
      (view) => view.width === width,
    )?.screenshotObjectId;
  if (!objectId)
    throw new PlatformError(
      "No screenshot was accepted for that viewport.",
      404,
    );
  const artifact = await loadArtifact(db, store, actor, projectId, objectId);
  if (artifact.record.mediaType !== "image/png")
    throw new PlatformError("Screenshot identity failed.", 503);
  return new Response(new Uint8Array(artifact.bytes), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}

// ---- Growth advice memory and revisions -------------------------------------------
const correctionColumns = `id,run_id AS "runId",body,created_at::text AS "createdAt",withdrawn_at::text AS "withdrawnAt"`;
const revisionColumns = `id,run_id AS "runId",request_key AS "requestKey",report_sha256 AS "reportSha256",correction_ids AS "correctionIds",status,model,object_id AS "objectId",object_sha256 AS "objectSha256",created_at::text AS "createdAt"`;
/** Regeneration calls the configured provider; bound the spend per sealed report. */
export const MAX_ADVICE_REVISIONS_PER_RUN = 20;
async function activeCorrections(client: SqlClient) {
  return (
    await client.query<AdviceCorrection>(
      `SELECT ${correctionColumns} FROM everonn_platform.advice_corrections WHERE withdrawn_at IS NULL ORDER BY created_at,id LIMIT 200`,
    )
  ).rows;
}
/** Owner corrections (all, including withdrawn) and advice revisions for a run. */
export async function adviceState(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  runId: string,
) {
  return projectTransaction(db, actor, projectId, false, async (client) => {
    await row(client, runId);
    return {
      corrections: (
        await client.query<AdviceCorrection>(
          `SELECT ${correctionColumns} FROM everonn_platform.advice_corrections ORDER BY created_at DESC,id DESC LIMIT 200`,
        )
      ).rows,
      revisions: (
        await client.query<AdviceRevision>(
          `SELECT ${revisionColumns} FROM everonn_platform.advice_revisions WHERE run_id=$1 ORDER BY created_at DESC,id DESC`,
          [runId],
        )
      ).rows,
    };
  });
}
export async function addAdviceCorrection(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  input: unknown,
) {
  const data = adviceCorrectionInput.parse(input);
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, project) => {
      if (data.runId) await row(client, data.runId);
      const id = randomUUID();
      await client.query(
        "INSERT INTO everonn_platform.advice_corrections(id,tenant_id,project_id,run_id,body,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          project.tenantId,
          projectId,
          data.runId ?? null,
          data.body,
          actor.id,
        ],
      );
      await audit(
        client,
        actor,
        project.tenantId,
        projectId,
        "advice.corrected",
        id,
      );
      return (
        await client.query<AdviceCorrection>(
          `SELECT ${correctionColumns} FROM everonn_platform.advice_corrections WHERE id=$1`,
          [id],
        )
      ).rows[0];
    },
  );
}
export async function withdrawAdviceCorrection(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  id: string,
) {
  uuid.parse(id);
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, project) => {
      const updated = await client.query<AdviceCorrection>(
        `UPDATE everonn_platform.advice_corrections SET withdrawn_at=clock_timestamp(),withdrawn_by=$2 WHERE id=$1 AND withdrawn_at IS NULL RETURNING ${correctionColumns}`,
        [id, actor.id],
      );
      if (!updated.rows[0])
        throw new PlatformError(
          "This correction is unavailable or was already withdrawn.",
          404,
        );
      await audit(
        client,
        actor,
        project.tenantId,
        projectId,
        "advice.correction_withdrawn",
        id,
      );
      return updated.rows[0];
    },
  );
}
async function revisionAdvice(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  revision: AdviceRevision,
) {
  const artifact = await loadArtifact(
    db,
    store,
    actor,
    projectId,
    revision.objectId,
  );
  if (artifact.record.sha256 !== revision.objectSha256)
    throw new PlatformError("Advice revision integrity failed.", 503);
  return JSON.parse(Buffer.from(artifact.bytes).toString()) as Advice;
}
export async function adviceRevisionDetail(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  runId: string,
  revisionId: string,
) {
  uuid.parse(revisionId);
  const revision = await projectTransaction(
    db,
    actor,
    projectId,
    false,
    async (client) => {
      await row(client, runId);
      return (
        await client.query<AdviceRevision>(
          `SELECT ${revisionColumns} FROM everonn_platform.advice_revisions WHERE id=$1 AND run_id=$2`,
          [revisionId, runId],
        )
      ).rows[0];
    },
  );
  if (!revision)
    throw new PlatformError("This advice revision is unavailable.", 404);
  return {
    revision,
    advice: await revisionAdvice(db, store, actor, projectId, revision),
  };
}
/**
 * Regenerates growth advice for a sealed report using the owner's current corrections.
 * The sealed report is not modified; the result is a new immutable revision.
 */
export async function createAdviceRevision(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  runId: string,
  input: unknown,
  signal?: AbortSignal,
) {
  const data = adviceRevisionInput.parse(input);
  const existing = async (client: SqlClient) =>
    (
      await client.query<AdviceRevision>(
        `SELECT ${revisionColumns} FROM everonn_platform.advice_revisions WHERE request_key=$1`,
        [data.requestKey],
      )
    ).rows[0];
  const replay = (revision: AdviceRevision) => {
    if (revision.runId !== runId)
      throw new PlatformError(
        "This advice request key belongs to a different report.",
        409,
      );
    return revision;
  };
  const prior = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client) => {
      const found = await existing(client);
      if (found) return replay(found);
      const count = (
        await client.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM everonn_platform.advice_revisions WHERE run_id=$1",
          [runId],
        )
      ).rows[0].n;
      if (count >= MAX_ADVICE_REVISIONS_PER_RUN)
        throw new PlatformError(
          `This report already has ${MAX_ADVICE_REVISIONS_PER_RUN} advice revisions. Create a fresh report to continue.`,
          409,
        );
      return null;
    },
  );
  if (prior)
    return {
      revision: prior,
      advice: await revisionAdvice(db, store, actor, projectId, prior),
    };
  // Verifies sealed-report identity and hash before any provider call.
  const { run, report } = await intelligenceReport(
    db,
    store,
    actor,
    projectId,
    runId,
  );
  const corrections = await projectTransaction(
    db,
    actor,
    projectId,
    false,
    (client) => activeCorrections(client),
  );
  const advice = await adviseReport(report, run.config, signal, corrections);
  signal?.throwIfAborted();
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, project) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`advice:${projectId}`],
      );
      const raced = await existing(client);
      if (raced)
        return {
          revision: replay(raced),
          advice: await revisionAdvice(db, store, actor, projectId, raced),
        };
      const object = await prepareObject(
        store,
        project,
        encode(advice),
        "website-growth-advice.json",
      );
      await registerObject(client, actor, project, object);
      const id = randomUUID();
      await client.query(
        "INSERT INTO everonn_platform.advice_revisions(id,tenant_id,project_id,run_id,request_key,report_sha256,correction_ids,status,model,object_id,object_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)",
        [
          id,
          project.tenantId,
          projectId,
          runId,
          data.requestKey,
          run.reportSha256,
          JSON.stringify(corrections.map((item) => item.id)),
          advice.status,
          advice.model,
          object.id,
          object.sha256,
          actor.id,
        ],
      );
      await audit(
        client,
        actor,
        project.tenantId,
        projectId,
        "advice.revised",
        id,
      );
      return {
        revision: (
          await client.query<AdviceRevision>(
            `SELECT ${revisionColumns} FROM everonn_platform.advice_revisions WHERE id=$1`,
            [id],
          )
        ).rows[0],
        advice,
      };
    },
  );
}
/**
 * The owner's current improvement brief for website design: the agent prompt from the
 * newest growth advice (latest revision, else the sealed report's own advice) of the
 * newest sealed intelligence report, plus active owner corrections. Null fields mean
 * no growth advice exists yet; design then relies on facts and page evidence alone.
 */
export async function designGuidance(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
) {
  const { latest, revision, corrections } = await projectTransaction(
    db,
    actor,
    projectId,
    false,
    async (client) => {
      const latest = (
        await client.query<IntelligenceRun>(
          `SELECT ${columns} FROM everonn_platform.intelligence_runs WHERE status IN ('complete','partial') ORDER BY created_at DESC,id DESC LIMIT 1`,
        )
      ).rows[0];
      return {
        latest,
        revision: latest
          ? (
              await client.query<AdviceRevision>(
                `SELECT ${revisionColumns} FROM everonn_platform.advice_revisions WHERE run_id=$1 AND status='available' ORDER BY created_at DESC,id DESC LIMIT 1`,
                [latest.id],
              )
            ).rows[0]
          : undefined,
        corrections: await activeCorrections(client),
      };
    },
  );
  let advice: Advice | null = null;
  if (revision)
    advice = await revisionAdvice(db, store, actor, projectId, revision);
  else if (latest)
    advice = (await intelligenceReport(db, store, actor, projectId, latest.id))
      .report.advice;
  const growth = advice?.status === "available" ? advice.growth : undefined;
  return {
    source: growth
      ? {
          runId: latest!.id,
          reportSha256: latest!.reportSha256!,
          adviceRevisionId: revision?.id ?? null,
        }
      : null,
    agentPrompt: growth?.agentPrompt ?? null,
    customerGaps: growth?.customerGaps ?? null,
    corrections: corrections.map(({ id, body }) => ({ id, body })),
  };
}

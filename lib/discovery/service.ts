import { randomUUID } from "node:crypto";
import type { Actor } from "../auth/sessions";
import type { PlatformDatabase, SqlClient } from "../platform/database";
import { PlatformError } from "../platform/config";
import {
  audit,
  projectTransaction,
  uuid,
  type Project,
} from "../projects/service";
import {
  digest,
  loadArtifact,
  prepareObject,
  registerObject,
  type ObjectStore,
} from "../storage/artifacts";
import { crawlable, discoverWebsite, type PageEvidence } from "../crawler";
import {
  crawlSettings,
  MAX_CRAWL_PAGES,
  MAX_CRAWL_URLS,
} from "../crawl-limits";
import type { CrawlState } from "../types";
import { discoverySchema } from "../input";
import {
  cursorSchema,
  type Capture,
  type Coverage,
  type InventoryPage,
  type Scan,
  type Snapshot,
} from "./contracts";

export type DiscoveryRuntime = Pick<
  NonNullable<Parameters<typeof discoverWebsite>[3]>,
  "resource" | "browser"
> & {
  settings?: ReturnType<typeof crawlSettings>;
  evidenceMode?: "live" | "fixture";
};
const scanColumns = `id,input_url AS "inputUrl",status,page_limit::int AS "pageLimit",revision::int AS revision,
  lease_token::int AS "leaseToken",lease_expires_at::text AS "leaseExpiresAt",pause_requested AS "pauseRequested",
  checkpoint_object_id AS "checkpointObjectId",coverage,last_error AS "lastError",config,job_id AS "jobId",
  pipeline_run_id AS "pipelineRunId",created_at::text AS "createdAt",updated_at::text AS "updatedAt",
  COALESCE(status='running' AND lease_expires_at>clock_timestamp(),false) AS "leaseActive"`;
const captureColumns = `id,normalized_url AS "normalizedUrl",final_url AS "finalUrl",http_status AS "httpStatus",
  capture_started_at::text AS "captureStartedAt",captured_at::text AS "capturedAt",rendered_at::text AS "renderedAt",
  raw_sha256 AS "rawSha256",text_sha256 AS "textSha256",raw_object_id AS "rawObjectId",evidence_object_id AS "evidenceObjectId",summary`;
const snapshotColumns = `id,crawl_run_id AS "crawlRunId",crawl_revision::int AS "crawlRevision",manifest_object_id AS "manifestObjectId",
  manifest_sha256 AS "manifestSha256",coverage,scope,capture_started_at::text AS "captureStartedAt",capture_ended_at::text AS "captureEndedAt",created_at::text AS "createdAt"`;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const limitations = [
  "Public same-origin HTML only; account pages, files, external sites and query-based pages are outside this scan.",
  "Capture times differ between pages; a frozen snapshot is not a simultaneous copy of the source site.",
  "Raw responses are limited to 2 MB and rendered HTML to 3 MB; oversized responses fail rather than silently truncate.",
  "Images are references, not downloaded assets. Extracted links, metadata and design cues are bounded; archived HTML and full normalized text preserve the captured evidence.",
  "Browser rendering is optional. Warnings identify missing JavaScript content or unavailable rendering. Discovery does not test source forms or prove business facts.",
];
async function scanRow(client: SqlClient, id: string, lock = false) {
  uuid.parse(id);
  const row = (
    await client.query<Scan>(
      `SELECT ${scanColumns} FROM everonn_platform.crawl_runs WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!row)
    throw new PlatformError(
      "This scan is unavailable or you do not have access.",
      404,
    );
  return row;
}
async function captures(client: SqlClient, runId: string) {
  return (
    await client.query<Capture>(
      `SELECT ${captureColumns} FROM everonn_platform.page_captures WHERE crawl_run_id=$1 ORDER BY captured_at,id`,
      [runId],
    )
  ).rows;
}
async function projectLock(client: SqlClient, projectId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    projectId,
  ]);
  // Expired processes lose their status and token before a replacement may claim work.
  const expired = await client.query<{
    job_id: string;
    pipeline_run_id: string;
  }>(
    `UPDATE everonn_platform.crawl_runs SET status='paused',lease_token=lease_token+1,lease_expires_at=NULL,revision=revision+1,updated_at=now()
    WHERE project_id=$1 AND status='running' AND lease_expires_at<=clock_timestamp() RETURNING job_id,pipeline_run_id`,
    [projectId],
  );
  for (const row of expired.rows) {
    await client.query(
      "UPDATE everonn_platform.jobs SET state='queued',reason=$2::jsonb WHERE id=$1",
      [
        row.job_id,
        JSON.stringify({ code: "lease_expired", execution: "request_batches" }),
      ],
    );
    await client.query(
      "UPDATE everonn_platform.pipeline_runs SET status='queued' WHERE id=$1",
      [row.pipeline_run_id],
    );
  }
}
async function lease(client: SqlClient, runId: string, token: number) {
  const row = (
    await client.query<Scan>(
      `SELECT ${scanColumns} FROM everonn_platform.crawl_runs WHERE id=$1 AND status='running' AND lease_token=$2 AND lease_expires_at>clock_timestamp() FOR UPDATE`,
      [runId, token],
    )
  ).rows[0];
  if (!row)
    throw new PlatformError(
      "This scan's execution lease expired. Reload and resume its saved progress.",
      409,
    );
  return row;
}
async function jobState(
  client: SqlClient,
  scan: Scan,
  state: string,
  code: string,
) {
  await client.query(
    "UPDATE everonn_platform.jobs SET state=$2,reason=$3::jsonb WHERE id=$1",
    [scan.jobId, state, JSON.stringify({ code, execution: "request_batches" })],
  );
  await client.query(
    "UPDATE everonn_platform.pipeline_runs SET status=$2 WHERE id=$1",
    [
      scan.pipelineRunId,
      state === "succeeded"
        ? "succeeded"
        : state === "failed"
          ? "failed"
          : state === "running"
            ? "running"
            : "queued",
    ],
  );
}
export async function startScan(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  requestKey: string,
  runtime: DiscoveryRuntime = {},
) {
  uuid.parse(requestKey);
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, project) => {
      await projectLock(client, projectId);
      const prior = (
        await client.query<Scan>(
          `SELECT ${scanColumns} FROM everonn_platform.crawl_runs WHERE request_key=$1`,
          [requestKey],
        )
      ).rows[0];
      if (prior) return prior;
      if (!project.sourceUrl)
        throw new PlatformError(
          "Create a project with a public source website URL before scanning.",
        );
      if (
        (
          await client.query(
            "SELECT id FROM everonn_platform.crawl_runs WHERE status='running'",
          )
        ).rows.length
      )
        throw new PlatformError(
          "A scan is already running for this project. Pause it before starting another.",
          409,
        );
      const settings = runtime.settings ?? crawlSettings();
      const config = {
        ...settings,
        batchMs: Math.min(settings.batchMs, 45_000),
        evidenceMode: runtime.evidenceMode ?? "live",
        extractorVersion: "everonn-html-archive-v1",
      };
      if (
        config.maxPages < 1 ||
        config.maxPages > MAX_CRAWL_PAGES ||
        config.batchPages < 1 ||
        config.batchPages > 100 ||
        config.concurrency < 1 ||
        config.concurrency > 6 ||
        config.batchMs < 1
      )
        throw new PlatformError("Invalid server crawl configuration.", 503);
      const id = randomUUID(),
        pipelineId = randomUUID(),
        jobId = randomUUID();
      await client.query(
        "INSERT INTO everonn_platform.pipeline_runs (id,tenant_id,project_id,status,requested_by) VALUES ($1,$2,$3,'queued',$4)",
        [pipelineId, project.tenantId, project.id, actor.id],
      );
      await client.query(
        `INSERT INTO everonn_platform.jobs (id,tenant_id,project_id,pipeline_run_id,stage,target_key,input_sha256,idempotency_key,state,reason)
      VALUES ($1,$2,$3,$4,'discovery',$5,$6,$7,'queued',$8::jsonb)`,
        [
          jobId,
          project.tenantId,
          project.id,
          pipelineId,
          id,
          digest(encode({ inputUrl: project.sourceUrl, config })),
          `discovery:${requestKey}`,
          JSON.stringify({
            code: "awaiting_request_batch",
            execution: "request_batches",
          }),
        ],
      );
      await client.query(
        `INSERT INTO everonn_platform.crawl_runs (id,tenant_id,project_id,pipeline_run_id,job_id,request_key,input_url,config,page_limit)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [
          id,
          project.tenantId,
          project.id,
          pipelineId,
          jobId,
          requestKey,
          project.sourceUrl,
          JSON.stringify(config),
          config.maxPages,
        ],
      );
      await audit(
        client,
        actor,
        project.tenantId,
        project.id,
        "discovery.started",
        id,
      );
      return scanRow(client, id);
    },
  );
}
export async function listScans(
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
        await client.query<Scan>(
          `SELECT ${scanColumns} FROM everonn_platform.crawl_runs ORDER BY created_at DESC,id DESC LIMIT 50`,
        )
      ).rows,
  );
}
export async function scanDetail(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  runId: string,
) {
  return projectTransaction(db, actor, projectId, false, async (client) => {
    const scan = await scanRow(client, runId);
    const count = (
      await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM everonn_platform.page_captures WHERE crawl_run_id=$1",
        [runId],
      )
    ).rows[0].n;
    return {
      ...scan,
      coverage: {
        ...scan.coverage,
        captured: count,
        pending: Math.max(
          0,
          (scan.coverage.pending ?? 0) -
            Math.max(0, count - (scan.coverage.captured ?? 0)),
        ),
      },
    };
  });
}
async function restore(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  scan: Scan,
): Promise<CrawlState | undefined> {
  const saved = await projectTransaction(
    db,
    actor,
    projectId,
    false,
    (client) => captures(client, scan.id),
  );
  if (!scan.checkpointObjectId) {
    if (saved.length)
      throw new PlatformError(
        "Captured pages exist without a recoverable discovery frontier.",
        503,
      );
    return undefined;
  }
  const { bytes } = await loadArtifact(
    db,
    store,
    actor,
    projectId,
    scan.checkpointObjectId,
  );
  const state = cursorSchema.parse(JSON.parse(Buffer.from(bytes).toString()));
  if (state.id !== scan.id || state.result.inputUrl !== scan.inputUrl)
    throw new PlatformError(
      "The saved scan identity failed verification.",
      503,
    );
  state.result.pages = saved.map((c) =>
    discoverySchema.shape.pages.element.parse(c.summary),
  );
  const accepted = new Set(saved.map((c) => c.normalizedUrl));
  state.result.skipped = state.result.skipped.filter(
    (p) => !accepted.has(p.url),
  );
  const seen = new Set([...state.seen, ...accepted]);
  const queue = new Set(state.queue.filter((url) => !seen.has(url)));
  for (const page of state.result.pages)
    for (const link of page.links) {
      const url = crawlable(link, state.result.origin);
      if (url && !seen.has(url) && queue.size < MAX_CRAWL_URLS) queue.add(url);
    }
  state.seen = [...seen];
  state.queue = [...queue];
  return state;
}
function coverage(state: CrawlState): Coverage {
  return {
    captured: state.result.pages.length,
    pending: state.queue.length,
    skipped: state.result.skipped.length,
    discovered: state.result.discovered,
    complete: state.result.complete,
    warnings: state.result.warnings,
    canContinue: state.result.crawl?.canContinue ?? false,
    canExtend: state.result.crawl?.canExtend ?? false,
  };
}
async function capturePage(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  project: Project,
  scan: Scan,
  token: number,
  evidence: PageEvidence,
) {
  const raw = await prepareObject(
    store,
    project,
    evidence.raw,
    "source.html",
    "text/html",
  );
  const full = await prepareObject(
    store,
    project,
    encode({
      version: 1,
      extractorVersion: scan.config.extractorVersion,
      page: evidence.fullPage,
    }),
    "page-evidence.json",
  );
  const rendered = evidence.renderedHtml
    ? await prepareObject(
        store,
        project,
        Buffer.from(evidence.renderedHtml),
        "rendered.html",
        "text/html",
      )
    : null;
  return projectTransaction(
    db,
    actor,
    project.id,
    true,
    async (client, current) => {
      await lease(client, scan.id, token);
      await registerObject(client, actor, current, raw);
      await registerObject(client, actor, current, full);
      if (rendered) await registerObject(client, actor, current, rendered);
      await client.query(
        `INSERT INTO everonn_platform.page_captures (id,tenant_id,project_id,crawl_run_id,normalized_url,final_url,http_status,capture_started_at,captured_at,rendered_at,raw_sha256,text_sha256,extractor_version,raw_object_id,evidence_object_id,rendered_object_id,summary)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
        [
          randomUUID(),
          current.tenantId,
          current.id,
          scan.id,
          evidence.requestedUrl,
          evidence.fullPage.url,
          evidence.status,
          evidence.captureStartedAt,
          evidence.capturedAt,
          evidence.renderedAt ?? null,
          raw.sha256,
          digest(Buffer.from(evidence.fullPage.text)),
          scan.config.extractorVersion,
          raw.id,
          full.id,
          rendered?.id ?? null,
          JSON.stringify(evidence.summary),
        ],
      );
      await client.query(
        "UPDATE everonn_platform.crawl_runs SET revision=revision+1,updated_at=now() WHERE id=$1",
        [scan.id],
      );
    },
  );
}
export async function runScanBatch(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  runId: string,
  options: { extend?: boolean; retrySkipped?: boolean } = {},
  externalSignal?: AbortSignal,
  runtime: DiscoveryRuntime = {},
) {
  const claimed = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, project) => {
      await projectLock(client, projectId);
      const scan = await scanRow(client, runId, true);
      if (scan.config.evidenceMode !== (runtime.evidenceMode ?? "live"))
        throw new PlatformError(
          "This scan requires the same server evidence mode it was created with.",
          409,
        );
      if (
        (
          await client.query(
            "SELECT id FROM everonn_platform.crawl_runs WHERE status='running'",
          )
        ).rows.length
      )
        throw new PlatformError(
          "A scan batch is already running for this project.",
          409,
        );
      if (scan.status === "complete" && !options.retrySkipped)
        throw new PlatformError(
          "This scan has finished. Start a new scan to refresh its evidence.",
          409,
        );
      const limit = options.extend
        ? Math.min(
            MAX_CRAWL_PAGES,
            Math.max(scan.pageLimit + scan.config.maxPages, scan.pageLimit * 2),
          )
        : scan.pageLimit;
      await client.query(
        `UPDATE everonn_platform.crawl_runs SET status='running',lease_token=lease_token+1,lease_expires_at=clock_timestamp()+interval '120 seconds',
      pause_requested=false,page_limit=$2,revision=revision+1,last_error=NULL,updated_at=now() WHERE id=$1`,
        [scan.id, limit],
      );
      const current = await scanRow(client, runId);
      await jobState(client, current, "running", "request_batch_running");
      return { scan: current, project };
    },
  );
  const { scan, project } = claimed,
    token = scan.leaseToken;
  const controller = new AbortController();
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, controller.signal])
    : controller.signal;
  let heartbeat: Promise<void> = Promise.resolve();
  let heartbeatError: unknown;
  const timer = setInterval(() => {
    heartbeat = heartbeat
      .then(async () => {
        const pause = await projectTransaction(
          db,
          actor,
          projectId,
          true,
          async (client) => {
            const current = await lease(client, runId, token);
            await client.query(
              "UPDATE everonn_platform.crawl_runs SET lease_expires_at=clock_timestamp()+interval '120 seconds' WHERE id=$1",
              [runId],
            );
            return current.pauseRequested;
          },
        );
        if (pause) controller.abort();
      })
      .catch((error) => {
        heartbeatError = error;
        controller.abort();
      });
  }, 1000);
  let state: CrawlState | undefined;
  try {
    state = await restore(db, store, actor, projectId, scan);
    if (options.retrySkipped && state) {
      const retry = state.result.skipped
        .filter((p) => !p.reason.includes("robots.txt"))
        .map((p) => p.url);
      state.result.skipped = state.result.skipped.filter(
        (p) => !retry.includes(p.url),
      );
      state.seen = state.seen.filter((url) => !retry.includes(url));
      state.queue = [...new Set([...state.queue, ...retry])].slice(
        0,
        MAX_CRAWL_URLS,
      );
    }
    await discoverWebsite(scan.inputUrl, () => {}, signal, {
      resource: runtime.resource,
      browser: runtime.browser,
      resume: state,
      id: runId,
      maxPages: scan.pageLimit,
      batchPages: scan.config.batchPages,
      batchMs: scan.config.batchMs,
      concurrency: scan.config.concurrency,
      onCapture: (evidence) =>
        capturePage(db, store, actor, project, scan, token, evidence),
      onCheckpoint: async (checkpoint) => {
        const object = await prepareObject(
          store,
          project,
          encode({
            ...checkpoint,
            result: { ...checkpoint.result, pages: [] },
          }),
          "crawl-checkpoint.json",
        );
        await projectTransaction(
          db,
          actor,
          projectId,
          true,
          async (client, current) => {
            const active = await lease(client, runId, token);
            await registerObject(client, actor, current, object);
            await client.query(
              `UPDATE everonn_platform.crawl_runs SET checkpoint_object_id=$2,coverage=$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1`,
              [runId, object.id, JSON.stringify(coverage(checkpoint))],
            );
            if (active.pauseRequested) controller.abort();
          },
        );
        state = structuredClone(checkpoint);
      },
    });
    clearInterval(timer);
    await heartbeat;
    if (heartbeatError) throw heartbeatError;
    await projectTransaction(db, actor, projectId, true, async (client) => {
      const active = await lease(client, runId, token);
      const status =
        active.pauseRequested || signal.aborted
          ? "paused"
          : (state?.result.crawl?.status ?? "paused");
      await client.query(
        "UPDATE everonn_platform.crawl_runs SET status=$2,lease_expires_at=NULL,revision=revision+1,updated_at=now() WHERE id=$1",
        [runId, status],
      );
      await jobState(
        client,
        scan,
        status === "complete"
          ? state?.result.complete
            ? "succeeded"
            : "failed"
          : "queued",
        status === "complete"
          ? "scan_finished_review_coverage"
          : "awaiting_request_batch",
      );
    });
  } catch (error) {
    clearInterval(timer);
    await heartbeat;
    // Never let a late process replace the new lease holder's state.
    await projectTransaction(db, actor, projectId, true, async (client) => {
      const active = (
        await client.query<{ id: string }>(
          "SELECT id FROM everonn_platform.crawl_runs WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_expires_at>clock_timestamp() FOR UPDATE",
          [runId, token],
        )
      ).rows[0];
      if (!active) return;
      const interrupted = signal.aborted && !heartbeatError;
      await client.query(
        "UPDATE everonn_platform.crawl_runs SET status=$2,lease_expires_at=NULL,last_error=$3,revision=revision+1,updated_at=now() WHERE id=$1",
        [
          runId,
          interrupted ? "paused" : "failed",
          interrupted
            ? null
            : "This batch could not finish. Accepted pages remain saved; retry to continue.",
        ],
      );
      await jobState(
        client,
        scan,
        interrupted ? "queued" : "failed",
        interrupted ? "batch_interrupted" : "batch_failed",
      );
    }).catch(() => {});
    if (!(signal.aborted && !heartbeatError)) {
      if (error instanceof PlatformError) throw error;
      throw new PlatformError(
        "Discovery could not finish this batch. Accepted pages remain saved; retry to continue.",
        503,
      );
    }
  } finally {
    clearInterval(timer);
  }
  return scanDetail(db, actor, projectId, runId);
}
export async function pauseScan(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  runId: string,
) {
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, project) => {
      await projectLock(client, projectId);
      const scan = await scanRow(client, runId, true);
      await client.query(
        "UPDATE everonn_platform.crawl_runs SET pause_requested=true,revision=revision+1,updated_at=now() WHERE id=$1",
        [runId],
      );
      await audit(
        client,
        actor,
        project.tenantId,
        project.id,
        "discovery.pause_requested",
        scan.id,
      );
      return scanRow(client, runId);
    },
  );
}
function inventory(state: CrawlState, saved: Capture[]): InventoryPage[] {
  const rows = new Map<string, InventoryPage>();
  for (const url of state.queue)
    rows.set(url, { url, outcome: "pending", captureId: null });
  for (const skip of state.result.skipped)
    rows.set(skip.url, {
      url: skip.url,
      outcome: "skipped",
      captureId: null,
      reason: skip.reason,
    });
  for (const capture of saved)
    rows.set(capture.normalizedUrl, {
      url: capture.normalizedUrl,
      outcome: "captured",
      captureId: capture.id,
      title: capture.summary.title,
      capturedAt: capture.capturedAt,
      rawSha256: capture.rawSha256,
      textSha256: capture.textSha256,
    });
  return [...rows.values()].sort((a, b) => a.url.localeCompare(b.url));
}
export async function scanPages(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  runId: string,
  offset = 0,
) {
  const scan = await projectTransaction(db, actor, projectId, false, (client) =>
    scanRow(client, runId),
  );
  const state = await restore(db, store, actor, projectId, scan);
  const saved = await projectTransaction(
    db,
    actor,
    projectId,
    false,
    (client) => captures(client, runId),
  );
  const rows = state ? inventory(state, saved) : [];
  return { pages: rows.slice(offset, offset + 100), total: rows.length };
}
export async function freezeSnapshot(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  runId: string,
  allowIncomplete = false,
) {
  const scan = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client) => {
      const current = await scanRow(client, runId);
      if (current.status === "running")
        throw new PlatformError(
          "Pause the scan and wait for its batch to finish before freezing a snapshot.",
          409,
        );
      return current;
    },
  );
  const existing = await projectTransaction(
    db,
    actor,
    projectId,
    false,
    async (client) =>
      (
        await client.query<Snapshot>(
          `SELECT ${snapshotColumns} FROM everonn_platform.source_snapshots WHERE crawl_run_id=$1 AND crawl_revision=$2`,
          [runId, scan.revision],
        )
      ).rows[0],
  );
  if (existing) return existing;
  const state = await restore(db, store, actor, projectId, scan);
  if (!state?.result.pages.length)
    throw new PlatformError(
      "Capture at least one readable page before freezing a snapshot.",
      422,
    );
  const saved = await projectTransaction(
    db,
    actor,
    projectId,
    false,
    (client) => captures(client, runId),
  );
  const rows = inventory(state, saved),
    counts = coverage(state);
  counts.captured = saved.length;
  counts.pending = rows.filter((p) => p.outcome === "pending").length;
  counts.skipped = rows.filter((p) => p.outcome === "skipped").length;
  counts.discovered = rows.length;
  counts.complete =
    scan.status === "complete" &&
    counts.complete &&
    !counts.pending &&
    !counts.skipped;
  if (!counts.complete && !allowIncomplete)
    throw new PlatformError(
      "This scan has incomplete coverage. Explicitly acknowledge a partial snapshot to preserve it.",
      422,
    );
  const scope = {
    inputUrl: scan.inputUrl,
    pageLimit: scan.pageLimit,
    evidenceMode: scan.config.evidenceMode,
    extractorVersion: scan.config.extractorVersion,
    limitations,
  };
  const start = new Date(
    Math.min(...saved.map((p) => Date.parse(p.captureStartedAt))),
  ).toISOString();
  const end = new Date(
    Math.max(...saved.map((p) => Date.parse(p.renderedAt ?? p.capturedAt))),
  ).toISOString();
  const id = randomUUID();
  const manifest = {
    version: 1,
    id,
    crawlRunId: runId,
    crawlRevision: scan.revision,
    coverage: counts,
    scope,
    captureStartedAt: start,
    captureEndedAt: end,
    pages: rows,
    captures: saved.map((capture) => ({
      id: capture.id,
      normalizedUrl: capture.normalizedUrl,
      finalUrl: capture.finalUrl,
      httpStatus: capture.httpStatus,
      captureStartedAt: capture.captureStartedAt,
      capturedAt: capture.capturedAt,
      renderedAt: capture.renderedAt,
      rawSha256: capture.rawSha256,
      textSha256: capture.textSha256,
      rawObjectId: capture.rawObjectId,
      evidenceObjectId: capture.evidenceObjectId,
    })),
  };
  const project = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (_, project) => project,
  );
  const object = await prepareObject(
    store,
    project,
    encode(manifest),
    "source-snapshot.json",
  );
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, current) => {
      const active = await scanRow(client, runId, true);
      const replay = (
        await client.query<Snapshot>(
          `SELECT ${snapshotColumns} FROM everonn_platform.source_snapshots WHERE crawl_run_id=$1 AND crawl_revision=$2`,
          [runId, scan.revision],
        )
      ).rows[0];
      if (replay) return replay;
      if (active.status === "running" || active.revision !== scan.revision)
        throw new PlatformError(
          "The scan changed while the snapshot was being frozen. Review its latest coverage and try again.",
          409,
        );
      await registerObject(client, actor, current, object);
      await client.query(
        `INSERT INTO everonn_platform.source_snapshots (id,tenant_id,project_id,crawl_run_id,crawl_revision,manifest_object_id,manifest_sha256,coverage,scope,capture_started_at,capture_ended_at,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`,
        [
          id,
          current.tenantId,
          current.id,
          runId,
          scan.revision,
          object.id,
          object.sha256,
          JSON.stringify(counts),
          JSON.stringify(scope),
          start,
          end,
          actor.id,
        ],
      );
      await client.query(
        `INSERT INTO everonn_platform.snapshot_pages (tenant_id,project_id,snapshot_id,crawl_run_id,normalized_url,outcome,capture_id,reason)
      SELECT $1,$2,$3,$4,x.url,x.outcome,x."captureId"::uuid,x.reason FROM jsonb_to_recordset($5::jsonb) AS x(url text,outcome text,"captureId" text,reason text)`,
        [current.tenantId, current.id, id, runId, JSON.stringify(rows)],
      );
      await audit(
        client,
        actor,
        current.tenantId,
        current.id,
        "snapshot.frozen",
        id,
      );
      return (
        await client.query<Snapshot>(
          `SELECT ${snapshotColumns} FROM everonn_platform.source_snapshots WHERE id=$1`,
          [id],
        )
      ).rows[0];
    },
  );
}
export async function listSnapshots(
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
        await client.query<Snapshot>(
          `SELECT ${snapshotColumns} FROM everonn_platform.source_snapshots ORDER BY created_at DESC,id DESC LIMIT 100`,
        )
      ).rows,
  );
}
export async function snapshotDetail(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  id: string,
  offset = 0,
) {
  uuid.parse(id);
  const result = await projectTransaction(
    db,
    actor,
    projectId,
    false,
    async (client) => {
      const snapshot = (
        await client.query<Snapshot>(
          `SELECT ${snapshotColumns} FROM everonn_platform.source_snapshots WHERE id=$1`,
          [id],
        )
      ).rows[0];
      if (!snapshot)
        throw new PlatformError(
          "This snapshot is unavailable or you do not have access.",
          404,
        );
      const pages = (
        await client.query<InventoryPage>(
          `SELECT p.normalized_url AS url,p.outcome,p.capture_id AS "captureId",p.reason,c.summary->>'title' AS title,c.captured_at::text AS "capturedAt",c.raw_sha256 AS "rawSha256",c.text_sha256 AS "textSha256"
      FROM everonn_platform.snapshot_pages p LEFT JOIN everonn_platform.page_captures c ON c.id=p.capture_id WHERE p.snapshot_id=$1 ORDER BY p.normalized_url LIMIT 100 OFFSET $2`,
          [id, offset],
        )
      ).rows;
      return { snapshot, pages, total: snapshot.coverage.discovered };
    },
  );
  const manifest = await loadArtifact(
    db,
    store,
    actor,
    projectId,
    result.snapshot.manifestObjectId,
  );
  if (manifest.record.sha256 !== result.snapshot.manifestSha256)
    throw new PlatformError(
      "The frozen snapshot failed integrity verification.",
      503,
    );
  return result;
}
export async function snapshotPage(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  snapshotId: string,
  captureId: string,
) {
  uuid.parse(snapshotId);
  uuid.parse(captureId);
  const capture = await projectTransaction(
    db,
    actor,
    projectId,
    false,
    async (client) => {
      const row = (
        await client.query<Capture>(
          `SELECT ${captureColumns} FROM everonn_platform.page_captures WHERE id=$2 AND EXISTS(SELECT 1 FROM everonn_platform.snapshot_pages WHERE snapshot_id=$1 AND capture_id=$2)`,
          [snapshotId, captureId],
        )
      ).rows[0];
      if (!row)
        throw new PlatformError(
          "This page is not part of that snapshot or you do not have access.",
          404,
        );
      return row;
    },
  );
  const object = await loadArtifact(
    db,
    store,
    actor,
    projectId,
    capture.evidenceObjectId,
  );
  const evidence = JSON.parse(Buffer.from(object.bytes).toString()) as {
    version: number;
    extractorVersion: string;
    page: Capture["summary"];
  };
  if (
    evidence.version !== 1 ||
    typeof evidence.page?.text !== "string" ||
    digest(Buffer.from(evidence.page.text)) !== capture.textSha256
  )
    throw new PlatformError(
      "This page's evidence failed integrity verification.",
      503,
    );
  return { capture, evidence };
}

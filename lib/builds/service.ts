import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Actor } from "../auth/sessions";
import type { PlatformDatabase, SqlClient } from "../platform/database";
import { localPlatformMode, PlatformError } from "../platform/config";
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
import { blueprintDetail, factSetDetail } from "../knowledge/service";
import { snapshotDetail } from "../discovery/service";
import { websiteProvider, websiteKeyName } from "../api";
import { getModels } from "../openrouter";
import { zipFiles } from "../site-pages";
import {
  createDesign,
  validateDesign,
  type DesignResult,
  type Design,
  requireThemedDesign,
  type DesignBrief,
} from "./design";
import { readSkill } from "../website-skill";
import { designGuidance } from "../intelligence/service";
import { generateSource, compileSite, type SiteContent } from "./compiler";
import {
  verifySite,
  previewFile,
  mediaType,
  contentSecurityPolicy,
} from "./verification";
import {
  startBuildInput,
  enquiryInput,
  type Build,
  type BuildManifest,
  type BuildVerification,
} from "./contracts";
export type BuildRuntime = {
  design?: typeof createDesign;
  mode?: "live" | "fixture";
};
const columns = `id,alternative_id AS "alternativeId",blueprint_id AS "blueprintId",revision,status,stage,lease_token::int AS "leaseToken",
 COALESCE(lease_expires_at>clock_timestamp(),false) AS "leaseActive",design_object_id AS "designObjectId",manifest_object_id AS "manifestObjectId",seal_sha256 AS "sealSha256",error,inputs,created_at::text AS "createdAt"`;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const fixtureMode = () =>
  localPlatformMode() &&
  process.env.PLATFORM_TEST_OUTPUT === "1" &&
  process.env.PLATFORM_TEST_CRAWL_FIXTURE === "1";
async function buildRow(client: SqlClient, id: string, lock = false) {
  uuid.parse(id);
  const row = (
    await client.query<Build>(
      `SELECT ${columns} FROM everonn_platform.website_builds WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!row)
    throw new PlatformError(
      "This build is unavailable or you do not have access.",
      404,
    );
  return row;
}
async function buildLease(client: SqlClient, id: string, token: number) {
  const build = await buildRow(client, id, true);
  if (build.leaseToken !== token || !build.leaseActive)
    throw new PlatformError(
      "Build execution expired. Reload to resume the saved stage.",
      409,
    );
  return build;
}
export async function listBuilds(
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
        await client.query<Build>(
          `SELECT ${columns} FROM everonn_platform.website_builds ORDER BY created_at DESC,id DESC LIMIT 100`,
        )
      ).rows,
  );
}
export async function buildDetail(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  id: string,
) {
  return projectTransaction(db, actor, projectId, false, async (client) => ({
    build: await buildRow(client, id),
    checks: (
      await client.query<{ result: BuildVerification }>(
        "SELECT result FROM everonn_platform.build_checks WHERE build_id=$1 ORDER BY created_at DESC LIMIT 10",
        [id],
      )
    ).rows.map((row) => row.result),
  }));
}
export async function startBuild(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  input: unknown,
  runtime: BuildRuntime = {},
) {
  const data = startBuildInput.parse(input);
  const replay = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client) =>
      (
        await client.query<Build>(
          `SELECT ${columns} FROM everonn_platform.website_builds WHERE request_key=$1`,
          [data.requestKey],
        )
      ).rows[0],
  );
  if (replay) {
    if (
      replay.blueprintId !== data.blueprintId ||
      replay.alternativeId !== data.alternativeId
    )
      throw new PlatformError(
        "This build request key belongs to different inputs.",
        409,
      );
    return replay;
  }
  const blueprint = await blueprintDetail(
    db,
    store,
    actor,
    projectId,
    data.blueprintId,
  );
  if (blueprint.record.status !== "approved")
    throw new PlatformError(
      "Approve the exact blueprint revision before generating websites.",
      422,
    );
  const facts = await factSetDetail(
    db,
    store,
    actor,
    projectId,
    blueprint.record.factSetId,
  );
  const snapshot = await snapshotDetail(
    db,
    store,
    actor,
    projectId,
    blueprint.record.snapshotId,
  );
  if (
    facts.record.status !== "approved" ||
    facts.record.snapshotId !== snapshot.snapshot.id
  )
    throw new PlatformError("Approved input revisions do not agree.", 422);
  const alternative = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client) =>
      (
        await client.query<{ slot: number }>(
          "SELECT slot FROM everonn_platform.design_alternatives WHERE id=$1",
          [data.alternativeId],
        )
      ).rows[0],
  );
  if (!alternative)
    throw new PlatformError("This design alternative is unavailable.", 404);
  const test = runtime.mode === "fixture" || fixtureMode();
  if (!test && !process.env[websiteKeyName()]?.trim())
    throw new PlatformError(
      `Website generation needs ${websiteKeyName()} in the server environment.`,
      503,
    );
  const models = test ? [] : await getModels();
  const nextVersion = JSON.parse(
    await readFile(
      path.join(process.cwd(), "node_modules/next/package.json"),
      "utf8",
    ),
  ).version as string;
  const generation = {
    provider: websiteProvider(),
    preferredModel: test
      ? "deterministic-test-fixture"
      : models[(alternative.slot - 1) % models.length].id,
    nextVersion,
    nodeVersion: process.versions.node,
    instructionVersion: "context-theme-v3",
    featureVersion: "enquiry-1.0.0",
    designSkillSha256: digest(
      Buffer.from(await readSkill("website-designer", "Website designer")),
    ),
  };
  // Fix the owner's current improvement brief (growth-advice prompt + corrections)
  // into the immutable build inputs; later advice or corrections need a new build.
  const guidance = await designGuidance(db, store, actor, projectId);
  const inputs: Build["inputs"] = {
    snapshotId: snapshot.snapshot.id,
    snapshotSha256: snapshot.snapshot.manifestSha256,
    factSetId: facts.record.id,
    factSetSha256: facts.record.contentSha256,
    blueprintId: blueprint.record.id,
    blueprintSha256: blueprint.record.contentSha256,
    configSha256: digest(encode(generation)),
    generation,
    guidance,
    mode:
      test || snapshot.snapshot.scope.evidenceMode === "fixture"
        ? "fixture"
        : "live",
  };
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, current) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [current.id],
      );
      const prior = (
        await client.query<Build>(
          `SELECT ${columns} FROM everonn_platform.website_builds WHERE request_key=$1`,
          [data.requestKey],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.blueprintId !== data.blueprintId ||
          prior.alternativeId !== data.alternativeId
        )
          throw new PlatformError(
            "This build request key belongs to different inputs.",
            409,
          );
        return prior;
      }
      const revision = (
          await client.query<{ n: number }>(
            "SELECT COALESCE(max(revision),0)+1 AS n FROM everonn_platform.website_builds WHERE alternative_id=$1",
            [data.alternativeId],
          )
        ).rows[0].n,
        id = randomUUID();
      await client.query(
        `INSERT INTO everonn_platform.website_builds(id,tenant_id,project_id,alternative_id,blueprint_id,request_key,revision,inputs,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [
          id,
          current.tenantId,
          current.id,
          data.alternativeId,
          data.blueprintId,
          data.requestKey,
          revision,
          JSON.stringify(inputs),
          actor.id,
        ],
      );
      const pipeline = randomUUID();
      await client.query(
        `INSERT INTO everonn_platform.pipeline_runs(id,tenant_id,project_id,status,requested_by) VALUES($1,$2,$3,'queued',$4)`,
        [pipeline, current.tenantId, current.id, actor.id],
      );
      await client.query(
        `INSERT INTO everonn_platform.jobs(id,tenant_id,project_id,pipeline_run_id,stage,target_key,input_sha256,idempotency_key,state,reason) VALUES($1,$2,$3,$4,'website_generation',$5,$6,$7,'queued',$8::jsonb)`,
        [
          randomUUID(),
          current.tenantId,
          current.id,
          pipeline,
          id,
          digest(encode(inputs)),
          `build:${id}`,
          JSON.stringify({
            code: "awaiting_request_stage",
            execution: "request_stages",
          }),
        ],
      );
      await audit(
        client,
        actor,
        current.tenantId,
        current.id,
        "build.created",
        id,
      );
      return buildRow(client, id);
    },
  );
}
async function readDesign(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  build: Build,
): Promise<DesignResult> {
  if (!build.designObjectId)
    throw new PlatformError("This build has no accepted design yet.", 409);
  const object = await loadArtifact(
    db,
    store,
    actor,
    projectId,
    build.designObjectId,
  );
  const value = JSON.parse(
    Buffer.from(object.bytes).toString(),
  ) as DesignResult;
  return { ...value, design: validateDesign(value.design) };
}
/** The accepted design's reasoning, context read and theme (no CSS) for display. */
export async function buildDesignSummary(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  id: string,
) {
  const build = await projectTransaction(
    db,
    actor,
    projectId,
    false,
    (client) => buildRow(client, id),
  );
  const { design, model, mode } = await readDesign(
    db,
    store,
    actor,
    projectId,
    build,
  );
  return {
    model,
    mode,
    name: design.name,
    rationale: design.rationale,
    context: design.context ?? null,
    theme: design.theme ?? null,
    navigation: design.navigation,
    hero: design.hero,
    content: design.content,
    briefApplied: Boolean(build.inputs.guidance?.agentPrompt),
    correctionsApplied: build.inputs.guidance?.corrections.length ?? 0,
  };
}
async function siteContent(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  build: Build,
): Promise<SiteContent> {
  const blueprint = await blueprintDetail(
      db,
      store,
      actor,
      projectId,
      build.blueprintId,
    ),
    facts = await factSetDetail(
      db,
      store,
      actor,
      projectId,
      build.inputs.factSetId,
    );
  if (
    blueprint.record.contentSha256 !== build.inputs.blueprintSha256 ||
    facts.record.contentSha256 !== build.inputs.factSetSha256
  )
    throw new PlatformError(
      "The fixed build inputs failed integrity verification.",
      503,
    );
  const pages: SiteContent["pages"] = [];
  let size = 0;
  for (const page of blueprint.document.pages.filter(
    (page) => page.outcome === "render",
  )) {
    if (!page.contentObjectId)
      throw new PlatformError(
        "A required blueprint page lacks source content.",
        422,
      );
    const object = await loadArtifact(
      db,
      store,
      actor,
      projectId,
      page.contentObjectId,
    );
    if (object.record.sha256 !== page.contentSha256)
      throw new PlatformError(
        "Approved page content failed integrity verification.",
        503,
      );
    const data = z
      .object({
        text: z.string().max(3_000_000),
        headings: z.array(z.string()).max(60),
      })
      .parse(JSON.parse(Buffer.from(object.bytes).toString()));
    size += Buffer.byteLength(data.text);
    if (size > 32_000_000)
      throw new PlatformError(
        "Approved content exceeds the disclosed 32 MB build input limit. Revise scope explicitly.",
        413,
      );
    pages.push({
      id: page.id,
      path: page.path,
      title: page.title,
      family: page.family,
      ...data,
    });
  }
  return {
    business: Object.fromEntries(
      facts.document.facts
        .filter((f) => f.value && f.verification === "owner_confirmed")
        .map((f) => [f.key, f.value]),
    ),
    pages,
    redirects: blueprint.document.pages
      .filter((p) => p.outcome === "redirect")
      .map((p) => ({ path: p.path, target: p.target! })),
    basePath: `/api/platform/projects/${projectId}/builds/${build.id}/preview`,
    enquiryEndpoint: `/api/platform/projects/${projectId}/builds/${build.id}/enquiries`,
  };
}
export async function buildManifest(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  id: string,
) {
  const build = (await buildDetail(db, actor, projectId, id)).build;
  if (!build.manifestObjectId || !build.sealSha256)
    throw new PlatformError("The build has not been compiled and sealed.", 409);
  const object = await loadArtifact(
    db,
    store,
    actor,
    projectId,
    build.manifestObjectId,
  );
  if (object.record.sha256 !== build.sealSha256)
    throw new PlatformError("Build seal integrity verification failed.", 503);
  const manifest = JSON.parse(
    Buffer.from(object.bytes).toString(),
  ) as BuildManifest;
  if (
    manifest.buildId !== id ||
    manifest.inputs.blueprintId !== build.blueprintId
  )
    throw new PlatformError("Build seal identity failed verification.", 503);
  return { build, manifest };
}
async function registerCompilation(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  project: Project,
  build: Build,
  token: number,
  design: DesignResult,
  content: SiteContent,
  signal?: AbortSignal,
) {
  const generated = await generateSource(content, design.design, build.inputs);
  if (generated.nextVersion !== build.inputs.generation.nextVersion)
    throw new PlatformError(
      "The compiler version changed. Create a new build configuration.",
      409,
    );
  const output = await compileSite(generated.files, signal);
  const objects: { path: string; object: PreparedObject }[] = [];
  for (const [name, bytes] of [
    ...[...generated.files.entries()].map(
      ([p, b]) => ["source/" + p, b] as const,
    ),
    ...[...output.entries()].map(([p, b]) => ["output/" + p, b] as const),
  ])
    objects.push({
      path: name,
      object: await prepareObject(
        store,
        project,
        bytes,
        path.basename(name),
        mediaType(name),
      ),
    });
  const sourceZip = zipFiles(
      [...generated.files].map(([name, content]) => ({ name, content })),
    ),
    outputZip = zipFiles(
      [...output].map(([name, content]) => ({ name, content })),
    );
  const sourceArchive = await prepareObject(
      store,
      project,
      sourceZip,
      "website-source.zip",
      "application/zip",
    ),
    outputArchive = await prepareObject(
      store,
      project,
      outputZip,
      "website-output.zip",
      "application/zip",
    );
  const manifest: BuildManifest = {
    version: 1,
    buildId: build.id,
    inputs: build.inputs,
    design: {
      model: design.model,
      usage: design.usage,
      mode: design.mode,
      sha256: digest(encode(design.design)),
    },
    routes: content.pages.map((p) => ({
      path: p.path,
      pageId: p.id,
      contentSha256: digest(Buffer.from(p.text)),
      family: p.family,
    })),
    redirects: content.redirects,
    files: objects.map(({ path, object }) => ({
      path,
      objectId: object.id,
      sha256: object.sha256,
      byteSize: object.byteSize,
    })),
    sourceArchiveId: sourceArchive.id,
    outputArchiveId: outputArchive.id,
    dependencyLockSha256: digest(generated.files.get("package-lock.json")!),
    nextVersion: generated.nextVersion,
  };
  const seal = await prepareObject(
    store,
    project,
    encode(manifest),
    "build-manifest.json",
  );
  await projectTransaction(
    db,
    actor,
    project.id,
    true,
    async (client, current) => {
      await buildLease(client, build.id, token);
      for (const { path, object } of objects) {
        await registerObject(client, actor, current, object);
        await client.query(
          "INSERT INTO everonn_platform.build_files(tenant_id,project_id,build_id,path,object_id) VALUES($1,$2,$3,$4,$5)",
          [current.tenantId, current.id, build.id, path, object.id],
        );
      }
      for (const object of [sourceArchive, outputArchive, seal])
        await registerObject(client, actor, current, object);
      await client.query(
        `UPDATE everonn_platform.website_builds SET stage=2,status='compiled',manifest_object_id=$2,seal_sha256=$3,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,
        [build.id, seal.id, seal.sha256],
      );
    },
  );
}
async function updateJob(
  client: SqlClient,
  id: string,
  state: string,
  code: string,
) {
  await client.query(
    `UPDATE everonn_platform.jobs SET state=$2,reason=$3::jsonb WHERE stage='website_generation' AND target_key=$1`,
    [id, state, JSON.stringify({ code, execution: "request_stages" })],
  );
  await client.query(
    `UPDATE everonn_platform.pipeline_runs SET status=$2 WHERE id IN(SELECT pipeline_run_id FROM everonn_platform.jobs WHERE stage='website_generation' AND target_key=$1)`,
    [
      id,
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
export async function runBuildStage(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  id: string,
  signal?: AbortSignal,
  runtime: BuildRuntime = {},
) {
  const claim = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, project) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [project.id],
      );
      const build = await buildRow(client, id, true);
      if (build.status === "ready") return { build, project, done: true };
      if (build.leaseActive)
        throw new PlatformError("This build stage is already running.", 409);
      const overlap = (
        await client.query(
          `SELECT id FROM everonn_platform.website_builds WHERE alternative_id=$1 AND id<>$2 AND lease_expires_at>clock_timestamp()`,
          [build.alternativeId, id],
        )
      ).rows.length;
      if (overlap)
        throw new PlatformError(
          "Another build is running for this alternative.",
          409,
        );
      await client.query(
        `UPDATE everonn_platform.website_builds SET status=CASE stage WHEN 0 THEN 'queued' WHEN 1 THEN 'designed' ELSE 'compiled' END,lease_expires_at=NULL,lease_token=lease_token+1 WHERE alternative_id=$1 AND id<>$2 AND status IN('designing','compiling','verifying')`,
        [build.alternativeId, id],
      );
      const status = ["designing", "compiling", "verifying"][build.stage];
      await client.query(
        `UPDATE everonn_platform.website_builds SET status=$2,lease_token=lease_token+1,lease_expires_at=clock_timestamp()+interval '300 seconds',error=NULL,updated_at=now() WHERE id=$1`,
        [id, status],
      );
      await updateJob(client, id, "running", status);
      return { build: await buildRow(client, id), project, done: false };
    },
  );
  if (claim.done) return buildDetail(db, actor, projectId, id);
  const { build, project } = claim,
    token = build.leaseToken;
  const controller = new AbortController(),
    combined = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
  let heartbeat = Promise.resolve();
  let heartbeatFailure: unknown;
  const timer = setInterval(() => {
    heartbeat = heartbeat
      .then(async () => {
        await projectTransaction(db, actor, projectId, true, async (client) => {
          const current = await buildRow(client, id, true);
          if (
            current.leaseToken === token &&
            !current.leaseActive &&
            !["designing", "compiling", "verifying"].includes(current.status)
          )
            return;
          await buildLease(client, id, token);
          await client.query(
            "UPDATE everonn_platform.website_builds SET lease_expires_at=clock_timestamp()+interval '300 seconds' WHERE id=$1",
            [id],
          );
        });
      })
      .catch((error) => {
        heartbeatFailure = error;
        controller.abort();
      });
  }, 5000);
  try {
    if (build.stage === 0) {
      if (build.inputs.generation.provider !== websiteProvider())
        throw new PlatformError(
          "The provider configuration changed. Create a new build.",
          409,
        );
      const blueprint = await blueprintDetail(
          db,
          store,
          actor,
          projectId,
          build.blueprintId,
        ),
        facts = await factSetDetail(
          db,
          store,
          actor,
          projectId,
          build.inputs.factSetId,
        );
      const peerRows = await projectTransaction(
        db,
        actor,
        projectId,
        false,
        async (client) =>
          (
            await client.query<Build>(
              `SELECT ${columns} FROM everonn_platform.website_builds WHERE id<>$1 AND alternative_id<>$2 AND blueprint_id=$3 AND design_object_id IS NOT NULL ORDER BY created_at DESC LIMIT 6`,
              [id, build.alternativeId, build.blueprintId],
            )
          ).rows,
      );
      const peers: Design[] = [];
      for (const peer of peerRows)
        peers.push(
          (await readDesign(db, store, actor, projectId, peer)).design,
        );
      const slot = await projectTransaction(
        db,
        actor,
        projectId,
        false,
        async (client) =>
          (
            await client.query<{ slot: number }>(
              "SELECT slot FROM everonn_platform.design_alternatives WHERE id=$1",
              [build.alternativeId],
            )
          ).rows[0].slot,
      );
      const guidance = build.inputs.guidance;
      const content = await siteContent(db, store, actor, projectId, build);
      // Real page headings and excerpts let the designer read the business's context.
      const brief: DesignBrief = {
        pages: content.pages.slice(0, 60).map((page) => ({
          path: page.path,
          title: page.title,
          family: page.family,
          headings: page.headings.slice(0, 6),
          excerpt: page.text.slice(0, 700),
        })),
        ...(guidance?.agentPrompt ? { agentPrompt: guidance.agentPrompt } : {}),
        ...(guidance?.customerGaps
          ? { customerGaps: guidance.customerGaps }
          : {}),
        corrections: guidance?.corrections.map((item) => item.body) ?? [],
      };
      const result = await (runtime.design ?? createDesign)(
        blueprint.document,
        facts.document.facts,
        slot,
        peers,
        combined,
        build.inputs.generation.preferredModel,
        brief,
      );
      result.design = validateDesign(result.design);
      if (build.inputs.mode === "live") requireThemedDesign(result.design);
      if (
        peers.some(
          (peer) =>
            digest(encode(peer)) === digest(encode(result.design)) ||
            peer.css === result.design.css ||
            (peer.navigation === result.design.navigation &&
              peer.hero === result.design.hero &&
              peer.content === result.design.content),
        )
      )
        throw new PlatformError(
          "This alternative needs a distinct design composition. Retry design generation.",
          422,
        );
      if (build.inputs.mode === "live" && result.mode !== "live")
        throw new PlatformError(
          "Fixture design cannot complete a live build.",
          409,
        );
      const object = await prepareObject(
        store,
        project,
        encode(result),
        "design.json",
      );
      await projectTransaction(
        db,
        actor,
        projectId,
        true,
        async (client, current) => {
          await buildLease(client, id, token);
          await registerObject(client, actor, current, object);
          await client.query(
            `UPDATE everonn_platform.website_builds SET stage=1,status='designed',design_object_id=$2,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,
            [id, object.id],
          );
        },
      );
    } else if (build.stage === 1)
      await registerCompilation(
        db,
        store,
        actor,
        project,
        build,
        token,
        await readDesign(db, store, actor, projectId, build),
        await siteContent(db, store, actor, projectId, build),
        combined,
      );
    else {
      const { manifest } = await buildManifest(db, store, actor, projectId, id),
        content = await siteContent(db, store, actor, projectId, build),
        output = new Map<string, Uint8Array>();
      for (const file of manifest.files.filter((file) =>
        file.path.startsWith("output/"),
      )) {
        const object = await loadArtifact(
          db,
          store,
          actor,
          projectId,
          file.objectId,
        );
        if (object.record.sha256 !== file.sha256)
          throw new PlatformError(
            "Compiled output integrity verification failed.",
            503,
          );
        output.set(file.path.slice(7), object.bytes);
      }
      const evidence = await verifySite(
        output,
        content,
        manifest,
        build.sealSha256!,
        (input) => submitEnquiry(db, actor, projectId, id, input, true),
        combined,
      );
      await projectTransaction(
        db,
        actor,
        projectId,
        true,
        async (client, current) => {
          await buildLease(client, id, token);
          await client.query(
            "INSERT INTO everonn_platform.build_checks(id,tenant_id,project_id,build_id,seal_sha256,result) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
            [
              randomUUID(),
              current.tenantId,
              current.id,
              id,
              build.sealSha256,
              JSON.stringify(evidence),
            ],
          );
          await client.query(
            `UPDATE everonn_platform.website_builds SET status=$2,stage=$3,error=$4,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,
            [
              id,
              evidence.passed ? "ready" : "failed",
              evidence.passed ? 3 : 2,
              evidence.passed
                ? null
                : "Required verification did not pass. Review the exact-build checks; retry verification or create a new build.",
            ],
          );
          await audit(
            client,
            actor,
            current.tenantId,
            current.id,
            evidence.passed ? "build.verified" : "build.verification_failed",
            id,
          );
        },
      );
    }
    clearInterval(timer);
    await heartbeat;
    if (heartbeatFailure) throw heartbeatFailure;
    await projectTransaction(db, actor, projectId, true, async (client) => {
      const current = await buildRow(client, id);
      await updateJob(
        client,
        id,
        current.status === "ready"
          ? "succeeded"
          : current.status === "failed"
            ? "failed"
            : "queued",
        current.status,
      );
    });
  } catch (error) {
    clearInterval(timer);
    await heartbeat;
    await projectTransaction(db, actor, projectId, true, async (client) => {
      const current = await buildRow(client, id, true);
      if (
        current.leaseToken !== token ||
        !current.leaseActive ||
        current.status === "ready"
      )
        return;
      await client.query(
        "UPDATE everonn_platform.website_builds SET status='failed',lease_expires_at=NULL,error=$2,updated_at=now() WHERE id=$1",
        [
          id,
          error instanceof PlatformError
            ? error.message
            : "This stage failed. Accepted stages remain saved; retry to continue.",
        ],
      );
      await updateJob(client, id, "failed", "stage_failed");
    }).catch(() => {});
    if (error instanceof PlatformError) throw error;
    throw new PlatformError(
      "Website generation could not finish this stage. Accepted stages remain saved; retry to continue.",
      503,
    );
  } finally {
    clearInterval(timer);
  }
  return buildDetail(db, actor, projectId, id);
}
export async function submitEnquiry(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  buildId: string,
  input: unknown,
  isTest = false,
) {
  const data = enquiryInput.parse(input);
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, current) => {
      const build = await buildRow(client, buildId);
      if (build.stage < 2 || !build.manifestObjectId)
        throw new PlatformError(
          "This build has no prepared enquiry feature.",
          409,
        );
      const prior = (
        await client.query<{
          id: string;
          name: string;
          email: string;
          message: string;
        }>(
          "SELECT id,name,email,message FROM everonn_platform.enquiries WHERE build_id=$1 AND request_key=$2",
          [buildId, data.requestKey],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.name !== data.name ||
          prior.email !== data.email ||
          prior.message !== data.message
        )
          throw new PlatformError(
            "This enquiry request was already used with different content.",
            409,
          );
        return { enquiryId: prior.id, saved: true };
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO everonn_platform.enquiries(id,tenant_id,project_id,build_id,request_key,name,email,message,is_test) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(build_id,request_key) DO NOTHING`,
        [
          id,
          current.tenantId,
          current.id,
          buildId,
          data.requestKey,
          data.name,
          data.email,
          data.message,
          isTest,
        ],
      );
      const accepted = (
        await client.query<{
          id: string;
          name: string;
          email: string;
          message: string;
        }>(
          "SELECT id,name,email,message FROM everonn_platform.enquiries WHERE build_id=$1 AND request_key=$2",
          [buildId, data.requestKey],
        )
      ).rows[0];
      if (
        accepted.name !== data.name ||
        accepted.email !== data.email ||
        accepted.message !== data.message
      )
        throw new PlatformError(
          "This enquiry request conflicts with a previous submission.",
          409,
        );
      return { enquiryId: accepted.id, saved: true };
    },
  );
}
export async function listEnquiries(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
) {
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client) =>
      (
        await client.query(
          'SELECT id,build_id AS "buildId",name,email,message,created_at::text AS "createdAt" FROM everonn_platform.enquiries WHERE NOT is_test ORDER BY created_at DESC LIMIT 100',
        )
      ).rows,
  );
}
export async function previewResponse(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  id: string,
  segments: string[],
  request: Request,
) {
  const { build, manifest } = await buildManifest(
    db,
    store,
    actor,
    projectId,
    id,
  );
  if (build.stage < 2)
    throw new PlatformError("The candidate preview is not compiled.", 409);
  const path = "/" + segments.join("/"),
    route = path.replace(/\/$/, "") || "/";
  const redirect = manifest.redirects.find((page) => page.path === route);
  if (redirect)
    return new Response(null, {
      status: 308,
      headers: {
        Location: `/api/platform/projects/${projectId}/builds/${id}/preview${redirect.target === "/" ? "/" : redirect.target + "/"}`,
        "Cache-Control": "private, no-store",
      },
    });
  const url = new URL(request.url);
  const file = previewFile(
    path + (url.pathname.endsWith("/") && path !== "/" ? "/" : ""),
  );
  const selected = manifest.files.find(
    (candidate) => candidate.path === "output/" + file,
  );
  if (!selected)
    return new Response("Page not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain",
        "Cache-Control": "private, no-store",
      },
    });
  const object = await loadArtifact(
    db,
    store,
    actor,
    projectId,
    selected.objectId,
  );
  if (object.record.sha256 !== selected.sha256)
    throw new PlatformError(
      "Preview output failed integrity verification.",
      503,
    );
  return new Response(new Uint8Array(object.bytes), {
    headers: {
      "Content-Type": mediaType(file!),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      ...(file?.endsWith(".html")
        ? {
            "Content-Security-Policy": contentSecurityPolicy(
              Buffer.from(object.bytes).toString(),
            ),
          }
        : {}),
    },
  });
}
export async function buildDownload(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  id: string,
  kind: "source" | "output",
) {
  const { manifest } = await buildManifest(db, store, actor, projectId, id);
  const object = await loadArtifact(
    db,
    store,
    actor,
    projectId,
    kind === "source" ? manifest.sourceArchiveId : manifest.outputArchiveId,
  );
  return new Response(new Uint8Array(object.bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="website-${kind}-${id}.zip"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

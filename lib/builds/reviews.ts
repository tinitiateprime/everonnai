import { randomUUID } from "node:crypto";
import type { Actor } from "../auth/sessions";
import type { PlatformDatabase } from "../platform/database";
import { PlatformError } from "../platform/config";
import { projectTransaction, audit, uuid } from "../projects/service";
import { blueprintDetail } from "../knowledge/service";
import { snapshotDetail } from "../discovery/service";
import { digest, loadArtifact, type ObjectStore } from "../storage/artifacts";
import { buildDetail, buildManifest } from "./service";
import {
  reviewInput,
  type BuildReview,
  type BuildReport,
  type ReportClaim,
} from "./review-contracts";
const columns = `id,build_id AS "buildId",seal_sha256 AS "sealSha256",request_key AS "requestKey",decision,notes,checklist,reviewer_id AS "reviewerId",created_at::text AS "createdAt"`;
export async function listBuildReviews(
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
        await client.query<BuildReview>(
          `SELECT DISTINCT ON(build_id) ${columns} FROM everonn_platform.build_reviews ORDER BY build_id,created_at DESC,id DESC`,
        )
      ).rows,
  );
}
export async function recordBuildReview(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  buildId: string,
  input: unknown,
) {
  uuid.parse(buildId);
  const data = reviewInput.parse(input);
  return projectTransaction(
    db,
    actor,
    projectId,
    false,
    async (client, project) => {
      if (!project.canReview)
        throw new PlatformError(
          "You do not have permission to review this build.",
          404,
        );
      // Serialize review decisions and idempotent requests. Build output stays immutable.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
        [projectId, buildId],
      );
      const build = (
        await client.query<{ status: string; seal: string }>(
          "SELECT status,seal_sha256 AS seal FROM everonn_platform.website_builds WHERE id=$1",
          [buildId],
        )
      ).rows[0];
      if (!build)
        throw new PlatformError(
          "This build is unavailable or you do not have access.",
          404,
        );
      if (build.status !== "ready" || build.seal !== data.sealSha256)
        throw new PlatformError(
          "Review requires a verified preview and its exact current seal.",
          409,
        );
      if (
        data.decision === "approved" &&
        !Object.values(data.checklist).every(Boolean)
      )
        throw new PlatformError(
          "Complete every review item before approving the preview.",
          422,
        );
      const previous = (
        await client.query<BuildReview>(
          `SELECT ${columns} FROM everonn_platform.build_reviews WHERE build_id=$1 AND request_key=$2`,
          [buildId, data.requestKey],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.reviewerId !== actor.id ||
          previous.sealSha256 !== data.sealSha256 ||
          previous.decision !== data.decision ||
          previous.notes !== data.notes ||
          Object.keys(data.checklist).some(
            (key) =>
              previous.checklist[key as keyof typeof data.checklist] !==
              data.checklist[key as keyof typeof data.checklist],
          )
        )
          throw new PlatformError(
            "This review request key belongs to a different decision.",
            409,
          );
        return previous;
      }
      const id = randomUUID();
      const accepted = (
        await client.query<BuildReview>(
          `INSERT INTO everonn_platform.build_reviews(id,tenant_id,project_id,build_id,seal_sha256,request_key,decision,notes,checklist,reviewer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING ${columns}`,
          [
            id,
            project.tenantId,
            projectId,
            buildId,
            data.sealSha256,
            data.requestKey,
            data.decision,
            data.notes,
            JSON.stringify(data.checklist),
            actor.id,
          ],
        )
      ).rows[0];
      await audit(
        client,
        actor,
        project.tenantId,
        projectId,
        "build.reviewed",
        id,
      );
      return accepted;
    },
  );
}
export async function buildReport(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  buildId: string,
): Promise<BuildReport> {
  const { build, manifest } = await buildManifest(
    db,
    store,
    actor,
    projectId,
    buildId,
  );
  const [detail, plan, source, reviews] = await Promise.all([
    buildDetail(db, actor, projectId, buildId),
    blueprintDetail(db, store, actor, projectId, build.blueprintId),
    snapshotDetail(db, store, actor, projectId, build.inputs.snapshotId),
    listBuildReviews(db, actor, projectId),
  ]);
  if (
    source.snapshot.manifestSha256 !== build.inputs.snapshotSha256 ||
    plan.record.contentSha256 !== build.inputs.blueprintSha256
  )
    throw new PlatformError(
      "The comparison inputs failed integrity verification.",
      503,
    );
  const verification =
    detail.checks.find(
      (check) =>
        check.buildId === buildId && check.sealSha256 === build.sealSha256,
    ) ?? null;
  const required = plan.document.pages.filter(
    (page) => page.outcome === "render",
  );
  let routesMatch =
    required.length === manifest.routes.length &&
    required.every((page) =>
      manifest.routes.some(
        (route) => route.pageId === page.id && route.path === page.path,
      ),
    );
  // Blueprint content hashes cover the JSON artifact; manifest route hashes cover
  // its text. Compare like representations rather than equating those digests.
  for (const page of required) {
    if (!page.contentObjectId) {
      routesMatch = false;
      continue;
    }
    const object = await loadArtifact(
      db,
      store,
      actor,
      projectId,
      page.contentObjectId,
    );
    const document = JSON.parse(Buffer.from(object.bytes).toString()) as {
      text: unknown;
    };
    const route = manifest.routes.find((route) => route.pageId === page.id);
    if (
      object.record.sha256 !== page.contentSha256 ||
      typeof document.text !== "string" ||
      route?.contentSha256 !== digest(Buffer.from(document.text))
    )
      routesMatch = false;
  }
  const previewVerified =
    build.status === "ready" &&
    routesMatch &&
    !!verification?.passed &&
    verification.checks.length > 0 &&
    verification.checks.every((check) => check.outcome === "pass");
  const latestReview =
    reviews.find(
      (review) =>
        review.buildId === buildId && review.sealSha256 === build.sealSha256,
    ) ?? null;
  const passKeys = new Set(
    verification?.checks
      .filter((check) => check.outcome === "pass")
      .map((check) => check.key) ?? [],
  );
  const evidence = (prefix: string) =>
    Array.from(passKeys).filter(
      (key) => key === prefix || key.startsWith(prefix + ":"),
    );
  const outputBytes = manifest.files
    .filter((file) => file.path.startsWith("output/"))
    .reduce((sum, file) => sum + file.byteSize, 0);
  const claims: ReportClaim[] = [
    {
      key: "page_coverage",
      kind: "observed",
      outcome: routesMatch ? "verified" : "blocked",
      statement: `${manifest.routes.length} of ${required.length} required pages are present in the sealed route inventory.`,
      evidence: [`blueprint:${build.blueprintId}`, `seal:${build.sealSha256}`],
      limitations: [
        "Excluded pages remain explicit exclusions; source coverage is reported separately.",
      ],
    },
    {
      key: "preserved_content",
      kind: "observed",
      outcome: required.every((page) => passKeys.has(`content:${page.path}`))
        ? "verified"
        : "blocked",
      statement: "Approved page text is preserved in the rendered output.",
      evidence: evidence("content"),
      limitations: [
        "Checks cover captured text after owner-approved contact changes. Original media, private content and extraction omissions are outside this check.",
      ],
    },
    {
      key: "protected_facts",
      kind: "observed",
      outcome: required.every((page) => passKeys.has(`facts:${page.path}`))
        ? "verified"
        : "blocked",
      statement: "Displayed business details match the approved fact revision.",
      evidence: evidence("facts"),
      limitations: [
        "Owner confirmation does not independently establish the truth of a business claim.",
      ],
    },
    {
      key: "navigation",
      kind: "observed",
      outcome:
        passKeys.has("internal_links") && passKeys.has("navigation_coverage")
          ? "verified"
          : "blocked",
      statement:
        "All required routes are reachable and generated internal links have valid targets.",
      evidence: [
        ...evidence("internal_links"),
        ...evidence("navigation_coverage"),
      ],
      limitations: [
        "The original site's link graph was not measured under the same method; no improvement percentage is claimed.",
      ],
    },
    {
      key: "enquiry",
      kind: "observed",
      outcome: [
        "enquiry_backend",
        "enquiry_validation",
        "enquiry_idempotency",
      ].every((key) => passKeys.has(key))
        ? "verified"
        : "blocked",
      statement:
        "The preview form saves validated enquiries and prevents duplicate submissions.",
      evidence: [
        ...evidence("enquiry_backend"),
        ...evidence("enquiry_validation"),
        ...evidence("enquiry_idempotency"),
      ],
      limitations: [
        "Private editor session and project inbox required. Email delivery and booking are not connected.",
      ],
    },
    {
      key: "output_size",
      kind: "measured",
      outcome: "verified",
      statement: `Sealed compiled files total ${outputBytes} bytes.`,
      evidence: [`seal:${build.sealSha256}`],
      limitations: [
        "Artifact bytes do not measure transferred bytes, loading speed or production performance.",
      ],
    },
    {
      key: "design_review",
      kind: "design_judgment",
      outcome: latestReview
        ? latestReview.decision === "approved"
          ? "verified"
          : "blocked"
        : "unassessed",
      statement: latestReview
        ? `Reviewer decision: ${latestReview.decision}. ${latestReview.notes}`
        : "Human design review is pending.",
      evidence: latestReview ? [`review:${latestReview.id}`] : [],
      limitations: [
        "A recorded human judgment is not an objective design score or a release approval.",
      ],
    },
    {
      key: "business_outcomes",
      kind: "predicted",
      outcome: "unassessed",
      statement:
        "Changes in enquiries, sales and search rankings have not been established.",
      evidence: [],
      limitations: [
        "Post-publication measurements would be required to support business outcome claims.",
      ],
    },
  ];
  const {
    id,
    manifestSha256,
    coverage,
    scope,
    captureStartedAt,
    captureEndedAt,
  } = source.snapshot;
  const report: Omit<BuildReport, "evaluationSha256"> = {
    version: 1,
    buildId,
    sealSha256: build.sealSha256!,
    inputs: build.inputs,
    previewVerified,
    humanReviewApproved:
      previewVerified && latestReview?.decision === "approved",
    publication: "not_configured",
    source: {
      id,
      manifestSha256,
      coverage,
      scope,
      captureStartedAt,
      captureEndedAt,
    },
    coverage: {
      requiredPages: required.length,
      exportedPages: manifest.routes.length,
      approvedRedirects: plan.document.pages.filter(
        (page) => page.outcome === "redirect",
      ).length,
      explicitExclusions: plan.document.pages.filter(
        (page) => page.outcome === "exclude",
      ).length,
      unresolvedPages: plan.document.pages.filter(
        (page) => page.outcome === "unresolved",
      ).length,
    },
    verification,
    latestReview,
    claims,
    limitations: [
      ...scope.limitations,
      "Capture timestamps describe a collection interval, not a simultaneous view of the original website.",
      "This is an authenticated preview evaluation. Production deployment, indexing and release approval remain unconfigured.",
      "No comparable baseline speed, accessibility score, conversion or SEO measurement is available.",
      ...(build.inputs.mode === "fixture" || scope.evidenceMode === "fixture"
        ? [
            "Source or design uses test fixtures; results do not demonstrate live customer-site or model design quality.",
          ]
        : []),
    ],
  };
  return {
    ...report,
    evaluationSha256: digest(Buffer.from(JSON.stringify(report))),
  };
}

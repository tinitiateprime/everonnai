import { ZodError } from "zod";
import { readJson } from "../api";
import {
  createSession,
  requireActor,
  revokeSession,
  sessionActor,
  sessionCookieName,
  readCookie,
  cookie,
} from "../auth/sessions";
import { startOidcLogin, finishOidcLogin, flowCookieName } from "../auth/oidc";
import { getPlatformDatabase, type PlatformDatabase } from "./database";
import {
  developmentLoginEnabled,
  platformConfiguration,
  platformOrigin,
  PlatformError,
} from "./config";
import {
  createTenant,
  listTenants,
  createProject,
  listProjects,
  projectDetail,
  tenantInput,
} from "../projects/service";
import {
  artifactLimit,
  getObjectStore,
  loadArtifact,
  saveArtifact,
  type ObjectStore,
} from "../storage/artifacts";
import {
  batchInput,
  freezeInput,
  startScanInput,
} from "../discovery/contracts";
import {
  startScan,
  listScans,
  scanDetail,
  runScanBatch,
  pauseScan,
  scanPages,
  freezeSnapshot,
  listSnapshots,
  snapshotDetail,
  snapshotPage,
  type DiscoveryRuntime,
} from "../discovery/service";
import { browserFixtureRuntime } from "../discovery/testing";
import {
  extractFacts,
  approveFacts,
  factSetDetail,
  listKnowledge,
  createBlueprint,
  approveBlueprint,
  blueprintDetail,
} from "../knowledge/service";
import {
  startBuild,
  runBuildStage,
  listBuilds,
  buildDetail,
  previewResponse,
  buildDownload,
  listEnquiries,
  submitEnquiry,
  type BuildRuntime,
} from "../builds/service";
import { z } from "zod";
import {
  listBuildReviews,
  recordBuildReview,
  buildReport,
} from "../builds/reviews";
import {
  listIntelligence,
  startIntelligence,
  intelligenceDetail,
  runIntelligenceBatch,
  intelligenceReport,
  pageAssessment,
  screenshotResponse,
} from "../intelligence/service";
import type { IntelligenceRuntime } from "../intelligence/browser";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
function mutationOrigin(request: Request) {
  if (request.headers.get("origin") !== platformOrigin())
    throw new PlatformError("This action must come from your workspace.", 403);
}
async function uploadBytes(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new PlatformError("Choose a file to upload.");
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > artifactLimit) {
    await reader.cancel();
    throw new PlatformError("Artifact exceeds the 64 MB limit.", 413);
  }
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > artifactLimit)
        throw new PlatformError("Artifact exceeds the 64 MB limit.", 413);
      parts.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(parts);
}
export async function platformRequest(
  request: Request,
  segments: string[],
  dependencies: {
    database?: PlatformDatabase;
    store?: ObjectStore;
    discovery?: DiscoveryRuntime;
    builds?: BuildRuntime;
    intelligence?: IntelligenceRuntime;
  } = {},
) {
  try {
    if (request.method === "POST") mutationOrigin(request);
    const route = segments.join("/");
    if (request.method === "GET" && route === "session") {
      const configuration = platformConfiguration();
      const token =
        configuration.login !== "missing"
          ? readCookie(request, sessionCookieName())
          : undefined;
      const actor = token
        ? await sessionActor(
            dependencies.database ?? (await getPlatformDatabase()),
            token,
          )
        : null;
      return json({ actor, configuration });
    }
    if (
      request.method === "POST" &&
      route === "auth/development" &&
      !developmentLoginEnabled()
    )
      throw new PlatformError("This sign-in method is unavailable.", 404);
    const db = dependencies.database ?? (await getPlatformDatabase());
    if (request.method === "GET" && route === "auth/login") {
      const login = await startOidcLogin();
      return new Response(null, {
        status: 303,
        headers: {
          Location: login.url.href,
          "Cache-Control": "no-store",
          "Set-Cookie": cookie(flowCookieName, login.flow, 600),
        },
      });
    }
    if (request.method === "GET" && route === "auth/callback") {
      const identity = await finishOidcLogin(
        request,
        readCookie(request, flowCookieName),
      );
      const session = await createSession(db, identity);
      const headers = new Headers({
        Location: platformOrigin() + "/projects",
        "Cache-Control": "no-store",
      });
      headers.append("Set-Cookie", cookie(flowCookieName, "", 0));
      headers.append(
        "Set-Cookie",
        cookie(sessionCookieName(), session.token, 28800),
      );
      return new Response(null, { status: 303, headers });
    }
    if (request.method === "POST" && route === "auth/development") {
      const session = await createSession(db, {
        issuer: "urn:everonn:local-development",
        subject: "local-developer",
        displayName: "Local developer",
      });
      const response = json({ actor: session.user });
      response.headers.set(
        "Set-Cookie",
        cookie(sessionCookieName(), session.token, 28800),
      );
      return response;
    }
    if (request.method === "POST" && route === "auth/logout") {
      await revokeSession(db, readCookie(request, sessionCookieName()));
      const response = json({ signedOut: true });
      response.headers.set("Set-Cookie", cookie(sessionCookieName(), "", 0));
      return response;
    }
    const actor = await requireActor(db, request);
    if (route === "tenants") {
      if (request.method === "GET")
        return json({ tenants: await listTenants(db, actor) });
      const data = tenantInput.parse(await readJson(request, 16000));
      return json({ tenant: await createTenant(db, actor, data.name) }, 201);
    }
    if (route === "projects" && request.method === "GET")
      return json({ projects: await listProjects(db, actor) });
    if (
      segments.length === 3 &&
      segments[0] === "tenants" &&
      segments[2] === "projects" &&
      request.method === "POST"
    )
      return json(
        {
          project: await createProject(
            db,
            actor,
            segments[1],
            await readJson(request, 16000),
          ),
        },
        201,
      );
    if (segments[0] === "projects") {
      const projectId = segments[1];
      if (segments[2] === "intelligence-runs") {
        const store = dependencies.store ?? getObjectStore();
        const fixture = browserFixtureRuntime();
        const runtime =
          dependencies.intelligence ??
          (fixture.evidenceMode === "fixture"
            ? {
                resource: fixture.resource,
                mode: "fixture",
                advice: "disabled",
              }
            : {});
        if (segments.length === 3 && request.method === "GET")
          return json({ runs: await listIntelligence(db, actor, projectId) });
        if (segments.length === 3 && request.method === "POST")
          return json(
            {
              run: await startIntelligence(
                db,
                store,
                actor,
                projectId,
                await readJson(request, 16000),
                runtime,
              ),
            },
            201,
          );
        if (segments.length === 4 && request.method === "GET")
          return json({
            run: await intelligenceDetail(db, actor, projectId, segments[3]),
          });
        if (
          segments.length === 5 &&
          segments[4] === "batch" &&
          request.method === "POST"
        )
          return json({
            run: await runIntelligenceBatch(
              db,
              store,
              actor,
              projectId,
              segments[3],
              request.signal,
              runtime,
            ),
          });
        if (
          segments.length === 5 &&
          segments[4] === "report" &&
          request.method === "GET"
        ) {
          const result = await intelligenceReport(
            db,
            store,
            actor,
            projectId,
            segments[3],
          );
          if (new URL(request.url).searchParams.get("download") === "1")
            return new Response(JSON.stringify(result, null, 2), {
              headers: {
                "Content-Type": "application/json",
                "Content-Disposition": `attachment; filename="site-intelligence-${result.run.id}.json"`,
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'",
              },
            });
          return json(result);
        }
        if (
          segments.length === 6 &&
          segments[4] === "pages" &&
          request.method === "GET"
        )
          return json({
            assessment: await pageAssessment(
              db,
              store,
              actor,
              projectId,
              segments[3],
              segments[5],
            ),
          });
        if (
          segments.length === 8 &&
          segments[4] === "pages" &&
          segments[6] === "screenshots" &&
          request.method === "GET"
        )
          return screenshotResponse(
            db,
            store,
            actor,
            projectId,
            segments[3],
            segments[5],
            Number(segments[7]),
          );
      }
      if (
        [
          "knowledge",
          "fact-sets",
          "blueprints",
          "builds",
          "enquiries",
          "build-reviews",
        ].includes(segments[2])
      ) {
        const store = dependencies.store ?? getObjectStore();
        if (
          segments[2] === "build-reviews" &&
          segments.length === 3 &&
          request.method === "GET"
        )
          return json({
            reviews: await listBuildReviews(db, actor, projectId),
          });
        if (
          segments[2] === "knowledge" &&
          segments.length === 3 &&
          request.method === "GET"
        )
          return json(await listKnowledge(db, actor, projectId));
        if (
          segments[2] === "enquiries" &&
          segments.length === 3 &&
          request.method === "GET"
        )
          return json({ enquiries: await listEnquiries(db, actor, projectId) });
        if (segments[2] === "fact-sets") {
          if (segments.length === 3 && request.method === "POST") {
            const data = z
              .object({ snapshotId: z.uuid() })
              .strict()
              .parse(await readJson(request, 16000));
            return json(
              {
                facts: await extractFacts(
                  db,
                  store,
                  actor,
                  projectId,
                  data.snapshotId,
                ),
              },
              201,
            );
          }
          if (segments.length === 4 && request.method === "GET")
            return json(
              await factSetDetail(db, store, actor, projectId, segments[3]),
            );
          if (
            segments.length === 5 &&
            segments[4] === "approve" &&
            request.method === "POST"
          )
            return json(
              {
                facts: await approveFacts(
                  db,
                  store,
                  actor,
                  projectId,
                  segments[3],
                  await readJson(request, 300000),
                ),
              },
              201,
            );
        }
        if (segments[2] === "blueprints") {
          if (segments.length === 3 && request.method === "POST") {
            const data = z
              .object({ factSetId: z.uuid() })
              .strict()
              .parse(await readJson(request, 16000));
            return json(
              {
                blueprint: await createBlueprint(
                  db,
                  store,
                  actor,
                  projectId,
                  data.factSetId,
                ),
              },
              201,
            );
          }
          if (segments.length === 4 && request.method === "GET")
            return json(
              await blueprintDetail(db, store, actor, projectId, segments[3]),
            );
          if (
            segments.length === 5 &&
            segments[4] === "approve" &&
            request.method === "POST"
          )
            return json(
              {
                blueprint: await approveBlueprint(
                  db,
                  store,
                  actor,
                  projectId,
                  segments[3],
                  await readJson(request, 6000000),
                ),
              },
              201,
            );
        }
        if (segments[2] === "builds") {
          if (segments.length === 3 && request.method === "GET")
            return json({ builds: await listBuilds(db, actor, projectId) });
          if (
            segments.length === 5 &&
            segments[4] === "review" &&
            request.method === "POST"
          )
            return json(
              {
                review: await recordBuildReview(
                  db,
                  actor,
                  projectId,
                  segments[3],
                  await readJson(request, 20000),
                ),
              },
              201,
            );
          if (
            segments.length === 5 &&
            segments[4] === "report" &&
            request.method === "GET"
          ) {
            const report = await buildReport(
              db,
              store,
              actor,
              projectId,
              segments[3],
            );
            if (new URL(request.url).searchParams.get("download") === "1")
              return new Response(JSON.stringify(report, null, 2), {
                headers: {
                  "Content-Type": "application/json",
                  "Content-Disposition": `attachment; filename="website-report-${report.buildId}.json"`,
                  "Cache-Control": "private, no-store",
                  "X-Content-Type-Options": "nosniff",
                  "Content-Security-Policy": "default-src 'none'",
                },
              });
            return json({ report });
          }
          if (segments.length === 3 && request.method === "POST")
            return json(
              {
                build: await startBuild(
                  db,
                  store,
                  actor,
                  projectId,
                  await readJson(request, 16000),
                  dependencies.builds,
                ),
              },
              201,
            );
          if (segments.length === 4 && request.method === "GET")
            return json(await buildDetail(db, actor, projectId, segments[3]));
          if (
            segments.length === 5 &&
            segments[4] === "run" &&
            request.method === "POST"
          )
            return json(
              await runBuildStage(
                db,
                store,
                actor,
                projectId,
                segments[3],
                request.signal,
                dependencies.builds,
              ),
            );
          if (
            segments.length >= 5 &&
            segments[4] === "preview" &&
            request.method === "GET"
          )
            return previewResponse(
              db,
              store,
              actor,
              projectId,
              segments[3],
              segments.slice(5),
              request,
            );
          if (
            segments.length === 6 &&
            segments[4] === "download" &&
            ["source", "output"].includes(segments[5]) &&
            request.method === "GET"
          )
            return buildDownload(
              db,
              store,
              actor,
              projectId,
              segments[3],
              segments[5] as "source" | "output",
            );
          if (
            segments.length === 5 &&
            segments[4] === "enquiries" &&
            request.method === "POST"
          )
            return json(
              await submitEnquiry(
                db,
                actor,
                projectId,
                segments[3],
                await readJson(request, 16000),
              ),
              201,
            );
        }
      }
      if (segments[2] === "discovery-runs" || segments[2] === "snapshots") {
        const store = dependencies.store ?? getObjectStore();
        const runtime = dependencies.discovery ?? browserFixtureRuntime();
        const offsetValue =
          new URL(request.url).searchParams.get("offset") ?? "0";
        const offset = Number(offsetValue);
        if (!/^\d{1,5}$/.test(offsetValue) || offset > 18000)
          throw new PlatformError("Invalid page offset.");
        if (segments[2] === "discovery-runs") {
          if (segments.length === 3 && request.method === "GET")
            return json({ scans: await listScans(db, actor, projectId) });
          if (segments.length === 3 && request.method === "POST") {
            const input = startScanInput.parse(await readJson(request, 16000));
            return json(
              {
                scan: await startScan(
                  db,
                  actor,
                  projectId,
                  input.requestKey,
                  runtime,
                ),
              },
              201,
            );
          }
          if (segments.length === 4 && request.method === "GET")
            return json({
              scan: await scanDetail(db, actor, projectId, segments[3]),
            });
          if (
            segments.length === 5 &&
            request.method === "GET" &&
            segments[4] === "pages"
          )
            return json(
              await scanPages(db, store, actor, projectId, segments[3], offset),
            );
          if (segments.length === 5 && request.method === "POST") {
            if (segments[4] === "batch") {
              const input = batchInput.parse(await readJson(request, 16000));
              return json({
                scan: await runScanBatch(
                  db,
                  store,
                  actor,
                  projectId,
                  segments[3],
                  input,
                  request.signal,
                  runtime,
                ),
              });
            }
            if (segments[4] === "pause")
              return json({
                scan: await pauseScan(db, actor, projectId, segments[3]),
              });
            if (segments[4] === "snapshots") {
              const input = freezeInput.parse(await readJson(request, 16000));
              return json(
                {
                  snapshot: await freezeSnapshot(
                    db,
                    store,
                    actor,
                    projectId,
                    segments[3],
                    input.allowIncomplete,
                  ),
                },
                201,
              );
            }
          }
        } else {
          if (segments.length === 3 && request.method === "GET")
            return json({
              snapshots: await listSnapshots(db, actor, projectId),
            });
          if (segments.length === 4 && request.method === "GET")
            return json(
              await snapshotDetail(
                db,
                store,
                actor,
                projectId,
                segments[3],
                offset,
              ),
            );
          if (
            segments.length === 6 &&
            segments[4] === "pages" &&
            request.method === "GET"
          )
            return json(
              await snapshotPage(
                db,
                store,
                actor,
                projectId,
                segments[3],
                segments[5],
              ),
            );
        }
      }
      if (segments.length === 2 && request.method === "GET")
        return json(await projectDetail(db, actor, projectId));
      if (segments[2] === "artifacts") {
        if (segments.length === 3 && request.method === "POST") {
          // Authorize before consuming/uploading a potentially large body.
          const detail = await projectDetail(db, actor, projectId);
          if (!detail.project.canEdit)
            throw new PlatformError(
              "You do not have permission to upload to this project.",
              404,
            );
          const artifact = await saveArtifact(
            db,
            dependencies.store ?? getObjectStore(),
            actor,
            projectId,
            await uploadBytes(request),
            {
              filename: decodeURIComponent(
                request.headers.get("x-file-name") ?? "document",
              ),
              kind: "document",
              mediaType:
                request.headers.get("content-type") ??
                "application/octet-stream",
            },
          );
          return json({ artifact }, 201);
        }
        if (segments.length === 4 && request.method === "GET") {
          const artifact = await loadArtifact(
            db,
            dependencies.store ?? getObjectStore(),
            actor,
            projectId,
            segments[3],
          );
          return new Response(new Uint8Array(artifact.bytes), {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(artifact.record.filename)}`,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'",
            },
          });
        }
      }
    }
    return json({ error: "This workspace endpoint does not exist." }, 404);
  } catch (error) {
    if (error instanceof PlatformError)
      return json({ error: error.message }, error.status);
    if (
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      error instanceof URIError
    )
      return json({ error: "Check the submitted workspace details." }, 400);
    return json(
      {
        error:
          "The workspace service is unavailable. Check the server configuration and try again.",
      },
      503,
    );
  }
}

import { NextResponse } from "next/server";
import { createWebsiteProject, normalizeWebsiteBusinessProfile, runWebsiteQa } from "@/features/website-studio/generator";
import { generateWebsiteSpec } from "@/features/website-studio/ai-generator";
import { resolveWebsiteMedia } from "@/features/website-studio/media";
import { generateWebsiteCode } from "@/features/website-studio/code-generator";
import { liveWebsite } from "@/features/website-studio/site-access";
import type { BusinessProfile, EverOnnWorkspace } from "@/features/everonn/types";
import type { WebsiteGenerationEvent, WebsiteGenerationProgress } from "@/features/website-studio/progress";
import { getProviderReadiness } from "@/lib/provider-config";
import { findWorkspaceJson, readWorkspaceJson, updateWorkspaceJson } from "@/lib/json-workspace-store";
import { resolvedWebsitePreferences } from "@/features/agent-runtime/memory";
import { assertSameOrigin, authErrorDetails, requireActor } from "@/features/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireActor("website:publish");
    const providers = getProviderReadiness();
    return NextResponse.json({
      available: true,
      concepts: ["editorial", "momentum", "aura"],
      generationMode: providers.gemini ? "gemini-required-with-qa" : "configuration-required",
      providers,
      gates: ["private-preview", "owner-claim", "owner-verification", "approval", "publish"],
    });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (raw.length > 60_000) return NextResponse.json({ error: "The generation request is too large." }, { status: 413 });
    const body = raw ? JSON.parse(raw) as { profile?: BusinessProfile; workspaceId?: string } : {};
    const actor = await requireActor("website:publish", body.workspaceId || body.profile?.workspaceId);
    const workspaceHeader = request.headers.get("x-everonn-workspace");
    if (workspaceHeader && workspaceHeader !== actor.workspaceId) {
      return NextResponse.json({ error: "The profile does not belong to the selected workspace." }, { status: 403 });
    }
    const snapshot = await readWorkspaceJson(actor.workspaceId);
    if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
      return NextResponse.json(await generateWorkspaceWebsite(snapshot, actor.workspaceId), { headers: { "Cache-Control": "no-store" } });
    }
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: WebsiteGenerationEvent) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); }
          catch { closed = true; if (heartbeat) clearInterval(heartbeat); }
        };
        heartbeat = setInterval(() => send({ type: "heartbeat" }), 15_000);
        void generateWorkspaceWebsite(snapshot, actor.workspaceId, (progress) => send({ type: "progress", progress }))
          .then((data) => send({ type: "result", data }))
          .catch((error) => send({ type: "error", error: authErrorDetails(error).message }))
          .finally(() => {
            if (heartbeat) clearInterval(heartbeat);
            if (!closed) { closed = true; controller.close(); }
          });
      },
      cancel() { closed = true; if (heartbeat) clearInterval(heartbeat); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message || "Unable to generate the website project." }, { status: details.status });
  }
}

async function generateWorkspaceWebsite(snapshot: EverOnnWorkspace, workspaceId: string, onProgress?: (progress: WebsiteGenerationProgress) => void) {
  const profile = normalizeWebsiteBusinessProfile(snapshot.profile);
  const generation = await generateWebsiteSpec(profile, { memory: snapshot.aiMemory, usage: { workspaceId, feature: "website_generation" }, onProgress });
  const project = createWebsiteProject(profile, generation.spec);
  project.publicSlug = liveWebsite(snapshot)?.publicSlug || snapshot.websiteProject?.publicSlug || project.publicSlug;
  project.profileSnapshot = structuredClone(snapshot.profile);
  const slugCollision = await findWorkspaceJson((workspace) => workspace.workspaceId !== workspaceId && (workspace.websiteProject?.publicSlug === project.publicSlug || liveWebsite(workspace)?.publicSlug === project.publicSlug));
  if (slugCollision) {
    const suffix = workspaceId.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase();
    project.publicSlug = `${project.publicSlug.slice(0, 54)}-${suffix}`;
  }
  project.generation = { provider: "gemini", model: generation.model, generatedAt: new Date().toISOString(), skills: generation.skills };
  const preferences = resolvedWebsitePreferences(snapshot.aiMemory, workspaceId);
  onProgress?.({ stage: "media", message: "Finding suitable photography for your services." });
  const media = await resolveWebsiteMedia(project.spec, profile, { preferences });
  project.spec.media = { hero: media.hero, story: media.story, gallery: media.gallery, services: media.services };
  project.spec.code = await generateWebsiteCode(project.spec, profile, { model: generation.model, memory: snapshot.aiMemory, usage: { workspaceId, feature: "website_generation" }, onProgress });
  project.qa = runWebsiteQa(project.spec, profile);
  if (!project.qa.passed) throw new Error("Generated website code did not pass business grounding checks.");
  onProgress?.({ stage: "saving", message: "Checking the complete website and saving your private preview." });
  await updateWorkspaceJson((workspace) => {
    if (workspace.workspaceId !== workspaceId) {
      throw new Error("The profile does not belong to the selected workspace.");
    }
    if (JSON.stringify(workspace.profile) !== JSON.stringify(snapshot.profile)
      || JSON.stringify(workspace.aiMemory) !== JSON.stringify(snapshot.aiMemory)
      || JSON.stringify(workspace.websiteProject) !== JSON.stringify(snapshot.websiteProject)) {
      throw Object.assign(new Error("Business facts, preferences, or the website changed during generation. Generate again using the latest changes."), { status: 409 });
    }
    const legacyLive = !workspace.publishedWebsite && liveWebsite(workspace);
    return { ...workspace, websiteProject: project, publishedWebsite: workspace.publishedWebsite || (legacyLive ? { id: crypto.randomUUID(), project: structuredClone(legacyLive), profile: structuredClone(workspace.profile), publishedAt: legacyLive.updatedAt } : null) };
  }, workspaceId);
  return {
    project,
    generatedBy: generation.provider,
    model: generation.model,
    mediaProvider: media.provider,
    mediaCount: Number(Boolean(media.hero)) + Number(Boolean(media.story && media.story.id !== media.hero?.id)) + media.gallery.length + Object.keys(media.services).length,
    mediaWarning: media.warning,
  };
}

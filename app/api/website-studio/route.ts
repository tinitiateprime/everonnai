import { NextResponse } from "next/server";
import { createWebsiteProject, normalizeWebsiteBusinessProfile } from "@/features/website-studio/generator";
import { generateWebsiteSpec } from "@/features/website-studio/ai-generator";
import { resolveWebsiteMedia } from "@/features/website-studio/media";
import type { BusinessProfile } from "@/features/everonn/types";
import { getProviderReadiness } from "@/lib/provider-config";
import { findWorkspaceJson, updateWorkspaceJson } from "@/lib/json-workspace-store";
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
    const body = await request.json() as { profile?: BusinessProfile };
    if (!body.profile) return NextResponse.json({ error: "A business profile is required." }, { status: 400 });
    await requireActor("website:publish", body.profile.workspaceId);
    const workspaceHeader = request.headers.get("x-everonn-workspace");
    if (workspaceHeader && workspaceHeader !== body.profile.workspaceId) {
      return NextResponse.json({ error: "The profile does not belong to the selected workspace." }, { status: 403 });
    }
    normalizeWebsiteBusinessProfile(body.profile);
    const generation = await generateWebsiteSpec(body.profile);
    const project = createWebsiteProject(body.profile, generation.spec);
    const slugCollision = await findWorkspaceJson((workspace) => workspace.workspaceId !== body.profile!.workspaceId && workspace.websiteProject?.publicSlug === project.publicSlug);
    if (slugCollision) {
      const suffix = body.profile.workspaceId.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase();
      project.publicSlug = `${project.publicSlug.slice(0, 54)}-${suffix}`;
    }
    project.generation = { provider: "gemini", model: generation.model, generatedAt: new Date().toISOString() };
    const media = await resolveWebsiteMedia(project.spec, body.profile);
    project.spec.media = { hero: media.hero, story: media.story, gallery: media.gallery, services: media.services };
    await updateWorkspaceJson((workspace) => {
      if (workspace.workspaceId !== body.profile!.workspaceId) {
        throw new Error("The profile does not belong to the selected workspace.");
      }
      return { ...workspace, profile: body.profile!, websiteProject: project };
    }, body.profile.workspaceId);
    return NextResponse.json({
      project,
      generatedBy: generation.provider,
      model: generation.model,
      mediaProvider: media.provider,
      mediaCount: Number(Boolean(media.hero)) + Number(Boolean(media.story && media.story.id !== media.hero?.id)) + media.gallery.length + Object.keys(media.services).length,
      mediaWarning: media.warning,
    });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message || "Unable to generate the website project." }, { status: details.status });
  }
}

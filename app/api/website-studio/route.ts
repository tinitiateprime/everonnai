import { NextResponse } from "next/server";
import { createWebsiteProject, normalizeWebsiteBusinessProfile } from "@/features/website-studio/generator";
import { generateWebsiteSpec } from "@/features/website-studio/ai-generator";
import { resolveWebsiteMedia } from "@/features/website-studio/media";
import type { BusinessProfile } from "@/features/everonn/types";
import { getProviderReadiness } from "@/lib/provider-config";
import { updateWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const providers = getProviderReadiness();
  return NextResponse.json({
    available: true,
    concepts: ["editorial", "momentum", "aura"],
    generationMode: providers.gemini ? "gemini-required-with-qa" : "configuration-required",
    providers,
    gates: ["private-preview", "owner-claim", "owner-verification", "approval", "publish"],
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { profile?: BusinessProfile };
    if (!body.profile) return NextResponse.json({ error: "A business profile is required." }, { status: 400 });
    const workspaceHeader = request.headers.get("x-everonn-workspace");
    if (workspaceHeader && workspaceHeader !== body.profile.workspaceId) {
      return NextResponse.json({ error: "The profile does not belong to the selected workspace." }, { status: 403 });
    }
    normalizeWebsiteBusinessProfile(body.profile);
    const generation = await generateWebsiteSpec(body.profile);
    const project = createWebsiteProject(body.profile, generation.spec);
    project.generation = { provider: "gemini", model: generation.model, generatedAt: new Date().toISOString() };
    const media = await resolveWebsiteMedia(project.spec, body.profile);
    project.spec.media = { hero: media.hero, story: media.story, gallery: media.gallery, services: media.services };
    await updateWorkspaceJson((workspace) => {
      if (workspace.workspaceId !== body.profile!.workspaceId) {
        throw new Error("The profile does not belong to the selected workspace.");
      }
      return { ...workspace, profile: body.profile!, websiteProject: project };
    });
    return NextResponse.json({
      project,
      generatedBy: generation.provider,
      model: generation.model,
      mediaProvider: media.provider,
      mediaCount: Number(Boolean(media.hero)) + Number(Boolean(media.story && media.story.id !== media.hero?.id)) + media.gallery.length + Object.keys(media.services).length,
      mediaWarning: media.warning,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate the website project." }, { status: 400 });
  }
}

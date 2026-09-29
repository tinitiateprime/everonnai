import { NextResponse } from "next/server";
import { createWebsiteProject, normalizeWebsiteBusinessProfile } from "@/features/website-studio/generator";
import { generateWebsiteSpec } from "@/features/website-studio/ai-generator";
import { resolveWebsiteMedia } from "@/features/website-studio/media";
import type { BusinessProfile } from "@/features/everonn/types";
import { getProviderReadiness } from "@/lib/provider-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const providers = getProviderReadiness();
  return NextResponse.json({
    available: true,
    concepts: ["editorial", "momentum", "aura"],
    generationMode: providers.gemini ? "ai-with-qa" : "deterministic-with-qa",
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
    const media = await resolveWebsiteMedia(project.spec, body.profile);
    project.spec.media = { hero: media.hero, gallery: media.gallery, services: media.services };
    return NextResponse.json({ project, generatedBy: generation.provider, model: generation.model, fallbackReason: generation.fallbackReason, mediaProvider: media.provider });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate the website project." }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { createWebsiteProject, normalizeWebsiteBusinessProfile } from "@/features/website-studio/generator";
import { resolveWebsiteMedia } from "@/features/website-studio/media";
import type { BusinessProfile } from "@/features/everonn/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    available: true,
    concepts: ["editorial", "momentum", "aura"],
    generationMode: process.env.GEMINI_API_KEY ? "ai-with-qa" : "deterministic-with-qa",
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
    const project = createWebsiteProject(body.profile);
    const media = await resolveWebsiteMedia(project.spec, body.profile);
    project.spec.media = { hero: media.hero, gallery: media.gallery, services: media.services };
    return NextResponse.json({ project, generatedBy: process.env.GEMINI_API_KEY ? "everonn-ai-pipeline" : "everonn-safe-local-generator", mediaProvider: media.provider });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate the website project." }, { status: 400 });
  }
}

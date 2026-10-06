import { NextResponse } from "next/server";
import type { WebsiteProject } from "@/features/everonn/types";
import { updateWorkspaceJson } from "@/lib/json-workspace-store";
import { assertSameOrigin, authErrorDetails, requireActor } from "@/features/auth/session";
import { publishWebsiteRevision, rollbackWebsiteRelease } from "@/features/website-studio/releases";

export const dynamic = "force-dynamic";

const statusRank = { draft: 0, generated: 1, claimed: 2, verified: 3, approved: 4, published: 5 } as const;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const workspaceId = request.headers.get("x-everonn-workspace");
    const body = await request.json() as {
      privateToken?: string;
      status?: WebsiteProject["status"];
      selectedConcept?: WebsiteProject["selectedConcept"];
      rollbackReleaseId?: string;
      expectedLiveReleaseId?: string;
    };
    if (!workspaceId || (!body.rollbackReleaseId && (!body.privateToken || !body.status || !(body.status in statusRank)))) {
      return NextResponse.json({ error: "A valid website transition is required." }, { status: 400 });
    }
    await requireActor("website:publish", workspaceId);
    if (body.selectedConcept !== undefined && body.selectedConcept !== null && !["editorial", "momentum", "aura"].includes(body.selectedConcept)) return NextResponse.json({ error: "Invalid website concept." }, { status: 400 });
    if (body.rollbackReleaseId) {
      const workspace = await updateWorkspaceJson((current) => {
        if (!body.expectedLiveReleaseId || current.publishedWebsite?.id !== body.expectedLiveReleaseId) throw Object.assign(new Error("The live website changed. Refresh before restoring a release."), { status: 409 });
        return rollbackWebsiteRelease(current, body.rollbackReleaseId!);
      }, workspaceId);
      return NextResponse.json({ project: workspace.websiteProject, publishedWebsite: workspace.publishedWebsite, websiteReleases: workspace.websiteReleases }, { headers: { "Cache-Control": "no-store" } });
    }

    let savedProject: WebsiteProject | null = null;
    await updateWorkspaceJson((workspace) => {
      const project = workspace.websiteProject;
      if (workspace.workspaceId !== workspaceId || !project || project.privateToken !== body.privateToken) {
        throw new Error("Website project access denied.");
      }
      const currentRank = statusRank[project.status];
      const requestedRank = statusRank[body.status!];
      if (requestedRank < currentRank || requestedRank > currentRank + 1) {
        throw new Error("Website publishing steps must be completed in order.");
      }
      if (project.status === "published" && body.selectedConcept !== undefined && body.selectedConcept !== project.selectedConcept) throw new Error("Regenerate and approve a new draft before changing the live design.");
      if (body.status === "published" && (!project.qa.passed || !(body.selectedConcept || project.selectedConcept))) {
        throw new Error("Select an approved concept before publishing.");
      }
      savedProject = {
        ...project,
        status: body.status!,
        selectedConcept: body.selectedConcept === undefined ? project.selectedConcept : body.selectedConcept,
        updatedAt: new Date().toISOString(),
      };
      if (body.status === "published" && project.status !== "published") {
        const published = publishWebsiteRevision(workspace, { ...savedProject, status: "approved" });
        savedProject = published.websiteProject;
        return published;
      }
      return { ...workspace, websiteProject: savedProject };
    }, workspaceId);

    // The provider reloads server-owned release state after transitions.
    return NextResponse.json({ project: savedProject }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message || "Unable to update the website project." }, { status: details.status });
  }
}

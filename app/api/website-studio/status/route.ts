import { NextResponse } from "next/server";
import type { WebsiteProject } from "@/features/everonn/types";
import { updateWorkspaceJson } from "@/lib/json-workspace-store";
import { assertSameOrigin, authErrorDetails, requireActor } from "@/features/auth/session";

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
    };
    if (!workspaceId || !body.privateToken || !body.status || !(body.status in statusRank)) {
      return NextResponse.json({ error: "A valid website transition is required." }, { status: 400 });
    }
    await requireActor("website:publish", workspaceId);

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
      if (body.status === "published" && (!project.qa.passed || !(body.selectedConcept || project.selectedConcept))) {
        throw new Error("Select an approved concept before publishing.");
      }
      savedProject = {
        ...project,
        status: body.status!,
        selectedConcept: body.selectedConcept === undefined ? project.selectedConcept : body.selectedConcept,
        updatedAt: new Date().toISOString(),
      };
      return { ...workspace, websiteProject: savedProject };
    });

    return NextResponse.json({ project: savedProject }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message || "Unable to update the website project." }, { status: details.status });
  }
}

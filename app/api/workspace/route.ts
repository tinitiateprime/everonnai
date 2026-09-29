import { NextResponse } from "next/server";
import type { EverOnnWorkspace } from "@/features/everonn/types";
import { readWorkspaceJson, updateWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

const websiteStatusRank = { draft: 0, generated: 1, claimed: 2, verified: 3, approved: 4, published: 5 } as const;

function noStore<T>(payload: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(payload, { ...init, headers });
}

export async function GET(request: Request) {
  try {
    const workspace = await readWorkspaceJson();
    const requestedWorkspace = request.headers.get("x-everonn-workspace");
    if (requestedWorkspace && requestedWorkspace !== workspace.workspaceId) {
      return noStore({ error: "Workspace access denied." }, { status: 403 });
    }
    return noStore({ workspace, persistence: "json-file" });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Unable to read the EverOnn JSON workspace." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 2_000_000) return noStore({ error: "The workspace JSON payload is too large." }, { status: 413 });
    const requestedWorkspace = request.headers.get("x-everonn-workspace");
    const body = await request.json() as { workspace?: EverOnnWorkspace };
    const workspace = await updateWorkspaceJson((current) => {
      if (!requestedWorkspace || requestedWorkspace !== current.workspaceId) {
        throw new Error("Workspace access denied.");
      }
      if (!body.workspace || body.workspace.workspaceId !== current.workspaceId) {
        throw new Error("The workspace payload does not match the selected workspace.");
      }
      const currentProject = current.websiteProject;
      const incomingProject = body.workspace.websiteProject;
      const currentProjectTime = currentProject ? Date.parse(currentProject.updatedAt) || 0 : 0;
      const incomingProjectTime = incomingProject ? Date.parse(incomingProject.updatedAt) || 0 : 0;
      const sameProject = currentProject && incomingProject
        && currentProject.privateToken === incomingProject.privateToken;
      const regressesPublishing = sameProject
        && websiteStatusRank[currentProject.status] > websiteStatusRank[incomingProject.status];
      return {
        ...body.workspace,
        websiteProject: currentProjectTime > incomingProjectTime || regressesPublishing
          ? currentProject
          : incomingProject,
      };
    });
    return noStore({ workspace, persistence: "json-file", savedAt: new Date().toISOString() });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Unable to save the EverOnn JSON workspace." }, { status: 400 });
  }
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: { "X-EverOnn-Persistence": "json-file" } });
}

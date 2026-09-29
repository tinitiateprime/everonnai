import { NextResponse } from "next/server";
import type { EverOnnWorkspace } from "@/features/everonn/types";
import { readWorkspaceJson, writeWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

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
    const current = await readWorkspaceJson();
    const requestedWorkspace = request.headers.get("x-everonn-workspace");
    if (!requestedWorkspace || requestedWorkspace !== current.workspaceId) {
      return noStore({ error: "Workspace access denied." }, { status: 403 });
    }
    const body = await request.json() as { workspace?: EverOnnWorkspace };
    if (!body.workspace || body.workspace.workspaceId !== current.workspaceId) {
      return noStore({ error: "The workspace payload does not match the selected workspace." }, { status: 400 });
    }
    const workspace = await writeWorkspaceJson(body.workspace);
    return noStore({ workspace, persistence: "json-file", savedAt: new Date().toISOString() });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Unable to save the EverOnn JSON workspace." }, { status: 400 });
  }
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: { "X-EverOnn-Persistence": "json-file" } });
}

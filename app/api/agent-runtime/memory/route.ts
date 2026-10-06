import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorDetails, requireActor } from "@/features/auth/session";
import { readWorkspaceJson, updateWorkspaceJson } from "@/lib/json-workspace-store";
import { forgetWebsiteMemory, retrieveWebsiteMemory, saveWebsiteMemory } from "@/features/agent-runtime/memory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor("website:publish", request.headers.get("x-everonn-workspace") || undefined);
    const workspace = await readWorkspaceJson(actor.workspaceId);
    return NextResponse.json({ memory: retrieveWebsiteMemory(workspace.aiMemory, actor.workspaceId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status });
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor("website:publish", request.headers.get("x-everonn-workspace") || undefined);
    const raw = await request.text();
    if (!raw || raw.length > 16_000) return NextResponse.json({ error: "Invalid website preferences." }, { status: 400 });
    const input = JSON.parse(raw) as { preferences?: unknown; changeRequest?: unknown; expectedRevision?: string | null; scope?: "workspace" | "project" };
    if (input.scope && !["workspace", "project"].includes(input.scope)) return NextResponse.json({ error: "Choose business or website scope." }, { status: 400 });
    const workspace = await updateWorkspaceJson((current) => ({ ...current, aiMemory: saveWebsiteMemory({
      records: current.aiMemory, profile: current.profile, actor,
      preferences: input.preferences, changeRequest: input.changeRequest, expectedRevision: input.expectedRevision, scope: input.scope,
    }) }), actor.workspaceId);
    return NextResponse.json({ memory: workspace.aiMemory }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status });
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor("website:publish", request.headers.get("x-everonn-workspace") || undefined);
    const raw = await request.text();
    if (!raw || raw.length > 2000) return NextResponse.json({ error: "Invalid memory reset request." }, { status: 400 });
    const input = JSON.parse(raw) as { scope?: unknown; expectedRevision?: unknown };
    if (!["workspace", "project"].includes(String(input.scope)) || (input.expectedRevision !== null && typeof input.expectedRevision !== "string")) {
      return NextResponse.json({ error: "Choose a scope and provide its current revision." }, { status: 400 });
    }
    const workspace = await updateWorkspaceJson((current) => ({ ...current, aiMemory: forgetWebsiteMemory({
      records: current.aiMemory, profile: current.profile, actor,
      scope: input.scope as "workspace" | "project", expectedRevision: input.expectedRevision as string | null,
    }) }), actor.workspaceId);
    return NextResponse.json({ memory: workspace.aiMemory }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status });
  }
}

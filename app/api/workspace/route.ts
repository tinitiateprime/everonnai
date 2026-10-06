import { NextResponse } from "next/server";
import type { EverOnnWorkspace } from "@/features/everonn/types";
import { authorizeWorkspaceAction } from "@/features/auth/rbac";
import { assertSameOrigin, authErrorDetails, requireActor } from "@/features/auth/session";
import { getProviderReadiness } from "@/lib/provider-config";
import { getGoogleConnection } from "@/lib/provider-credentials";
import { syncAuthUsersFromTeam } from "@/lib/auth-store";
import { readWorkspaceJson, updateWorkspaceJson, workspacePersistence } from "@/lib/json-workspace-store";
import { preserveContactServerState, preserveLeadServerState } from "@/features/everonn/lead-capture";

export const dynamic = "force-dynamic";

function preserveRows<T extends { id: string }>(current: T[], incoming: T[]) {
  const incomingIds = new Set(incoming.map((item) => item.id));
  return [...incoming, ...current.filter((item) => !incomingIds.has(item.id))];
}

function noStore<T>(payload: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(payload, { ...init, headers });
}

async function withRuntimeProviderState(workspace: EverOnnWorkspace) {
  const googleConnection = await getGoogleConnection(workspace.workspaceId).catch(() => null);
  return {
    ...workspace,
    integrations: {
      ...workspace.integrations,
      gemini: getProviderReadiness().gemini ? "ready" as const : "not_configured" as const,
      googleCalendar: googleConnection?.scope.some((scope) => scope.includes("calendar")) ? "connected" as const : "disconnected" as const,
      gmail: googleConnection?.scope.includes("https://www.googleapis.com/auth/gmail.send") ? "connected" as const : "disconnected" as const,
      elevenLabs: getProviderReadiness().elevenLabs ? "ready" as const : "not_configured" as const,
    },
  };
}

export async function GET(request: Request) {
  try {
    const actor = await requireActor("workspace:view");
    const workspace = await readWorkspaceJson(actor.workspaceId);
    const requestedWorkspace = request.headers.get("x-everonn-workspace");
    if (requestedWorkspace && requestedWorkspace !== workspace.workspaceId) {
      return noStore({ error: "Workspace access denied." }, { status: 403 });
    }
    return noStore({ workspace: await withRuntimeProviderState(workspace), actor, persistence: workspacePersistence() });
  } catch (error) {
    const details = authErrorDetails(error, 500);
    return noStore({ error: details.message || "Unable to read the EverOnn JSON workspace." }, { status: details.status || 500 });
  }
}

function changed(left: unknown, right: unknown) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function authorizeWorkspaceUpdate(actor: Awaited<ReturnType<typeof requireActor>>, current: EverOnnWorkspace, incoming: EverOnnWorkspace) {
  if (changed(current.profile, incoming.profile)) authorizeWorkspaceAction(actor, current, "business:configure");
  if (changed(current.contacts, incoming.contacts) || changed(current.leads, incoming.leads)) authorizeWorkspaceAction(actor, current, "inbox:operate");
  if (changed(current.conversations, incoming.conversations)) authorizeWorkspaceAction(actor, current, "calls:operate");
  if (changed(current.appointments, incoming.appointments)) authorizeWorkspaceAction(actor, current, "appointments:operate");
  if (changed(current.team, incoming.team)) {
    authorizeWorkspaceAction(actor, current, "team:manage");
    if (!incoming.team.some((member) => member.role === "owner" && member.status === "active")) throw new Error("The workspace must keep at least one active owner.");
    if (incoming.team.some((member) => member.role === "owner" && member.status === "invited")) throw new Error("Owner access cannot be assigned through an invitation.");
  }
  if (changed(current.integrations.googleCalendar, incoming.integrations.googleCalendar) || changed(current.integrations.gmail, incoming.integrations.gmail)) {
    authorizeWorkspaceAction(actor, current, "business:configure");
  }
  if (changed(current.integrations.elevenLabs, incoming.integrations.elevenLabs)) authorizeWorkspaceAction(actor, current, "calls:operate");
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 2_000_000) return noStore({ error: "The workspace JSON payload is too large." }, { status: 413 });
    const requestedWorkspace = request.headers.get("x-everonn-workspace");
    const body = await request.json() as { workspace?: EverOnnWorkspace };
    const actor = await requireActor("workspace:view");
    let teamChanged = false;
    const workspace = await updateWorkspaceJson((current) => {
      if (requestedWorkspace && requestedWorkspace !== current.workspaceId) {
        throw new Error("Workspace access denied.");
      }
      if (!body.workspace || body.workspace.workspaceId !== current.workspaceId) {
        throw new Error("The workspace payload does not match the selected workspace.");
      }
      authorizeWorkspaceUpdate(actor, current, body.workspace);
      teamChanged = changed(current.team, body.workspace.team);
      return {
        ...body.workspace,
        // Preferences are written through the authorized memory endpoint; stale autosaves cannot overwrite them.
        aiMemory: current.aiMemory,
        contacts: preserveContactServerState(current.contacts, body.workspace.contacts),
        leads: preserveLeadServerState(current.leads, body.workspace.leads),
        conversations: preserveRows(current.conversations, body.workspace.conversations),
        appointments: preserveRows(current.appointments, body.workspace.appointments).map((item) => current.appointments.find((saved) => saved.id === item.id && saved.provider === "google") || item),
        automationLock: current.automationLock,
        // Generation and publication are server-owned, never trusted from generic autosaves.
        websiteProject: current.websiteProject,
        publishedWebsite: current.publishedWebsite,
        websiteReleases: current.websiteReleases,
      };
    }, actor.workspaceId);
    if (teamChanged) await syncAuthUsersFromTeam(workspace.workspaceId, workspace.team);
    return noStore({ workspace: await withRuntimeProviderState(workspace), actor, persistence: workspacePersistence(), savedAt: new Date().toISOString() });
  } catch (error) {
    const details = authErrorDetails(error);
    return noStore({ error: details.message || "Unable to save the EverOnn JSON workspace." }, { status: details.status });
  }
}

export async function HEAD() {
  try {
    await requireActor("workspace:view");
    return new Response(null, { status: 200, headers: { "X-EverOnn-Persistence": workspacePersistence() } });
  } catch (error) {
    return new Response(null, { status: authErrorDetails(error).status });
  }
}

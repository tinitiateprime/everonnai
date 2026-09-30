import { NextResponse } from "next/server";
import { getGoogleOAuthConfig, googleOAuthRedirectUri, googleOAuthScopes, revokeGoogleConnection } from "@/features/integrations/google-oauth";
import { readWorkspaceJson, writeWorkspaceJson } from "@/lib/json-workspace-store";
import { deleteGoogleConnection, getGoogleConnection } from "@/lib/provider-credentials";

export const dynamic = "force-dynamic";

function noStore<T>(payload: T, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

async function selectedWorkspace(request: Request) {
  const workspace = await readWorkspaceJson();
  const workspaceId = request.headers.get("x-everonn-workspace") || new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId || workspaceId !== workspace.workspaceId) throw new Error("Workspace access denied.");
  return workspace;
}

export async function GET(request: Request) {
  try {
    const workspace = await selectedWorkspace(request);
    let configured = true;
    try { getGoogleOAuthConfig(); } catch { configured = false; }
    const connection = configured ? await getGoogleConnection(workspace.workspaceId) : null;
    return noStore({
      configured,
      connected: Boolean(connection),
      calendar: Boolean(connection?.scope.some((scope) => scope.includes("calendar"))),
      gmail: Boolean(connection?.scope.includes("https://www.googleapis.com/auth/gmail.send")),
      requiredScopes: googleOAuthScopes,
      redirectUri: googleOAuthRedirectUri(new URL(request.url).origin),
    });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Unable to read Google connection status." }, 403);
  }
}

export async function DELETE(request: Request) {
  try {
    const workspace = await selectedWorkspace(request);
    const connection = await getGoogleConnection(workspace.workspaceId);
    await revokeGoogleConnection(connection);
    await deleteGoogleConnection(workspace.workspaceId);
    await writeWorkspaceJson({
      ...workspace,
      integrations: { ...workspace.integrations, googleCalendar: "disconnected", gmail: "disconnected" },
    });
    return noStore({ disconnected: true });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Unable to disconnect Google." }, 400);
  }
}

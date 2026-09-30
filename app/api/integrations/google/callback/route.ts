import { NextRequest, NextResponse } from "next/server";
import { exchangeGoogleAuthorizationCode, getGoogleOAuthConfig, googleOAuthRedirectUri } from "@/features/integrations/google-oauth";
import { readWorkspaceJson, writeWorkspaceJson } from "@/lib/json-workspace-store";
import { getGoogleConnection, saveGoogleConnection, verifyGoogleOAuthState } from "@/lib/provider-credentials";
import { requireActor } from "@/features/auth/session";

export const dynamic = "force-dynamic";

function dashboardRedirect(request: NextRequest, result: "connected" | "denied" | "error") {
  const response = NextResponse.redirect(new URL(`/dashboard/settings?google=${result}`, request.url));
  response.cookies.set("everonn_google_oauth", "", { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/api/integrations/google/callback", maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("error")) return dashboardRedirect(request, "denied");
  try {
    const code = request.nextUrl.searchParams.get("code") || "";
    const encodedState = request.nextUrl.searchParams.get("state") || "";
    if (!code || !encodedState) throw new Error("Google did not return an authorization code.");
    const config = getGoogleOAuthConfig();
    const state = verifyGoogleOAuthState(encodedState, config.encryptionSecret);
    const nonce = request.cookies.get("everonn_google_oauth")?.value || "";
    if (!nonce || nonce !== state.nonce) throw new Error("Google authorization could not be matched to this browser.");
    const workspace = await readWorkspaceJson();
    if (workspace.workspaceId !== state.workspaceId) throw new Error("Workspace access denied.");
    await requireActor("business:configure", state.workspaceId);
    const existing = await getGoogleConnection(state.workspaceId);
    const redirectUri = googleOAuthRedirectUri(request.nextUrl.origin);
    const connection = await exchangeGoogleAuthorizationCode(code, redirectUri, existing?.refreshToken);
    await saveGoogleConnection(state.workspaceId, connection);
    const calendarConnected = connection.scope.some((scope) => scope.includes("calendar"));
    const gmailConnected = connection.scope.includes("https://www.googleapis.com/auth/gmail.send");
    await writeWorkspaceJson({
      ...workspace,
      integrations: {
        ...workspace.integrations,
        googleCalendar: calendarConnected ? "connected" : "disconnected",
        gmail: gmailConnected ? "connected" : "disconnected",
      },
    });
    return dashboardRedirect(request, "connected");
  } catch {
    return dashboardRedirect(request, "error");
  }
}

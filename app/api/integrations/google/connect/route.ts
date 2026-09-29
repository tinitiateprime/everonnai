import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthorizationUrl, getGoogleOAuthConfig, googleOAuthRedirectUri } from "@/features/integrations/google-oauth";
import { readWorkspaceJson } from "@/lib/json-workspace-store";
import { signGoogleOAuthState } from "@/lib/provider-credentials";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspace = await readWorkspaceJson();
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") || "";
    if (!workspaceId || workspaceId !== workspace.workspaceId) return NextResponse.json({ error: "Workspace access denied." }, { status: 403 });
    const config = getGoogleOAuthConfig();
    const redirectUri = googleOAuthRedirectUri(request.nextUrl.origin);
    const nonce = randomBytes(24).toString("base64url");
    const state = signGoogleOAuthState({ workspaceId, nonce, returnTo: "/dashboard/settings", expiresAt: Date.now() + 10 * 60_000 }, config.encryptionSecret);
    const response = NextResponse.redirect(buildGoogleAuthorizationUrl(state, redirectUri));
    response.cookies.set("everonn_google_oauth", nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/api/integrations/google/callback",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to start Google authorization." }, { status: 503 });
  }
}

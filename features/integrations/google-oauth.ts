import { getGoogleConnection, saveGoogleConnection, type GoogleConnection } from "@/lib/provider-credentials";

export const googleOAuthScopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/gmail.send",
];

export function getGoogleOAuthConfig() {
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
  const encryptionSecret = String(process.env.CREDENTIAL_ENCRYPTION_KEY || "").trim();
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured.");
  if (encryptionSecret.length < 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must contain at least 32 characters.");
  return { clientId, clientSecret, encryptionSecret };
}

export function googleOAuthRedirectUri(requestOrigin: string) {
  const netlifySiteUrl = process.env.NETLIFY === "true" ? String(process.env.URL || "").trim() : "";
  const redirectUri = new URL("/api/integrations/google/callback", netlifySiteUrl || requestOrigin);
  if (redirectUri.protocol !== "http:" && redirectUri.protocol !== "https:") throw new Error("The application URL must use HTTP or HTTPS.");
  return redirectUri.toString();
}

export function buildGoogleAuthorizationUrl(state: string, redirectUri: string) {
  const config = getGoogleOAuthConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", googleOAuthScopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url;
}

type GoogleTokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(parameters: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as GoogleTokenPayload | null;
  if (!response.ok || !payload?.access_token) throw new Error(payload?.error_description || payload?.error || `Google OAuth returned HTTP ${response.status}.`);
  return payload;
}

function toConnection(payload: GoogleTokenPayload, refreshToken: string): GoogleConnection {
  return {
    accessToken: payload.access_token || "",
    refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000,
    scope: String(payload.scope || googleOAuthScopes.join(" ")).split(" ").filter(Boolean),
    tokenType: payload.token_type || "Bearer",
    connectedAt: new Date().toISOString(),
  };
}

export async function exchangeGoogleAuthorizationCode(code: string, redirectUri: string, existingRefreshToken = "") {
  const config = getGoogleOAuthConfig();
  const payload = await tokenRequest({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" });
  const refreshToken = payload.refresh_token || existingRefreshToken;
  if (!refreshToken) throw new Error("Google did not return offline access. Reconnect and approve consent again.");
  return toConnection(payload, refreshToken);
}

export async function getValidGoogleAccessToken(workspaceId: string) {
  const connection = await getGoogleConnection(workspaceId);
  if (!connection) throw new Error("Google is not connected for this workspace.");
  if (connection.expiresAt > Date.now() + 60_000) return connection.accessToken;
  const config = getGoogleOAuthConfig();
  const payload = await tokenRequest({ refresh_token: connection.refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" });
  const refreshed = toConnection(payload, connection.refreshToken);
  refreshed.connectedAt = connection.connectedAt;
  await saveGoogleConnection(workspaceId, refreshed);
  return refreshed.accessToken;
}

export async function revokeGoogleConnection(connection: GoogleConnection | null) {
  const token = connection?.refreshToken || connection?.accessToken;
  if (!token) return;
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  }).catch(() => undefined);
}

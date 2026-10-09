import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  decryptPayload,
  encryptPayload,
  readIntegration,
  withIntegration,
  type GoogleConnection,
} from "./integrations-store";

// Ported from main: features/integrations/google-oauth.ts, with connections stored per
// generated business instead of per workspace.
export const googleOAuthScopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/gmail.send",
];
export function googleOAuthConfigured() {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
    (process.env.CREDENTIAL_ENCRYPTION_KEY ?? "").trim().length >= 32,
  );
}
function config() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret || !googleOAuthConfigured())
    throw new Error(
      "Google is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and CREDENTIAL_ENCRYPTION_KEY (32+ characters) in .env.local and restart the app.",
    );
  return { clientId, clientSecret };
}
export function googleRedirectUri(requestUrl: string) {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    new URL("/api/integrations/google/callback", requestUrl).toString()
  );
}

const stateKey = () =>
  createHmac("sha256", (process.env.CREDENTIAL_ENCRYPTION_KEY ?? "").trim())
    .update("google-oauth-state")
    .digest();
/** Signed, expiring OAuth state naming the business that started the connection. */
export function signOAuthState(slug: string, now = Date.now()) {
  const body = Buffer.from(
    JSON.stringify({
      slug,
      exp: now + 10 * 60_000,
      nonce: randomBytes(12).toString("base64url"),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", stateKey())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}
export function verifyOAuthState(state: string, now = Date.now()) {
  const [body, signature] = state.split(".");
  if (!body || !signature) throw new Error("Invalid Google connection state.");
  const expected = createHmac("sha256", stateKey()).update(body).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new Error("Invalid Google connection state.");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (typeof payload.slug !== "string" || !(payload.exp > now))
    throw new Error("The Google connection link expired. Connect again.");
  return payload.slug as string;
}
export function googleAuthorizationUrl(slug: string, redirectUri: string) {
  const { clientId } = config();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", googleOAuthScopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", signOAuthState(slug));
  return url.toString();
}

type TokenPayload = {
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
  const payload = (await response
    .json()
    .catch(() => null)) as TokenPayload | null;
  if (!response.ok || !payload?.access_token)
    throw new Error(
      payload?.error_description ||
        payload?.error ||
        `Google OAuth returned HTTP ${response.status}.`,
    );
  return payload;
}
function toConnection(
  payload: TokenPayload,
  refreshToken: string,
): GoogleConnection {
  return {
    accessToken: payload.access_token ?? "",
    refreshToken,
    expiresAt:
      Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000,
    scope: String(payload.scope || googleOAuthScopes.join(" "))
      .split(" ")
      .filter(Boolean),
    tokenType: payload.token_type || "Bearer",
    connectedAt: new Date().toISOString(),
  };
}
export async function connectGoogle(
  slug: string,
  code: string,
  redirectUri: string,
) {
  const { clientId, clientSecret } = config();
  const payload = await tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  await withIntegration(slug, async (record, save) => {
    const previous = record.google
      ? decryptPayload<GoogleConnection>(record.google)
      : null;
    const refreshToken = payload.refresh_token || previous?.refreshToken;
    if (!refreshToken)
      throw new Error(
        "Google did not return offline access. Connect again and approve every permission.",
      );
    await save({
      ...record,
      google: encryptPayload(toConnection(payload, refreshToken)),
    });
  });
}
export async function googleConnection(slug: string) {
  const record = await readIntegration(slug);
  if (!record.google || !googleOAuthConfigured()) return null;
  try {
    return decryptPayload<GoogleConnection>(record.google);
  } catch {
    return null;
  }
}
/** A current access token, refreshed (and re-saved) when it is about to expire. */
export async function googleAccessToken(slug: string) {
  const connection = await googleConnection(slug);
  if (!connection)
    throw new Error("Google is not connected for this business.");
  if (connection.expiresAt > Date.now() + 60_000) return connection.accessToken;
  const { clientId, clientSecret } = config();
  const payload = await tokenRequest({
    refresh_token: connection.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const refreshed = {
    ...toConnection(payload, connection.refreshToken),
    connectedAt: connection.connectedAt,
  };
  await withIntegration(slug, (record, save) =>
    save({ ...record, google: encryptPayload(refreshed) }),
  );
  return refreshed.accessToken;
}
export async function disconnectGoogle(slug: string) {
  const connection = await googleConnection(slug);
  await withIntegration(slug, (record, save) =>
    save({ ...record, google: undefined }),
  );
  const token = connection?.refreshToken || connection?.accessToken;
  if (token)
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    }).catch(() => undefined);
}

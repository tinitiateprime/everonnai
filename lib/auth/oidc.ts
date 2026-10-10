import * as oidc from "openid-client";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { platformOrigin, PlatformError } from "../platform/config";

const flowSchema = z.object({
  state: z.string().min(16).max(200),
  nonce: z.string().min(16).max(200),
  verifier: z.string().min(43).max(128),
  expiresAt: z.number(),
});
export const flowCookieName = "everonn-oidc-flow";
function encryptionKey() {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32)
    throw new PlatformError(
      "Configure a 32-character or longer AUTH_SESSION_SECRET for sign-in.",
      503,
    );
  return createHash("sha256").update(secret).digest();
}
export function encodeFlow(flow: z.infer<typeof flowSchema>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(flowSchema.parse(flow)), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function decodeFlow(value?: string) {
  if (!value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new PlatformError("Sign-in expired. Please try again.", 401);
  try {
    const data = Buffer.from(value, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      data.subarray(0, 12),
    );
    decipher.setAuthTag(data.subarray(12, 28));
    const flow = flowSchema.parse(
      JSON.parse(
        Buffer.concat([
          decipher.update(data.subarray(28)),
          decipher.final(),
        ]).toString("utf8"),
      ),
    );
    if (flow.expiresAt <= Date.now()) throw new Error("Expired");
    return flow;
  } catch {
    throw new PlatformError("Sign-in expired. Please try again.", 401);
  }
}
let configuration: Promise<oidc.Configuration> | undefined;
export function oidcConfiguration() {
  if (!configuration) {
    const issuer = process.env.AUTH_OIDC_ISSUER?.trim();
    const id = process.env.AUTH_OIDC_CLIENT_ID?.trim();
    const secret = process.env.AUTH_OIDC_CLIENT_SECRET?.trim();
    if (!issuer || !id || !secret || new URL(issuer).protocol !== "https:")
      throw new PlatformError(
        "Configure an HTTPS OIDC issuer and client credentials for sign-in.",
        503,
      );
    encryptionKey();
    configuration = oidc
      .discovery(new URL(issuer), id, secret, undefined, {
        execute: [oidc.enableNonRepudiationChecks],
        timeout: 15,
      })
      .catch(() => {
        configuration = undefined;
        throw new PlatformError(
          "The sign-in provider is unavailable. Please try again.",
          503,
        );
      });
  }
  return configuration;
}
export async function startOidcLogin() {
  const config = await oidcConfiguration();
  const verifier = oidc.randomPKCECodeVerifier();
  const flow = {
    verifier,
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    expiresAt: Date.now() + 600000,
  };
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: platformOrigin() + "/api/platform/auth/callback",
    scope: "openid profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
  });
  return { url, flow: encodeFlow(flow) };
}
export async function finishOidcLogin(
  request: Request,
  value?: string,
  configurationOverride?: oidc.Configuration,
) {
  const flow = decodeFlow(value);
  // Use the configured origin, not untrusted Host/forwarded headers, for token exchange.
  const url = new URL(platformOrigin() + "/api/platform/auth/callback");
  url.search = new URL(request.url).search;
  const config = configurationOverride ?? (await oidcConfiguration());
  oidc.enableNonRepudiationChecks(config);
  const tokens = await oidc.authorizationCodeGrant(config, url, {
    pkceCodeVerifier: flow.verifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims?.sub || !claims.iss)
    throw new PlatformError(
      "The sign-in provider did not verify your identity.",
      401,
    );
  return {
    issuer: claims.iss,
    subject: claims.sub,
    displayName: String(
      claims.name || claims.preferred_username || "Workspace member",
    ).slice(0, 120),
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import { googleOAuthRedirectUri } from "../features/integrations/google-oauth";
import { getGeminiWebsiteConfig, getProviderReadiness } from "../lib/provider-config";

test("AgenticThat provider variable names work unchanged", () => {
  const environment = {
    GOOGLE_API_KEY: "shared-google-key",
    GEMINI_WEBSITE_MODELS: "gemini-primary, gemini-secondary",
    GEMINI_WEBSITE_TIMEOUT_MS: "42000",
    GEMINI_WEBSITE_RETRY_DELAY_MS: "1200",
    PEXELS_API_KEY: "shared-pexels-key",
    ELEVENLABS_API_KEY: "shared-eleven-key",
    ELEVENLABS_AGENT_ID: "shared-agent-id",
    GOOGLE_OAUTH_CLIENT_ID: "client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
    CREDENTIAL_ENCRYPTION_KEY: "encryption-key",
    RESEND_API_KEY: "resend-key",
    AUTH_EMAIL_FROM: "EverOnn <hello@example.com>",
  };

  const gemini = getGeminiWebsiteConfig(environment);
  assert.equal(gemini.apiKey, "shared-google-key");
  assert.deepEqual(gemini.models.slice(0, 2), ["gemini-primary", "gemini-secondary"]);
  assert.equal(gemini.timeoutMs, 42_000);
  assert.equal(gemini.retryDelayMs, 1_200);
  assert.deepEqual(getProviderReadiness(environment), {
    gemini: true,
    pexels: true,
    elevenLabs: true,
    googleOAuth: true,
    googleServiceAccount: false,
    resend: true,
  });
});

test("Google OAuth callback uses the public application URL", () => {
  assert.equal(googleOAuthRedirectUri("https://everonnai.netlify.app"), "https://everonnai.netlify.app/api/integrations/google/callback");
});

test("Google OAuth callback uses Netlify's stable site URL instead of an immutable deploy URL", () => {
  const previousSiteName = process.env.SITE_NAME;
  process.env.SITE_NAME = "everonnai";
  try {
    assert.equal(
      googleOAuthRedirectUri("https://deploy-id--everonnai.netlify.app"),
      "https://everonnai.netlify.app/api/integrations/google/callback",
    );
  } finally {
    if (previousSiteName === undefined) delete process.env.SITE_NAME;
    else process.env.SITE_NAME = previousSiteName;
  }
});

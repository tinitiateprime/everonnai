type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

function clean(environment: Environment, ...keys: string[]) {
  for (const key of keys) {
    const value = String(environment[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function boundedNumber(value: string, fallback: number, minimum: number, maximum: number) {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback;
}

export function getGeminiWebsiteConfig(environment: Environment = process.env) {
  const configuredModels = clean(environment, "GEMINI_WEBSITE_MODELS")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const models = [...new Set([
    ...configuredModels,
    clean(environment, "GEMINI_WEBSITE_MODEL"),
    clean(environment, "GEMINI_MODEL"),
    "gemini-3.8-flash",
  ].filter(Boolean))].slice(0, 5);

  return {
    apiKey: clean(environment, "GEMINI_API_KEY", "GOOGLE_API_KEY"),
    models,
    timeoutMs: boundedNumber(clean(environment, "GEMINI_WEBSITE_TIMEOUT_MS", "GEMINI_TIMEOUT_MS"), 150_000, 10_000, 240_000),
    retryDelayMs: boundedNumber(clean(environment, "GEMINI_WEBSITE_RETRY_DELAY_MS"), 900, 0, 10_000),
  };
}

export function getProviderReadiness(environment: Environment = process.env) {
  const gemini = getGeminiWebsiteConfig(environment);
  return {
    gemini: Boolean(gemini.apiKey),
    pexels: Boolean(clean(environment, "PEXELS_API_KEY")),
    elevenLabs: Boolean(clean(environment, "ELEVENLABS_API_KEY") && clean(environment, "ELEVENLABS_AGENT_ID")),
    googleOAuth: Boolean(clean(environment, "GOOGLE_OAUTH_CLIENT_ID") && clean(environment, "GOOGLE_OAUTH_CLIENT_SECRET") && clean(environment, "CREDENTIAL_ENCRYPTION_KEY")),
    googleServiceAccount: Boolean(clean(environment, "GOOGLE_CALENDAR_SERVICE_ACCOUNT_BASE64")),
    resend: Boolean(clean(environment, "RESEND_API_KEY") && clean(environment, "AUTH_EMAIL_FROM")),
  };
}

export function getGeminiWebsiteCodeTimeout(environment: Environment = process.env) {
  return boundedNumber(clean(environment, "GEMINI_WEBSITE_CODE_TIMEOUT_MS"), 150_000, 30_000, 240_000);
}

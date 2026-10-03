import { writeFile } from "node:fs/promises";

// Amplify build variables are not automatically available to Next.js SSR.
// Copy only application configuration, never build-role AWS credentials.
const appOrigin = process.env.NEXT_PUBLIC_APP_URL || "";
let validOrigin = false;
try { const parsed = new URL(appOrigin); validOrigin = parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && ["", "/"].includes(parsed.pathname); } catch { /* Report configuration without values. */ }
if (!validOrigin) throw new Error("Set NEXT_PUBLIC_APP_URL to the live HTTPS Amplify origin before deploying.");
if ((process.env.SUPABASE_USAGE_SCHEMA || "everonn_usage") !== "everonn_usage") throw new Error("SUPABASE_USAGE_SCHEMA must be everonn_usage.");
if (!process.env.SUPABASE_DB_URL && !((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY))) {
  throw new Error("Configure SUPABASE_DB_URL in Amplify before deploying the usage meter. A configured Data API URL/server key is the optional alternative.");
}
const keys = [
  "NEXT_PUBLIC_APP_URL", "EVERONN_AUTH_SETUP_TOKEN", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_MODEL", "GEMINI_TIMEOUT_MS", "GEMINI_WEBSITE_MODEL", "GEMINI_WEBSITE_MODELS", "GEMINI_WEBSITE_TIMEOUT_MS", "GEMINI_WEBSITE_RETRY_DELAY_MS", "GEMINI_BILLING_TIER", "PEXELS_API_KEY",
  "ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_WEBHOOK_SECRET", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "CREDENTIAL_ENCRYPTION_KEY", "GOOGLE_CALENDAR_SERVICE_ACCOUNT_BASE64",
  "SUPABASE_DB_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_USAGE_SCHEMA", "USAGE_CRON_SECRET", "GEMINI_BILLING_SERVICE_ACCOUNT_BASE64", "GEMINI_BILLING_TABLE", "GEMINI_BILLING_PROJECT_ID", "GEMINI_BILLING_SERVICE_ID", "GEMINI_BILLING_WORKSPACE_ID", "GEMINI_BILLING_TIME_ZONE",
  "EVERONN_DATA_FILE", "EVERONN_WORKSPACES_FILE", "EVERONN_AUTH_FILE", "EVERONN_CONNECTIONS_FILE", "PHONE_FRONT_DESK_FOLLOW_UP_ENABLED",
];
// dotenv-expand runs again at SSR startup. Escape literal dollars so a secret
// is not changed by an accidental reference to another environment variable.
const lines = keys.filter((key) => process.env[key]).map((key) => `${key}=${JSON.stringify(process.env[key]).replace(/\$/g, "\\$")}`);
if (!process.env.SUPABASE_USAGE_SCHEMA) lines.push("SUPABASE_USAGE_SCHEMA=everonn_usage");
lines.push("USAGE_REQUIRE_DURABLE_STORAGE=true", "USAGE_BACKGROUND_MODE=external");
await writeFile(".env.production", `${lines.join("\n")}\n`, { mode: 0o600 });
console.log("Prepared the server environment for Amplify without logging secret values.");

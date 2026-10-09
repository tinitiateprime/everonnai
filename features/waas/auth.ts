import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "waas_admin";
export function apiKey() {
  const key = process.env.WAAS_API_KEY?.trim();
  if (!key || key.length < 32) throw Object.assign(new Error("Set WAAS_API_KEY to at least 32 random characters."), { status: 503 });
  return key;
}
function equal(left: string, right: string) {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}
export function verifyApiKey(value: string) { return equal(value, apiKey()); }
export function sessionToken(expires = Date.now() + 8 * 60 * 60 * 1000) {
  return String(expires) + "." + createHmac("sha256", apiKey()).update("waas-admin:" + expires).digest("hex");
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.WAAS_PUBLIC_URL || request.url).origin;
  if (!origin || origin !== expected) throw Object.assign(new Error("This request must come from the Website Studio origin."), { status: 403 });
}
export function authorize(request: Request) {
  const bearer = request.headers.get("authorization");
  if (bearer) {
    if (bearer.startsWith("Bearer ") && verifyApiKey(bearer.slice(7))) return;
    throw Object.assign(new Error("Invalid API key."), { status: 401 });
  }
  apiKey();
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(SESSION_COOKIE + "="))?.slice(SESSION_COOKIE.length + 1);
  const expiry = token?.split(".")[0];
  if (!token || !expiry || !/^\d{13}$/.test(expiry) || Number(expiry) <= Date.now() || Number(expiry) > Date.now() + 8 * 60 * 60 * 1000 || !equal(token, sessionToken(Number(expiry)))) throw Object.assign(new Error("Sign in to Website Studio."), { status: 401 });
  if (!["GET", "HEAD"].includes(request.method)) assertOrigin(request);
}

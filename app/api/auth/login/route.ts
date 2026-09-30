import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorDetails, setAuthCookie } from "@/features/auth/session";
import { authenticateCredentials, getAuthSetupState } from "@/lib/auth-store";

export const dynamic = "force-dynamic";

const attempts = new Map<string, number[]>();

function enforceRateLimit(request: Request, email: string) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = createHash("sha256").update(`${address}|${email.trim().toLowerCase()}`).digest("hex");
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((time) => now - time < 15 * 60_000);
  if (recent.length >= 10) throw Object.assign(new Error("Too many sign-in attempts. Try again in 15 minutes."), { status: 429 });
  attempts.set(key, [...recent, now]);
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (!raw || raw.length > 2_000) return NextResponse.json({ error: "Invalid sign-in request." }, { status: 400 });
    const input = JSON.parse(raw) as { email?: string; password?: string };
    const email = String(input.email || "").trim().toLowerCase();
    const password = String(input.password || "");
    if (!email || !password) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
    const setup = await getAuthSetupState();
    if (setup.setupRequired) return NextResponse.json({ error: "Create the first owner account before signing in.", setupRequired: true }, { status: 409 });
    enforceRateLimit(request, email);
    const result = await authenticateCredentials(email, password);
    const response = NextResponse.json({ authenticated: true, actor: result.actor }, { headers: { "Cache-Control": "private, no-store" } });
    setAuthCookie(response, result.token, request.url);
    return response;
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status, headers: { "Cache-Control": "private, no-store" } });
  }
}

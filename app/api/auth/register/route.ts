import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createStarterWorkspace } from "@/features/everonn/starter-workspace";
import { assertSameOrigin, authErrorDetails, setAuthCookie } from "@/features/auth/session";
import { getAuthSetupState, registerWorkspaceOwner, rollbackNewAccount } from "@/lib/auth-store";
import { createWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

const attempts = new Map<string, number[]>();

function clean(value: unknown, maximum: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function consumeRateLimit(key: string, maximum: number, now: number) {
  const recent = (attempts.get(key) || []).filter((time) => now - time < 60 * 60_000);
  if (recent.length >= maximum) throw Object.assign(new Error("Too many account-creation attempts. Try again later."), { status: 429 });
  attempts.set(key, [...recent, now]);
}

function enforceRateLimit(request: Request, email: string) {
  const address = request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "local";
  const now = Date.now();
  const addressKey = createHash("sha256").update(`${address}|*`).digest("base64url");
  const emailKey = createHash("sha256").update(`${address}|${email}`).digest("base64url");
  consumeRateLimit(addressKey, 20, now);
  consumeRateLimit(emailKey, 5, now);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (!raw || raw.length > 6_000) return NextResponse.json({ error: "Invalid account request." }, { status: 400 });
    const input = JSON.parse(raw) as { name?: string; businessName?: string; businessType?: string; email?: string; password?: string; timeZone?: string };
    const name = clean(input.name, 120);
    const businessName = clean(input.businessName, 160);
    const businessType = clean(input.businessType, 160);
    const email = clean(input.email, 254).toLowerCase();
    const password = String(input.password || "");
    const timeZone = clean(input.timeZone, 100) || "UTC";
    if (name.length < 2 || businessName.length < 2 || businessType.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter your name, business name, business type, and a valid work email." }, { status: 400 });
    }
    const setup = await getAuthSetupState();
    if (setup.setupRequired) {
      return NextResponse.json({ error: "Create the platform’s first owner account before opening customer registration." }, { status: 409 });
    }
    enforceRateLimit(request, email);
    const workspaceId = `workspace_${crypto.randomUUID()}`;
    const memberId = `member_${crypto.randomUUID()}`;
    const result = await registerWorkspaceOwner({ workspaceId, memberId, name, email, password });
    try {
      await createWorkspaceJson(createStarterWorkspace({ workspaceId, memberId, ownerName: name, ownerEmail: email, businessName, businessType, timeZone }));
    } catch (workspaceError) {
      await rollbackNewAccount(result.actor.userId).catch(() => undefined);
      throw workspaceError;
    }
    const response = NextResponse.json({ authenticated: true, actor: result.actor }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    setAuthCookie(response, result.token, request.url);
    return response;
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status, headers: { "Cache-Control": "private, no-store" } });
  }
}

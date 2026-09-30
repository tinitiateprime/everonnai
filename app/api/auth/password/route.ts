import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorDetails, requireActor, setAuthCookie } from "@/features/auth/session";
import { replacePassword } from "@/lib/auth-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor("workspace:view");
    const raw = await request.text();
    if (!raw || raw.length > 2_000) return NextResponse.json({ error: "Invalid password request." }, { status: 400 });
    const input = JSON.parse(raw) as { currentPassword?: string; newPassword?: string };
    const result = await replacePassword(actor, String(input.currentPassword || ""), String(input.newPassword || ""));
    const response = NextResponse.json({ changed: true }, { headers: { "Cache-Control": "private, no-store" } });
    setAuthCookie(response, result.token, request.url);
    return response;
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status, headers: { "Cache-Control": "private, no-store" } });
  }
}

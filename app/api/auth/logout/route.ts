import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertSameOrigin, authCookieName, authErrorDetails, clearAuthCookie } from "@/features/auth/session";
import { revokeSession } from "@/lib/auth-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const token = (await cookies()).get(authCookieName)?.value || "";
    if (token) await revokeSession(token);
    const response = NextResponse.json({ signedOut: true }, { headers: { "Cache-Control": "private, no-store" } });
    clearAuthCookie(response, request.url);
    return response;
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status, headers: { "Cache-Control": "private, no-store" } });
  }
}

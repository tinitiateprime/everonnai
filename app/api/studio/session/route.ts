import { NextResponse } from "next/server";
import { assertOrigin, authorize, SESSION_COOKIE, sessionToken, verifyApiKey } from "@/features/waas/auth";
import { body, errorResponse, json } from "@/features/waas/http";
import { object, bad } from "@/features/waas/input";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { authorize(request); return json({ authenticated: true }); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const input = object(await body(request));
    if (typeof input.apiKey !== "string" || !verifyApiKey(input.apiKey)) bad("Invalid API key.", 401);
    const response = NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SESSION_COOKIE, sessionToken(), { httpOnly: true, secure: new URL(process.env.WAAS_PUBLIC_URL || request.url).protocol === "https:", sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 });
    return response;
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    assertOrigin(request);
    const response = NextResponse.json({ authenticated: false });
    response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
    return response;
  } catch (error) { return errorResponse(error); }
}

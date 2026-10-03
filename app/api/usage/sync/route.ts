import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorDetails, requireActor } from "@/features/auth/session";
import { syncWorkspaceUsage } from "@/features/usage/elevenlabs";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor("usage:view");
    return NextResponse.json(await syncWorkspaceUsage(actor.workspaceId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const details = authErrorDetails(error, 502);
    return NextResponse.json({ error: details.message }, { status: details.status, headers: { "Cache-Control": "private, no-store" } });
  }
}

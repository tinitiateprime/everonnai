import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorDetails } from "@/features/auth/session";
import { readUsageSession } from "@/lib/usage-store";
import { syncUsageSession } from "@/features/usage/elevenlabs";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (raw.length > 1_000) return NextResponse.json({ error: "Invalid usage session request." }, { status: 400 });
    const input = JSON.parse(raw) as { sessionId?: string; conversationId?: string };
    if (typeof input.sessionId !== "string" || typeof input.conversationId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(input.conversationId)) return NextResponse.json({ error: "Invalid usage session request." }, { status: 400 });
    const session = await readUsageSession(input.sessionId);
    if (!session || Date.now() - Date.parse(session.createdAt) > 24 * 60 * 60_000) return NextResponse.json({ error: "Usage session unavailable." }, { status: 404 });
    // The opaque credential authorizes only reconciliation with a provider
    // conversation whose userId AND agentId match. No client metrics accepted.
    await syncUsageSession(session, input.conversationId);
    return NextResponse.json({ recorded: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const details = authErrorDetails(error, 502);
    return NextResponse.json({ error: details.message }, { status: details.status, headers: { "Cache-Control": "private, no-store" } });
  }
}

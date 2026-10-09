import { assertSameOrigin, requireActor } from "@/features/auth/session";
import { executeCommand, parseCommand } from "@/features/call-center/server/commands";
import { loadSnapshot } from "@/features/call-center/server/snapshot";
import { deskError, deskJson, deskNotConfigured } from "@/features/call-center/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Desk commands (Appendix J envelope: { type, id, payload }). The response
// carries the fresh snapshot so the desk renders server state immediately.
export async function POST(request: Request) {
  const unavailable = deskNotConfigured();
  if (unavailable) return unavailable;
  try {
    assertSameOrigin(request);
    if (Number(request.headers.get("content-length") || 0) > 32_000) return deskJson({ error: "Command too large.", code: "invalid_input" }, { status: 413 });
    const actor = await requireActor();
    const session = request.headers.get("x-desk-session") || "";
    const command = parseCommand(await request.json());
    const result = await executeCommand(actor, command, session);
    return deskJson({ ok: true, result, snapshot: await loadSnapshot(actor, session) });
  } catch (error) {
    return deskError(error);
  }
}

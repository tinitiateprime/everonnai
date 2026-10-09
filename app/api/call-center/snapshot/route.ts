import { requireActor } from "@/features/auth/session";
import { loadSnapshot } from "@/features/call-center/server/snapshot";
import { deskError, deskJson, deskNotConfigured } from "@/features/call-center/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Desk state snapshot; each poll doubles as the operator heartbeat (DSK-026).
export async function GET(request: Request) {
  const unavailable = deskNotConfigured();
  if (unavailable) return unavailable;
  try {
    const actor = await requireActor();
    const session = new URL(request.url).searchParams.get("session") || "";
    if (!/^[0-9a-f-]{36}$/i.test(session)) return deskJson({ error: "A desk session id is required.", code: "invalid_input" }, { status: 400 });
    return deskJson(await loadSnapshot(actor, session));
  } catch (error) {
    return deskError(error);
  }
}

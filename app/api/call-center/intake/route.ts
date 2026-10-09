import { appendCallerMessage, createEscalation, endFromCallerSide } from "@/features/call-center/server/intake";
import { bearerMatches, deskError, deskJson, deskNotConfigured } from "@/features/call-center/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Service intake for the AI runtime (voice, chat and SMS agents). Authenticated
// with CALL_CENTER_INTAKE_SECRET; never called from a browser.
export async function POST(request: Request) {
  const unavailable = deskNotConfigured();
  if (unavailable) return unavailable;
  if (!bearerMatches(request, process.env.CALL_CENTER_INTAKE_SECRET)) return deskJson({ error: "Unauthorized.", code: "forbidden" }, { status: 401 });
  try {
    if (Number(request.headers.get("content-length") || 0) > 200_000) return deskJson({ error: "Payload too large.", code: "invalid_input" }, { status: 413 });
    const body = await request.json() as { type?: string; data?: Record<string, unknown> };
    const actor = { type: "service" as const, id: "ai-runtime" };
    const data = body.data || {};
    if (body.type === "escalation.create") return deskJson(await createEscalation(actor, data), { status: 201 });
    if (body.type === "escalation.end") return deskJson(await endFromCallerSide(actor, { tenantId: String(data.tenantId || ""), escalationId: String(data.escalationId || ""), reasonCode: String(data.reasonCode || "") }));
    if (body.type === "conversation.message") return deskJson(await appendCallerMessage(actor, { tenantId: String(data.tenantId || ""), escalationId: String(data.escalationId || ""), text: String(data.text || "") }), { status: 201 });
    return deskJson({ error: "type must be escalation.create, escalation.end or conversation.message.", code: "invalid_input" }, { status: 400 });
  } catch (error) {
    return deskError(error);
  }
}

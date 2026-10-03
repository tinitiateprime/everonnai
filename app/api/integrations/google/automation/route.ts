import { NextResponse } from "next/server";
import { processLeadAutomation } from "@/features/integrations/lead-automation";
import { readWorkspaceJson } from "@/lib/json-workspace-store";
import { updateWorkspaceJson } from "@/lib/json-workspace-store";
import { validateAppointmentRequest } from "@/features/voice-agent/appointment-validation";
import { assertSameOrigin, authErrorDetails, requireActor } from "@/features/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (!raw || raw.length > 2_000) return NextResponse.json({ error: "Invalid automation request." }, { status: 400 });
    const input = JSON.parse(raw) as { leadId?: string; appointmentRequest?: unknown };
    const workspaceId = request.headers.get("x-everonn-workspace") || "";
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace access denied." }, { status: 403 });
    }
    await requireActor("appointments:operate", workspaceId);
    const workspace = await readWorkspaceJson(workspaceId);
    if (!input.leadId || !workspace.leads.some((lead) => lead.id === input.leadId)) {
      return NextResponse.json({ error: "A valid lead is required." }, { status: 400 });
    }
    if (input.appointmentRequest !== undefined) {
      const existing = workspace.appointments.find((item) => item.leadId === input.leadId && item.status === "confirmed");
      if (existing) return NextResponse.json({ error: "This request already has a confirmed booking. Review the existing Calendar event to change it." }, { status: 409 });
      let appointmentRequest;
      try { appointmentRequest = validateAppointmentRequest(input.appointmentRequest, workspace.profile); }
      catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
      await updateWorkspaceJson((current) => ({ ...current, leads: current.leads.map((lead) => lead.id === input.leadId ? { ...lead, appointmentRequest, captureStatus: "complete", updatedAt: new Date().toISOString() } : lead) }), workspaceId);
    }
    const result = await processLeadAutomation(input.leadId, workspaceId);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const details = authErrorDetails(error, 502);
    return NextResponse.json({ error: details.message || "Unable to process Google follow-up." }, { status: details.status });
  }
}

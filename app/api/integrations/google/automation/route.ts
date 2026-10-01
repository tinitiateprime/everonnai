import { NextResponse } from "next/server";
import { processLeadAutomation } from "@/features/integrations/lead-automation";
import { readWorkspaceJson } from "@/lib/json-workspace-store";
import { assertSameOrigin, authErrorDetails, requireActor } from "@/features/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (!raw || raw.length > 2_000) return NextResponse.json({ error: "Invalid automation request." }, { status: 400 });
    const input = JSON.parse(raw) as { leadId?: string };
    const workspaceId = request.headers.get("x-everonn-workspace") || "";
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace access denied." }, { status: 403 });
    }
    await requireActor("appointments:operate", workspaceId);
    const workspace = await readWorkspaceJson(workspaceId);
    if (!input.leadId || !workspace.leads.some((lead) => lead.id === input.leadId)) {
      return NextResponse.json({ error: "A valid lead is required." }, { status: 400 });
    }
    const result = await processLeadAutomation(input.leadId, workspaceId);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const details = authErrorDetails(error, 502);
    return NextResponse.json({ error: details.message || "Unable to process Google follow-up." }, { status: details.status });
  }
}

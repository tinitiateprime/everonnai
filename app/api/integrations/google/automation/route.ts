import { NextResponse } from "next/server";
import { processLeadAutomation } from "@/features/integrations/lead-automation";
import { readWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (!raw || raw.length > 2_000) return NextResponse.json({ error: "Invalid automation request." }, { status: 400 });
    const input = JSON.parse(raw) as { leadId?: string };
    const workspace = await readWorkspaceJson();
    if (request.headers.get("x-everonn-workspace") !== workspace.workspaceId) {
      return NextResponse.json({ error: "Workspace access denied." }, { status: 403 });
    }
    if (!input.leadId || !workspace.leads.some((lead) => lead.id === input.leadId)) {
      return NextResponse.json({ error: "A valid lead is required." }, { status: 400 });
    }
    const result = await processLeadAutomation(input.leadId);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process Google follow-up." }, { status: 502 });
  }
}

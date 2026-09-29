import { NextResponse } from "next/server";
import type { Lead } from "@/features/everonn/types";
import { updateWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

function clean(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (!raw || raw.length > 5_000) return NextResponse.json({ error: "Invalid lead request." }, { status: 400 });
    const input = JSON.parse(raw) as {
      previewToken?: string;
      publicSlug?: string;
      callerName?: string;
      callerPhone?: string;
      reason?: string;
    };
    const callerPhone = clean(input.callerPhone, 40);
    if (!callerPhone) return NextResponse.json({ error: "A callback number is required." }, { status: 400 });

    let lead: Lead | null = null;
    await updateWorkspaceJson((workspace) => {
      const project = workspace.websiteProject;
      const previewAllowed = Boolean(input.previewToken && project?.privateToken === input.previewToken);
      const publicAllowed = Boolean(input.publicSlug && project?.publicSlug === input.publicSlug && project.status === "published");
      if (!project || (!previewAllowed && !publicAllowed)) throw new Error("This website assistant is unavailable.");
      lead = {
        id: `lead_${crypto.randomUUID()}`,
        workspaceId: workspace.workspaceId,
        callerName: clean(input.callerName, 120) || "Website visitor",
        callerPhone,
        reason: clean(input.reason, 300) || "AI website assistant conversation",
        source: "chat",
        urgency: "normal",
        status: "new",
        createdAt: new Date().toISOString(),
      };
      return { ...workspace, leads: [lead, ...workspace.leads] };
    });

    return NextResponse.json({ saved: true, leadId: lead && (lead as Lead).id }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to capture callback details." }, { status: 400 });
  }
}

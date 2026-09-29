import { NextResponse } from "next/server";
import type { Contact, Lead, Urgency } from "@/features/everonn/types";
import { updateWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

function clean(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function phoneKey(value: string) {
  return value.replace(/\D/g, "").slice(-15);
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
      urgency?: Urgency;
      source?: Lead["source"];
    };
    const callerPhone = clean(input.callerPhone, 40);
    if (!callerPhone) return NextResponse.json({ error: "A callback number is required." }, { status: 400 });

    let lead: Lead | null = null;
    let contact: Contact | null = null;
    await updateWorkspaceJson((workspace) => {
      const project = workspace.websiteProject;
      const workspaceAllowed = request.headers.get("x-everonn-workspace") === workspace.workspaceId;
      const previewAllowed = Boolean(input.previewToken && project?.privateToken === input.previewToken);
      const publicAllowed = Boolean(input.publicSlug && project?.publicSlug === input.publicSlug && project.status === "published");
      if (!workspaceAllowed && (!project || (!previewAllowed && !publicAllowed))) throw new Error("This website assistant is unavailable.");
      const now = new Date().toISOString();
      const callerName = clean(input.callerName, 120) || "Website visitor";
      const reason = clean(input.reason, 300) || "AI website assistant conversation";
      const urgency: Urgency = ["low", "normal", "high"].includes(String(input.urgency)) ? input.urgency! : "normal";
      const source: Lead["source"] = ["phone", "chat", "website"].includes(String(input.source)) ? input.source! : "chat";
      const normalizedPhone = phoneKey(callerPhone);
      const existingContact = workspace.contacts.find((item) => phoneKey(item.phone) === normalizedPhone);
      contact = {
        id: existingContact?.id || `contact_${crypto.randomUUID()}`,
        workspaceId: workspace.workspaceId,
        name: callerName === "Website visitor" ? existingContact?.name || callerName : callerName,
        phone: callerPhone,
        email: existingContact?.email || "",
        company: existingContact?.company,
        lastContactAt: now,
      };
      const existingLead = workspace.leads.find((item) => phoneKey(item.callerPhone) === normalizedPhone && item.status === "new");
      lead = {
        id: existingLead?.id || `lead_${crypto.randomUUID()}`,
        workspaceId: workspace.workspaceId,
        contactId: contact.id,
        callerName: callerName === "Website visitor" ? existingLead?.callerName || callerName : callerName,
        callerPhone,
        reason,
        source,
        urgency,
        status: "new",
        createdAt: existingLead?.createdAt || now,
      };
      return {
        ...workspace,
        contacts: existingContact
          ? workspace.contacts.map((item) => item.id === existingContact.id ? contact! : item)
          : [contact, ...workspace.contacts],
        leads: existingLead
          ? workspace.leads.map((item) => item.id === existingLead.id ? lead! : item)
          : [lead, ...workspace.leads],
      };
    });

    return NextResponse.json({ saved: true, lead, contact }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to capture callback details." }, { status: 400 });
  }
}

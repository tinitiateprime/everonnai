import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { Contact, Lead, Urgency } from "@/features/everonn/types";
import { processLeadAutomation } from "@/features/integrations/lead-automation";
import { updateWorkspaceJson } from "@/lib/json-workspace-store";
import { hasCapability } from "@/features/auth/rbac";
import { assertSameOrigin, authErrorDetails, getCurrentActor } from "@/features/auth/session";

export const dynamic = "force-dynamic";

const publicAttempts = new Map<string, number[]>();
const publicWindowMs = 10 * 60_000;

function enforcePublicRateLimit(request: Request, scope: string) {
  const address = request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "local";
  const key = createHash("sha256").update(`${address}|${scope}`).digest("base64url");
  const now = Date.now();
  const recent = (publicAttempts.get(key) || []).filter((time) => now - time < publicWindowMs);
  if (recent.length >= 12) throw Object.assign(new Error("Too many callback requests. Please try again in a few minutes."), { status: 429 });
  publicAttempts.set(key, [...recent, now]);
  if (publicAttempts.size > 2_000) {
    for (const [attemptKey, times] of publicAttempts) {
      if (!times.some((time) => now - time < publicWindowMs)) publicAttempts.delete(attemptKey);
    }
  }
}

function clean(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function phoneKey(value: string) {
  return value.replace(/\D/g, "").slice(-15);
}

function emailKey(value: string) {
  return value.trim().toLowerCase();
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (!raw || raw.length > 5_000) return NextResponse.json({ error: "Invalid lead request." }, { status: 400 });
    const input = JSON.parse(raw) as {
      previewToken?: string;
      publicSlug?: string;
      callerName?: string;
      callerPhone?: string;
      callerEmail?: string;
      reason?: string;
      urgency?: Urgency;
      source?: Lead["source"];
    };
    const callerPhone = clean(input.callerPhone, 40);
    const callerEmail = emailKey(clean(input.callerEmail, 254));
    if (callerEmail && !validEmail(callerEmail)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    if (!callerPhone && !callerEmail) return NextResponse.json({ error: "A callback number or email address is required." }, { status: 400 });

    let lead: Lead | null = null;
    let contact: Contact | null = null;
    const actor = request.headers.get("x-everonn-workspace") ? await getCurrentActor() : null;
    if (!actor) enforcePublicRateLimit(request, input.publicSlug || input.previewToken || "unscoped");
    await updateWorkspaceJson((workspace) => {
      const project = workspace.websiteProject;
      const workspaceAllowed = Boolean(request.headers.get("x-everonn-workspace") === workspace.workspaceId && actor?.workspaceId === workspace.workspaceId && hasCapability(actor.role, "inbox:operate"));
      const previewAllowed = Boolean(input.previewToken && project?.privateToken === input.previewToken);
      const publicAllowed = Boolean(input.publicSlug && project?.publicSlug === input.publicSlug && project.status === "published");
      if (!workspaceAllowed && (!project || (!previewAllowed && !publicAllowed))) throw new Error("This website assistant is unavailable.");
      const now = new Date().toISOString();
      const callerName = clean(input.callerName, 120) || "Website visitor";
      const reason = clean(input.reason, 300) || "AI website assistant conversation";
      const urgency: Urgency = ["low", "normal", "high"].includes(String(input.urgency)) ? input.urgency! : "normal";
      const source: Lead["source"] = ["phone", "chat", "website"].includes(String(input.source)) ? input.source! : "chat";
      const normalizedPhone = phoneKey(callerPhone);
      const existingContact = (normalizedPhone
        ? workspace.contacts.find((item) => phoneKey(item.phone) === normalizedPhone)
        : undefined) || (callerEmail
        ? workspace.contacts.find((item) => emailKey(item.email) === callerEmail)
        : undefined);
      contact = {
        id: existingContact?.id || `contact_${crypto.randomUUID()}`,
        workspaceId: workspace.workspaceId,
        name: callerName === "Website visitor" ? existingContact?.name || callerName : callerName,
        phone: callerPhone || existingContact?.phone || "",
        email: callerEmail || existingContact?.email || "",
        company: existingContact?.company,
        lastContactAt: now,
      };
      const existingLead = workspace.leads.find((item) => item.status === "new" && (
        (normalizedPhone && phoneKey(item.callerPhone) === normalizedPhone)
        || (existingContact && item.contactId === existingContact.id)));
      lead = {
        id: existingLead?.id || `lead_${crypto.randomUUID()}`,
        workspaceId: workspace.workspaceId,
        contactId: contact.id,
        callerName: callerName === "Website visitor" ? existingLead?.callerName || callerName : callerName,
        callerPhone: callerPhone || existingLead?.callerPhone || existingContact?.phone || "",
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

    let appointment = null;
    let automationError = "";
    try {
      const result = await processLeadAutomation(lead!.id);
      lead = result.lead;
      appointment = result.appointment;
    } catch (error) {
      automationError = error instanceof Error ? error.message : "Automated follow-up could not run.";
    }

    return NextResponse.json({ saved: true, lead, contact, appointment, automationError: automationError || undefined }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message || "Unable to capture callback details." }, { status: details.status });
  }
}

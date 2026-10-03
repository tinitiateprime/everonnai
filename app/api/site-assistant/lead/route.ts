import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { Contact, Lead, Urgency } from "@/features/everonn/types";
import { processLeadAutomation } from "@/features/integrations/lead-automation";
import { findWorkspaceJson, readWorkspaceJson, updateWorkspaceJson } from "@/lib/json-workspace-store";
import { hasCapability } from "@/features/auth/rbac";
import { assertSameOrigin, authErrorDetails, getCurrentActor } from "@/features/auth/session";
import { captureWorkspaceLead } from "@/features/everonn/lead-capture";
import { validateAppointmentRequest } from "@/features/voice-agent/appointment-validation";

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
    if (!raw || raw.length > 30_000) return NextResponse.json({ error: "Invalid lead request." }, { status: 400 });
    const input = JSON.parse(raw) as {
      previewToken?: string;
      publicSlug?: string;
      callerName?: string;
      callerPhone?: string;
      callerEmail?: string;
      reason?: string;
      urgency?: Urgency;
      source?: Lead["source"];
      requestId?: string;
      finalize?: boolean;
      appointmentRequest?: unknown;
    };
    if (typeof input.reason === "string" && input.reason.length > 12000) return NextResponse.json({ error: "This conversation is too long to submit. Please start a new request with the service and preferred time." }, { status: 400 });
    const callerPhone = clean(input.callerPhone, 40);
    const callerEmail = emailKey(clean(input.callerEmail, 254));
    if (callerEmail && !validEmail(callerEmail)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    if (!callerPhone && !callerEmail) return NextResponse.json({ error: "A callback number or email address is required." }, { status: 400 });
    if (callerPhone && !/^\+?[\d ()-]+$/.test(callerPhone)) return NextResponse.json({ error: "Enter a valid callback number." }, { status: 400 });
    if (callerPhone && !/^\d{7,15}$/.test(callerPhone.replace(/\D/g, ""))) return NextResponse.json({ error: "Enter a callback number with 7 to 15 digits." }, { status: 400 });
    if (input.requestId !== undefined && (typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId))) return NextResponse.json({ error: "Invalid request identifier." }, { status: 400 });
    if (input.finalize !== undefined && typeof input.finalize !== "boolean") return NextResponse.json({ error: "Invalid request status." }, { status: 400 });

    let lead: Lead | null = null;
    let contact: Contact | null = null;
    const selectedWorkspace = request.headers.get("x-everonn-workspace");
    const actor = selectedWorkspace ? await getCurrentActor() : null;
    const workspaceAllowed = Boolean(selectedWorkspace && actor?.workspaceId === selectedWorkspace && hasCapability(actor.role, "inbox:operate"));
    const resolvedWorkspace = workspaceAllowed
      ? await readWorkspaceJson(selectedWorkspace!)
      : selectedWorkspace
        ? null
        : await findWorkspaceJson((candidate) => Boolean(
          (input.previewToken && candidate.websiteProject?.privateToken === input.previewToken)
          || (input.publicSlug && candidate.websiteProject?.publicSlug === input.publicSlug && candidate.websiteProject.status === "published")
        ));
    if (!resolvedWorkspace) return NextResponse.json({ error: "This website assistant is unavailable." }, { status: 404 });
    const workspaceId = resolvedWorkspace.workspaceId;
    let appointmentRequest: Lead["appointmentRequest"];
    try {
      if (input.appointmentRequest !== undefined) appointmentRequest = validateAppointmentRequest(input.appointmentRequest, resolvedWorkspace.profile);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
    if (!actor) enforcePublicRateLimit(request, input.publicSlug || input.previewToken || "unscoped");
    await updateWorkspaceJson((workspace) => {
      const project = workspace.websiteProject;
      const previewAllowed = Boolean(input.previewToken && project?.privateToken === input.previewToken);
      const publicAllowed = Boolean(input.publicSlug && project?.publicSlug === input.publicSlug && project.status === "published");
      if (!workspaceAllowed && (!project || (!previewAllowed && !publicAllowed))) throw new Error("This website assistant is unavailable.");
      const callerName = clean(input.callerName, 120) || "Website visitor";
      const reason = clean(input.reason, 12000);
      const urgency: Urgency = ["low", "normal", "high"].includes(String(input.urgency)) ? input.urgency! : "normal";
      const source: Lead["source"] = ["phone", "chat", "website"].includes(String(input.source)) ? input.source! : "chat";
      const captured = captureWorkspaceLead(workspace, { callerName, callerPhone, callerEmail, reason, urgency, source, requestId: input.requestId, finalize: input.finalize, appointmentRequest });
      lead = captured.lead;
      contact = captured.contact;
      return captured.workspace;
    }, workspaceId);

    let appointment = null;
    let automationError = "";
    try {
      if (input.finalize !== false) {
        const result = await processLeadAutomation(lead!.id, workspaceId);
        lead = result.lead;
        appointment = result.appointment;
      }
    } catch (error) {
      automationError = error instanceof Error ? error.message : "Automated follow-up could not run.";
    }

    return NextResponse.json({ saved: true, lead, contact, appointment, automationError: automationError || undefined }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid lead request." }, { status: 400 });
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message || "Unable to capture callback details." }, { status: details.status });
  }
}

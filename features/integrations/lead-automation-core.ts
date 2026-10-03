import { createHash, randomUUID } from "node:crypto";
import type { Appointment, BusinessProfile, EverOnnWorkspace, Lead } from "@/features/everonn/types";
import { localDateTimeToUtc } from "@/features/voice-agent/appointment-time";
import type { AppointmentIntent } from "@/features/voice-agent/appointment-validation";
import type { bookGoogleCalendarAppointment, checkGoogleCalendarAvailability, findGoogleCalendarAppointment, sendGmailNotification } from "./google";

type Automation = NonNullable<Lead["automation"]>;
type Dependencies = {
  read: (workspaceId: string) => Promise<EverOnnWorkspace>;
  update: (update: (current: EverOnnWorkspace) => EverOnnWorkspace, workspaceId: string) => Promise<EverOnnWorkspace>;
  getConnection: (workspaceId: string) => Promise<{ scope: string[] } | null>;
  getAccessToken: (workspaceId: string) => Promise<string>;
  extractIntent: (profile: BusinessProfile, reason: string, options: { now: Date }) => Promise<AppointmentIntent>;
  availability: typeof checkGoogleCalendarAvailability;
  book: typeof bookGoogleCalendarAppointment;
  findEvent: typeof findGoogleCalendarAppointment;
  sendEmail: typeof sendGmailNotification;
  followUpEnabled: boolean;
};

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const eventIdFor = (workspaceId: string, leadId: string) => createHash("sha256").update(`${workspaceId}|${leadId}`).digest("hex").slice(0, 52);

function result(workspace: EverOnnWorkspace, leadId: string) {
  const lead = workspace.leads.find((item) => item.id === leadId);
  if (!lead) throw new Error("The lead no longer exists in this workspace.");
  return { lead, appointment: workspace.appointments.find((item) => item.leadId === leadId) || null, emailSent: lead.automation?.gmailStatus === "sent" };
}

function notification(profile: BusinessProfile, lead: Lead, email: string, appointment: Appointment | null) {
  const status = lead.automation?.appointmentStatus;
  const appointmentLine = appointment
    ? `${appointment.status === "confirmed" ? "Confirmed" : "Requested"}: ${appointment.service}, ${appointment.date} at ${appointment.time} (${appointment.timeZone || profile.timeZone})`
    : status === "needs_details" ? "Service, exact date, or time needs clarification."
      : status === "failed" ? "Calendar could not complete the request; human follow-up required."
        : "No appointment requested.";
  return {
    subject: `${lead.urgency === "high" ? "Urgent " : ""}Service request from ${lead.callerName || "a customer"}`,
    text: [`Customer request for ${profile.businessName}`, "", `Customer: ${lead.callerName}`, `Phone: ${lead.callerPhone || "Not provided"}`, `Email: ${email || "Not provided"}`, `Source: ${lead.source}`, `Urgency: ${lead.urgency}`, `Request: ${lead.reason}`, `Appointment: ${appointmentLine}`, lead.automation?.message || "", "", "Open the EverOnn inbox to follow up."].join("\n"),
  };
}

export async function runLeadAutomation(leadId: string, workspaceId: string, deps: Dependencies) {
  const token = randomUUID();
  // The durable lease serializes availability + booking across server instances.
  const claimed = await deps.update((current) => {
    const lead = current.leads.find((item) => item.id === leadId);
    if (!lead) throw new Error("The lead no longer exists in this workspace.");
    if (lead.captureStatus === "collecting") return current;
    if (current.automationLock && Date.parse(current.automationLock.expiresAt) > Date.now()) return current;
    return { ...current, automationLock: { token, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() } };
  }, workspaceId);
  if (claimed.automationLock?.token !== token) {
    if (claimed.leads.find((item) => item.id === leadId)?.captureStatus === "collecting") return result(claimed, leadId);
    throw new Error("Another request is processing for this business. Your details are saved; retry shortly.");
  }
  const update = (mutate: (current: EverOnnWorkspace) => EverOnnWorkspace) => deps.update((current) => {
    if (current.automationLock?.token !== token) throw new Error("The request processing lease expired. Retry the saved request.");
    return mutate(current);
  }, workspaceId);
  try {
    const snapshot = await deps.read(workspaceId);
    const { lead } = result(snapshot, leadId);
    const contact = snapshot.contacts.find((item) => item.id === lead.contactId);
    const connection = await deps.getConnection(workspaceId);
    const calendarConnected = Boolean(connection?.scope.some((scope) => scope.includes("calendar")));
    const gmailConnected = Boolean(connection?.scope.includes("https://www.googleapis.com/auth/gmail.send"));
    let appointment = snapshot.appointments.find((item) => item.leadId === leadId) || null;
    let appointmentStatus: Automation["appointmentStatus"] = appointment?.status === "confirmed" ? "confirmed" : appointment?.status === "cancelled" ? "cancelled" : "not_requested";
    let message = "";
    let accessToken = "";

    if (appointment?.status === "confirmed") {
      if (appointment.requestDetails && appointment.requestDetails !== lead.reason) message = "Request details changed after booking. Review the existing Calendar event before changing it.";
    } else if (appointment?.status === "cancelled") {
      const selectedService = lead.appointmentRequest && snapshot.profile.services.find((item) => item.id === lead.appointmentRequest?.serviceId)?.name;
      const isNewRequest = Boolean(lead.appointmentRequest && (
        selectedService !== appointment.service
        || lead.appointmentRequest.date !== appointment.date
        || lead.appointmentRequest.time !== appointment.time
      ));
      if (isNewRequest) appointment = null;
      else message = "This appointment request was cancelled. Choose a new service, date, or time before booking it again.";
    }

    if (appointment?.status !== "confirmed" && appointment?.status !== "cancelled") {
      try {
        let intent: AppointmentIntent;
        if (lead.appointmentRequest) {
          const request = lead.appointmentRequest;
          const service = snapshot.profile.services.find((item) => item.active && item.id === request.serviceId);
          intent = { requested: true, service: service?.name || "", startsAtLocal: `${request.date}T${request.time}:00` };
        } else {
          intent = await deps.extractIntent(snapshot.profile, lead.reason, { now: new Date(lead.createdAt) });
        }
        if (intent.requested && (!intent.service || !intent.startsAtLocal)) {
          appointmentStatus = "needs_details";
          message = "Ask the customer for the approved service, preferred date, and exact time. No time has been allocated.";
        } else if (intent.requested) {
          const service = snapshot.profile.services.find((item) => item.active && item.name === intent.service);
          if (!service) throw new Error("The requested service is not an active business service.");
          const startsAt = localDateTimeToUtc(intent.startsAtLocal, snapshot.profile.timeZone);
          if (startsAt.getTime() <= Date.now() || startsAt.getTime() > Date.now() + 2 * 365 * 86400_000) throw new Error("Ask the customer for a future date and exact time within the next two years.");
          const duration = snapshot.profile.appointmentDurationMinutes;
          if (!Number.isInteger(duration) || duration < 5 || duration > 480) throw new Error("Configure an appointment duration between 5 and 480 minutes.");
          const endsAt = new Date(startsAt.getTime() + duration * 60_000);
          const base: Appointment = {
            id: appointment?.id || `appointment_${randomUUID()}`, workspaceId, leadId,
            contactName: lead.callerName, contactPhone: lead.callerPhone, contactEmail: contact?.email || "",
            service: service.name, date: intent.startsAtLocal.slice(0, 10), time: intent.startsAtLocal.slice(11, 16),
            timeZone: snapshot.profile.timeZone, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
            requestDetails: lead.reason, status: "requested", provider: calendarConnected ? "google" : "manual",
            createdAt: appointment?.createdAt || new Date().toISOString(),
          };
          const currentLead = (await deps.read(workspaceId)).leads.find((item) => item.id === leadId);
          if (currentLead?.reason !== lead.reason || JSON.stringify(currentLead?.appointmentRequest) !== JSON.stringify(lead.appointmentRequest)) throw new Error("Customer preferences changed while processing. Submit the latest request again.");
          appointment = base;
          if (!calendarConnected) {
            appointmentStatus = "failed";
            message = "Preferred service, date, and time saved. Google Calendar is disconnected; a human must confirm availability.";
          } else {
            accessToken = await deps.getAccessToken(workspaceId);
            const existingEvent = await deps.findEvent({ accessToken, calendarId: "primary", eventId: eventIdFor(workspaceId, leadId), startsAt: base.startsAt!, endsAt: base.endsAt! });
            const availability = existingEvent ? { available: true } : await deps.availability({ accessToken, calendarId: "primary", startsAt: base.startsAt!, endsAt: base.endsAt!, timeZone: base.timeZone! });
            if (!availability.available) {
              appointmentStatus = "unavailable";
              message = "The customer's preferred time is busy. Ask for another date and time; no alternative was allocated.";
            } else {
              const event = existingEvent || await deps.book({ accessToken, calendarId: "primary", eventId: eventIdFor(workspaceId, leadId), startsAt: base.startsAt!, endsAt: base.endsAt!, timeZone: base.timeZone!, businessName: snapshot.profile.businessName, service: base.service, customerName: lead.callerName, customerPhone: lead.callerPhone, customerEmail: contact?.email && validEmail(contact.email) ? contact.email : undefined, reason: lead.reason, sourceLeadId: leadId });
              if (!event?.id) throw new Error("Google Calendar did not return a confirmed event.");
              appointment = { ...base, status: "confirmed", googleEventId: event.id, googleEventUrl: event.htmlLink };
              appointmentStatus = "confirmed";
              message = "The customer's service request was confirmed in Google Calendar at their preferred time.";
            }
          }
        }
      } catch (error) {
        appointmentStatus = "failed";
        message = error instanceof Error ? error.message : "Calendar could not complete the request.";
      }
    }

    const saved = await update((current) => ({
      ...current,
      appointments: appointment ? [appointment, ...current.appointments.filter((item) => item.leadId !== leadId)] : current.appointments,
      leads: current.leads.map((item) => item.id === leadId ? {
        ...item,
        automation: { ...item.automation, appointmentStatus, appointmentId: appointment?.id, googleEventId: appointment?.googleEventId, gmailStatus: item.automation?.gmailStatus || "not_configured", message: message || undefined, processedAt: new Date().toISOString() },
      } : item),
    }));
    const gmail = result(saved, leadId).lead.automation!;
    // Gmail has no send idempotency key. A timeout can mean it was delivered.
    // A persisted attemptedAt/pending marker is never reclaimed automatically.
    if (deps.followUpEnabled && gmailConnected && validEmail(saved.profile.email) && !gmail.gmailAttemptedAt && !["sent", "pending", "delivery_unknown"].includes(gmail.gmailStatus)) {
      let sendStarted = false;
      try {
        if (!accessToken) accessToken = await deps.getAccessToken(workspaceId);
        const reserved = await update((current) => ({
          ...current,
          leads: current.leads.map((item) => item.id === leadId && !item.automation?.gmailAttemptedAt && !["sent", "pending", "delivery_unknown"].includes(item.automation?.gmailStatus || "") ? { ...item, automation: { ...item.automation!, gmailStatus: "pending", gmailAttemptedAt: new Date().toISOString() } } : item),
        }));
        const reservedLead = result(reserved, leadId).lead;
        if (reservedLead.automation?.gmailStatus !== "pending") return result(reserved, leadId);
        sendStarted = true;
        const email = notification(reserved.profile, reservedLead, contact?.email || "", appointment);
        const sent = await deps.sendEmail({ accessToken, from: reserved.profile.email, to: reserved.profile.email, ...email });
        if (!sent?.id) throw new Error("Gmail returned no delivery identifier.");
        await update((current) => ({ ...current, leads: current.leads.map((item) => item.id === leadId ? { ...item, automation: { ...item.automation!, gmailStatus: "sent", gmailMessageId: sent.id } } : item) }));
      } catch (error) {
        await update((current) => ({ ...current, leads: current.leads.map((item) => item.id === leadId ? { ...item, automation: { ...item.automation!, gmailStatus: sendStarted ? "delivery_unknown" : "failed", message: [item.automation?.message, sendStarted ? "Email delivery could not be verified. Check the connected Gmail Sent folder before any manual resend." : `Gmail: ${error instanceof Error ? error.message : "Unable to obtain email access."}`].filter(Boolean).join(" ") } } : item) }));
      }
    }
    return result(await deps.read(workspaceId), leadId);
  } finally {
    await deps.update((current) => current.automationLock?.token === token ? { ...current, automationLock: undefined } : current, workspaceId);
  }
}

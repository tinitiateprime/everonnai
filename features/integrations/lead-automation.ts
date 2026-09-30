import "server-only";
import { createHash } from "node:crypto";
import type { Appointment, Lead } from "@/features/everonn/types";
import { extractAppointmentIntent } from "@/features/voice-agent/appointment";
import { localDateTimeToUtc } from "@/features/voice-agent/appointment-time";
import { extractCallerDetails } from "@/features/voice-agent/engine";
import { bookGoogleCalendarAppointment, checkGoogleCalendarAvailability, sendGmailNotification } from "./google";
import { getValidGoogleAccessToken } from "./google-oauth";
import { readWorkspaceJson, updateWorkspaceJson } from "@/lib/json-workspace-store";
import { getGoogleConnection } from "@/lib/provider-credentials";

type AutomationResult = {
  lead: Lead;
  appointment: Appointment | null;
  emailSent: boolean;
};

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function displayTime(localDateTime: string) {
  const [, hour = "0", minute = "0"] = localDateTime.match(/T(\d{2}):(\d{2})/) || [];
  const date = new Date(Date.UTC(2000, 0, 1, Number(hour), Number(minute)));
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(date);
}

function eventIdFor(workspaceId: string, leadId: string) {
  return createHash("sha256").update(`${workspaceId}|${leadId}`).digest("hex").slice(0, 52);
}

function enabledFollowUpEmail() {
  return String(process.env.PHONE_FRONT_DESK_FOLLOW_UP_ENABLED || "true").trim().toLowerCase() !== "false";
}

function automationEmail(input: {
  businessName: string;
  lead: Lead;
  contactEmail: string;
  appointment: Appointment | null;
  appointmentStatus: NonNullable<Lead["automation"]>["appointmentStatus"];
}) {
  const appointmentLine = input.appointment
    ? `${input.appointment.status === "confirmed" ? "Confirmed" : "Requested"}: ${input.appointment.date} at ${input.appointment.time} (${input.appointment.service})`
    : input.appointmentStatus === "needs_details"
      ? "Requested, but a complete date and time were not provided."
      : input.appointmentStatus === "unavailable"
        ? "Requested time was unavailable; human follow-up is required."
        : input.appointmentStatus === "failed"
          ? "Could not be completed automatically; human follow-up is required."
          : "No appointment requested.";
  return {
    subject: `${input.lead.urgency === "high" ? "Urgent " : ""}EverOnn inquiry from ${input.lead.callerName || "a customer"}`,
    text: [
      `A new customer request was captured for ${input.businessName}.`,
      "",
      `Customer: ${input.lead.callerName || "Not provided"}`,
      `Phone: ${input.lead.callerPhone || "Not provided"}`,
      `Email: ${input.contactEmail || "Not provided"}`,
      `Source: ${input.lead.source}`,
      `Urgency: ${input.lead.urgency}`,
      `Request: ${input.lead.reason}`,
      `Appointment: ${appointmentLine}`,
      "",
      "Open the EverOnn inbox to follow up.",
    ].join("\n"),
  };
}

export async function processLeadAutomation(leadId: string): Promise<AutomationResult> {
  const snapshot = await readWorkspaceJson();
  const lead = snapshot.leads.find((item) => item.id === leadId);
  if (!lead) throw new Error("The lead no longer exists in this workspace.");
  const contact = snapshot.contacts.find((item) => item.id === lead.contactId);
  const parsedContact = extractCallerDetails([{ id: "automation", role: "caller", text: lead.reason, at: lead.createdAt }]);
  const genericName = /^(ai caller|website visitor|new customer)$/i.test(lead.callerName.trim());
  const effectiveLead: Lead = genericName && parsedContact.callerName ? { ...lead, callerName: parsedContact.callerName } : lead;
  const connection = await getGoogleConnection(snapshot.workspaceId);
  const calendarConnected = Boolean(connection?.scope.some((scope) => scope.includes("calendar")));
  const gmailConnected = Boolean(connection?.scope.includes("https://www.googleapis.com/auth/gmail.send"));
  const existingAppointment = snapshot.appointments.find((item) => item.leadId === lead.id) || null;
  let appointment = existingAppointment;
  let appointmentStatus: NonNullable<Lead["automation"]>["appointmentStatus"] = existingAppointment
    ? existingAppointment.status === "confirmed" ? "confirmed" : "unavailable"
    : "not_requested";
  let automationMessage = "";
  let accessToken = "";
  let emailClaimed = false;

  if (enabledFollowUpEmail() && gmailConnected && validEmail(snapshot.profile.email)) {
    const claimTime = new Date();
    await updateWorkspaceJson((current) => {
      emailClaimed = false;
      const currentLead = current.leads.find((item) => item.id === lead.id);
      if (!currentLead) throw new Error("The lead was removed while its follow-up was processing.");
      const pendingSince = Date.parse(currentLead.automation?.processedAt || "");
      const pendingIsFresh = currentLead.automation?.gmailStatus === "pending" && Number.isFinite(pendingSince) && claimTime.getTime() - pendingSince < 2 * 60_000;
      if (currentLead.automation?.gmailStatus === "sent" || pendingIsFresh) return current;
      emailClaimed = true;
      const reservedLead: Lead = {
        ...currentLead,
        automation: {
          appointmentStatus: currentLead.automation?.appointmentStatus || appointmentStatus,
          appointmentId: currentLead.automation?.appointmentId,
          googleEventId: currentLead.automation?.googleEventId,
          gmailStatus: "pending",
          gmailMessageId: currentLead.automation?.gmailMessageId,
          message: currentLead.automation?.message,
          processedAt: claimTime.toISOString(),
        },
      };
      return { ...current, leads: current.leads.map((item) => item.id === reservedLead.id ? reservedLead : item) };
    });
  }

  if (!existingAppointment) {
    try {
      const intent = await extractAppointmentIntent(snapshot.profile, lead.reason);
      if (intent.requested && !intent.startsAtLocal) {
        appointmentStatus = "needs_details";
        automationMessage = "The appointment request needs a complete date and time.";
      } else if (intent.requested) {
        if (!calendarConnected) throw new Error("Google Calendar is not connected with event access.");
        const startsAt = localDateTimeToUtc(intent.startsAtLocal, snapshot.profile.timeZone);
        const latestAllowed = Date.now() + 2 * 365 * 24 * 60 * 60_000;
        if (startsAt.getTime() < Date.now() - 60_000 || startsAt.getTime() > latestAllowed) {
          throw new Error("The requested appointment time is outside the supported booking window.");
        }
        const endsAt = new Date(startsAt.getTime() + snapshot.profile.appointmentDurationMinutes * 60_000);
        accessToken = await getValidGoogleAccessToken(snapshot.workspaceId);
        const availability = await checkGoogleCalendarAvailability({
          accessToken,
          calendarId: "primary",
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          timeZone: snapshot.profile.timeZone,
        });
        const baseAppointment: Appointment = {
          id: `appointment_${crypto.randomUUID()}`,
          workspaceId: snapshot.workspaceId,
          contactName: effectiveLead.callerName,
          contactPhone: effectiveLead.callerPhone,
          contactEmail: contact?.email || "",
          leadId: effectiveLead.id,
          service: intent.service || "Appointment request",
          date: intent.startsAtLocal.slice(0, 10),
          time: displayTime(intent.startsAtLocal),
          status: "requested",
          provider: "google",
          createdAt: new Date().toISOString(),
        };
        if (!availability.available) {
          appointment = baseAppointment;
          appointmentStatus = "unavailable";
          automationMessage = "The requested Google Calendar time is busy and needs human follow-up.";
        } else {
          const event = await bookGoogleCalendarAppointment({
            accessToken,
            calendarId: "primary",
            eventId: eventIdFor(snapshot.workspaceId, effectiveLead.id),
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            timeZone: snapshot.profile.timeZone,
            businessName: snapshot.profile.businessName,
            service: baseAppointment.service,
            customerName: effectiveLead.callerName,
            customerPhone: effectiveLead.callerPhone,
            customerEmail: contact?.email && validEmail(contact.email) ? contact.email : undefined,
            reason: effectiveLead.reason,
            sourceLeadId: effectiveLead.id,
          });
          appointment = { ...baseAppointment, status: "confirmed", googleEventId: event.id, googleEventUrl: event.htmlLink };
          appointmentStatus = "confirmed";
          automationMessage = "The appointment was confirmed in Google Calendar.";
        }
      }
    } catch (error) {
      appointmentStatus = "failed";
      automationMessage = error instanceof Error ? error.message : "The appointment could not be processed.";
    }
  }

  let gmailStatus: NonNullable<Lead["automation"]>["gmailStatus"] = emailClaimed ? "pending" : lead.automation?.gmailStatus || "not_configured";
  let gmailMessageId = lead.automation?.gmailMessageId;
  let emailSent = gmailStatus === "sent";
  if (emailClaimed) {
    try {
      if (!accessToken) accessToken = await getValidGoogleAccessToken(snapshot.workspaceId);
      const message = automationEmail({ businessName: snapshot.profile.businessName, lead: effectiveLead, contactEmail: contact?.email || "", appointment, appointmentStatus });
      const sent = await sendGmailNotification({
        accessToken,
        from: snapshot.profile.email,
        to: snapshot.profile.email,
        subject: message.subject,
        text: message.text,
      });
      gmailStatus = "sent";
      gmailMessageId = sent.id;
      emailSent = true;
    } catch (error) {
      gmailStatus = "failed";
      automationMessage = [automationMessage, error instanceof Error ? `Gmail: ${error.message}` : "Gmail notification failed."].filter(Boolean).join(" ");
    }
  }

  const processedAt = new Date().toISOString();
  const updated = await updateWorkspaceJson((current) => {
    const currentLead = current.leads.find((item) => item.id === lead.id);
    if (!currentLead) throw new Error("The lead was removed while its follow-up was processing.");
    const storedAppointment = current.appointments.find((item) => item.leadId === lead.id);
    const nextAppointment = storedAppointment || appointment;
    const finalGmailStatus = emailClaimed ? gmailStatus : currentLead.automation?.gmailStatus || gmailStatus;
    const finalGmailMessageId = emailClaimed ? gmailMessageId : currentLead.automation?.gmailMessageId || gmailMessageId;
    const nextLead: Lead = {
      ...currentLead,
      callerName: genericName && parsedContact.callerName ? parsedContact.callerName : currentLead.callerName,
      automation: {
        appointmentStatus: nextAppointment?.status === "confirmed" ? "confirmed" : appointmentStatus,
        appointmentId: nextAppointment?.id,
        googleEventId: nextAppointment?.googleEventId,
        gmailStatus: finalGmailStatus,
        gmailMessageId: finalGmailMessageId,
        message: automationMessage || undefined,
        processedAt,
      },
    };
    return {
      ...current,
      leads: current.leads.map((item) => item.id === nextLead.id ? nextLead : item),
      contacts: genericName && parsedContact.callerName && contact
        ? current.contacts.map((item) => item.id === contact.id ? { ...item, name: parsedContact.callerName } : item)
        : current.contacts,
      appointments: storedAppointment || !appointment ? current.appointments : [appointment, ...current.appointments],
    };
  });

  return {
    lead: updated.leads.find((item) => item.id === lead.id)!,
    appointment: updated.appointments.find((item) => item.leadId === lead.id) || null,
    emailSent,
  };
}

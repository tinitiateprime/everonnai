import { createHash, randomUUID } from "node:crypto";
import { localDateTimeToUtc } from "./appointment-time";
import {
  bookGoogleCalendarAppointment,
  checkGoogleCalendarAvailability,
  findGoogleCalendarAppointment,
  sendGmailNotification,
} from "./google";
import { googleAccessToken, googleConnection } from "./google-oauth";
import {
  readIntegration,
  withIntegration,
  type BookingRecord,
  type BookingSettings,
} from "./integrations-store";
import type { Knowledge } from "./types";

// Server side of the voice/chat agent's client tools (the shared ElevenLabs agent's
// check_availability, book_appointment, capture_lead, request_human_handoff and
// prepare_appointment). Agent-extracted values are never trusted to book: every field
// is validated here and only a created Google Calendar event confirms a booking.
export const BOOKING_TOOLS = [
  "prepare_appointment",
  "check_availability",
  "book_appointment",
  "capture_lead",
  "request_human_handoff",
] as const;
export type BookingTool = (typeof BOOKING_TOOLS)[number];
export type ToolResult = {
  saved: boolean;
  booked: boolean;
  available: boolean | null;
  message: string;
};
export const bookingDeps = {
  connection: googleConnection,
  accessToken: googleAccessToken,
  availability: checkGoogleCalendarAvailability,
  findEvent: findGoogleCalendarAppointment,
  book: bookGoogleCalendarAppointment,
  sendEmail: sendGmailNotification,
  now: () => new Date(),
};
type Deps = typeof bookingDeps;

const result = (partial: Partial<ToolResult> & { message: string }) => ({
  saved: false,
  booked: false,
  available: null,
  ...partial,
});
const text = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
function validPhone(value: string) {
  return (
    /^\+?[\d ().-]+$/.test(value) && /^\d{7,15}$/.test(value.replace(/\D/g, ""))
  );
}

/** What the live agent may promise for this business. */
export async function bookingStatus(slug: string, deps: Deps = bookingDeps) {
  const [record, connection] = await Promise.all([
    readIntegration(slug),
    deps.connection(slug).catch(() => null),
  ]);
  const calendar = Boolean(
    connection?.scope.some((scope) => scope.includes("calendar")),
  );
  const gmail = Boolean(
    connection?.scope.includes("https://www.googleapis.com/auth/gmail.send"),
  );
  return {
    settings: record.settings,
    googleConnected: Boolean(connection),
    connectedAt: connection?.connectedAt,
    gmailConnected: gmail,
    // Booking also needs a business time zone to interpret spoken times.
    calendarReady: calendar && Boolean(record.settings.timeZone),
    activity: record.activity.slice(0, 20),
  };
}

function matchService(knowledge: Knowledge, requested: string) {
  const wanted = requested.toLowerCase();
  const services = knowledge.services.filter((s) => s.name.trim());
  if (!services.length) return requested ? requested : "";
  return (
    services.find((s) => s.name.trim().toLowerCase() === wanted) ??
    services.find(
      (s) =>
        wanted.includes(s.name.trim().toLowerCase()) ||
        s.name.trim().toLowerCase().includes(wanted),
    )
  )?.name.trim();
}
function slot(
  args: Record<string, unknown>,
  settings: BookingSettings,
  knowledge: Knowledge,
  now: Date,
) {
  const date = text(args.date, 10);
  const time = text(args.time, 5);
  const service = matchService(knowledge, text(args.service, 200));
  if (!service)
    return {
      error: `Ask which service they want. Offered services: ${knowledge.services
        .map((s) => s.name)
        .filter(Boolean)
        .join(", ")}.`,
    };
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    return {
      error: `Ask for the exact date and time (YYYY-MM-DD and 24-hour HH:mm in ${settings.timeZone}). Nothing has been checked or booked.`,
    };
  let startsAt: Date;
  try {
    startsAt = localDateTimeToUtc(`${date}T${time}:00`, settings.timeZone);
  } catch (error) {
    return { error: `${(error as Error).message} Ask for another time.` };
  }
  if (
    startsAt.getTime() <= now.getTime() ||
    startsAt.getTime() > now.getTime() + 2 * 365 * 86_400_000
  )
    return {
      error:
        "Ask for a future date and time within the next two years. Nothing has been booked.",
    };
  const endsAt = new Date(
    startsAt.getTime() + settings.durationMinutes * 60_000,
  );
  return {
    service,
    date,
    time,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };
}
function notification(
  businessName: string,
  entry: BookingRecord,
  callerEmail = "",
) {
  const what =
    entry.kind === "appointment"
      ? `Appointment confirmed in Google Calendar: ${entry.service}, ${entry.date} at ${entry.time} (${entry.timeZone})`
      : entry.kind === "handoff"
        ? "The caller asked for a person to follow up."
        : "Callback request.";
  return {
    subject: `${entry.urgency === "high" ? "Urgent: " : ""}${
      entry.kind === "appointment" ? "New booking" : "Callback request"
    } from ${entry.callerName || "a website visitor"}`,
    text: [
      `Website assistant request for ${businessName}`,
      "",
      what,
      `Customer: ${entry.callerName || "Not provided"}`,
      `Phone: ${entry.callerPhone || "Not provided"}`,
      ...(callerEmail ? [`Email: ${callerEmail}`] : []),
      ...(entry.reason ? [`Reason: ${entry.reason}`] : []),
      ...(entry.googleEventUrl
        ? [`Calendar event: ${entry.googleEventUrl}`]
        : []),
    ].join("\n"),
  };
}
/** Owner notification address, when Gmail sending is connected for this business. */
async function emailTarget(
  slug: string,
  knowledge: Knowledge,
  settings: BookingSettings,
  deps: Deps,
) {
  const to = settings.notifyEmail || knowledge.email;
  const connection = await deps.connection(slug).catch(() => null);
  return validEmail(to) &&
    connection?.scope.includes("https://www.googleapis.com/auth/gmail.send")
    ? to
    : "";
}
async function notify(
  to: string,
  accessToken: string,
  knowledge: Knowledge,
  entry: BookingRecord,
  deps: Deps,
): Promise<BookingRecord["email"]> {
  if (!to || !accessToken) return "not_configured";
  try {
    const sent = await deps.sendEmail({
      accessToken,
      to,
      ...notification(knowledge.businessName, entry),
    });
    return sent?.id ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export async function runBookingTool(
  slug: string,
  knowledge: Knowledge,
  tool: BookingTool,
  args: Record<string, unknown>,
  deps: Deps = bookingDeps,
): Promise<ToolResult> {
  if (tool === "prepare_appointment")
    return result({
      message:
        "Nothing is booked yet. Confirm the service, then the exact date and time, and call check_availability.",
    });
  if (tool === "capture_lead" || tool === "request_human_handoff") {
    const callerPhone = text(args.caller_phone ?? args.phone, 40);
    if (!validPhone(callerPhone))
      return result({
        message:
          "Ask for a callback number (7 to 15 digits). Nothing has been saved yet.",
      });
    const settings = (await readIntegration(slug)).settings;
    const sendTo = await emailTarget(slug, knowledge, settings, deps);
    const accessToken = sendTo
      ? await deps.accessToken(slug).catch(() => "")
      : "";
    return withIntegration(slug, async (record, save) => {
      const entry: BookingRecord = {
        id: randomUUID(),
        kind: tool === "request_human_handoff" ? "handoff" : "callback",
        createdAt: deps.now().toISOString(),
        callerName: text(args.caller_name ?? args.name, 120),
        callerPhone,
        reason: text(args.reason, 2000),
        urgency: ["low", "normal", "high"].includes(text(args.urgency, 10))
          ? text(args.urgency, 10)
          : "normal",
        status: "saved",
        email: "not_configured",
      };
      entry.email = await notify(sendTo, accessToken, knowledge, entry, deps);
      await save({
        ...record,
        activity: [entry, ...record.activity].slice(0, 200),
      });
      return result({
        saved: true,
        message:
          entry.email === "sent"
            ? "Saved and emailed to the team. Tell the caller the team will call them back; do not promise a time."
            : "Saved for the team. Tell the caller the team will call them back; do not promise a time.",
      });
    });
  }

  const status = await bookingStatus(slug, deps);
  if (!status.calendarReady)
    return result({
      message:
        "Online booking is not connected for this business. Nothing was checked or booked. Offer to take their name and callback number with capture_lead so the team can arrange the appointment.",
    });
  const settings = status.settings;
  const requested = slot(args, settings, knowledge, deps.now());
  if ("error" in requested) return result({ message: requested.error! });
  const calendarId = "primary";

  if (tool === "check_availability") {
    const { available } = await deps.availability({
      accessToken: await deps.accessToken(slug),
      calendarId,
      startsAt: requested.startsAt,
      endsAt: requested.endsAt,
      timeZone: settings.timeZone,
    });
    return result({
      available,
      message: available
        ? `${requested.date} at ${requested.time} (${settings.timeZone}) is free for ${requested.service}. Nothing is booked yet: confirm the details, get the caller's name and callback number and explicit agreement, then call book_appointment.`
        : `${requested.date} at ${requested.time} is not available. Ask for another date or time; do not suggest one yourself.`,
    });
  }

  // book_appointment
  const callerName = text(args.caller_name, 120);
  const callerPhone = text(args.caller_phone, 40);
  if (args.caller_confirmed !== true)
    return result({
      message:
        "Read back the service, date, time and time zone and ask the caller to explicitly agree. Nothing has been booked.",
    });
  if (!callerName || !validPhone(callerPhone))
    return result({
      message:
        "Ask for the caller's full name and a callback number (7 to 15 digits). Nothing has been booked.",
    });
  // Same caller + slot always maps to one event, so retried tool calls cannot double-book.
  const eventId = createHash("sha256")
    .update(`${slug}|${requested.startsAt}|${callerPhone.replace(/\D/g, "")}`)
    .digest("hex")
    .slice(0, 52);
  // Fetched before taking the lock: a token refresh saves under the same lock.
  const accessToken = await deps.accessToken(slug);
  const sendTo = await emailTarget(slug, knowledge, settings, deps);
  return withIntegration(slug, async (record, save) => {
    const existing = await deps.findEvent({
      accessToken,
      calendarId,
      eventId,
      startsAt: requested.startsAt,
      endsAt: requested.endsAt,
    });
    if (!existing) {
      const { available } = await deps.availability({
        accessToken,
        calendarId,
        startsAt: requested.startsAt,
        endsAt: requested.endsAt,
        timeZone: settings.timeZone,
      });
      if (!available)
        return result({
          available: false,
          message: `${requested.date} at ${requested.time} was just taken. Nothing was booked. Ask for another date or time.`,
        });
    }
    const event =
      existing ??
      (await deps.book({
        accessToken,
        calendarId,
        eventId,
        startsAt: requested.startsAt,
        endsAt: requested.endsAt,
        timeZone: settings.timeZone,
        businessName: knowledge.businessName,
        service: requested.service,
        customerName: callerName,
        customerPhone: callerPhone,
        reason: text(args.notes ?? args.reason, 2000) || requested.service,
        sourceLeadId: eventId,
        location: knowledge.location || undefined,
      }));
    if (!event?.id)
      return result({
        message:
          "The calendar did not confirm the booking. Nothing is confirmed; offer to take a callback request instead.",
      });
    const entry: BookingRecord = {
      id: randomUUID(),
      kind: "appointment",
      createdAt: deps.now().toISOString(),
      callerName,
      callerPhone,
      service: requested.service,
      date: requested.date,
      time: requested.time,
      timeZone: settings.timeZone,
      status: "confirmed",
      googleEventId: event.id,
      googleEventUrl: event.htmlLink,
      email: "not_configured",
    };
    if (!existing)
      entry.email = await notify(sendTo, accessToken, knowledge, entry, deps);
    await save({
      ...record,
      activity: existing
        ? record.activity
        : [entry, ...record.activity].slice(0, 200),
    });
    return result({
      booked: true,
      saved: true,
      available: true,
      message: `booked=true. Confirmed: ${requested.service} on ${requested.date} at ${requested.time} (${settings.timeZone}) for ${callerName}.`,
    });
  });
}

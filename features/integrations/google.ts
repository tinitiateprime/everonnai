const calendarApi = "https://www.googleapis.com/calendar/v3";
const gmailApi = "https://gmail.googleapis.com/gmail/v1";

export class GoogleRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function googleRequest<T>(url: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as T | { error?: { message?: string } } | null;
  if (!response.ok) throw new GoogleRequestError((payload as { error?: { message?: string } } | null)?.error?.message || `Google returned HTTP ${response.status}.`, response.status);
  return payload as T;
}

export async function checkGoogleCalendarAvailability(input: { accessToken: string; calendarId: string; startsAt: string; endsAt: string; timeZone: string }) {
  const payload = await googleRequest<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: Array<{ reason?: string }> }> }>(`${calendarApi}/freeBusy`, input.accessToken, {
    method: "POST",
    body: JSON.stringify({ timeMin: input.startsAt, timeMax: input.endsAt, timeZone: input.timeZone, items: [{ id: input.calendarId }] }),
  });
  const calendar = payload?.calendars?.[input.calendarId];
  if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) throw new Error("Google Calendar could not verify availability. Please try again or request human follow-up.");
  const busy = calendar.busy;
  return { available: busy.length === 0, busy };
}

export async function findGoogleCalendarAppointment(input: { accessToken: string; calendarId: string; eventId: string; startsAt: string; endsAt: string }) {
  try {
    const event = await googleRequest<{ id: string; htmlLink?: string; status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }>(`${calendarApi}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`, input.accessToken);
    if (event.status === "cancelled") throw new Error("The existing Google Calendar event was cancelled. A human must review this request.");
    if (!event.id || Date.parse(event.start?.dateTime || "") !== Date.parse(input.startsAt) || Date.parse(event.end?.dateTime || "") !== Date.parse(input.endsAt)) throw new Error("This request already has a Google Calendar event with different details. Review the existing event before changing it.");
    return event;
  } catch (error) {
    if (error instanceof GoogleRequestError && error.status === 404) return null;
    throw error;
  }
}

export async function bookGoogleCalendarAppointment(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  businessName: string;
  service: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  reason: string;
  sourceLeadId: string;
  location?: string;
}) {
  const eventUrl = `${calendarApi}/calendars/${encodeURIComponent(input.calendarId)}/events`;
  try {
    return await googleRequest<{ id: string; htmlLink?: string }>(`${eventUrl}${input.customerEmail ? "?sendUpdates=all" : ""}`, input.accessToken, {
      method: "POST",
      body: JSON.stringify({
        id: input.eventId,
        summary: `${input.service} · ${input.customerName || "Customer"}`,
        description: [
          `EverOnn appointment for ${input.businessName}`,
          `Customer: ${input.customerName || "Not provided"}`,
          `Phone: ${input.customerPhone || "Not provided"}`,
          `Email: ${input.customerEmail || "Not provided"}`,
          `Request: ${input.reason}`,
        ].join("\n"),
        start: { dateTime: input.startsAt, timeZone: input.timeZone },
        end: { dateTime: input.endsAt, timeZone: input.timeZone },
        attendees: input.customerEmail ? [{ email: input.customerEmail }] : undefined,
        location: input.location || undefined,
        extendedProperties: { private: { source: "everonn", leadId: input.sourceLeadId } },
      }),
    });
  } catch (error) {
    if (!(error instanceof GoogleRequestError) || error.status !== 409) throw error;
    const existing = await findGoogleCalendarAppointment(input);
    if (!existing) throw new Error("Google Calendar reported an existing event but it could not be verified.");
    return existing;
  }
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function buildGmailRaw(input: { from: string; to: string; subject: string; text: string }) {
  const header = (value: string) => value.replace(/[\r\n]/g, " ").trim();
  const subject = header(input.subject);
  const encodedSubject = /[^\x20-\x7e]/.test(subject) ? `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=` : subject;
  return base64Url([`From: ${header(input.from)}`, `To: ${header(input.to)}`, `Subject: ${encodedSubject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(input.text, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || ""].join("\r\n"));
}

export async function sendGmailNotification(input: { accessToken: string; from: string; to: string; subject: string; text: string }) {
  return googleRequest<{ id: string; threadId: string }>(`${gmailApi}/users/me/messages/send`, input.accessToken, {
    method: "POST",
    body: JSON.stringify({ raw: buildGmailRaw(input) }),
  });
}

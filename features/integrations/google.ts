const calendarApi = "https://www.googleapis.com/calendar/v3";
const gmailApi = "https://gmail.googleapis.com/gmail/v1";

class GoogleRequestError extends Error {
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
  const payload = await googleRequest<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }>(`${calendarApi}/freeBusy`, input.accessToken, {
    method: "POST",
    body: JSON.stringify({ timeMin: input.startsAt, timeMax: input.endsAt, timeZone: input.timeZone, items: [{ id: input.calendarId }] }),
  });
  const busy = payload.calendars?.[input.calendarId]?.busy || [];
  return { available: busy.length === 0, busy };
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
        extendedProperties: { private: { source: "everonn", leadId: input.sourceLeadId } },
      }),
    });
  } catch (error) {
    if (!(error instanceof GoogleRequestError) || error.status !== 409) throw error;
    return googleRequest<{ id: string; htmlLink?: string }>(`${eventUrl}/${encodeURIComponent(input.eventId)}`, input.accessToken);
  }
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function buildGmailRaw(input: { from: string; to: string; subject: string; text: string }) {
  return base64Url([`From: ${input.from}`, `To: ${input.to}`, `Subject: ${input.subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", input.text].join("\r\n"));
}

export async function sendGmailNotification(input: { accessToken: string; from: string; to: string; subject: string; text: string }) {
  return googleRequest<{ id: string; threadId: string }>(`${gmailApi}/users/me/messages/send`, input.accessToken, {
    method: "POST",
    body: JSON.stringify({ raw: buildGmailRaw(input) }),
  });
}

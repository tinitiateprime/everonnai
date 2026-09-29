const calendarApi = "https://www.googleapis.com/calendar/v3";
const gmailApi = "https://gmail.googleapis.com/gmail/v1";

async function googleRequest<T>(url: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as T | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error((payload as { error?: { message?: string } } | null)?.error?.message || `Google returned HTTP ${response.status}.`);
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

export async function bookGoogleCalendarAppointment(input: { accessToken: string; calendarId: string; startsAt: string; endsAt: string; timeZone: string; businessName: string; service: string; customerName: string; customerPhone: string }) {
  return googleRequest<{ id: string; htmlLink?: string }>(`${calendarApi}/calendars/${encodeURIComponent(input.calendarId)}/events`, input.accessToken, {
    method: "POST",
    body: JSON.stringify({
      summary: `${input.service} · ${input.customerName || "Customer"}`,
      description: `EverOnn request for ${input.businessName}\nCustomer: ${input.customerName}\nCallback: ${input.customerPhone}`,
      start: { dateTime: input.startsAt, timeZone: input.timeZone },
      end: { dateTime: input.endsAt, timeZone: input.timeZone },
      extendedProperties: { private: { source: "everonn" } },
    }),
  });
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

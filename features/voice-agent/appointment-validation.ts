import type { BusinessProfile } from "@/features/everonn/types";
import { localDateTimeToUtc } from "./appointment-time";

export type AppointmentIntent = { requested: boolean; service: string; startsAtLocal: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function businessLocalDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}

function evidenceDate(source: string, now: Date, timeZone: string): string {
  const explicit = source.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (explicit) return explicit;
  const today = businessLocalDate(now, timeZone);
  const date = new Date(`${today}T12:00:00Z`);
  if (/\b(day after tomorrow|tomorrow|today)\b/i.test(source)) {
    date.setUTCDate(date.getUTCDate() + (/day after tomorrow/i.test(source) ? 2 : /tomorrow/i.test(source) ? 1 : 0));
    return date.toISOString().slice(0, 10);
  }
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const weekday = source.toLowerCase().match(/\b(?:(next|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekday) {
    const difference = (weekdays.indexOf(weekday[2]) - date.getUTCDay() + 7) % 7;
    // "Next Friday" has multiple common meanings. Ask for the exact date.
    if (weekday[1] === "next") return "";
    date.setUTCDate(date.getUTCDate() + difference);
    return date.toISOString().slice(0, 10);
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const named = source.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i)
    || source.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:,?\s+(\d{4}))?\b/i)?.map((value, index, match) => index === 1 ? match[2] : index === 2 ? match[1] : value);
  if (!named) return "";
  const month = months.indexOf(named[1].toLowerCase().slice(0, 3));
  if (month < 0) return "";
  let year = Number(named[3] || today.slice(0, 4));
  let candidate = `${year}-${String(month + 1).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
  if (!named[3] && candidate < today) {
    year += 1;
    candidate = `${year}${candidate.slice(4)}`;
  }
  return candidate;
}

function evidenceTime(source: string) {
  if (/\bnoon\b/i.test(source)) return "12:00";
  if (/\bmidnight\b/i.test(source)) return "00:00";
  const clock = source.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2] || 0);
    if (hour < 1 || hour > 12 || minute > 59) return "";
    return `${String(hour % 12 + (/^p/i.test(clock[3]) ? 12 : 0)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const twentyFour = source.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return twentyFour ? `${twentyFour[1].padStart(2, "0")}:${twentyFour[2]}` : "";
}

export function bookingClarification(profile: BusinessProfile, customerText: string, now = new Date()) {
  if (!/\b(book|booking|schedule|appointment|reserve)\b/i.test(customerText) || /\b(?:don't|do not|not interested in|cancel)\s+(?:want to\s+)?(?:book|booking|schedule|appointment)\b/i.test(customerText)) return "";
  const active = profile.services.filter((item) => item.active);
  const serviceMentioned = active.some((service) => service.name.toLowerCase().split(/\W+/).some((word) => word.length > 3 && !["service", "services", "appointment"].includes(word) && new RegExp(`\\b${word}\\b`, "i").test(customerText)));
  if (!serviceMentioned) return active.length ? `Which service would you like to book: ${active.map((service) => service.name).join(", ")}?` : "Please describe the service you need. The team will follow up to confirm whether it is available.";
  if (!evidenceDate(customerText, now, profile.timeZone)) return `What exact date would you prefer for the appointment? We use ${profile.timeZone}.`;
  if (!evidenceTime(customerText)) return `What exact time would you prefer on that date? Please include AM or PM, or use a 24-hour time. We use ${profile.timeZone}.`;
  return "";
}

// An LLM's normalized timestamp alone is never sufficient authority to book.
export function validateExtractedIntent(value: Record<string, unknown>, profile: BusinessProfile, customerText: string, now: Date): AppointmentIntent {
  const requested = value.appointmentRequested === true;
  const evidence = (key: string) => {
    const quote = clean(value[key]);
    return quote && clean(customerText).toLowerCase().includes(quote.toLowerCase()) ? quote : "";
  };
  const service = profile.services.find((item) => item.active && item.name.toLowerCase() === clean(value.service).toLowerCase());
  const serviceQuote = evidence("serviceEvidence");
  const significantWords = service?.name.toLowerCase().match(/[a-z]{3,}/g)?.filter((word) => !["and", "the", "service", "services", "appointment"].includes(word)) || [];
  const groundedService = service && serviceQuote && significantWords.some((word) => serviceQuote.toLowerCase().includes(word)) ? service.name : "";
  const local = clean(value.startsAtLocal);
  const date = evidenceDate(evidence("dateEvidence"), now, profile.timeZone);
  const time = evidenceTime(evidence("timeEvidence"));
  const matches = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00)?$/.test(local) && date && time && local.slice(0, 10) === date && local.slice(11, 16) === time;
  return { requested, service: groundedService, startsAtLocal: matches ? `${date}T${time}:00` : "" };
}

export function validateAppointmentRequest(value: unknown, profile: BusinessProfile) {
  if (!value || typeof value !== "object") throw new Error("Choose a service, preferred date, and preferred time.");
  const request = value as Record<string, unknown>;
  const service = profile.services.find((item) => item.active && item.id === request.serviceId);
  if (!service) throw new Error("Choose one of the business's active services.");
  const date = clean(request.date);
  const time = clean(request.time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("Choose both a preferred date and time.");
  const startsAt = localDateTimeToUtc(`${date}T${time}:00`, profile.timeZone);
  if (startsAt.getTime() <= Date.now() || startsAt.getTime() > Date.now() + 2 * 365 * 86400_000) throw new Error("Choose a future date and time within the next two years.");
  return { serviceId: service.id, date, time };
}

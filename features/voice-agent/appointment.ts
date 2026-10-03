import "server-only";
import type { BusinessProfile } from "@/features/everonn/types";
import { getGeminiWebsiteConfig } from "@/lib/provider-config";
import { parseEmbeddedJsonObject } from "./appointment-time";
import { validateExtractedIntent, type AppointmentIntent } from "./appointment-validation";
import { meteredGeminiRequest } from "@/features/usage/gemini";
import type { UsageContext } from "@/features/usage/types";

export { localDateTimeToUtc } from "./appointment-time";

export type { AppointmentIntent } from "./appointment-validation";

type GeminiConfig = ReturnType<typeof getGeminiWebsiteConfig>;

const responseSchema = {
  type: "OBJECT",
  required: ["appointmentRequested", "service", "startsAtLocal", "serviceEvidence", "dateEvidence", "timeEvidence"],
  properties: {
    appointmentRequested: { type: "BOOLEAN" },
    service: { type: "STRING" },
    startsAtLocal: { type: "STRING" },
    serviceEvidence: { type: "STRING" },
    dateEvidence: { type: "STRING" },
    timeEvidence: { type: "STRING" },
  },
};

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function extractJson(payload: unknown) {
  const response = payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const source = response.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!source) throw new Error("Gemini returned no appointment details.");
  return parseEmbeddedJsonObject(source);
}

export async function extractAppointmentIntent(
  profile: BusinessProfile,
  reason: string,
  options: { now?: Date; config?: GeminiConfig; fetchImpl?: typeof fetch; usage?: UsageContext } = {},
): Promise<AppointmentIntent> {
  if (!/\b(book|booking|schedule|appointment|reserve|visit|come|available)\b/i.test(reason)) return { requested: false, service: "", startsAtLocal: "" };
  const config = options.config || getGeminiWebsiteConfig();
  if (!config.apiKey) throw new Error("Gemini is required to understand appointment requests.");
  const now = options.now || new Date();
  const prompt = `Extract an appointment request from this customer message.

CURRENT UTC TIME: ${now.toISOString()}
BUSINESS TIME ZONE: ${profile.timeZone}
APPOINTMENT DURATION: ${profile.appointmentDurationMinutes} minutes
APPROVED SERVICES: ${profile.services.filter((service) => service.active).map((service) => service.name).join(", ")}
CUSTOMER MESSAGE (customer turns only, in order): ${clean(reason, 12000)}

Rules:
- appointmentRequested is true only when the customer explicitly asks to schedule, book, or request an appointment.
- Resolve relative dates using the current time and business time zone.
- startsAtLocal must be YYYY-MM-DDTHH:mm:ss in the business time zone, with no UTC suffix or offset.
- If either the date or time is missing or ambiguous, return an empty startsAtLocal. Never guess.
- Match service to exactly one approved service. If unclear or unsupported, return an empty service.
- serviceEvidence, dateEvidence, and timeEvidence must each quote the customer's exact words. Empty evidence means missing information. Never use assistant suggestions as customer preferences.
- Use the most recent explicit preference when the customer corrects a date or time. A bare number, morning, afternoon, ASAP, or next week is not an exact time/date.
- Return only the JSON object.`;

  let lastError = "Gemini could not understand the appointment request.";
  for (const [index, model] of config.models.slice(0, 2).entries()) {
    try {
      const { response, payload } = await meteredGeminiRequest(model, config.apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(Math.min(config.timeoutMs, 25_000)),
        cache: "no-store",
      }, { fetchImpl: options.fetchImpl, usage: options.usage });
      if (!response.ok) {
        const message = (payload as { error?: { message?: string } } | null)?.error?.message;
        throw new Error(message || `Gemini returned HTTP ${response.status}.`);
      }
      return validateExtractedIntent(extractJson(payload), profile, reason, now);
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (index === 0 && config.models.length > 1 && config.retryDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(config.retryDelayMs, 1_000)));
      }
    }
  }
  throw new Error(lastError);
}

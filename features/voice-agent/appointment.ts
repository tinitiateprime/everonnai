import "server-only";
import type { BusinessProfile } from "@/features/everonn/types";
import { getGeminiWebsiteConfig } from "@/lib/provider-config";
import { parseEmbeddedJsonObject } from "./appointment-time";

export { localDateTimeToUtc } from "./appointment-time";

export type AppointmentIntent = {
  requested: boolean;
  service: string;
  startsAtLocal: string;
};

type GeminiConfig = ReturnType<typeof getGeminiWebsiteConfig>;

const responseSchema = {
  type: "OBJECT",
  required: ["appointmentRequested", "service", "startsAtLocal"],
  properties: {
    appointmentRequested: { type: "BOOLEAN" },
    service: { type: "STRING" },
    startsAtLocal: { type: "STRING" },
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

function normalizeIntent(value: Record<string, unknown>): AppointmentIntent {
  const startsAtLocal = clean(value.startsAtLocal, 40);
  return {
    requested: value.appointmentRequested === true,
    service: clean(value.service, 160),
    startsAtLocal: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(startsAtLocal) ? startsAtLocal : "",
  };
}

export async function extractAppointmentIntent(
  profile: BusinessProfile,
  reason: string,
  options: { now?: Date; config?: GeminiConfig; fetchImpl?: typeof fetch } = {},
): Promise<AppointmentIntent> {
  const config = options.config || getGeminiWebsiteConfig();
  if (!config.apiKey) throw new Error("Gemini is required to understand appointment requests.");
  const now = options.now || new Date();
  const prompt = `Extract an appointment request from this customer message.

CURRENT UTC TIME: ${now.toISOString()}
BUSINESS TIME ZONE: ${profile.timeZone}
APPOINTMENT DURATION: ${profile.appointmentDurationMinutes} minutes
APPROVED SERVICES: ${profile.services.filter((service) => service.active).map((service) => service.name).join(", ")}
CUSTOMER MESSAGE: ${clean(reason, 1200)}

Rules:
- appointmentRequested is true only when the customer explicitly asks to schedule, book, or request an appointment.
- Resolve relative dates using the current time and business time zone.
- startsAtLocal must be YYYY-MM-DDTHH:mm:ss in the business time zone, with no UTC suffix or offset.
- If either the date or time is missing or ambiguous, return an empty startsAtLocal. Never guess.
- Match service to an approved service when possible; otherwise preserve a short customer-provided service name.
- Return only the JSON object.`;

  let lastError = "Gemini could not understand the appointment request.";
  for (const [index, model] of config.models.slice(0, 2).entries()) {
    try {
      const response = await (options.fetchImpl || fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(Math.min(config.timeoutMs, 25_000)),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = (payload as { error?: { message?: string } } | null)?.error?.message;
        throw new Error(message || `Gemini returned HTTP ${response.status}.`);
      }
      return normalizeIntent(extractJson(payload));
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (index === 0 && config.models.length > 1 && config.retryDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(config.retryDelayMs, 1_000)));
      }
    }
  }
  throw new Error(lastError);
}

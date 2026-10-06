import "server-only";
import type { BusinessProfile } from "@/features/everonn/types";
import { getGeminiWebsiteConfig } from "@/lib/provider-config";
import { parseEmbeddedJsonObject } from "./appointment-time";
import { validateExtractedIntent, type AppointmentIntent } from "./appointment-validation";
import { meteredGeminiRequest } from "@/features/usage/gemini";
import type { UsageContext } from "@/features/usage/types";
import { composeAgentContext } from "@/features/agent-runtime/prompt-composer";

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
  const prompt = composeAgentContext({ profile, capabilities: ["appointment-booking"], now });

  let lastError = "Gemini could not understand the appointment request.";
  for (const [index, model] of config.models.slice(0, 2).entries()) {
    try {
      const { response, payload } = await meteredGeminiRequest(model, config.apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: `${prompt.context}\n\nExtract appointment intent from these customer turns, in order:\n${clean(reason, 12000)}` }] }],
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

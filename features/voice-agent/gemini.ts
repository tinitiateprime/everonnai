import "server-only";
import type { BusinessProfile } from "@/features/everonn/types";
import { getGeminiWebsiteConfig } from "@/lib/provider-config";
import { buildReceptionistPrompt } from "./engine";
import { bookingClarification } from "./appointment-validation";
import { meteredGeminiRequest } from "@/features/usage/gemini";
import type { UsageContext } from "@/features/usage/types";

export type AiConversationMessage = { role: "assistant" | "caller"; text: string };

function clean(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function extractReply(payload: unknown) {
  const response = payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const reply = response.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!reply) throw new Error("Gemini returned an empty assistant response.");
  return reply.slice(0, 1800);
}

export async function generateAssistantReply(profile: BusinessProfile, input: AiConversationMessage[], usage: UsageContext) {
  const customerText = input.filter((item) => item.role === "caller").map((item) => clean(item.text, 1200)).join("\n");
  const clarification = bookingClarification(profile, customerText);
  if (clarification) return { reply: clarification, model: "request clarification" };
  const config = getGeminiWebsiteConfig();
  if (!config.apiKey) throw new Error("Gemini chat is not configured.");
  const messages = input
    .map((message) => ({ role: message.role, text: clean(message.text, 1200) }))
    .filter((message) => message.text)
    .slice(-16);
  while (messages[0]?.role === "assistant") messages.shift();
  if (!messages.length) throw new Error("A customer message is required.");

  let lastError = "Gemini chat was unavailable.";
  for (const [index, model] of config.models.entries()) {
    try {
      const { response, payload } = await meteredGeminiRequest(model, config.apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `${buildReceptionistPrompt(profile)}\nAnswer as a website chat assistant. Never say that a booking, price, transfer, or availability is confirmed unless a connected tool explicitly confirms it.` }] },
          contents: messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.text }] })),
          generationConfig: { temperature: 0.35, maxOutputTokens: 600 },
        }),
        signal: AbortSignal.timeout(Math.min(config.timeoutMs, 45_000)),
        cache: "no-store",
      }, { usage });
      if (!response.ok) {
        const providerMessage = (payload as { error?: { message?: string } } | null)?.error?.message;
        throw new Error(providerMessage || `Gemini returned HTTP ${response.status}.`);
      }
      return { reply: extractReply(payload), model };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (index < config.models.length - 1 && config.retryDelayMs) await new Promise((resolve) => setTimeout(resolve, config.retryDelayMs));
    }
  }
  throw new Error(`Gemini chat could not respond. ${lastError}`);
}

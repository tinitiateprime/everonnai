import type { Model } from "./types";
import { ProviderError } from "./openrouter";

// Direct Gemini API provider for website planning/generation (WEBSITE_PROVIDER=gemini).
// Each version starts on its own model, so free-tier per-model request quotas do not collide.
export const DEFAULT_GEMINI_WEBSITE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
];

export function geminiWebsiteModels(
  configured = process.env.GEMINI_WEBSITE_MODELS,
): Model[] {
  const ids = (configured ?? "")
    .split(",")
    .map((id) => id.trim().replace(/^models\//, ""))
    .filter((id) => /^[a-zA-Z0-9._-]+$/.test(id));
  return [...new Set(ids.length ? ids : DEFAULT_GEMINI_WEBSITE_MODELS)].map(
    (id) => ({
      id,
      name: `Gemini ${id.replace(/^gemini-/, "")}`,
      context_length: 1_000_000,
      description: "Gemini API (direct)",
      supported_parameters: ["temperature", "response_format"],
      top_provider: { max_completion_tokens: 65536 },
      pricing: { prompt: "", completion: "" },
    }),
  );
}

function thinkingConfig(id: string) {
  // Gemini 2.5 takes a token budget; Gemini 3+ and the -latest aliases take a level.
  return /gemini-2\.5/.test(id)
    ? { thinkingBudget: 2048 }
    : { thinkingLevel: "low" };
}

export async function geminiCompletion(
  key: string,
  model: Model,
  messages: { role: string; content: string }[],
  signal: AbortSignal | undefined,
  json: boolean,
  outputTokens: number,
) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const request = () =>
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:generateContent`,
      {
        method: "POST",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(150000)])
          : AbortSignal.timeout(150000),
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        cache: "no-store",
        body: JSON.stringify({
          ...(system
            ? { systemInstruction: { parts: [{ text: system }] } }
            : {}),
          contents: messages
            .filter((m) => m.role !== "system")
            .map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
          generationConfig: {
            temperature: json ? 0.7 : 0.85,
            // Gemini counts thinking tokens against this limit; leave headroom.
            maxOutputTokens: outputTokens + 8000,
            thinkingConfig: thinkingConfig(model.id),
            ...(json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      },
    );
  // Gemini answers 500/503 while a model is briefly overloaded and 429 with a RetryInfo
  // delay when a per-minute quota is spent; wait and retry within the request budget.
  let response = await request();
  for (let attempt = 1; attempt <= 3; attempt++) {
    let delay: number;
    if ([500, 503].includes(response.status)) delay = attempt * 3000;
    else if (response.status === 429) {
      const detail = await response
        .clone()
        .json()
        .catch(() => null);
      const retry = (detail?.error?.details ?? []).find(
        (d: { retryDelay?: string }) => d.retryDelay,
      )?.retryDelay;
      const seconds = Number.parseFloat(retry ?? "");
      // No RetryInfo, or a long wait, means a daily quota: fail fast instead.
      if (!Number.isFinite(seconds) || seconds > 60) break;
      delay = (seconds + 1) * 1000;
    } else break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    signal?.throwIfAborted();
    response = await request();
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const reason = JSON.stringify(detail?.error ?? "");
    if (response.status === 400 && /API_KEY_INVALID/.test(reason))
      throw new ProviderError(
        401,
        "Gemini rejected the server API key. Check GEMINI_API_KEY and restart the app.",
      );
    throw new ProviderError(
      response.status,
      response.status === 429
        ? "The Gemini API quota was reached (free-tier keys allow a few requests per minute and per day). Wait a minute and retry this version."
        : `Gemini could not complete the request (HTTP ${response.status}). Retry this version.`,
    );
  }
  const payload = await response.json();
  const candidate = payload.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS")
    throw new Error(
      "The model reached its output limit before finishing the design. Retry with another configured model.",
    );
  const content = (candidate?.content?.parts ?? [])
    .filter((p: { thought?: boolean; text?: string }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!content.trim())
    throw new Error(
      `The model returned no website content${candidate?.finishReason ? ` (${candidate.finishReason})` : ""}. Retry this version.`,
    );
  const usage = payload.usageMetadata ?? {};
  return {
    content,
    model: payload.modelVersion ?? model.id,
    usage: {
      prompt_tokens: usage.promptTokenCount,
      completion_tokens: usage.candidatesTokenCount,
      total_tokens: usage.totalTokenCount,
      completion_tokens_details: { reasoning_tokens: usage.thoughtsTokenCount },
    },
  };
}

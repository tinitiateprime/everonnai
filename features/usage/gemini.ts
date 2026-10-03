import { randomUUID } from "node:crypto";
import { recordUsage } from "@/lib/usage-store";
import { nonNegativeNumber, type GeminiTokens, type UsageContext, type UsageEvent } from "./types";

export function geminiTokens(payload: unknown): GeminiTokens | null {
  const metadata = (payload as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata;
  if (!metadata || typeof metadata !== "object") return null;
  const tokens = {
    input: nonNegativeNumber(metadata.promptTokenCount),
    output: nonNegativeNumber(metadata.candidatesTokenCount),
    thinking: nonNegativeNumber(metadata.thoughtsTokenCount),
    cached: nonNegativeNumber(metadata.cachedContentTokenCount),
    tools: nonNegativeNumber(metadata.toolUsePromptTokenCount),
    total: nonNegativeNumber(metadata.totalTokenCount),
  };
  // Cache tokens are already included in promptTokenCount. Preserve the
  // provider's total, including thinking, rather than adding cache twice.
  return Object.values(tokens).some((value) => value !== null) ? tokens : null;
}

export async function meteredGeminiRequest(
  model: string,
  apiKey: string,
  init: RequestInit,
  options: { usage?: UsageContext; fetchImpl?: typeof fetch; record?: (event: UsageEvent) => Promise<void> } = {},
) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const event: UsageEvent | null = options.usage ? {
    ...options.usage, id: randomUUID(), provider: "gemini", kind: "request", operation: "generateContent", model,
    status: "pending", startedAt, recordedAt: startedAt, latencyMs: null, httpStatus: null, tokens: null, voice: null,
  } : null;
  const save = options.record || recordUsage;
  // Establish a durable record before making a chargeable call. A later write
  // failure leaves a pending record and must never trigger another AI request.
  if (event) await save(event);
  let response: Response | undefined;
  let payload: unknown = null;
  try {
    response = await (options.fetchImpl || fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, init);
    payload = await response.json().catch(() => null);
    return { response, payload };
  } finally {
    if (event) {
      await save({
        ...event,
        status: response?.ok ? "success" : "failed", startedAt, recordedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started), httpStatus: response?.status ?? null,
        tokens: geminiTokens(payload), voice: null,
      }).catch(() => console.error("Could not finalize a Gemini usage record; the pending record was retained."));
    }
  }
}

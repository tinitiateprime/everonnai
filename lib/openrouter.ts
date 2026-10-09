import type { Model } from "./types";
import { websiteProvider } from "./api";
import { geminiCompletion, geminiWebsiteModels } from "./gemini";

export const DEFAULT_WEBSITE_MODELS = [
  "~anthropic/claude-opus-latest",
  "~google/gemini-pro-latest",
  "openai/gpt-6.1-sol",
];
const MODEL_ALIASES: Record<string, string> = {
  "anthropic/claude-opus-latest": "~anthropic/claude-opus-latest",
  "google/gemini-pro-latest": "~google/gemini-pro-latest",
};
export function resolveModelId(id: string) {
  return MODEL_ALIASES[id.trim()] ?? id.trim();
}
let catalogue: { expires: number; models: Model[] } | undefined;
export function prioritizeModels(
  models: Model[],
  configured = process.env.OPENROUTER_MODELS,
) {
  const override = (configured ?? "")
    .split(",")
    .map(resolveModelId)
    .filter(Boolean);
  const preferred = [
    ...new Set(override.length ? override : DEFAULT_WEBSITE_MODELS),
  ];
  // Only explicitly configured models can be selected or used as fallback.
  return preferred.flatMap((id) => {
    const model = models.find((m) => m.id === id);
    return model ? [model] : [];
  });
}
export function eligibleWebsiteModels(models: Model[]) {
  return models.filter(
    (m) =>
      !/content-safety|moderation|embedding/i.test(m.id) &&
      !/:batch$|(?:^|[-/])image(?:[-/]|$)/i.test(m.id) &&
      (!m.architecture?.output_modalities ||
        m.architecture.output_modalities.includes("text")) &&
      m.context_length >= 32000 &&
      (m.top_provider?.max_completion_tokens ?? 16000) >= 8000,
  );
}
function reasoningConfig(model: Model) {
  if (!model.supported_parameters.includes("reasoning")) return {};
  const efforts = model.reasoning?.supported_efforts;
  if (efforts?.length)
    return {
      reasoning: {
        effort:
          ["medium", "low", "minimal"].find((effort) =>
            efforts.includes(effort),
          ) ?? efforts[0],
        exclude: true,
      },
    };
  if (model.reasoning?.supports_max_tokens)
    return { reasoning: { max_tokens: 3000, exclude: true } };
  if (model.reasoning?.mandatory === false)
    return { reasoning: { enabled: false, exclude: true } };
  return model.reasoning?.mandatory
    ? { reasoning: { enabled: true, exclude: true } }
    : {};
}
export async function getModels(signal?: AbortSignal) {
  if (websiteProvider() === "gemini") return geminiWebsiteModels();
  if (catalogue && catalogue.expires > Date.now())
    return configuredModels(catalogue.models);
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "Could not load OpenRouter's current model catalogue. Try again shortly.",
    );
  const payload = await response.json();
  const models = eligibleWebsiteModels(payload.data ?? []);
  catalogue = { expires: Date.now() + 300000, models };
  return configuredModels(models);
}
function configuredModels(models: Model[]) {
  const selected = prioritizeModels(models);
  if (!selected.length)
    throw new Error(
      "None of the configured website models are currently available with suitable text, context and output support. Check OPENROUTER_MODELS and restart the app.",
    );
  return selected;
}
export class ProviderError extends Error {
  constructor(
    public status: number,
    message?: string,
  ) {
    super(
      message ??
        (status === 401
          ? "OpenRouter rejected the server API key. Check OPENROUTER_API_KEY and restart the app."
          : status === 402
            ? "OpenRouter reports insufficient credit. Add credit to the account used by OPENROUTER_API_KEY."
            : status === 429
              ? "The OpenRouter model is rate limited. Wait and retry this version."
              : `OpenRouter could not complete the request (HTTP ${status}). Retry this version.`),
    );
  }
}
export async function completion(
  key: string,
  model: Model,
  messages: { role: string; content: string }[],
  signal?: AbortSignal,
  schema?: object,
) {
  const outputTokens = Math.min(
    schema ? 5000 : 12000,
    model.top_provider?.max_completion_tokens ?? 12000,
  );
  // Conservative context guard: never silently drop the owner's knowledge.
  const estimatedInputTokens = Math.ceil(
    Buffer.byteLength(JSON.stringify(messages)) / 2,
  );
  if (estimatedInputTokens + outputTokens > model.context_length)
    throw new Error(
      "This model's context is too small for all the business evidence. Choose a larger-context model.",
    );
  if (websiteProvider() === "gemini")
    return geminiCompletion(
      key,
      model,
      messages,
      signal,
      Boolean(schema),
      outputTokens,
    );
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(150000)])
        : AbortSignal.timeout(150000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Title": "EverOnn Website Studio",
      },
      body: JSON.stringify({
        model: model.id,
        messages,
        stream: false,
        max_tokens: outputTokens,
        ...(model.supported_parameters.includes("temperature")
          ? { temperature: 0.85 }
          : {}),
        ...reasoningConfig(model),
        ...(schema && model.supported_parameters.includes("response_format")
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: "design_plan", strict: true, schema },
              },
            }
          : {}),
        provider: { allow_fallbacks: true },
      }),
      cache: "no-store",
    },
  );
  if (!response.ok) throw new ProviderError(response.status);
  const payload = await response.json();
  if (payload.error) throw new ProviderError(payload.error.code ?? 502);
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length")
    throw new Error(
      "The model reached its output limit before finishing the design. Retry with another configured model.",
    );
  if (
    typeof choice?.message?.content !== "string" ||
    !choice.message.content.trim()
  )
    throw new Error(
      "The model returned no website content. Retry this version.",
    );
  return {
    content: choice.message.content,
    model: payload.model ?? model.id,
    usage: payload.usage,
  };
}

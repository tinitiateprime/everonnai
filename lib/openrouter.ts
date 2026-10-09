import type { Model } from "./types";

let catalogue: { expires: number; models: Model[] } | undefined;
export function freeCodingModels(models: Model[]) {
  return models
    .filter(
      (m) =>
        !/content-safety|moderation|embedding/i.test(m.id) &&
        Number(m.pricing.prompt) === 0 &&
        Number(m.pricing.completion) === 0 &&
        (m.id.endsWith(":free") || m.id === "openrouter/free") &&
        m.context_length >= 32000 &&
        (m.top_provider?.max_completion_tokens ?? 16000) >= 8000,
    )
    .sort((a, b) => score(b) - score(a));
}
function score(model: Model) {
  const description = `${model.name} ${model.description}`.toLowerCase();
  return (
    (description.match(
      /coding|programming|software|frontend|code generation|instruction/g,
    )?.length ?? 0) *
      12 +
    Math.min(model.context_length / 10000, 25) +
    (model.supported_parameters.includes("response_format") ? 8 : 0) -
    (model.id === "openrouter/free" ? 100 : 0)
  );
}
export async function getModels(signal?: AbortSignal) {
  if (catalogue && catalogue.expires > Date.now()) return catalogue.models;
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
  const models = freeCodingModels(payload.data ?? []);
  if (!models.length)
    throw new Error(
      "No suitable free models are currently available. Try again later.",
    );
  const preferred = (process.env.OPENROUTER_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  models.sort((a, b) => {
    const ai = preferred.indexOf(a.id),
      bi = preferred.indexOf(b.id);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  catalogue = { expires: Date.now() + 300000, models };
  return models;
}
export class ProviderError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? "OpenRouter rejected the API key. Check Connection settings."
        : status === 402
          ? "OpenRouter reports insufficient credit or a daily free-model quota limit."
          : status === 429
            ? "OpenRouter's free model is rate limited. Wait and retry this version."
            : `OpenRouter could not complete the request (HTTP ${status}). Retry this version.`,
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
    schema ? 5000 : 18000,
    model.top_provider?.max_completion_tokens ?? 18000,
  );
  // Conservative context guard: never silently drop the owner's knowledge.
  const estimatedInputTokens = Math.ceil(
    Buffer.byteLength(JSON.stringify(messages)) / 2,
  );
  if (estimatedInputTokens + outputTokens > model.context_length)
    throw new Error(
      "This free model's context is too small for all the business evidence. Choose a larger-context model.",
    );
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(160000)])
        : AbortSignal.timeout(160000),
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
        ...(model.supported_parameters.includes("reasoning")
          ? { reasoning: { effort: "low", exclude: true } }
          : {}),
        ...(schema && model.supported_parameters.includes("response_format")
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: "design_plan", strict: true, schema },
              },
            }
          : {}),
        provider: { max_price: { prompt: 0, completion: 0 } },
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
      "The model reached its output limit before finishing the design. Retry with another free model.",
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

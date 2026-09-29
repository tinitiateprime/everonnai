import type { BusinessProfile, WebsiteSpec } from "@/features/everonn/types";
import { buildWebsitePrompt, generateDeterministicWebsiteSpec, runWebsiteQa } from "./generator";
import { getGeminiWebsiteConfig } from "@/lib/provider-config";

type GeminiConfig = ReturnType<typeof getGeminiWebsiteConfig>;
type GenerationResult = {
  spec: WebsiteSpec;
  provider: "gemini" | "deterministic";
  model: string | null;
  fallbackReason: string | null;
};

const responseSchema = {
  type: "OBJECT",
  required: ["brand", "visualDirection", "mediaPlan", "hero", "services", "about", "faq", "contact"],
  properties: {
    brand: { type: "OBJECT", required: ["tagline", "positioning"], properties: { tagline: { type: "STRING" }, positioning: { type: "STRING" } } },
    visualDirection: { type: "OBJECT", required: ["primaryColor", "accentColor", "mood"], properties: { primaryColor: { type: "STRING" }, accentColor: { type: "STRING" }, mood: { type: "STRING" } } },
    mediaPlan: { type: "OBJECT", required: ["heroQuery", "galleryQuery"], properties: { heroQuery: { type: "STRING" }, galleryQuery: { type: "STRING" } } },
    hero: { type: "OBJECT", required: ["eyebrow", "headline", "subheadline", "primaryCta"], properties: { eyebrow: { type: "STRING" }, headline: { type: "STRING" }, subheadline: { type: "STRING" }, primaryCta: { type: "STRING" } } },
    services: { type: "ARRAY", items: { type: "OBJECT", required: ["id", "name", "summary", "details"], properties: { id: { type: "STRING" }, name: { type: "STRING" }, summary: { type: "STRING" }, details: { type: "ARRAY", items: { type: "STRING" } } } } },
    about: { type: "OBJECT", required: ["title", "body"], properties: { title: { type: "STRING" }, body: { type: "STRING" } } },
    faq: { type: "ARRAY", items: { type: "OBJECT", required: ["question", "answer"], properties: { question: { type: "STRING" }, answer: { type: "STRING" } } } },
    contact: { type: "OBJECT", required: ["title", "copy", "ctaLabel"], properties: { title: { type: "STRING" }, copy: { type: "STRING" }, ctaLabel: { type: "STRING" } } },
  },
};

function text(value: unknown, fallback: string, maximum = 1200) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : fallback;
}

function color(value: unknown, fallback: string) {
  const candidate = text(value, fallback, 16);
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

function normalizeGeneratedSpec(value: unknown, profile: BusinessProfile) {
  const fallback = generateDeterministicWebsiteSpec(profile);
  const generated = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const brand = generated.brand && typeof generated.brand === "object" ? generated.brand as Record<string, unknown> : {};
  const direction = generated.visualDirection && typeof generated.visualDirection === "object" ? generated.visualDirection as Record<string, unknown> : {};
  const mediaPlan = generated.mediaPlan && typeof generated.mediaPlan === "object" ? generated.mediaPlan as Record<string, unknown> : {};
  const hero = generated.hero && typeof generated.hero === "object" ? generated.hero as Record<string, unknown> : {};
  const about = generated.about && typeof generated.about === "object" ? generated.about as Record<string, unknown> : {};
  const contact = generated.contact && typeof generated.contact === "object" ? generated.contact as Record<string, unknown> : {};
  const generatedServices = Array.isArray(generated.services) ? generated.services.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
  const generatedFaq = Array.isArray(generated.faq) ? generated.faq.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];

  const services = fallback.services.map((service) => {
    const match = generatedServices.find((item) => item.id === service.id || String(item.name || "").trim().toLowerCase() === service.name.toLowerCase());
    const details = Array.isArray(match?.details) ? match.details.map((item) => text(item, "", 240)).filter(Boolean).slice(0, 4) : [];
    return {
      ...service,
      name: service.name,
      summary: text(match?.summary, service.summary, 500),
      details: details.length ? details : service.details,
    };
  });
  const faq = generatedFaq.map((item) => ({ question: text(item.question, "", 240), answer: text(item.answer, "", 800) }))
    .filter((item) => item.question && item.answer)
    .slice(0, 8);

  return {
    ...fallback,
    brand: { tagline: text(brand.tagline, fallback.brand.tagline, 240), positioning: text(brand.positioning, fallback.brand.positioning, 700) },
    visualDirection: { primaryColor: color(direction.primaryColor, fallback.visualDirection.primaryColor), accentColor: color(direction.accentColor, fallback.visualDirection.accentColor), mood: text(direction.mood, fallback.visualDirection.mood, 80) },
    mediaPlan: { heroQuery: text(mediaPlan.heroQuery, fallback.mediaPlan.heroQuery, 180), galleryQuery: text(mediaPlan.galleryQuery, fallback.mediaPlan.galleryQuery, 180) },
    hero: { eyebrow: text(hero.eyebrow, fallback.hero.eyebrow, 160), headline: text(hero.headline, fallback.hero.headline, 180), subheadline: text(hero.subheadline, fallback.hero.subheadline, 700), primaryCta: text(hero.primaryCta, fallback.hero.primaryCta, 80) },
    services,
    about: { title: text(about.title, fallback.about.title, 240), body: text(about.body, fallback.about.body, 1200) },
    faq: faq.length >= 4 ? faq : fallback.faq,
    contact: { title: text(contact.title, fallback.contact.title, 240), copy: text(contact.copy, fallback.contact.copy, 700), ctaLabel: text(contact.ctaLabel, fallback.contact.ctaLabel, 80) },
  } satisfies WebsiteSpec;
}

function extractGeminiJson(payload: unknown) {
  const response = payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const source = response.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!source) throw new Error("Gemini returned no website content.");
  const cleaned = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(cleaned) as unknown;
}

async function requestGemini(model: string, profile: BusinessProfile, config: GeminiConfig, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${buildWebsitePrompt(profile)}\n\nReturn only the JSON object matching the supplied response schema.` }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0.55, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (payload as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message || `Gemini returned HTTP ${response.status}.`);
  }
  return extractGeminiJson(payload);
}

export async function generateWebsiteSpec(input: BusinessProfile, options: { config?: GeminiConfig; fetchImpl?: typeof fetch } = {}): Promise<GenerationResult> {
  const fallback = generateDeterministicWebsiteSpec(input);
  const config = options.config || getGeminiWebsiteConfig();
  if (!config.apiKey) return { spec: fallback, provider: "deterministic", model: null, fallbackReason: null };

  let lastError = "Gemini generation was unavailable.";
  for (const [index, model] of config.models.entries()) {
    try {
      const generated = await requestGemini(model, input, config, options.fetchImpl || fetch);
      const spec = normalizeGeneratedSpec(generated, input);
      const qa = runWebsiteQa(spec, input);
      if (!qa.passed) throw new Error("Generated content did not pass EverOnn grounding QA.");
      return { spec, provider: "gemini", model, fallbackReason: null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (index < config.models.length - 1 && config.retryDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, config.retryDelayMs));
      }
    }
  }
  return { spec: fallback, provider: "deterministic", model: null, fallbackReason: lastError };
}

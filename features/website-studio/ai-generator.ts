import type { BusinessProfile, WebsiteServiceSpec, WebsiteSpec } from "@/features/everonn/types";
import { buildWebsitePrompt, generateDeterministicWebsiteSpec, runWebsiteQa, websiteSlug } from "./generator";
import { getGeminiWebsiteConfig } from "@/lib/provider-config";

type GeminiConfig = ReturnType<typeof getGeminiWebsiteConfig>;
type GenerationResult = {
  spec: WebsiteSpec;
  provider: "gemini" | "deterministic";
  model: string | null;
  fallbackReason: string | null;
};

const string = { type: "STRING" };
const titledCopy = {
  type: "OBJECT",
  required: ["title", "copy"],
  properties: { title: string, copy: string },
};
const responseSchema = {
  type: "OBJECT",
  required: ["seo", "brand", "visualDirection", "mediaPlan", "hero", "servicesIntro", "services", "benefits", "process", "about", "faq", "contact"],
  properties: {
    seo: { type: "OBJECT", required: ["title", "description"], properties: { title: string, description: string } },
    brand: { type: "OBJECT", required: ["tagline", "positioning"], properties: { tagline: string, positioning: string } },
    visualDirection: { type: "OBJECT", required: ["primaryColor", "accentColor", "mood"], properties: { primaryColor: string, accentColor: string, mood: string } },
    mediaPlan: { type: "OBJECT", required: ["heroQuery", "galleryQuery", "heroAlt", "storyAlt"], properties: { heroQuery: string, galleryQuery: string, heroAlt: string, storyAlt: string } },
    hero: { type: "OBJECT", required: ["eyebrow", "headline", "subheadline", "primaryCta", "secondaryCta"], properties: { eyebrow: string, headline: string, subheadline: string, primaryCta: string, secondaryCta: string } },
    servicesIntro: { type: "OBJECT", required: ["eyebrow", "title", "copy"], properties: { eyebrow: string, title: string, copy: string } },
    services: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["id", "name", "slug", "summary", "details", "idealFor", "ctaLabel", "imageQuery", "imageAlt", "pageHeadline", "pageIntro", "pageSections"],
        properties: {
          id: string,
          name: string,
          slug: string,
          summary: string,
          details: { type: "ARRAY", items: string },
          idealFor: string,
          ctaLabel: string,
          imageQuery: string,
          imageAlt: string,
          pageHeadline: string,
          pageIntro: string,
          pageSections: { type: "ARRAY", items: titledCopy },
        },
      },
    },
    benefits: { type: "ARRAY", items: titledCopy },
    process: { type: "ARRAY", items: titledCopy },
    about: { type: "OBJECT", required: ["eyebrow", "title", "body"], properties: { eyebrow: string, title: string, body: string } },
    faq: { type: "ARRAY", items: { type: "OBJECT", required: ["question", "answer"], properties: { question: string, answer: string } } },
    contact: { type: "OBJECT", required: ["eyebrow", "title", "copy", "ctaLabel"], properties: { eyebrow: string, title: string, copy: string, ctaLabel: string } },
  },
};

function text(value: unknown, fallback: string, maximum = 1200) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : fallback;
}

function color(value: unknown, fallback: string) {
  const candidate = text(value, fallback, 16);
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

function record(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
}

function titledRows(value: unknown, fallback: Array<{ title: string; copy: string }>, minimum = 3) {
  const rows = records(value).map((item) => ({ title: text(item.title, "", 180), copy: text(item.copy, "", 800) })).filter((item) => item.title && item.copy).slice(0, 8);
  return rows.length >= minimum ? rows : fallback;
}

function normalizeService(match: Record<string, unknown> | undefined, fallback: WebsiteServiceSpec): WebsiteServiceSpec {
  const details = Array.isArray(match?.details) ? match.details.map((item) => text(item, "", 260)).filter(Boolean).slice(0, 5) : [];
  const pageSections = titledRows(match?.pageSections, fallback.pageSections, 2).slice(0, 4);
  return {
    ...fallback,
    id: fallback.id,
    name: fallback.name,
    slug: websiteSlug(text(match?.slug, fallback.slug, 100) || fallback.name),
    summary: text(match?.summary, fallback.summary, 600),
    details: details.length >= 2 ? details : fallback.details,
    idealFor: text(match?.idealFor, fallback.idealFor, 320),
    ctaLabel: text(match?.ctaLabel, fallback.ctaLabel, 100),
    imageQuery: text(match?.imageQuery, fallback.imageQuery, 180),
    imageAlt: text(match?.imageAlt, fallback.imageAlt, 220),
    pageHeadline: text(match?.pageHeadline, fallback.pageHeadline, 200),
    pageIntro: text(match?.pageIntro, fallback.pageIntro, 1000),
    pageSections,
  };
}

function normalizeGeneratedSpec(value: unknown, profile: BusinessProfile): WebsiteSpec {
  const fallback = generateDeterministicWebsiteSpec(profile);
  const generated = record(value);
  const seo = record(generated.seo);
  const brand = record(generated.brand);
  const direction = record(generated.visualDirection);
  const mediaPlan = record(generated.mediaPlan);
  const hero = record(generated.hero);
  const servicesIntro = record(generated.servicesIntro);
  const about = record(generated.about);
  const contact = record(generated.contact);
  const generatedServices = records(generated.services);
  const generatedFaq = records(generated.faq);

  const services = fallback.services.map((service) => {
    const match = generatedServices.find((item) => item.id === service.id || String(item.name || "").trim().toLowerCase() === service.name.toLowerCase());
    return normalizeService(match, service);
  });
  const faq = generatedFaq.map((item) => ({ question: text(item.question, "", 240), answer: text(item.answer, "", 900) }))
    .filter((item) => item.question && item.answer)
    .slice(0, 10);

  return {
    ...fallback,
    seo: { title: text(seo.title, fallback.seo.title, 180), description: text(seo.description, fallback.seo.description, 320) },
    brand: { tagline: text(brand.tagline, fallback.brand.tagline, 240), positioning: text(brand.positioning, fallback.brand.positioning, 800) },
    visualDirection: { primaryColor: color(direction.primaryColor, fallback.visualDirection.primaryColor), accentColor: color(direction.accentColor, fallback.visualDirection.accentColor), mood: text(direction.mood, fallback.visualDirection.mood, 100) },
    mediaPlan: {
      heroQuery: text(mediaPlan.heroQuery, fallback.mediaPlan.heroQuery, 180),
      galleryQuery: text(mediaPlan.galleryQuery, fallback.mediaPlan.galleryQuery, 180),
      heroAlt: text(mediaPlan.heroAlt, fallback.mediaPlan.heroAlt, 220),
      storyAlt: text(mediaPlan.storyAlt, fallback.mediaPlan.storyAlt, 220),
    },
    hero: {
      eyebrow: text(hero.eyebrow, fallback.hero.eyebrow, 160),
      headline: text(hero.headline, fallback.hero.headline, 200),
      subheadline: text(hero.subheadline, fallback.hero.subheadline, 800),
      primaryCta: text(hero.primaryCta, fallback.hero.primaryCta, 100),
      secondaryCta: text(hero.secondaryCta, fallback.hero.secondaryCta, 100),
    },
    servicesIntro: {
      eyebrow: text(servicesIntro.eyebrow, fallback.servicesIntro.eyebrow, 100),
      title: text(servicesIntro.title, fallback.servicesIntro.title, 200),
      copy: text(servicesIntro.copy, fallback.servicesIntro.copy, 700),
    },
    services,
    benefits: titledRows(generated.benefits, fallback.benefits),
    process: titledRows(generated.process, fallback.process),
    about: { eyebrow: text(about.eyebrow, fallback.about.eyebrow, 100), title: text(about.title, fallback.about.title, 240), body: text(about.body, fallback.about.body, 1600) },
    faq: faq.length >= 4 ? faq : fallback.faq,
    contact: { eyebrow: text(contact.eyebrow, fallback.contact.eyebrow, 100), title: text(contact.title, fallback.contact.title, 240), copy: text(contact.copy, fallback.contact.copy, 800), ctaLabel: text(contact.ctaLabel, fallback.contact.ctaLabel, 100) },
  };
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
      generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0.55, maxOutputTokens: 16384 },
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
      if (index < config.models.length - 1 && config.retryDelayMs) await new Promise((resolve) => setTimeout(resolve, config.retryDelayMs));
    }
  }
  return { spec: fallback, provider: "deterministic", model: null, fallbackReason: lastError };
}

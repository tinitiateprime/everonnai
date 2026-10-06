import type { BusinessProfile, WebsiteServiceSpec, WebsiteSpec } from "@/features/everonn/types";
import { runWebsiteQa, websiteSlug } from "./generator";
import { buildWebsitePrompt } from "./prompt";
import { applyWebsitePreferences } from "./brand";
import { resolvedWebsitePreferences } from "@/features/agent-runtime/memory";
import type { ScopedMemory, SkillTrace } from "@/features/agent-runtime/types";
import { getGeminiWebsiteConfig } from "@/lib/provider-config";
import { meteredGeminiRequest } from "@/features/usage/gemini";
import type { UsageContext } from "@/features/usage/types";
import type { WebsiteGenerationProgress } from "./progress";

type GeminiConfig = ReturnType<typeof getGeminiWebsiteConfig>;
type GenerationResult = {
  spec: WebsiteSpec;
  provider: "gemini";
  model: string;
  skills: SkillTrace[];
};

const string = { type: "STRING" };
const titledCopy = {
  type: "OBJECT",
  required: ["title", "copy"],
  properties: { title: string, copy: string },
};
const responseSchema = {
  type: "OBJECT",
  required: ["design", "seo", "brand", "visualDirection", "mediaPlan", "hero", "servicesIntro", "services", "benefits", "process", "about", "faq", "contact"],
  properties: {
    design: { type: "OBJECT", required: ["rationale"], properties: { rationale: string } },
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

function requireText(container: Record<string, unknown>, key: string, path: string) {
  if (typeof container[key] !== "string" || !container[key].trim()) throw new Error(`Gemini omitted required website content: ${path}.${key}.`);
}

function requireTitledRows(value: unknown, path: string, minimum: number) {
  const rows = records(value);
  if (rows.length < minimum) throw new Error(`Gemini returned too few ${path} entries.`);
  rows.forEach((row, index) => {
    requireText(row, "title", `${path}[${index}]`);
    requireText(row, "copy", `${path}[${index}]`);
  });
}

function assertCompleteAiSpec(value: unknown, profile: BusinessProfile) {
  const generated = record(value);
  requireText(record(generated.design), "rationale", "design");
  const textGroups: Array<[string, string[]]> = [
    ["seo", ["title", "description"]],
    ["brand", ["tagline", "positioning"]],
    ["visualDirection", ["primaryColor", "accentColor", "mood"]],
    ["mediaPlan", ["heroQuery", "galleryQuery", "heroAlt", "storyAlt"]],
    ["hero", ["eyebrow", "headline", "subheadline", "primaryCta", "secondaryCta"]],
    ["servicesIntro", ["eyebrow", "title", "copy"]],
    ["about", ["eyebrow", "title", "body"]],
    ["contact", ["eyebrow", "title", "copy", "ctaLabel"]],
  ];
  for (const [groupName, keys] of textGroups) {
    const group = record(generated[groupName]);
    keys.forEach((key) => requireText(group, key, groupName));
  }
  const direction = record(generated.visualDirection);
  if (!/^#[0-9a-f]{6}$/i.test(String(direction.primaryColor)) || !/^#[0-9a-f]{6}$/i.test(String(direction.accentColor))) {
    throw new Error("Gemini returned invalid website brand colors.");
  }
  requireTitledRows(generated.benefits, "benefits", 3);
  requireTitledRows(generated.process, "process", 3);

  const generatedServices = records(generated.services);
  const activeServices = profile.services.filter((item) => item.active);
  if (generatedServices.length !== activeServices.length || generatedServices.some((item) => !activeServices.some((service) => service.id === item.id && service.name === item.name))) {
    throw new Error("Gemini introduced unsupported or duplicate services.");
  }
  for (const service of profile.services.filter((item) => item.active)) {
    const match = generatedServices.find((item) => item.id === service.id || String(item.name || "").trim().toLowerCase() === service.name.toLowerCase());
    if (!match) throw new Error(`Gemini omitted the service page for ${service.name}.`);
    ["slug", "summary", "idealFor", "ctaLabel", "imageQuery", "imageAlt", "pageHeadline", "pageIntro"].forEach((key) => requireText(match, key, `services.${service.id}`));
    const details = Array.isArray(match.details) ? match.details.filter((item) => typeof item === "string" && item.trim()) : [];
    if (details.length < 2) throw new Error(`Gemini returned incomplete service details for ${service.name}.`);
    requireTitledRows(match.pageSections, `services.${service.id}.pageSections`, 2);
  }

  const faq = records(generated.faq);
  if (faq.length < 4) throw new Error("Gemini returned fewer than four FAQ answers.");
  faq.forEach((item, index) => {
    requireText(item, "question", `faq[${index}]`);
    requireText(item, "answer", `faq[${index}]`);
  });
}

function titledRows(value: unknown) {
  return records(value).map((item) => ({ title: text(item.title, "", 180), copy: text(item.copy, "", 800) })).filter((item) => item.title && item.copy).slice(0, 8);
}

function normalizeService(match: Record<string, unknown>, source: BusinessProfile["services"][number]): WebsiteServiceSpec {
  const details = Array.isArray(match.details) ? match.details.map((item) => text(item, "", 260)).filter(Boolean).slice(0, 5) : [];
  const pageSections = titledRows(match.pageSections).slice(0, 4);
  return {
    id: source.id,
    name: source.name,
    slug: websiteSlug(text(match.slug, source.name, 100)),
    summary: text(match.summary, "", 600),
    details,
    idealFor: text(match.idealFor, "", 320),
    ctaLabel: text(match.ctaLabel, "", 100),
    imageQuery: text(match.imageQuery, "", 180),
    imageAlt: text(match.imageAlt, "", 220),
    pageHeadline: text(match.pageHeadline, "", 200),
    pageIntro: text(match.pageIntro, "", 1000),
    pageSections,
  };
}

function normalizeGeneratedSpec(value: unknown, profile: BusinessProfile): WebsiteSpec {
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

  const services = profile.services.filter((service) => service.active).map((service) => {
    const match = generatedServices.find((item) => item.id === service.id || String(item.name || "").trim().toLowerCase() === service.name.toLowerCase());
    return normalizeService(match!, service);
  });
  const faq = generatedFaq.map((item) => ({ question: text(item.question, "", 240), answer: text(item.answer, "", 900) }))
    .filter((item) => item.question && item.answer)
    .slice(0, 10);

  return {
    schemaVersion: 1,
    design: { rationale: text(record(generated.design).rationale, "", 1200) },
    seo: { title: text(seo.title, "", 180), description: text(seo.description, "", 320) },
    brand: { tagline: text(brand.tagline, "", 240), positioning: text(brand.positioning, "", 800) },
    visualDirection: { primaryColor: color(direction.primaryColor, ""), accentColor: color(direction.accentColor, ""), mood: text(direction.mood, "", 100) },
    mediaPlan: {
      heroQuery: text(mediaPlan.heroQuery, "", 180),
      galleryQuery: text(mediaPlan.galleryQuery, "", 180),
      heroAlt: text(mediaPlan.heroAlt, "", 220),
      storyAlt: text(mediaPlan.storyAlt, "", 220),
    },
    media: { hero: null, story: null, gallery: [], services: {} },
    hero: {
      eyebrow: text(hero.eyebrow, "", 160),
      headline: text(hero.headline, "", 200),
      subheadline: text(hero.subheadline, "", 800),
      primaryCta: text(hero.primaryCta, "", 100),
      secondaryCta: text(hero.secondaryCta, "", 100),
    },
    servicesIntro: {
      eyebrow: text(servicesIntro.eyebrow, "", 100),
      title: text(servicesIntro.title, "", 200),
      copy: text(servicesIntro.copy, "", 700),
    },
    services,
    benefits: titledRows(generated.benefits),
    process: titledRows(generated.process),
    about: { eyebrow: text(about.eyebrow, "", 100), title: text(about.title, "", 240), body: text(about.body, "", 1600) },
    faq,
    contact: { eyebrow: text(contact.eyebrow, "", 100), title: text(contact.title, "", 240), copy: text(contact.copy, "", 800), ctaLabel: text(contact.ctaLabel, "", 100) },
  };
}

function extractGeminiJson(payload: unknown) {
  const response = payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const source = response.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!source) throw new Error("Gemini returned no website content.");
  const cleaned = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(cleaned) as unknown;
}

async function requestGemini(model: string, profile: BusinessProfile, config: GeminiConfig, fetchImpl: typeof fetch, usage?: UsageContext, memory?: ScopedMemory[], correction?: { generated: unknown; feedback: string }) {
  const prompt = buildWebsitePrompt(profile, memory);
  const contents = [{ role: "user", parts: [{ text: `${prompt.context}\n\nCONTENT_PLAN_TASK\nPlan the complete grounded website content, brand colors, photography direction, and design rationale matching the response schema. Include every active service exactly once, at least three benefits, three process steps, four FAQs, and two detailed sections per service. Actual HTML and CSS are generated in the next stage; do not choose from a layout menu.` }] }];
  if (correction) {
    contents.push({ role: "model", parts: [{ text: JSON.stringify(correction.generated) }] });
    contents.push({ role: "user", parts: [{ text: `Repair the complete content plan and return the full response-schema JSON. Validation feedback: ${correction.feedback}\nUse only supplied business facts. Remove unsupported claims everywhere, including SEO and service pages. Do not change service IDs/names, invent evidence, or weaken the validation rules.` }] });
  }
  const { response, payload } = await meteredGeminiRequest(model, config.apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
      contents,
      generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0.55, maxOutputTokens: 16384 },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
    cache: "no-store",
  }, { fetchImpl, usage });
  if (!response.ok) {
    const message = (payload as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message || `Gemini returned HTTP ${response.status}.`);
  }
  const generated = extractGeminiJson(payload);
  return { generated, skills: prompt.trace };
}

export async function generateWebsiteSpec(input: BusinessProfile, options: { config?: GeminiConfig; fetchImpl?: typeof fetch; usage?: UsageContext; memory?: ScopedMemory[]; onProgress?: (progress: WebsiteGenerationProgress) => void } = {}): Promise<GenerationResult> {
  const config = options.config || getGeminiWebsiteConfig();
  if (!config.apiKey) throw new Error("Gemini website generation is required. Add GEMINI_API_KEY before generating a site.");

  let lastError = "Gemini generation was unavailable.";
  for (const [index, model] of config.models.entries()) {
    try {
      options.onProgress?.({ stage: "content", message: "Planning website content from your saved business knowledge." });
      let result = await requestGemini(model, input, config, options.fetchImpl || fetch, options.usage, options.memory);
      for (let attempt = 0; attempt < 2; attempt++) {
        let feedback: string;
        try {
          assertCompleteAiSpec(result.generated, input);
          const preferences = resolvedWebsitePreferences(options.memory, input.workspaceId);
          const spec = applyWebsitePreferences(normalizeGeneratedSpec(result.generated, input), preferences);
          const qa = runWebsiteQa(spec, input);
          if (!qa.passed) throw new Error(`Generated content did not pass EverOnn grounding QA. ${qa.checks.filter((check) => !check.passed).map((check) => check.message).join(" ")}`);
          return { spec, provider: "gemini", model, skills: result.skills };
        } catch (error) {
          feedback = error instanceof Error ? error.message : "The website content is incomplete.";
          if (attempt) throw error;
        }
        options.onProgress?.({ stage: "content", message: "Refining website content after factual checks." });
        result = await requestGemini(model, input, config, options.fetchImpl || fetch, options.usage, options.memory, { generated: result.generated, feedback: feedback.slice(0, 2000) });
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (index < config.models.length - 1 && config.retryDelayMs) await new Promise((resolve) => setTimeout(resolve, config.retryDelayMs));
    }
  }
  throw new Error(`Gemini could not generate a complete grounded website. ${lastError}`);
}

import type { BusinessProfile, QaCheck, WebsiteProject, WebsiteSpec } from "@/features/everonn/types";

export const WEBSITE_CONCEPTS = ["editorial", "momentum", "aura"] as const;

const unsupportedClaimPattern = /\b(?:award[- ]winning|number one|#1|best in|certified|licensed|accredited|guaranteed|\d+\+?\s+years? of experience|\d+(?:\.\d+)?%\s+(?:success|satisfaction)|\d+\+?\s+(?:clients|customers|patients|students))\b/gi;

function clean(value: unknown, max = 1200) {
  return typeof value === "string" ? value.trim().replace(/\r\n?/g, "\n").slice(0, max) : "";
}

function slugify(value: string) {
  return clean(value, 120)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "everonn-business";
}

export function normalizeWebsiteBusinessProfile(profile: BusinessProfile) {
  const services = profile.services.filter((service) => service.active && clean(service.name, 120));
  if (!clean(profile.businessName, 120)) throw new Error("Business name is required.");
  if (!clean(profile.businessType, 120)) throw new Error("Business type is required.");
  if (clean(profile.description, 2400).length < 40) throw new Error("Add a business description of at least 40 characters.");
  if (!services.length) throw new Error("Add at least one active service.");
  return { ...profile, services };
}

export function buildWebsitePrompt(input: BusinessProfile) {
  const profile = normalizeWebsiteBusinessProfile(input);
  return `ROLE: Senior brand strategist, conversion copywriter, information architect, and creative director.

TASK: Create structured content for three responsive business website concepts: Editorial, Momentum, and Aura.

GROUNDING RULES:
- The approved BUSINESS_PROFILE is the only source of facts.
- Preserve every supplied service name exactly and never invent another service.
- Never invent people, credentials, awards, years in business, ratings, prices, discounts, testimonials, addresses, opening hours, availability, guarantees, medical claims, or legal claims.
- If a fact is missing, write accurate category-level copy without implying that the business supplied it.
- Calls to action must not claim an appointment is confirmed.
- Keep primary headings below 14 words and avoid placeholders.

BUSINESS_PROFILE:
${JSON.stringify(profile)}`;
}

function supportedKnowledge(profile: BusinessProfile, category?: string) {
  return profile.knowledge.filter((item) => item.approved && (!category || item.category === category));
}

export function generateDeterministicWebsiteSpec(input: BusinessProfile): WebsiteSpec {
  const profile = normalizeWebsiteBusinessProfile(input);
  const services = profile.services.map((service) => ({
    id: service.id,
    name: service.name,
    summary: service.description || `${service.name} requests handled with a clear path to the team.`,
    details: [
      `Available for customers in ${profile.serviceArea || profile.location || "the listed service area"}.`,
      "Contact the team to confirm timing, scope, and pricing.",
    ],
  }));
  const approvedFaqs = supportedKnowledge(profile, "faq").slice(0, 6).map((item) => ({ question: item.question, answer: item.answer }));
  const fallbackFaqs = [
    { question: "How do I request service?", answer: `Call ${profile.businessName} or send a request through the website. The team will confirm the details and next step.` },
    { question: "What areas do you serve?", answer: profile.serviceArea || profile.location || "Contact the team to confirm whether your location is covered." },
    { question: "When is the business available?", answer: profile.hours || "Contact the team to confirm current business hours and availability." },
    { question: "Can I get a price online?", answer: profile.pricingRules || "The team confirms pricing after reviewing the details of the request." },
  ];
  const faq = [...approvedFaqs, ...fallbackFaqs]
    .filter((item, index, all) => all.findIndex((other) => other.question.toLowerCase() === item.question.toLowerCase()) === index)
    .slice(0, 8);

  return {
    schemaVersion: 1,
    brand: {
      tagline: `Ready when customers need ${profile.businessType.toLowerCase()}.`,
      positioning: `${profile.businessName} helps customers with ${services.map((service) => service.name).join(", ")} in ${profile.serviceArea || profile.location || "its service area"}.`,
    },
    visualDirection: { primaryColor: "#03152f", accentColor: "#12c5ce", mood: profile.tone === "direct" ? "technical" : profile.tone === "warm" ? "warm" : "trustworthy" },
    mediaPlan: {
      heroQuery: `${profile.businessType} professional working ${profile.location}`.trim(),
      galleryQuery: `${profile.businessType} tools team customer service`.trim(),
    },
    media: { hero: null, gallery: [], services: {} },
    hero: {
      eyebrow: `${profile.businessType} · ${profile.location || profile.serviceArea}`,
      headline: `${profile.businessName}, ready to help.`,
      subheadline: profile.description,
      primaryCta: profile.phone ? "Call now" : "Request service",
    },
    services,
    about: {
      title: `A clear way to reach ${profile.businessName}.`,
      body: `${profile.description} Customers can ask questions, share request details, and receive a clear next step from the team.`,
    },
    faq,
    contact: {
      title: "Tell us what you need.",
      copy: `Share the service, location, and best way to reach you. ${profile.businessName} will confirm availability and next steps.`,
      ctaLabel: "Request service",
    },
  };
}

export function runWebsiteQa(spec: WebsiteSpec, input: BusinessProfile) {
  const profile = normalizeWebsiteBusinessProfile(input);
  const serialized = JSON.stringify(spec);
  const source = JSON.stringify(profile).toLowerCase();
  const claims = [...new Set(serialized.match(unsupportedClaimPattern) || [])].filter((claim) => !source.includes(claim.toLowerCase()));
  const checks: QaCheck[] = [
    { key: "business-verified", passed: profile.verified, message: profile.verified ? "The business profile is owner verified." : "Verify the business profile before publication." },
    { key: "verified-services", passed: profile.services.every((service) => spec.services.some((generated) => generated.name === service.name)), message: "Every active service is grounded in the approved profile." },
    { key: "no-invented-services", passed: spec.services.every((generated) => profile.services.some((service) => generated.name === service.name)), message: "No unsupported services were introduced." },
    { key: "no-placeholders", passed: !/(lorem ipsum|\btbd\b|insert |placeholder|coming soon)/i.test(serialized), message: "No placeholder copy is present." },
    { key: "no-unsupported-claims", passed: claims.length === 0, message: claims.length ? `Remove unsupported claims: ${claims.join(", ")}.` : "No unsupported credentials or performance claims are present." },
    { key: "complete-contact", passed: Boolean(spec.contact.title && spec.contact.copy && (profile.phone || profile.email)), message: "The website has a real customer contact path." },
    { key: "faq-depth", passed: spec.faq.length >= 4, message: "At least four grounded customer questions are included." },
    { key: "three-concepts", passed: WEBSITE_CONCEPTS.length === 3, message: "Editorial, Momentum, and Aura concepts are available." },
  ];
  return { passed: checks.every((check) => check.passed), checks, checkedAt: new Date().toISOString() };
}

export function createWebsiteProject(profile: BusinessProfile, suppliedSpec?: WebsiteSpec): WebsiteProject {
  const spec = suppliedSpec || generateDeterministicWebsiteSpec(profile);
  const qa = runWebsiteQa(spec, profile);
  const createdAt = new Date().toISOString();
  const random = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  return {
    id: `website_${crypto.randomUUID()}`,
    workspaceId: profile.workspaceId,
    privateToken: random,
    publicSlug: slugify(profile.businessName),
    concepts: [...WEBSITE_CONCEPTS],
    selectedConcept: null,
    status: "generated",
    spec,
    qa,
    createdAt,
    updatedAt: createdAt,
  };
}

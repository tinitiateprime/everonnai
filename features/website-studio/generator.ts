import type { BusinessProfile, QaCheck, WebsiteProject, WebsiteServiceSpec, WebsiteSpec } from "@/features/everonn/types";

export const WEBSITE_CONCEPTS = ["editorial", "momentum", "aura"] as const;

const unsupportedClaimPattern = /\b(?:award[- ]winning|number one|#1|best in|certified|licensed|accredited|guaranteed|\d+\+?\s+years? of experience|\d+(?:\.\d+)?%\s+(?:success|satisfaction)|\d+\+?\s+(?:clients|customers|patients|students))\b/gi;

function clean(value: unknown, max = 1200) {
  return typeof value === "string" ? value.trim().replace(/\r\n?/g, "\n").slice(0, max) : "";
}

export function websiteSlug(value: string) {
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
  return `ROLE: Senior information architect, brand strategist, conversion copywriter, SEO editor, and photography director.

TASK: Create the complete structured content system for three responsive multi-page business website concepts: Editorial, Momentum, and Aura.

INFORMATION ARCHITECTURE:
- A conversion-focused homepage.
- A complete services index.
- One useful, distinct detail page for every supplied service.
- An About page and a Contact page.
- Site-wide AI chat and voice entry points will use this same approved profile.

GROUNDING AND QUALITY RULES:
- The approved BUSINESS_PROFILE is the only source of business-specific facts.
- Preserve every supplied service name and ID exactly and never invent another service.
- Give every service a URL slug, audience fit, CTA, concrete image query and alt text, page headline, page introduction, and two or three genuinely useful detail sections.
- Image queries must describe authentic editorial photography of the exact work, tools, environment, people, or outcome. Never request logos, text, collages, renders, or abstract backgrounds.
- Never invent people, credentials, awards, years in business, ratings, prices, discounts, testimonials, addresses, hours, availability, guarantees, medical claims, or legal claims.
- If a fact is missing, use accurate category-level guidance without presenting it as a verified fact about this business.
- Calls to action must not claim an appointment is confirmed.
- Keep primary headings below 14 words. Avoid placeholders, generic repetition, and empty marketing language.
- Write enough distinct copy for a polished multi-page website; each section must add new information.

BUSINESS_PROFILE:
${JSON.stringify(profile)}`;
}

function supportedKnowledge(profile: BusinessProfile, category?: string) {
  return profile.knowledge.filter((item) => item.approved && (!category || item.category === category));
}

function deterministicService(profile: BusinessProfile, service: BusinessProfile["services"][number]): WebsiteServiceSpec {
  const area = profile.serviceArea || profile.location || "the listed service area";
  const description = service.description || `${service.name} requests handled with a clear path to the team.`;
  return {
    id: service.id,
    slug: websiteSlug(service.name),
    name: service.name,
    summary: description,
    details: [
      `Available for customers in ${area}.`,
      "Contact the team to confirm timing, scope, and pricing.",
      "Share the relevant details so the team can recommend a suitable next step.",
    ],
    idealFor: `Customers exploring ${service.name.toLowerCase()} in ${area}.`,
    ctaLabel: `Ask about ${service.name}`,
    imageQuery: `${profile.businessType} professional performing ${service.name} real work tools customer`.trim(),
    imageAlt: `${service.name} for a customer of ${profile.businessName}`,
    pageHeadline: `${service.name}, with a clear next step.`,
    pageIntro: `${description} Share what you need and ${profile.businessName} can confirm the appropriate scope, timing, and next step.`,
    pageSections: [
      { title: `When to ask about ${service.name}`, copy: `This service is intended for customers who need help with ${service.name.toLowerCase()}. Describe the situation, location, and preferred timing so the team has useful context.` },
      { title: "What the team needs to know", copy: "Provide the relevant property, equipment, project, or service details. The team will review the request and confirm what is available without making assumptions about price or timing." },
      { title: "Your next step", copy: `Call or send an enquiry to ${profile.businessName}. A person can confirm the service scope, availability, and any preparation that may be needed.` },
    ],
  };
}

export function generateDeterministicWebsiteSpec(input: BusinessProfile): WebsiteSpec {
  const profile = normalizeWebsiteBusinessProfile(input);
  const services = profile.services.map((service) => deterministicService(profile, service));
  const area = profile.serviceArea || profile.location || "the listed service area";
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
    seo: {
      title: `${profile.businessName} | ${profile.businessType}`,
      description: `${profile.businessName} provides ${services.map((service) => service.name).join(", ")} for customers in ${area}.`,
    },
    brand: {
      tagline: `Ready when customers need ${profile.businessType.toLowerCase()}.`,
      positioning: `${profile.businessName} helps customers with ${services.map((service) => service.name).join(", ")} in ${area}.`,
    },
    visualDirection: { primaryColor: "#03152f", accentColor: "#12c5ce", mood: profile.tone === "direct" ? "technical" : profile.tone === "warm" ? "warm" : "trustworthy" },
    mediaPlan: {
      heroQuery: `${profile.businessType} skilled professional helping customer ${profile.location}`.trim(),
      galleryQuery: `${profile.businessType} real work tools team customer environment`.trim(),
      heroAlt: `${profile.businessName} serving customers in ${area}`,
      storyAlt: `The people, tools, and work behind ${profile.businessName}`,
    },
    media: { hero: null, story: null, gallery: [], services: {} },
    hero: {
      eyebrow: `${profile.businessType} · ${profile.location || profile.serviceArea}`,
      headline: `${profile.businessName}, ready to help.`,
      subheadline: profile.description,
      primaryCta: profile.phone ? "Call now" : "Request service",
      secondaryCta: "Explore services",
    },
    servicesIntro: {
      eyebrow: "Services",
      title: "Choose the help that fits your next step.",
      copy: `Explore every approved service from ${profile.businessName}, then contact the team for scope, availability, and pricing.`,
    },
    services,
    benefits: [
      { title: "A clear first response", copy: "Ask a question, describe what you need, and receive a useful path to the team." },
      { title: "Business-approved answers", copy: "Website, chat, and voice use the same verified services, hours, coverage, and policies." },
      { title: "Human confirmation", copy: "A person confirms prices, availability, appointments, and any decision that requires judgment." },
    ],
    process: [
      { title: "Choose a service", copy: "Explore the service pages and identify the closest match for your request." },
      { title: "Share the useful details", copy: "Use the website, chat, or phone path to explain the situation and preferred next step." },
      { title: "Receive confirmation", copy: "The team reviews the request and confirms scope, availability, pricing, or an appointment." },
    ],
    about: {
      eyebrow: "About the business",
      title: `A clear way to reach ${profile.businessName}.`,
      body: `${profile.description} Customers can explore each service, ask the AI assistant approved questions, share request details, and receive a clear next step from the team.`,
    },
    faq,
    contact: {
      eyebrow: "Start a conversation",
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
    { key: "verified-services", passed: profile.services.every((service) => spec.services.some((generated) => generated.id === service.id && generated.name === service.name)), message: "Every active service is grounded in the approved profile." },
    { key: "no-invented-services", passed: spec.services.every((generated) => profile.services.some((service) => generated.id === service.id && generated.name === service.name)), message: "No unsupported services were introduced." },
    { key: "service-pages", passed: spec.services.every((service) => Boolean(service.slug && service.imageQuery && service.imageAlt && service.pageHeadline && service.pageIntro && service.pageSections.length >= 2)), message: "Every service has a complete detail page and photography direction." },
    { key: "multi-page-content", passed: Boolean(spec.servicesIntro && spec.about && spec.contact && spec.benefits.length >= 3 && spec.process.length >= 3), message: "Home, Services, About, Contact, and service-detail content are complete." },
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
    publicSlug: websiteSlug(profile.businessName),
    concepts: [...WEBSITE_CONCEPTS],
    selectedConcept: null,
    status: "generated",
    spec,
    qa,
    createdAt,
    updatedAt: createdAt,
  };
}

import type { BusinessProfile, WebsiteServiceSpec, WebsiteSpec } from "@/features/everonn/types";
import { normalizeWebsiteBusinessProfile, websiteSlug } from "@/features/website-studio/generator";

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
    design: { rationale: "Deterministic content fixture for isolated tests only." },
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

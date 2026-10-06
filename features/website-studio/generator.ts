import type { BusinessProfile, QaCheck, WebsiteProject, WebsiteSpec } from "@/features/everonn/types";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import * as cssTree from "css-tree";

export const WEBSITE_CONCEPTS = ["editorial", "momentum", "aura"] as const;

const unsupportedClaimPattern = /\b(?:award[- ]winning|number one|#1|best in|certified|licensed|accredited|guaranteed|\d+\+?\s+years? of experience|\d+(?:\.\d+)?%\s+(?:success|satisfaction)|\d+\+?\s+(?:clients|customers|patients|students))\b/gi;

function clean(value: unknown, max = 1200) {
  return typeof value === "string" ? value.trim().replace(/\r\n?/g, "\n").slice(0, max) : "";
}

function copyStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return value && typeof value === "object" ? Object.values(value).flatMap(copyStrings) : [];
}

function customerWebsiteCopy(spec: WebsiteSpec) {
  const parts = copyStrings({
    seo: spec.seo, brand: spec.brand, hero: spec.hero, servicesIntro: spec.servicesIntro,
    services: spec.services.map(({ id, slug, imageQuery, ...copy }) => {
      void id; void slug; void imageQuery;
      return copy;
    }),
    benefits: spec.benefits, process: spec.process, about: spec.about, faq: spec.faq, contact: spec.contact,
    imageDescriptions: [spec.mediaPlan.heroAlt, spec.mediaPlan.storyAlt],
  });
  for (const concept of Object.values(spec.code?.concepts || {})) {
    for (const page of concept.pages) {
      parts.push(page.title, page.description);
      const pageText: string[] = [];
      const visit = (node: DefaultTreeAdapterMap["node"]) => {
        if ("value" in node) pageText.push(node.value);
        if ("attrs" in node) parts.push(...node.attrs.filter((attr) => ["alt", "title", "aria-label"].includes(attr.name)).map((attr) => attr.value));
        if ("childNodes" in node) node.childNodes.forEach(visit);
      };
      visit(parseFragment(page.html));
      parts.push(pageText.join(" "));
    }
    // CSS text can appear through content/custom properties; class names and design notes are not customer copy.
    const stylesheet = cssTree.parse(concept.css, { parseCustomProperty: true });
    cssTree.walk(stylesheet, { visit: "String", enter(node) { if (this.declaration) parts.push(node.value); } });
  }
  return parts.join("\n");
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

export function runWebsiteQa(spec: WebsiteSpec, input: BusinessProfile) {
  const profile = normalizeWebsiteBusinessProfile(input);
  const serialized = customerWebsiteCopy(spec);
  const source = JSON.stringify({ ...profile, knowledge: profile.knowledge.filter((item) => item.approved) }).toLowerCase();
  const claims = [...new Map((serialized.match(unsupportedClaimPattern) || []).map((claim) => [claim.toLowerCase(), claim])).values()].filter((claim) => !source.includes(claim.toLowerCase()));
  const checks: QaCheck[] = [
    { key: "business-verified", passed: profile.verified, message: profile.verified ? "The business profile is owner verified." : "Verify the business profile before publication." },
    { key: "verified-services", passed: profile.services.every((service) => spec.services.some((generated) => generated.id === service.id && generated.name === service.name)), message: "Every active service is grounded in the approved profile." },
    { key: "no-invented-services", passed: spec.services.every((generated) => profile.services.some((service) => generated.id === service.id && generated.name === service.name)), message: "No unsupported services were introduced." },
    { key: "unique-service-routes", passed: new Set(spec.services.map((service) => service.slug)).size === spec.services.length, message: "Every service has a unique page address." },
    { key: "service-pages", passed: spec.services.every((service) => Boolean(service.slug && service.imageQuery && service.imageAlt && service.pageHeadline && service.pageIntro && service.pageSections.length >= 2)), message: "Every service has a complete detail page and photography direction." },
    { key: "multi-page-content", passed: Boolean(spec.servicesIntro && spec.about && spec.contact && spec.benefits.length >= 3 && spec.process.length >= 3), message: "Home, Services, About, Contact, and service-detail content are complete." },
    { key: "no-placeholders", passed: !/(lorem ipsum|\btbd\b|insert |placeholder|coming soon)/i.test(serialized), message: "No placeholder copy is present." },
    { key: "no-unsupported-claims", passed: claims.length === 0, message: claims.length ? `Remove unsupported claims: ${claims.join(", ")}.` : "No unsupported credentials or performance claims are present." },
    { key: "complete-contact", passed: Boolean(spec.contact.title && spec.contact.copy && (profile.phone || profile.email)), message: "The website has a real customer contact path." },
    { key: "faq-depth", passed: spec.faq.length >= 4, message: "At least four grounded customer questions are included." },
    { key: "three-concepts", passed: WEBSITE_CONCEPTS.length === 3, message: "Editorial, Momentum, and Aura concepts are available." },
  ];
  if (spec.code) checks.push(
    { key: "generated-code", passed: WEBSITE_CONCEPTS.every((concept) => Boolean(spec.code?.concepts[concept]?.css && spec.code.concepts[concept].pages.length === spec.services.length + 4)), message: "Each design has its own generated stylesheet and complete page documents." },
  );
  return { passed: checks.every((check) => check.passed), checks, checkedAt: new Date().toISOString() };
}

export function createWebsiteProject(profile: BusinessProfile, spec: WebsiteSpec): WebsiteProject {
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

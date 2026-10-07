import type { DomainSkillId, ScopedMemory, SkillTrace, WebsiteDesign } from "@/features/agent-runtime/types";

export type WorkspaceRole = "owner" | "manager" | "agent" | "viewer";
export type Urgency = "low" | "normal" | "high";

export type BusinessService = {
  id: string;
  name: string;
  description: string;
  active: boolean;
};

export type KnowledgeItem = {
  id: string;
  category: "service" | "faq" | "policy" | "pricing" | "handoff";
  question: string;
  answer: string;
  approved: boolean;
  updatedAt: string;
};

export type BusinessProfile = {
  id: string;
  workspaceId: string;
  businessName: string;
  businessType: string;
  skillId?: DomainSkillId;
  domainSkillIds?: DomainSkillId[];
  description: string;
  phone: string;
  email: string;
  website: string;
  location: string;
  serviceArea: string;
  hours: string;
  services: BusinessService[];
  knowledge: KnowledgeItem[];
  greeting: string;
  assistantName: string;
  tone: "warm" | "professional" | "direct";
  emergencyRules: string;
  pricingRules: string;
  policies: string;
  transferNumber: string;
  timeZone: string;
  appointmentDurationMinutes: number;
  verified: boolean;
  updatedAt: string;
};

export type Contact = {
  id: string;
  workspaceId: string;
  name: string;
  phone: string;
  email: string;
  company?: string;
  lastContactAt: string;
};

export type TranscriptMessage = {
  id: string;
  role: "assistant" | "caller";
  text: string;
  at: string;
};

export type Lead = {
  id: string;
  workspaceId: string;
  contactId?: string;
  callerName: string;
  callerPhone: string;
  reason: string;
  source: "phone" | "chat" | "website";
  urgency: Urgency;
  status: "new" | "qualified" | "follow_up" | "closed";
  requestId?: string;
  updatedAt?: string;
  captureStatus?: "collecting" | "complete";
  appointmentRequest?: { serviceId: string; date: string; time: string };
  automation?: {
    appointmentStatus: "not_requested" | "needs_details" | "unavailable" | "confirmed" | "cancelled" | "failed";
    appointmentId?: string;
    googleEventId?: string;
    gmailStatus: "not_configured" | "pending" | "sent" | "failed" | "delivery_unknown";
    gmailMessageId?: string;
    gmailAttemptedAt?: string;
    message?: string;
    processedAt: string;
  };
  createdAt: string;
};

export type Conversation = {
  id: string;
  workspaceId: string;
  channel: "phone" | "chat" | "website";
  status: "open" | "completed" | "handoff";
  contactName: string;
  contactPhone: string;
  summary: string;
  urgency: Urgency;
  messages: TranscriptMessage[];
  createdAt: string;
};

export type Appointment = {
  id: string;
  workspaceId: string;
  contactName: string;
  contactPhone: string;
  service: string;
  date: string;
  time: string;
  status: "requested" | "confirmed" | "cancelled";
  provider: "manual" | "google";
  leadId?: string;
  contactEmail?: string;
  googleEventId?: string;
  googleEventUrl?: string;
  startsAt?: string;
  endsAt?: string;
  timeZone?: string;
  requestDetails?: string;
  createdAt: string;
};

export type QaCheck = { key: string; passed: boolean; message: string };

export type WebsiteServiceSpec = {
  id: string;
  slug: string;
  name: string;
  summary: string;
  details: string[];
  idealFor: string;
  ctaLabel: string;
  imageQuery: string;
  imageAlt: string;
  pageHeadline: string;
  pageIntro: string;
  pageSections: Array<{ title: string; copy: string }>;
};

export type WebsiteSpec = {
  schemaVersion: 1;
  design?: Pick<WebsiteDesign, "rationale">;
  code?: WebsiteCode;
  seo: { title: string; description: string };
  brand: { tagline: string; positioning: string };
  visualDirection: { primaryColor: string; accentColor: string; mood: string };
  mediaPlan: { heroQuery: string; galleryQuery: string; heroAlt: string; storyAlt: string };
  media: {
    hero: WebsiteMediaAsset | null;
    story: WebsiteMediaAsset | null;
    gallery: WebsiteMediaAsset[];
    services: Record<string, WebsiteMediaAsset>;
  };
  hero: { eyebrow: string; headline: string; subheadline: string; primaryCta: string; secondaryCta: string };
  servicesIntro: { eyebrow: string; title: string; copy: string };
  services: WebsiteServiceSpec[];
  benefits: Array<{ title: string; copy: string }>;
  process: Array<{ title: string; copy: string }>;
  about: { eyebrow: string; title: string; body: string };
  faq: Array<{ question: string; answer: string }>;
  contact: { eyebrow: string; title: string; copy: string; ctaLabel: string };
};

export type WebsiteMediaAsset = {
  id: string;
  url: string;
  alt: string;
  photographer: string;
  sourceUrl: string;
};

export type WebsiteCodePage = { path: string; title: string; description: string; html: string };
export type WebsiteCodeConcept = { name: string; rationale: string; css: string; pages: WebsiteCodePage[]; models?: string[] };
export type WebsiteCode = {
  schemaVersion: 1;
  concepts: Record<"editorial" | "momentum" | "aura", WebsiteCodeConcept>;
  validatedAt: string;
};

export type WebsiteRelease = {
  id: string;
  project: WebsiteProject;
  profile: BusinessProfile;
  publishedAt: string;
};

export type WebsiteProject = {
  id: string;
  workspaceId: string;
  privateToken: string;
  publicSlug: string;
  concepts: Array<"editorial" | "momentum" | "aura">;
  selectedConcept: "editorial" | "momentum" | "aura" | null;
  status: "draft" | "generated" | "claimed" | "verified" | "approved" | "published";
  profileSnapshot?: BusinessProfile;
  generation?: { provider: "gemini"; model: string; generatedAt: string; skills?: SkillTrace[] };
  spec: WebsiteSpec;
  qa: { passed: boolean; checks: QaCheck[]; checkedAt: string };
  createdAt: string;
  updatedAt: string;
};

export type IntegrationState = {
  gemini?: "not_configured" | "ready";
  googleCalendar: "disconnected" | "connected";
  gmail: "disconnected" | "connected";
  elevenLabs: "not_configured" | "ready";
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  status: "active" | "invited";
};

export type EverOnnWorkspace = {
  version: 1;
  workspaceId: string;
  profile: BusinessProfile;
  contacts: Contact[];
  leads: Lead[];
  conversations: Conversation[];
  appointments: Appointment[];
  websiteProject: WebsiteProject | null;
  publishedWebsite?: WebsiteRelease | null;
  websiteReleases?: WebsiteRelease[];
  integrations: IntegrationState;
  team: TeamMember[];
  aiMemory?: ScopedMemory[];
  websiteGeneration?: import("@/features/website-studio/job-types").WebsiteGenerationJob;
  automationLock?: { token: string; expiresAt: string };
};

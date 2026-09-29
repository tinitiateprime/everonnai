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
  createdAt: string;
};

export type QaCheck = { key: string; passed: boolean; message: string };

export type WebsiteSpec = {
  schemaVersion: 1;
  brand: { tagline: string; positioning: string };
  visualDirection: { primaryColor: string; accentColor: string; mood: string };
  mediaPlan: { heroQuery: string; galleryQuery: string };
  media: {
    hero: WebsiteMediaAsset | null;
    gallery: WebsiteMediaAsset[];
    services: Record<string, WebsiteMediaAsset>;
  };
  hero: { eyebrow: string; headline: string; subheadline: string; primaryCta: string };
  services: Array<{ id: string; name: string; summary: string; details: string[] }>;
  about: { title: string; body: string };
  faq: Array<{ question: string; answer: string }>;
  contact: { title: string; copy: string; ctaLabel: string };
};

export type WebsiteMediaAsset = {
  id: string;
  url: string;
  alt: string;
  photographer: string;
  sourceUrl: string;
};

export type WebsiteProject = {
  id: string;
  workspaceId: string;
  privateToken: string;
  publicSlug: string;
  concepts: Array<"editorial" | "momentum" | "aura">;
  selectedConcept: "editorial" | "momentum" | "aura" | null;
  status: "draft" | "generated" | "claimed" | "verified" | "approved" | "published";
  spec: WebsiteSpec;
  qa: { passed: boolean; checks: QaCheck[]; checkedAt: string };
  createdAt: string;
  updatedAt: string;
};

export type IntegrationState = {
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
  integrations: IntegrationState;
  team: TeamMember[];
};

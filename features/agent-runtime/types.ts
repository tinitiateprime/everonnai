export type DomainSkillId = "general" | "hvac";
export type AgentCapability = "assistant" | "appointment-booking" | "website-building";
export type WebsiteConcept = "editorial" | "momentum" | "aura";
export type HeroLayout = "split" | "immersive" | "centered";
export type ServiceLayout = "cards" | "editorial" | "featured";
export type WebsiteSection = "services" | "benefits" | "about" | "process" | "gallery" | "faq" | "contact";

export type WebsitePreferences = {
  brief: string;
  accepted: string[];
  rejected: string[];
  primaryColor: string;
  accentColor: string;
  heroLayout: "auto" | HeroLayout;
  serviceLayout: "auto" | ServiceLayout;
  typography: "auto" | "editorial" | "modern" | "technical";
  density: "auto" | "airy" | "compact";
  imagery: "auto" | "equipment" | "people" | "none";
  priorityServiceId: string;
  hiddenSections: WebsiteSection[];
};

export type ScopedMemory = {
  id: string;
  workspaceId: string;
  scope: "workspace" | "project";
  projectId?: string;
  capability: "website-building";
  key: "website-preferences";
  value: WebsitePreferences;
  requests: Array<{ text: string; at: string }>;
  source: "owner-settings";
  approved: true;
  updatedBy: string;
  revision: string;
  createdAt: string;
  updatedAt: string;
};

export type WebsiteDesign = {
  rationale: string;
  imagery?: "photography" | "none";
  typography: "editorial" | "modern" | "technical";
  density: "airy" | "compact";
  sectionOrder: WebsiteSection[];
  serviceOrder: string[];
  concepts: Record<WebsiteConcept, { hero: HeroLayout; services: ServiceLayout }>;
  sectionHeadings: Record<"process" | "gallery" | "faq", { eyebrow: string; title: string; copy: string }>;
};

export type SkillTrace = { id: string; version: string; digest: string };

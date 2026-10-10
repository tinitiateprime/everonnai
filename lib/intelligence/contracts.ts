import { z } from "zod";
import type { Coverage, Snapshot } from "../discovery/contracts";
export const intelligenceInput = z
  .object({ snapshotId: z.uuid(), requestKey: z.uuid() })
  .strict();
/** Owner correction to remember for later growth advice on this project. */
export const adviceCorrectionInput = z
  .object({
    body: z.string().trim().min(3, "Describe the correction.").max(2000),
    runId: z.uuid().optional(),
  })
  .strict();
/** Regenerate growth advice for a sealed report with the current corrections. */
export const adviceRevisionInput = z.object({ requestKey: z.uuid() }).strict();
export const intelligenceVersion = "site-intelligence-v1";
export type Reference = {
  id: string;
  captureId: string;
  url: string;
  locator: string;
  observation: string;
  kind: "captured_html" | "browser" | "stylesheet" | "inventory";
};
export type Finding = {
  id: string;
  rule: string;
  area:
    | "coverage"
    | "seo"
    | "ux"
    | "accessibility"
    | "features"
    | "design"
    | "performance"
    | "content";
  priority: "P0" | "P1" | "P2" | "P3";
  kind: "observed" | "measured" | "inferred" | "design_judgment";
  title: string;
  detail: string;
  evidenceIds: string[];
  action: string;
  acceptance: string[];
};
export type Feature = {
  id: string;
  kind: string;
  label: string;
  locator: string;
  confidence: "observed" | "inferred";
  backend: "not_tested" | "not_applicable";
  evidenceIds: string[];
  details: Record<string, string | number | boolean | string[]>;
};
export type SourceAsset = {
  kind:
    | "image"
    | "font"
    | "stylesheet"
    | "script"
    | "video"
    | "audio"
    | "iframe"
    | "download";
  url: string;
  locator: string;
  alt: string | null;
  details: Record<string, string | number | boolean>;
};
export type Token = {
  kind:
    | "color"
    | "font"
    | "font_size"
    | "spacing"
    | "radius"
    | "shadow"
    | "breakpoint"
    | "custom_property"
    | "layout";
  name: string;
  value: string;
  count: number;
  origin: string;
};
export type PageInventory = {
  url: string;
  title: string;
  description: string;
  language: string;
  canonical: string | null;
  robots: string;
  viewport: string;
  headings: { level: number; text: string; locator: string }[];
  links: {
    url: string;
    text: string;
    locator: string;
    rel: string;
    internal: boolean;
    fragment: string | null;
  }[];
  anchors: string[];
  sections: {
    kind: string;
    heading: string;
    text: string;
    locator: string;
    wordCount: number;
  }[];
  businessData: {
    emails: string[];
    phones: string[];
    addresses: string[];
    prices: string[];
    structuredFacts: { path: string; value: string }[];
  };
  forms: {
    locator: string;
    label: string;
    method: string;
    action: string;
    fields: {
      tag: string;
      type: string;
      name: string;
      label: string;
      required: boolean;
      options: string[];
      autocomplete: string;
      pattern: string;
    }[];
    submitLabels: string[];
  }[];
  features: Feature[];
  assets: SourceAsset[];
  structuredData: {
    types: string[];
    value: unknown;
    valid: boolean;
    locator: string;
  }[];
  technology: { name: string; evidence: string }[];
  tokens: Token[];
  counts: {
    elements: number;
    links: number;
    images: number;
    forms: number;
    headings: number;
    sections: number;
    words: number;
  };
  limits: string[];
};
export type ResourceObservation = {
  url: string;
  type: string;
  status: number | null;
  byteSize: number;
  sha256: string | null;
  capturedAt: string;
  outcome: "loaded" | "http_error" | "blocked" | "unavailable";
  reason: string | null;
  objectId?: string;
};
export type BrowserObservation = {
  status: "observed" | "inconclusive";
  environment: "guarded_snapshot_replay";
  browserVersion: string | null;
  axeVersion: string | null;
  startedAt: string;
  endedAt: string;
  viewports: {
    width: number;
    overflowPixels: number;
    visibleControls: number;
    smallControls: number;
    hiddenContent: boolean;
    fonts: string[];
    colors: string[];
    tokens: Token[];
    screenshotObjectId?: string;
  }[];
  interactions: {
    locator: string;
    kind: string;
    outcome: "revealed" | "unchanged" | "unavailable";
    detail: string;
  }[];
  resources: ResourceObservation[];
  accessibility: {
    rule: string;
    impact: string;
    description: string;
    helpUrl: string;
    targets: string[];
    inconclusive: boolean;
  }[];
  performance: {
    domContentLoadedMs: number | null;
    loadMs: number | null;
    lcpMs: number | null;
    cls: number | null;
    requestCount: number;
    downloadedBytes: number;
    profile: string;
  };
  runtimeErrors: number;
  renderedTextSha256: string | null;
  matchesCapturedText: boolean | null;
  limitations: string[];
};
export type PageAssessment = {
  version: 1;
  captureId: string;
  sourceSha256: string;
  textSha256: string;
  assessedAt: string;
  inventory: PageInventory;
  renderedInventory?: PageInventory;
  browser: BrowserObservation;
  references: Reference[];
  findings: Finding[];
};
export type IntelligenceRun = {
  id: string;
  snapshotId: string;
  snapshotSha256: string;
  requestKey: string;
  status: "queued" | "running" | "paused" | "complete" | "partial" | "failed";
  stage: number;
  leaseToken: number;
  leaseActive: boolean;
  processedPages: number;
  requiredPages: number;
  browserPages: number;
  reportObjectId: string | null;
  reportSha256: string | null;
  error: string | null;
  createdAt: string;
  config: {
    version: string;
    mode: "live" | "fixture";
    provider: string | null;
    model: string | null;
    viewports: number[];
    batchPages: number;
    maxRequests: number;
    maxNetworkBytes: number;
    pageSeconds: number;
    fullFeatureBackendTests: false;
  };
};
export type Advice = {
  status: "available" | "inconclusive" | "not_configured";
  model: string | null;
  usage?: unknown;
  summary: string;
  recommendations: {
    title: string;
    why: string;
    priority: "P0" | "P1" | "P2" | "P3";
    evidenceIds: string[];
    acceptance: string[];
  }[];
  /**
   * Plain-language growth advice from the site-growth-advisor skill. Optional so
   * reports sealed before this field existed remain valid.
   */
  growth?: GrowthAdvice;
  limitations: string[];
};
export type GrowthAdvice = {
  /** Free text: what the website lacks to attract customers. */
  customerGaps: string;
  /** Free text: how the EverOnn agent will enhance the website. */
  enhancementPlan: string;
  /** Plain prompt the agent will work from; owner-editable. */
  agentPrompt: string;
  evidenceIds: string[];
  /** Owner corrections (advice memory) the model reported applying. */
  appliedCorrectionIds: string[];
};
/** Owner correction remembered for later advice on this project. */
export type AdviceCorrection = {
  id: string;
  runId: string | null;
  body: string;
  createdAt: string;
  withdrawnAt: string | null;
};
/** Immutable advice regenerated from a sealed report with the current corrections. */
export type AdviceRevision = {
  id: string;
  runId: string;
  requestKey: string;
  reportSha256: string;
  correctionIds: string[];
  status: Advice["status"];
  model: string | null;
  objectId: string;
  objectSha256: string;
  createdAt: string;
};
export type IntelligenceReport = {
  version: 1;
  runId: string;
  snapshotId: string;
  snapshotSha256: string;
  createdAt: string;
  mode: "live" | "fixture";
  assessmentVersion: string;
  status: "complete_within_scope" | "partial";
  source: Pick<Snapshot, "captureStartedAt" | "captureEndedAt" | "scope">;
  coverage: Coverage & {
    assessed: number;
    browserAssessed: number;
    assessmentGaps: string[];
  };
  summary: {
    pages: number;
    features: number;
    assets: number;
    findings: number;
    priorities: Record<string, number>;
    families: Record<string, number>;
    overview: string;
  };
  pages: {
    captureId: string;
    url: string;
    title: string;
    family: string;
    counts: PageInventory["counts"];
    featureKinds: string[];
    browserStatus: string;
    findingIds: string[];
    limits: string[];
  }[];
  features: (Feature & { captureId: string; url: string })[];
  assets: (SourceAsset & { pages: string[] })[];
  designSystem: {
    tokens: (Token & { pageUrls: string[] })[];
    components: { kind: string; pages: string[]; count: number }[];
    observedPages: number;
    stylesheets: number;
    limitations: string[];
  };
  navigation: {
    edges: { from: string; to: string; text: string }[];
    unreachable: string[];
    unassessedTargets: string[];
    excludedTargets: string[];
    complete: boolean;
  };
  findings: Finding[];
  references: Reference[];
  actionPlan: {
    priority: string;
    title: string;
    why: string;
    findingIds: string[];
    acceptance: string[];
  }[];
  advice: Advice;
  limitations: string[];
  methodology: {
    rulesVersion: string;
    browserEnvironment: string;
    viewports: number[];
    sources: { name: string; url: string }[];
  };
};

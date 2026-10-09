import { z } from "zod";

const optionalText = z.string().trim().max(3000).default("");
export const knowledgeSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Add a business description.")
    .max(20000),
  businessName: z.string().trim().min(1, "Add a business name.").max(3000),
  businessType: z.string().trim().min(1, "Add a business type.").max(3000),
  industry: optionalText,
  websiteUrl: z.string().trim().max(2048).default(""),
  phone: optionalText,
  email: z.union([z.literal(""), z.email()]).default(""),
  location: optionalText,
  serviceArea: optionalText,
  hours: optionalText,
  additionalDetails: z.string().trim().max(15000).default(""),
  services: z
    .array(z.object({ name: optionalText, description: optionalText }))
    .max(50)
    .default([]),
});
// Incomplete drafts remain editable; only submitted generation knowledge must be complete.
export const knowledgeDraftSchema = knowledgeSchema.extend({
  description: z.string().max(20000).default(""),
  businessName: optionalText,
  businessType: optionalText,
  email: z.string().max(320).default(""),
});
export type Knowledge = z.infer<typeof knowledgeSchema>;
export const emptyKnowledge: Knowledge = {
  description: "",
  businessName: "",
  businessType: "",
  industry: "",
  websiteUrl: "",
  phone: "",
  email: "",
  location: "",
  serviceArea: "",
  hours: "",
  additionalDetails: "",
  services: [],
};
export type SourcePage = {
  url: string;
  title: string;
  description: string;
  text: string;
  truncated: boolean;
  headings: string[];
  links: string[];
  phones: string[];
  emails: string[];
  images: { url: string; alt: string }[];
  structuredData: unknown[];
  design: {
    colors: string[];
    fonts: string[];
    css: string;
    stylesheets: string[];
  };
};
export type Discovery = {
  inputUrl: string;
  origin: string;
  pages: SourcePage[];
  skipped: { url: string; reason: string }[];
  warnings: string[];
  discovered: number;
  complete: boolean;
  crawledAt: string;
  crawl?: {
    id: string;
    revision: string;
    pageLimit: number;
    remaining: number;
    canContinue: boolean;
    canExtend: boolean;
    status: "paused" | "complete" | "limit";
  };
};
export type CrawlState = {
  id: string;
  result: Discovery;
  root: string;
  robotsText: string;
  queue: string[];
  seen: string[];
};
export const directionSchema = z.object({
  name: z.string().min(1).max(100),
  concept: z.string().min(10).max(2500),
  palette: z.array(z.string().max(100)).min(3).max(8),
  typography: z.string().min(1).max(500),
  composition: z.string().min(10).max(2000),
  imageQueries: z.array(z.string().trim().min(3).max(160)).max(2).default([]),
});
export type Direction = z.infer<typeof directionSchema>;
export type PhotoAsset = {
  id: number;
  url: string;
  alt: string;
  width: number;
  height: number;
  photographer: string;
  photographerUrl: string;
  sourceUrl: string;
};
export type MediaBundle = { photos: PhotoAsset[]; warnings: string[] };
export type DesignPlan = {
  directions: Direction[];
  model: string;
  media?: MediaBundle[];
  sourceSnapshotId?: string;
};
export type Artifact = {
  id: string;
  index: number;
  name: string;
  rationale: string;
  html: string;
  path?: string;
  model: string;
  createdAt: string;
  warnings: string[];
  direction?: Direction;
  photos?: PhotoAsset[];
  edits?: { prompt: string; createdAt: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};
export type Model = {
  id: string;
  name: string;
  context_length: number;
  description: string;
  supported_parameters: string[];
  top_provider?: { max_completion_tokens?: number };
  pricing: { prompt: string; completion: string };
  architecture?: { output_modalities?: string[] };
  reasoning?: {
    supported_efforts?: string[] | null;
    mandatory?: boolean;
    supports_max_tokens?: boolean;
    default_enabled?: boolean;
  };
};

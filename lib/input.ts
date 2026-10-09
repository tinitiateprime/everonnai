import { z } from "zod";
import { directionSchema, knowledgeSchema } from "./types";
import { MAX_CRAWL_PAGES, MAX_CRAWL_URLS } from "./crawl-limits";
// Browser persistence is untrusted. Bound and validate imported discoveries/artifacts.
const pageSchema = z.object({
  url: z.string().max(2048),
  title: z.string().max(2000),
  description: z.string().max(6000),
  text: z.string().max(12000),
  truncated: z.boolean(),
  headings: z.array(z.string().max(4000)).max(60),
  links: z.array(z.string().max(2048)).max(2000),
  phones: z.array(z.string().max(200)).max(25),
  emails: z.array(z.string().max(320)).max(25),
  images: z
    .array(z.object({ url: z.string().max(2048), alt: z.string().max(2000) }))
    .max(31),
  structuredData: z.array(z.unknown()).max(10),
  design: z.object({
    colors: z.array(z.string().max(180)).max(100),
    fonts: z.array(z.string().max(500)).max(50),
    css: z.string().max(10000),
    stylesheets: z.array(z.string().max(2048)).max(8),
  }),
});
export const discoverySchema = z.object({
  inputUrl: z.string().max(2048),
  origin: z.string().max(2048),
  pages: z.array(pageSchema).max(MAX_CRAWL_PAGES),
  skipped: z
    .array(
      z.object({ url: z.string().max(2048), reason: z.string().max(2000) }),
    )
    .max(MAX_CRAWL_PAGES * 3),
  warnings: z.array(z.string().max(3000)).max(MAX_CRAWL_PAGES + 20),
  discovered: z
    .number()
    .int()
    .min(0)
    .max(MAX_CRAWL_URLS + MAX_CRAWL_PAGES * 3),
  complete: z.boolean(),
  crawledAt: z.string().max(100),
  crawl: z
    .object({
      id: z.uuid(),
      revision: z.uuid(),
      pageLimit: z.number().int().min(1).max(MAX_CRAWL_PAGES),
      remaining: z.number().int().min(0).max(MAX_CRAWL_URLS),
      canContinue: z.boolean(),
      canExtend: z.boolean(),
      status: z.enum(["paused", "complete", "limit"]),
    })
    .optional(),
});
export const planInput = z.object({
  knowledge: knowledgeSchema,
  discovery: discoverySchema.nullable().default(null),
  discoveryId: z.uuid().optional(),
  sourceSnapshotId: z.uuid().optional(),
});
const artifactSchema = z.object({
  id: z.string(),
  index: z.number().int().min(0).max(2),
  name: z.string().max(100),
  rationale: z.string().max(5000),
  html: z.string().max(350000),
  model: z.string().max(200),
  createdAt: z.string(),
  warnings: z.array(z.string()).max(30),
});
export const generationInput = planInput.extend({
  direction: directionSchema,
  index: z.number().int().min(0).max(2),
  previous: z.array(artifactSchema).max(2).default([]),
  model: z.string().max(200).optional(),
  photoIds: z
    .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
    .max(8)
    .default([]),
});
export const refinementInput = z.object({
  business: z.string().min(1).max(100),
  version: z.enum(["1", "2", "3"]),
  revision: z.string().min(1).max(100),
  prompt: z.string().trim().min(3, "Describe the change you want.").max(6000),
  model: z.string().max(200).optional(),
});

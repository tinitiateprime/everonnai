import { z } from "zod";
export const factSchema = z.object({
  id: z.uuid(),
  key: z.string().max(80),
  label: z.string().max(150),
  value: z.string().max(4000),
  required: z.boolean(),
  verification: z.enum([
    "source_supported",
    "owner_confirmed",
    "conflict",
    "unknown",
  ]),
  candidates: z.array(z.string().max(4000)).max(100),
  evidence: z
    .array(
      z.object({
        captureId: z.uuid(),
        locator: z.string().max(100),
        value: z.string().max(4000),
      }),
    )
    .max(100),
});
export const factsDocumentSchema = z.object({
  version: z.literal(1),
  snapshotId: z.uuid(),
  facts: z.array(factSchema).max(50),
});
export const approveFactsInput = z
  .object({
    decisions: z
      .array(
        z
          .object({
            id: z.uuid(),
            value: z.string().trim().max(4000),
            decision: z.enum(["confirm", "omit"]),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type Fact = z.infer<typeof factSchema>;
export type FactSet = {
  id: string;
  snapshotId: string;
  version: number;
  status: "draft" | "approved";
  documentObjectId: string;
  contentSha256: string;
  createdAt: string;
};
export const pagePath = z
  .string()
  .max(400)
  .regex(
    /^\/(?:[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}(?:\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79})*)?$/,
  )
  .refine(
    (path) => !/^\/(api|_next|404)(\/|$)/.test(path),
    "Use a public website path.",
  );
export const blueprintPageSchema = z.object({
  id: z.uuid(),
  sourceUrl: z.string().max(2048),
  path: pagePath,
  title: z.string().min(1).max(2000),
  family: z.enum([
    "home",
    "about",
    "service",
    "contact",
    "article",
    "policy",
    "content",
  ]),
  outcome: z.enum(["render", "redirect", "exclude", "unresolved"]),
  target: pagePath.nullable(),
  reason: z.string().max(2000),
  contentObjectId: z.uuid().nullable(),
  contentSha256: z.string().nullable(),
  captureIds: z.array(z.uuid()).max(10),
});
export const blueprintDocumentSchema = z.object({
  version: z.literal(1),
  snapshotId: z.uuid(),
  factSetId: z.uuid(),
  pages: z.array(blueprintPageSchema).max(18000),
  features: z
    .array(
      z.object({
        key: z.literal("enquiry"),
        version: z.literal("1.0.0"),
        mode: z.literal("preview_local"),
        required: z.literal(true),
      }),
    )
    .length(1),
});
export const approveBlueprintInput = z
  .object({
    pages: z
      .array(
        z
          .object({
            id: z.uuid(),
            path: pagePath,
            title: z.string().trim().min(1).max(2000).optional(),
            outcome: z.enum(["render", "redirect", "exclude"]),
            target: pagePath.nullable(),
            reason: z.string().trim().max(2000),
          })
          .strict(),
      )
      .max(18000),
  })
  .strict();
export type BlueprintPage = z.infer<typeof blueprintPageSchema>;
export type BlueprintDocument = z.infer<typeof blueprintDocumentSchema>;
export type Blueprint = {
  id: string;
  snapshotId: string;
  factSetId: string;
  version: number;
  status: "draft" | "approved";
  documentObjectId: string;
  contentSha256: string;
  createdAt: string;
};

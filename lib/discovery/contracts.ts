import { z } from "zod";
import { discoverySchema } from "../input";
import { MAX_CRAWL_PAGES, MAX_CRAWL_URLS } from "../crawl-limits";

export const startScanInput = z.object({ requestKey: z.uuid() }).strict();
export const batchInput = z
  .object({
    extend: z.boolean().default(false),
    retrySkipped: z.boolean().default(false),
  })
  .strict();
export const freezeInput = z
  .object({ allowIncomplete: z.boolean().default(false) })
  .strict();
export const cursorSchema = z.object({
  id: z.uuid(),
  result: discoverySchema,
  root: z.string().max(2048),
  robotsText: z.string().max(2_000_000),
  queue: z.array(z.string().max(2048)).max(MAX_CRAWL_URLS),
  seen: z.array(z.string().max(2048)).max(MAX_CRAWL_PAGES * 3),
});
export type Coverage = {
  captured: number;
  pending: number;
  skipped: number;
  discovered: number;
  complete: boolean;
  warnings: string[];
  canContinue: boolean;
  canExtend: boolean;
};
export type Scan = {
  id: string;
  inputUrl: string;
  status: "running" | "paused" | "limit" | "complete" | "failed";
  pageLimit: number;
  revision: number;
  leaseToken: number;
  leaseExpiresAt: string | null;
  leaseActive: boolean;
  pauseRequested: boolean;
  checkpointObjectId: string | null;
  coverage: Partial<Coverage>;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  config: {
    maxPages: number;
    batchPages: number;
    batchMs: number;
    concurrency: number;
    evidenceMode: "live" | "fixture";
    extractorVersion: string;
  };
  jobId: string;
  pipelineRunId: string;
};
export type Capture = {
  id: string;
  normalizedUrl: string;
  finalUrl: string;
  httpStatus: number;
  captureStartedAt: string;
  capturedAt: string;
  renderedAt: string | null;
  rawSha256: string;
  textSha256: string;
  rawObjectId: string;
  evidenceObjectId: string;
  summary: z.infer<typeof discoverySchema>["pages"][number];
};
export type Snapshot = {
  id: string;
  crawlRunId: string;
  crawlRevision: number;
  manifestObjectId: string;
  manifestSha256: string;
  coverage: Coverage;
  scope: {
    inputUrl: string;
    pageLimit: number;
    evidenceMode: "live" | "fixture";
    limitations: string[];
    extractorVersion: string;
  };
  captureStartedAt: string;
  captureEndedAt: string;
  createdAt: string;
};
export type InventoryPage = {
  url: string;
  outcome: "captured" | "skipped" | "pending";
  captureId: string | null;
  title?: string;
  reason?: string;
  capturedAt?: string;
  rawSha256?: string;
  textSha256?: string;
};

import { z } from "zod";
import type { Build, BuildVerification } from "./contracts";
import type { Snapshot } from "../discovery/contracts";
export const reviewInput = z
  .object({
    requestKey: z.uuid(),
    sealSha256: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(["approved", "changes_requested"]),
    notes: z.string().trim().min(10).max(5000),
    checklist: z
      .object({
        brandAndLayout: z.boolean(),
        contentAndFacts: z.boolean(),
        mobileAndKeyboard: z.boolean(),
        featuresAndLimitations: z.boolean(),
        distinctAlternatives: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type BuildReview = z.infer<typeof reviewInput> & {
  id: string;
  buildId: string;
  reviewerId: string;
  createdAt: string;
};
export type ReportClaim = {
  key: string;
  kind: "measured" | "observed" | "design_judgment" | "predicted";
  outcome: "verified" | "blocked" | "unassessed";
  statement: string;
  evidence: string[];
  limitations: string[];
};
export type BuildReport = {
  version: 1;
  evaluationSha256: string;
  buildId: string;
  sealSha256: string;
  inputs: Build["inputs"];
  previewVerified: boolean;
  humanReviewApproved: boolean;
  publication: "not_configured";
  source: Pick<
    Snapshot,
    | "id"
    | "manifestSha256"
    | "coverage"
    | "scope"
    | "captureStartedAt"
    | "captureEndedAt"
  >;
  coverage: {
    requiredPages: number;
    exportedPages: number;
    approvedRedirects: number;
    explicitExclusions: number;
    unresolvedPages: number;
  };
  verification: BuildVerification | null;
  latestReview: BuildReview | null;
  claims: ReportClaim[];
  limitations: string[];
};

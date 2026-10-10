import { z } from "zod";
export const startBuildInput = z
  .object({
    blueprintId: z.uuid(),
    alternativeId: z.uuid(),
    requestKey: z.uuid(),
  })
  .strict();
export const enquiryInput = z
  .object({
    requestKey: z.uuid(),
    name: z.string().trim().min(1).max(120),
    email: z.email().max(320),
    message: z.string().trim().min(5).max(5000),
  })
  .strict();
export type Build = {
  id: string;
  alternativeId: string;
  blueprintId: string;
  revision: number;
  status:
    | "queued"
    | "designing"
    | "designed"
    | "compiling"
    | "compiled"
    | "verifying"
    | "ready"
    | "failed";
  stage: number;
  leaseToken: number;
  leaseActive: boolean;
  designObjectId: string | null;
  manifestObjectId: string | null;
  sealSha256: string | null;
  error: string | null;
  createdAt: string;
  inputs: {
    snapshotId: string;
    snapshotSha256: string;
    factSetId: string;
    factSetSha256: string;
    blueprintId: string;
    blueprintSha256: string;
    configSha256: string;
    generation: {
      provider: string;
      preferredModel: string;
      nextVersion: string;
      nodeVersion: string;
      instructionVersion: string;
      featureVersion: string;
      /** SHA-256 of the website-designer SKILL.md (context-theme builds onward). */
      designSkillSha256?: string;
    };
    mode: "live" | "fixture";
    /**
     * Owner improvement brief fixed when the build started (context-theme builds
     * onward): growth-advice agent prompt and gaps with their source report/revision,
     * and the owner's active corrections.
     */
    guidance?: {
      source: {
        runId: string;
        reportSha256: string;
        adviceRevisionId: string | null;
      } | null;
      agentPrompt: string | null;
      customerGaps: string | null;
      corrections: { id: string; body: string }[];
    };
  };
};
export type BuildManifest = {
  version: 1;
  buildId: string;
  inputs: Build["inputs"];
  design: {
    model: string;
    usage: unknown;
    mode: "live" | "fixture";
    sha256: string;
  };
  routes: {
    path: string;
    pageId: string;
    contentSha256: string;
    family: string;
  }[];
  redirects: { path: string; target: string }[];
  files: { path: string; objectId: string; sha256: string; byteSize: number }[];
  sourceArchiveId: string;
  outputArchiveId: string;
  dependencyLockSha256: string;
  nextVersion: string;
};
export type BuildVerification = {
  suiteVersion?: string;
  environment?: "isolated_local_preview";
  passed: boolean;
  buildId: string;
  sealSha256: string;
  checks: {
    key: string;
    outcome: "pass" | "fail" | "inconclusive";
    details: string;
  }[];
  browserVersion: string | null;
  testedAt: string;
  mode: "live" | "fixture";
};

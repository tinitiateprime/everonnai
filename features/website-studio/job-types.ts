import type { BusinessProfile, WebsiteCodeConcept, WebsiteSpec } from "@/features/everonn/types";
import type { ScopedMemory, SkillTrace, WebsiteConcept } from "@/features/agent-runtime/types";
import type { WebsiteGenerationProgress } from "./progress";
import type { WebsiteCodeAttempt } from "./code-generator";

export type WebsiteJobStatus = {
  id: string;
  status: "running" | "failed" | "completed";
  progress: WebsiteGenerationProgress;
  canResume: boolean;
  retryAfterMs?: number;
  error?: string;
};

export type WebsiteGenerationJob = {
  version: 1;
  id: string;
  workspaceId: string;
  status: WebsiteJobStatus["status"];
  createdAt: string;
  updatedAt: string;
  progress: WebsiteGenerationProgress;
  error?: string;
  lease?: { token: string; expiresAt: string };
  completedProjectId?: string;
  checkpoint?: {
    profile: BusinessProfile;
    memory?: ScopedMemory[];
    fingerprint: string;
    models: string[];
    contentAttempt: { modelIndex: number; validationAttempt: number; generated?: unknown; feedback?: string };
    spec?: WebsiteSpec;
    contentModel?: string;
    skills?: SkillTrace[];
    designs: Partial<Record<WebsiteConcept, WebsiteCodeConcept>>;
    codeAttempt?: WebsiteCodeAttempt;
    conceptIndex: number;
    mediaWarning?: string | null;
  };
};

export function assertWebsiteJobScope(job: WebsiteGenerationJob | undefined, workspaceId: string) {
  if (!job) return;
  if (job.version !== 1 || job.workspaceId !== workspaceId || !/^[a-f0-9-]{36}$/i.test(job.id)
    || !["running", "failed", "completed"].includes(job.status)
    || !["content", "media", "code", "saving"].includes(job.progress?.stage)
    || (job.status !== "completed" && !job.checkpoint)
    || (job.checkpoint && (job.checkpoint.profile.workspaceId !== workspaceId || !Array.isArray(job.checkpoint.models)
      || !job.checkpoint.models.length || job.checkpoint.models.length > 5
      || job.checkpoint.models.some((model) => !/^[a-z0-9_.-]{1,100}$/i.test(model))
      || !Number.isInteger(job.checkpoint.conceptIndex) || job.checkpoint.conceptIndex < 0 || job.checkpoint.conceptIndex > 3))
    || (job.lease && (!job.lease.token || !Number.isFinite(Date.parse(job.lease.expiresAt))))) {
    throw new Error("Invalid website generation checkpoint or workspace scope.");
  }
}

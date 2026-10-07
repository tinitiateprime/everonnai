import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { EverOnnWorkspace, WorkspaceRole } from "@/features/everonn/types";
import { authorizeWorkspaceAction } from "@/features/auth/rbac";
import { resolvedWebsitePreferences, validateMemoryScope } from "@/features/agent-runtime/memory";
import { readWorkspaceJson, updateWorkspaceJson, findWorkspaceJson } from "@/lib/json-workspace-store";
import { getGeminiWebsiteConfig } from "@/lib/provider-config";
import { requestWebsiteContent, validateWebsiteContent } from "./ai-generator";
import { generateWebsiteCodeStep, generateWebsiteDesignStep, WebsiteCodeRetry } from "./code-generator";
import { normalizeWebsiteCodeConcept, websitePaths } from "./code-validation";
import { createWebsiteProject, normalizeWebsiteBusinessProfile, runWebsiteQa, WEBSITE_CONCEPTS } from "./generator";
import { resolveWebsiteMedia } from "./media";
import { liveWebsite } from "./site-access";
import { assertWebsiteJobScope, type WebsiteGenerationJob, type WebsiteJobStatus } from "./job-types";
import type { WebsiteGenerationResult } from "./progress";

// One chargeable AI call per request. No work is launched after returning the HTTP response.
export const WEBSITE_STEP_TIMEOUT_MS = 20_000;
const LEASE_MS = 60_000;
type Actor = { workspaceId: string; role: WorkspaceRole };
export type WebsiteJobStore = {
  read: (workspaceId: string) => Promise<EverOnnWorkspace>;
  update: (workspaceId: string, change: (workspace: EverOnnWorkspace) => EverOnnWorkspace) => Promise<EverOnnWorkspace>;
  slugUsed: (slug: string, workspaceId: string) => Promise<boolean>;
};
type Options = { store?: WebsiteJobStore; config?: ReturnType<typeof getGeminiWebsiteConfig>; fetchImpl?: typeof fetch; mediaApiKey?: string; now?: () => Date };
const defaultStore: WebsiteJobStore = {
  read: readWorkspaceJson,
  update: (id, change) => updateWorkspaceJson(change, id),
  slugUsed: async (slug, id) => Boolean(await findWorkspaceJson((workspace) => workspace.workspaceId !== id && (workspace.websiteProject?.publicSlug === slug || liveWebsite(workspace)?.publicSlug === slug))),
};
function fingerprint(workspace: EverOnnWorkspace) {
  return createHash("sha256").update(JSON.stringify([workspace.profile, workspace.aiMemory, workspace.websiteProject])).digest("hex");
}
function message(error: unknown) {
  let value = error instanceof Error ? error.message : "Website generation could not complete.";
  for (const key of [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY, process.env.PEXELS_API_KEY]) if (key) value = value.replaceAll(key, "[redacted]");
  return value.slice(0, 2000);
}
function getJob(workspace: EverOnnWorkspace, id?: string) {
  const job = workspace.websiteGeneration;
  assertWebsiteJobScope(job, workspace.workspaceId);
  if (id && job?.id !== id) throw Object.assign(new Error("This website build was replaced. Refresh Website Studio to continue."), { status: 409 });
  return job;
}
function publicResult(workspace: EverOnnWorkspace): WebsiteGenerationResult {
  const saved = getJob(workspace);
  if (!saved) return {};
  const job: WebsiteJobStatus = {
    id: saved.id, status: saved.status, progress: saved.progress,
    canResume: Boolean(saved.checkpoint && saved.checkpoint.fingerprint === fingerprint(workspace)),
    ...(saved.lease ? { retryAfterMs: 1000 } : {}), ...(saved.error ? { error: saved.error } : {}),
  };
  const project = workspace.websiteProject;
  return { job, ...(saved.status === "completed" && project && project.id === saved.completedProjectId
    ? { project, generatedBy: "gemini", model: project.generation?.model } : {}) };
}
class BusyStep extends Error {}

export function createWebsiteJobRunner(options: Options = {}) {
  const store = options.store || defaultStore;
  const now = options.now || (() => new Date());
  async function read(actor: Actor, id?: string) {
    const workspace = await store.read(actor.workspaceId);
    authorizeWorkspaceAction(actor, workspace, "website:publish");
    getJob(workspace, id);
    return workspace;
  }
  return {
    async status(actor: Actor, id?: string) { return publicResult(await read(actor, id)); },
    async start(actor: Actor) {
      const config = options.config || getGeminiWebsiteConfig();
      if (!config.apiKey) throw Object.assign(new Error("Configure Gemini before generating a website."), { status: 503 });
      const workspace = await store.update(actor.workspaceId, (current) => {
        authorizeWorkspaceAction(actor, current, "website:publish");
        const existing = getJob(current);
        const signature = fingerprint(current);
        if (existing?.status === "running" && existing.checkpoint?.fingerprint === signature) return current;
        if (current.profile.services.filter((service) => service.active).length > 16) throw new Error("Split catalogues larger than 16 active services before generating.");
        validateMemoryScope(current.aiMemory, current.workspaceId);
        const timestamp = now().toISOString();
        const job: WebsiteGenerationJob = {
          version: 1, id: randomUUID(), workspaceId: current.workspaceId, status: "running", createdAt: timestamp, updatedAt: timestamp,
          progress: { stage: "content", message: "Planning website content from your saved business knowledge." },
          checkpoint: { profile: structuredClone(current.profile), memory: structuredClone(current.aiMemory), fingerprint: signature,
            models: config.models, contentAttempt: { modelIndex: 0, validationAttempt: 0 }, designs: {}, conceptIndex: 0 },
        };
        assertWebsiteJobScope(job, current.workspaceId);
        return { ...current, websiteGeneration: job };
      });
      return publicResult(workspace);
    },
    async resume(actor: Actor, id: string) {
      const workspace = await store.update(actor.workspaceId, (current) => {
        authorizeWorkspaceAction(actor, current, "website:publish");
        const job = getJob(current, id)!;
        if (job.status !== "failed") return current;
        if (!job.checkpoint || job.checkpoint.fingerprint !== fingerprint(current)) throw Object.assign(new Error("Business information changed. Start a new website build using the latest facts."), { status: 409 });
        return { ...current, websiteGeneration: { ...job, status: "running", error: undefined, lease: undefined, updatedAt: now().toISOString(),
          checkpoint: { ...job.checkpoint, contentAttempt: { modelIndex: 0, validationAttempt: 0 }, codeAttempt: undefined } } };
      });
      return publicResult(workspace);
    },
    async advance(actor: Actor, id: string) {
      const initial = await read(actor, id);
      if (initial.websiteGeneration!.status !== "running") return publicResult(initial);
      const token = randomUUID();
      let claimed: EverOnnWorkspace;
      try {
        claimed = await store.update(actor.workspaceId, (current) => {
          authorizeWorkspaceAction(actor, current, "website:publish");
          const job = getJob(current, id)!;
          if (job.status !== "running" || (job.lease && Date.parse(job.lease.expiresAt) > now().getTime())) throw new BusyStep();
          return { ...current, websiteGeneration: { ...job, lease: { token, expiresAt: new Date(now().getTime() + LEASE_MS).toISOString() } } };
        });
      } catch (error) {
        if (error instanceof BusyStep) return publicResult(await read(actor, id));
        throw error;
      }
      const job = structuredClone(claimed.websiteGeneration!);
      const checkpoint = job.checkpoint!;
      let project: EverOnnWorkspace["websiteProject"];
      try {
        if (checkpoint.fingerprint !== fingerprint(claimed)) throw new Error("Business facts, preferences or the draft changed. Start a new website build using the latest information.");
        validateMemoryScope(checkpoint.memory, actor.workspaceId);
        const profile = normalizeWebsiteBusinessProfile(checkpoint.profile);
        const config = { ...(options.config || getGeminiWebsiteConfig()), models: checkpoint.models, retryDelayMs: 0 };
        const usage = { workspaceId: actor.workspaceId, feature: "website_generation" as const };
        if (job.progress.stage === "content") {
          const attempt = checkpoint.contentAttempt;
          const model = checkpoint.models[attempt.modelIndex];
          try {
            const result = await requestWebsiteContent(model, profile, { ...config, timeoutMs: Math.min(config.timeoutMs, WEBSITE_STEP_TIMEOUT_MS) }, options.fetchImpl || fetch, usage, checkpoint.memory,
              attempt.generated ? { generated: attempt.generated, feedback: attempt.feedback || "Repair the complete content." } : undefined);
            try {
              checkpoint.spec = validateWebsiteContent(result.generated, profile, checkpoint.memory);
              checkpoint.contentModel = model; checkpoint.skills = result.skills;
              checkpoint.contentAttempt = { modelIndex: 0, validationAttempt: 0 };
              job.progress = { stage: "media", message: "Finding suitable photography for your services." };
            } catch (error) {
              if (!attempt.validationAttempt) {
                checkpoint.contentAttempt = { ...attempt, validationAttempt: 1, generated: result.generated, feedback: message(error) };
                job.progress.message = "Refining website content after factual checks.";
              } else throw error;
            }
          } catch (error) {
            const status = (error as { httpStatus?: number }).httpStatus;
            if ([401, 402, 403].includes(status || 0) || attempt.modelIndex >= checkpoint.models.length - 1) throw error;
            checkpoint.contentAttempt = { modelIndex: attempt.modelIndex + 1, validationAttempt: 0 };
            job.progress.message = "Trying another configured Gemini model for the content plan.";
          }
        } else if (job.progress.stage === "media") {
          const media = await resolveWebsiteMedia(checkpoint.spec!, profile, { apiKey: options.mediaApiKey, fetchImpl: options.fetchImpl, preferences: resolvedWebsitePreferences(checkpoint.memory, actor.workspaceId) });
          checkpoint.spec!.media = { hero: media.hero, story: media.story, gallery: media.gallery, services: media.services };
          checkpoint.mediaWarning = media.warning;
          job.progress = { stage: "code", message: "Designing the original website pages.", completedPages: 0, totalPages: websitePaths(checkpoint.spec!).length * 3 };
        } else if (job.progress.stage === "code") {
          const concept = WEBSITE_CONCEPTS[checkpoint.conceptIndex];
          const previous = checkpoint.designs[concept];
          const paths = websitePaths(checkpoint.spec!);
          // One page per request keeps each unit small on hosted request budgets.
          const requested = [paths[previous?.pages.length || 0]];
          try {
            const batchOptions = { config, fetchImpl: options.fetchImpl, model: previous?.models?.at(-1) || checkpoint.contentModel,
              memory: checkpoint.memory, usage, timeoutMs: WEBSITE_STEP_TIMEOUT_MS, attempt: checkpoint.codeAttempt };
            const result = previous
              ? await generateWebsiteCodeStep(concept, requested, checkpoint.spec!, profile, batchOptions,
                { code: { ...previous, pages: previous.pages.length ? [previous.pages[0]] : [] }, model: previous.models!.at(-1)! })
              : await generateWebsiteDesignStep(concept, checkpoint.spec!, profile, batchOptions);
            checkpoint.designs[concept] = { ...result.code, pages: [...(previous?.pages || []), ...result.code.pages], models: [...new Set([...(previous?.models || []), result.model])] };
            checkpoint.codeAttempt = undefined;
            if (checkpoint.designs[concept]!.pages.length === paths.length) checkpoint.conceptIndex++;
            const completedPages = Object.values(checkpoint.designs).reduce((count, value) => count + value!.pages.length, 0);
            job.progress = { stage: checkpoint.conceptIndex === 3 ? "saving" : "code", concept, completedPages, totalPages: paths.length * 3,
              message: checkpoint.conceptIndex === 3 ? "Checking the complete website and saving your private preview." : `Building website pages: ${completedPages} of ${paths.length * 3} complete.` };
          } catch (error) {
            if (!(error instanceof WebsiteCodeRetry)) throw error;
            checkpoint.codeAttempt = error.attempt; job.progress.message = error.message;
          }
        } else {
          const spec = checkpoint.spec!;
          const preferences = resolvedWebsitePreferences(checkpoint.memory, actor.workspaceId);
          const concepts = Object.fromEntries(WEBSITE_CONCEPTS.map((concept) => [concept, { ...normalizeWebsiteCodeConcept(checkpoint.designs[concept], spec, profile, preferences), models: checkpoint.designs[concept]!.models }])) as NonNullable<typeof spec.code>["concepts"];
          if (new Set(Object.values(concepts).map((design) => design.css + design.pages[0].html)).size !== 3) throw new Error("Gemini repeated the website design. Generate distinct designs again.");
          spec.code = { schemaVersion: 1, concepts, validatedAt: now().toISOString() };
          if (JSON.stringify(spec.code).length > 900_000) throw new Error("The generated website exceeded its storage limit.");
          project = createWebsiteProject(profile, spec);
          project.qa = runWebsiteQa(spec, profile);
          if (!project.qa.passed) throw new Error("The complete website did not pass business grounding checks.");
          project.publicSlug = liveWebsite(claimed)?.publicSlug || claimed.websiteProject?.publicSlug || project.publicSlug;
          if (await store.slugUsed(project.publicSlug, actor.workspaceId)) project.publicSlug = `${project.publicSlug.slice(0, 54)}-${actor.workspaceId.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase()}`;
          project.profileSnapshot = structuredClone(checkpoint.profile);
          project.generation = { provider: "gemini", model: checkpoint.contentModel!, generatedAt: now().toISOString(), skills: checkpoint.skills };
          job.status = "completed"; job.completedProjectId = project.id; job.checkpoint = undefined;
        }
      } catch (error) { job.status = "failed"; job.error = message(error); }
      job.lease = undefined; job.updatedAt = now().toISOString();
      const saved = await store.update(actor.workspaceId, (current) => {
        const active = getJob(current, id)!;
        if (active.lease?.token !== token) throw Object.assign(new Error("This build step was superseded. Resume the saved website build."), { status: 409 });
        if (checkpoint.fingerprint !== fingerprint(current)) {
          return { ...current, websiteGeneration: { ...active, lease: undefined, status: "failed", updatedAt: now().toISOString(), error: "Business facts, preferences or the draft changed during generation. Start a new build using the latest information." } };
        }
        if (!project) return { ...current, websiteGeneration: job };
        const legacy = !current.publishedWebsite && liveWebsite(current);
        return { ...current, websiteGeneration: job, websiteProject: project,
          publishedWebsite: current.publishedWebsite || (legacy ? { id: randomUUID(), project: structuredClone(legacy), profile: structuredClone(current.profile), publishedAt: legacy.updatedAt } : null) };
      });
      return { ...publicResult(saved), mediaWarning: saved.websiteGeneration?.status === "completed" ? checkpoint.mediaWarning : undefined };
    },
  };
}

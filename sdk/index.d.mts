export type Concept = "editorial" | "momentum" | "aura";
export type ProfileInput = {
  businessName: string; businessType: string; description: string;
  email?: string; phone?: string; location?: string; serviceArea?: string; hours?: string; website?: string;
  timeZone?: string; skillId?: "general" | "hvac"; verified?: boolean;
  services: Array<{ id?: string; name: string; description?: string; active?: boolean }>;
  knowledge?: Array<{ id?: string; category?: "service" | "faq" | "policy" | "pricing" | "handoff"; question: string; answer: string; approved?: boolean }>;
};
export type Preferences = { brief?: string; accepted?: string[]; rejected?: string[]; primaryColor?: string; accentColor?: string; imagery?: "auto" | "equipment" | "people" | "none"; typography?: "auto" | "editorial" | "modern" | "technical"; density?: "auto" | "airy" | "compact"; priorityServiceId?: string; hiddenSections?: string[] };
export type Actions = { booking?: string; chat?: string; voice?: string };
export type Site = {
  id: string; revision: string; profile: ProfileInput; actions: Actions; preferences: Preferences; preferencesRevision: string | null;
  draft: { id: string; status: string; selectedConcept: Concept | null; concepts: Array<{ id: Concept; name: string }>; qa: { passed: boolean; checks: Array<{ key: string; passed: boolean; message: string }> } } | null;
  previewUrl: string | null; publicUrl: string | null; liveReleaseId: string | null;
  releases: Array<{ id: string; publishedAt: string; concept: Concept | null }>;
  job: Job | null;
};
export type Job = { id: string; status: "running" | "failed" | "completed"; progress: { stage: string; message: string; completedPages?: number; totalPages?: number }; error?: string; canResume?: boolean; retryAfterMs?: number };
export type BuildResult = { job?: Job; project?: { id: string; status: string }; error?: string };
export type ExportBundle = { siteId: string; releaseId: string; pages: Array<{ path: string; html: string }> };
export class WaasError extends Error { status: number; constructor(message: string, status?: number); }
export function createWaasClient(options: { baseUrl: string; apiKey: string; fetch?: typeof globalThis.fetch }): {
  listSites(): Promise<Site[]>;
  createSite(input: { profile: ProfileInput; actions?: Actions; preferences?: Preferences }): Promise<Site>;
  getSite(id: string): Promise<Site>;
  updateSite(id: string, input: { expectedRevision: string; profile?: Partial<ProfileInput>; actions?: Actions; preferences?: Preferences; expectedPreferencesRevision?: string | null; changeRequest?: string }): Promise<Site>;
  buildStatus(id: string, jobId?: string, signal?: AbortSignal): Promise<BuildResult>;
  buildStep(id: string, input: { operation: "start" | "advance" | "resume"; jobId?: string }, signal?: AbortSignal): Promise<BuildResult>;
  generate(id: string, options?: { resume?: boolean; signal?: AbortSignal; onProgress?: (job: Job) => void }): Promise<BuildResult>;
  publish(id: string, input: { concept: Concept; approved: true; draftId: string; expectedLiveReleaseId: string | null }): Promise<Site>;
  rollback(id: string, input: { releaseId: string; expectedLiveReleaseId: string }): Promise<Site>;
  exportSite(id: string): Promise<ExportBundle>;
  usage(id: string): Promise<unknown[]>;
  url(path: string): string;
};

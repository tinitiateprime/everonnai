import type { WebsiteProject } from "@/features/everonn/types";
import type { WebsiteConcept } from "@/features/agent-runtime/types";

export type WebsiteGenerationProgress = {
  stage: "content" | "media" | "code" | "saving";
  message: string;
  concept?: WebsiteConcept;
  completedPages?: number;
  totalPages?: number;
};
export type WebsiteGenerationResult = { project?: WebsiteProject; error?: string; generatedBy?: string; model?: string; mediaWarning?: string | null; job?: import("./job-types").WebsiteJobStatus };
export type WebsiteGenerationEvent =
  | { type: "progress"; progress: WebsiteGenerationProgress }
  | { type: "result"; data: WebsiteGenerationResult }
  | { type: "error"; error: string }
  | { type: "heartbeat" };

export async function readWebsiteGeneration(response: Response, onProgress: (progress: WebsiteGenerationProgress) => void): Promise<WebsiteGenerationResult> {
  const interrupted = () => new Error(`Website Studio returned an empty or incomplete response (HTTP ${response.status}). Resume the saved build; your published website stays unchanged.`);
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    let text: string;
    try { text = await response.text(); } catch { throw interrupted(); }
    if (!text.trim() || text.length > 2_000_000) throw interrupted();
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw interrupted(); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw interrupted();
    return data as WebsiteGenerationResult;
  }
  if (!response.body) throw new Error("Website generation returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: WebsiteGenerationResult | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    let event: WebsiteGenerationEvent;
    try { event = JSON.parse(line) as WebsiteGenerationEvent; } catch { throw interrupted(); }
    if (event.type === "progress") onProgress(event.progress);
    if (event.type === "result") result = event.data;
    if (event.type === "error") throw new Error(event.error);
  };
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 2_000_000) throw new Error("Website generation response exceeded its size limit.");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (chunk.done) break;
    }
    consume(buffer);
    if (!result) throw new Error("Website generation was interrupted before completion. Refresh Website Studio to check the latest draft.");
    return result;
  } finally { reader.releaseLock(); }
}

export async function runWebsiteGeneration(input: {
  workspaceId: string;
  existingJob?: import("./job-types").WebsiteJobStatus;
  onProgress: (progress: WebsiteGenerationProgress) => void;
  onJob?: (job: import("./job-types").WebsiteJobStatus) => void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) {
  const fetchImpl = input.fetchImpl || fetch;
  const headers = { "Content-Type": "application/json", "x-everonn-workspace": input.workspaceId };
  const wait = (duration: number) => new Promise<void>((resolve, reject) => {
    input.signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(input.signal?.reason || new Error("Website build paused.")); };
    const timer = setTimeout(() => { input.signal?.removeEventListener("abort", abort); resolve(); }, duration);
    input.signal?.addEventListener("abort", abort, { once: true });
  });
  async function request(operation?: string, jobId?: string): Promise<WebsiteGenerationResult> {
    let response: Response;
    try { response = await fetchImpl(operation ? "/api/website-studio" : `/api/website-studio${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ""}`, {
      ...(operation ? { method: "POST", headers, body: JSON.stringify({ workspaceId: input.workspaceId, operation, jobId }) } : { headers }),
      cache: "no-store", signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(40_000)]) : AbortSignal.timeout(40_000),
    }); } catch (error) {
      input.signal?.throwIfAborted();
      if (["TimeoutError", "AbortError"].includes((error as { name?: string })?.name || "")) throw new Error("The connection to Website Studio timed out. Use Resume saved build to continue; completed content and pages are retained.");
      throw error;
    }
    const result = await readWebsiteGeneration(response, input.onProgress);
    if (!response.ok) throw Object.assign(new Error(result.error || "Website Studio could not complete this request."), { httpStatus: response.status });
    return result;
  }
  let result: WebsiteGenerationResult;
  try { result = input.existingJob ? await request(input.existingJob.status === "failed" ? "resume" : undefined, input.existingJob.id) : await request("start"); }
  catch (error) {
    input.signal?.throwIfAborted();
    if ((error as { httpStatus?: number }).httpStatus) throw error;
    result = await request(undefined, input.existingJob?.id);
    if (!result.job) throw error;
  }
  let failures = 0;
  for (let index = 0; index < 1500; index++) {
    input.signal?.throwIfAborted();
    if (result.project) return result;
    const job = result.job;
    if (!job || !["running", "failed", "completed"].includes(job.status)) throw new Error("Website Studio did not return a saved build. Refresh and try again.");
    input.onJob?.(job); input.onProgress(job.progress);
    if (job.status === "failed") throw new Error(job.error || "The saved website build failed.");
    if (job.status === "completed") throw new Error("The completed draft changed. Refresh Website Studio to view the latest website.");
    await wait(job.retryAfterMs || 100);
    try { result = await request("advance", job.id); failures = 0; }
    catch (error) {
      input.signal?.throwIfAborted();
      if ([400, 401, 403, 409].includes((error as { httpStatus?: number }).httpStatus || 0)) throw error;
      if (++failures > 3) throw new Error("The connection was interrupted. Resume the saved website build to continue; completed pages are retained.");
      await wait(1000);
      result = await request(undefined, job.id);
    }
  }
  throw new Error("This build is taking longer than expected. Resume it from Website Studio; completed pages are retained.");
}

import type { WebsiteProject } from "@/features/everonn/types";
import type { WebsiteConcept } from "@/features/agent-runtime/types";

export type WebsiteGenerationProgress = {
  stage: "content" | "media" | "code" | "saving";
  message: string;
  concept?: WebsiteConcept;
  completedPages?: number;
  totalPages?: number;
};
export type WebsiteGenerationResult = { project?: WebsiteProject; error?: string; generatedBy?: string; model?: string; mediaWarning?: string | null };
export type WebsiteGenerationEvent =
  | { type: "progress"; progress: WebsiteGenerationProgress }
  | { type: "result"; data: WebsiteGenerationResult }
  | { type: "error"; error: string }
  | { type: "heartbeat" };

export async function readWebsiteGeneration(response: Response, onProgress: (progress: WebsiteGenerationProgress) => void): Promise<WebsiteGenerationResult> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) return response.json();
  if (!response.body) throw new Error("Website generation returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: WebsiteGenerationResult | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as WebsiteGenerationEvent;
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

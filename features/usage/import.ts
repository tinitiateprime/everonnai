import { createHash } from "node:crypto";
import { readUsageEvents, recordUsage } from "@/lib/usage-store";
import { geminiTokens } from "./gemini";
import { estimateGeminiCost } from "./pricing";
import { usageFeatures, type UsageEvent, type UsageFeature } from "./types";

// Administrative import of explicitly attributed provider exports. Matching
// eventId repairs an existing timeout rather than counting a second request.
export async function importGeminiUsage(input: unknown, apply = false) {
  const manifest = input as { version?: number; workspaceId?: string; records?: Array<Record<string, unknown>> };
  if (!manifest || manifest.version !== 1 || typeof manifest.workspaceId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(manifest.workspaceId) || !Array.isArray(manifest.records) || manifest.records.length > 1000) throw new Error("Invalid usage import manifest.");
  const existing = await readUsageEvents(manifest.workspaceId);
  const ids = new Set<string>();
  const responses = new Set<string>();
  const events: UsageEvent[] = manifest.records.map((row) => {
    const { feature, model, startedAt, responseId, eventId, httpStatus } = row;
    if (typeof feature !== "string" || !Object.hasOwn(usageFeatures, feature) || !["website_generation", "website_chat", "call_chat", "appointment_extraction"].includes(feature) || typeof model !== "string" || !/^[A-Za-z0-9_./-]{1,160}$/.test(model) || typeof startedAt !== "string" || !Number.isFinite(Date.parse(startedAt)) || Date.parse(startedAt) > Date.now() || typeof responseId !== "string" || !/^[A-Za-z0-9_./-]{1,200}$/.test(responseId) || typeof httpStatus !== "number" || !Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) throw new Error("Invalid provider usage row.");
    const prior = eventId ? existing.find((event) => event.id === eventId) : existing.find((event) => event.providerResponseId === responseId);
    if (eventId && !prior) throw new Error("The imported event ID was not found in this workspace.");
    if (prior && (prior.provider !== "gemini" || prior.feature !== feature || prior.model !== model || prior.startedAt !== new Date(startedAt).toISOString() || (prior.providerResponseId && prior.providerResponseId !== responseId))) throw new Error("The provider export does not match the existing request.");
    if (existing.some((event) => event.providerResponseId === responseId && event.id !== prior?.id)) throw new Error("This provider response is already assigned to another request.");
    const id = prior?.id || `gi_${createHash("sha256").update(responseId).digest("hex")}`;
    if (ids.has(id) || responses.has(responseId)) throw new Error("Duplicate provider response in the import manifest.");
    ids.add(id); responses.add(responseId);
    const tokens = geminiTokens({ usageMetadata: row.usageMetadata });
    if (tokens?.total == null) throw new Error("The imported provider response has no total token count.");
    if (prior?.tokens?.total != null && JSON.stringify(prior.tokens) !== JSON.stringify(tokens)) throw new Error("The import conflicts with existing provider token counts.");
    return { id, workspaceId: manifest.workspaceId!, provider: "gemini", feature: feature as UsageFeature, model, kind: "request", operation: "generateContent", startedAt: new Date(startedAt).toISOString(), recordedAt: new Date().toISOString(), status: httpStatus < 400 ? "success" : "failed", httpStatus, latencyMs: prior?.latencyMs ?? null, tokens, voice: null, source: "import", historical: prior ? prior.historical || undefined : true, providerResponseId: responseId, estimatedCost: estimateGeminiCost(model, tokens, { timestamp: startedAt }) };
  });
  // Validate everything before writing. Re-running a partly saved batch is safe.
  if (apply) for (const event of events) await recordUsage(event);
  return { validated: events.length, applied: apply ? events.length : 0 };
}

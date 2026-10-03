import { createUsageSession, readUsageSession, readUsageSessions, recordUsage, saveUsageSession } from "@/lib/usage-store";
import { conversationUsage, elevenLabsJson, type ConversationPayload } from "./elevenlabs";
import type { UsageFeature, UsageSession } from "./types";

export async function importElevenLabsUsage(input: unknown, apply = false, fetchImpl: typeof fetch = fetch) {
  const manifest = input as { version?: number; workspaceId?: string; feature?: string; agentId?: string; conversationIds?: string[] };
  if (!manifest || manifest.version !== 1 || typeof manifest.workspaceId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(manifest.workspaceId) || !["dashboard_voice", "website_voice", "elevenlabs_chat"].includes(manifest.feature || "") || !manifest.agentId || manifest.agentId !== process.env.ELEVENLABS_AGENT_ID || !Array.isArray(manifest.conversationIds) || !manifest.conversationIds.length || manifest.conversationIds.length > 100 || manifest.conversationIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) || new Set(manifest.conversationIds).size !== manifest.conversationIds.length) throw new Error("Invalid ElevenLabs usage import manifest.");
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ElevenLabs conversation read access is required.");
  const existingSessions = await readUsageSessions(manifest.workspaceId);
  const validated: Array<{ session: UsageSession; payload: ConversationPayload; legacy: boolean }> = [];
  for (const id of manifest.conversationIds) {
    const payload = await elevenLabsJson(`/convai/conversations/${encodeURIComponent(id)}`, key, fetchImpl) as ConversationPayload;
    if (payload.conversation_id !== id) throw new Error("The provider returned a different conversation.");
    const userId = payload.user_id || payload.conversation_initiation_client_data?.user_id;
    const known = userId ? await readUsageSession(userId) : existingSessions.find((session) => session.trustedUnattributedImport && session.agentId === manifest.agentId && session.feature === manifest.feature && session.conversationIds.includes(id)) || null;
    if (userId && (!known || known.workspaceId !== manifest.workspaceId || known.feature !== manifest.feature)) throw new Error("The provider conversation cannot be attributed to this workspace and feature.");
    const session: UsageSession = known || { id: "administrative-history-import", workspaceId: manifest.workspaceId, feature: manifest.feature as UsageFeature, agentId: manifest.agentId, createdAt: new Date().toISOString(), conversationIds: [id], syncedAt: null, complete: false, trustedUnattributedImport: true };
    conversationUsage(session, payload);
    validated.push({ session, payload, legacy: !known });
  }
  if (apply) for (const entry of validated) {
    // Legacy attribution is a deliberate administrator decision. It is never
    // accepted by a browser callback or inferred from a shared agent alone.
    let session = entry.session;
    const event = { ...conversationUsage(session, entry.payload), source: "import" as const };
    await recordUsage(event);
    if (entry.legacy) {
      const id = await createUsageSession({ workspaceId: session.workspaceId, feature: session.feature }, session.agentId);
      session = { ...session, id };
    }
    await saveUsageSession({ ...session, conversationIds: [...new Set([...session.conversationIds, entry.payload.conversation_id!])], syncedAt: new Date().toISOString(), complete: event.status !== "pending" && event.voice?.credits != null && event.voice?.costUsd != null });
  }
  return { validated: validated.length, applied: apply ? validated.length : 0 };
}

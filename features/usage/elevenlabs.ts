import { createHash, randomUUID } from "node:crypto";
import { recordUsage, readUsageSession, readUsageSessions, saveUsageSession } from "@/lib/usage-store";
import { nonNegativeNumber, type UsageContext, type UsageEvent, type UsageSession } from "./types";
import { finalizeUsage, replayUsageOutbox, retryUsageWrite } from "./delivery";

const api = "https://api.elevenlabs.io/v1";
export type ConversationPayload = {
  agent_id?: string;
  conversation_id?: string;
  user_id?: string;
  status?: string;
  conversation_initiation_client_data?: { user_id?: string };
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    cost?: number | null;
    cost_fiat?: number | null;
    charging?: {
      tts_usage?: { total_characters?: number; total_audio_output_seconds?: number };
      asr_usage?: { total_audio_input_seconds?: number };
    };
  };
};

export async function elevenLabsJson(path: string, apiKey: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${api}${path}`, { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`ElevenLabs usage request returned HTTP ${response.status}. Check the API key's conversation read permissions.`);
  return payload;
}

export async function meteredElevenLabsSetup(path: string, apiKey: string, usage: UsageContext, agentId: string) {
  const started = performance.now();
  const event: UsageEvent = {
    ...usage, id: randomUUID(), provider: "elevenlabs", kind: "request", operation: path.includes("get-signed-url") ? "signed URL" : "conversation token", model: agentId,
    status: "pending", startedAt: new Date().toISOString(), recordedAt: new Date().toISOString(),
    latencyMs: null, httpStatus: null, tokens: null, voice: null,
  };
  await retryUsageWrite(() => recordUsage(event));
  let response: Response | undefined;
  try {
    response = await fetch(`${api}${path}`, { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`ElevenLabs returned HTTP ${response.status}.`);
    return payload as { token?: string; signed_url?: string };
  } finally {
    await finalizeUsage({ ...event, status: response?.ok ? "success" : "failed", recordedAt: new Date().toISOString(), latencyMs: Math.round(performance.now() - started), httpStatus: response?.status ?? null, source: "response" });
  }
}

export function conversationUsage(session: UsageSession, payload: ConversationPayload): UsageEvent {
  const userId = payload.user_id || payload.conversation_initiation_client_data?.user_id;
  const trustedHistory = session.trustedUnattributedImport && !userId && session.conversationIds.includes(payload.conversation_id || "");
  if (payload.agent_id !== session.agentId || (!trustedHistory && userId !== session.id) || !payload.conversation_id) {
    throw Object.assign(new Error("The provider conversation does not belong to this usage session."), { status: 403 });
  }
  const metadata = payload.metadata;
  const time = nonNegativeNumber(metadata?.start_time_unix_secs);
  const startDate = time === null ? null : new Date(time * 1000);
  const final = payload.status === "done" || payload.status === "failed";
  return {
    workspaceId: session.workspaceId, feature: session.feature,
    id: `el_${createHash("sha256").update(payload.conversation_id).digest("hex")}`,
    provider: "elevenlabs", kind: "conversation", operation: "conversation", model: session.agentId, source: "reconciliation", historical: session.trustedUnattributedImport || undefined,
    status: payload.status === "failed" ? "failed" : final ? "success" : "pending",
    startedAt: startDate && Number.isFinite(startDate.getTime()) ? startDate.toISOString() : session.createdAt,
    recordedAt: new Date().toISOString(), latencyMs: null, httpStatus: null, tokens: null,
    voice: {
      durationSeconds: nonNegativeNumber(metadata?.call_duration_secs),
      // In-progress cost fields can be placeholders. Wait for a final provider
      // record before presenting charges. No currency conversion is inferred.
      credits: final ? nonNegativeNumber(metadata?.cost) : null,
      costUsd: final ? nonNegativeNumber(metadata?.cost_fiat) : null,
      ttsCharacters: nonNegativeNumber(metadata?.charging?.tts_usage?.total_characters),
      audioOutputSeconds: nonNegativeNumber(metadata?.charging?.tts_usage?.total_audio_output_seconds),
      audioInputSeconds: nonNegativeNumber(metadata?.charging?.asr_usage?.total_audio_input_seconds),
    },
  };
}

// Serialize sync/connection callbacks in this process. Events use stable IDs,
// so repeated syncs and multiple instances cannot add the same charge twice.
const queues = new Map<string, Promise<unknown>>();
export function syncUsageSession(session: UsageSession, conversationId?: string, fetchImpl: typeof fetch = fetch) {
  const previous = queues.get(session.id) || Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    session = await readUsageSession(session.id) || session;
    const providerCheckedAt = new Date().toISOString();
    const apiKey = String(process.env.ELEVENLABS_API_KEY || "").trim();
    if (!apiKey) throw new Error("ElevenLabs is not configured for usage synchronization.");
    // Discover from the provider using our opaque identity, even when a tab
    // closed before the connection callback reached the application.
    const discovered = [...session.conversationIds, ...(conversationId ? [conversationId] : [])];
    // A connection callback already supplies a provider ID. Discovery is only
    // needed for callbacks lost when a browser closes.
    if (!conversationId && !session.trustedUnattributedImport) {
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const listing = await elevenLabsJson(`/convai/conversations?agent_id=${encodeURIComponent(session.agentId)}&user_id=${encodeURIComponent(session.id)}&page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, apiKey, fetchImpl) as { conversations?: Array<{ conversation_id: string }>; has_more?: boolean; next_cursor?: string };
        discovered.push(...(listing.conversations || []).map((entry) => entry.conversation_id));
        if (!listing.has_more) break;
        if (!listing.next_cursor || cursors.has(listing.next_cursor)) throw new Error("ElevenLabs conversation pagination could not be completed. Usage may be incomplete.");
        cursor = listing.next_cursor;
        cursors.add(cursor);
      } while (true);
    }
    const ids = [...new Set(discovered)];
    let complete = ids.length > 0;
    for (const id of ids) {
      const payload = await elevenLabsJson(`/convai/conversations/${encodeURIComponent(id)}`, apiKey, fetchImpl) as ConversationPayload;
      const event = conversationUsage(session, payload);
      await recordUsage(event);
      complete &&= event.status !== "pending" && event.voice?.credits != null && event.voice?.costUsd != null;
    }
    const now = Date.now();
    const age = now - Date.parse(session.createdAt);
    const delay = ids.length ? (age > 24 * 60 * 60_000 ? 60 * 60_000 : 60_000) : age > 24 * 60 * 60_000 ? 24 * 60 * 60_000 : age > 60 * 60_000 ? 15 * 60_000 : 60_000;
    const updated = { ...session, conversationIds: ids, syncedAt: new Date(now).toISOString(), providerCheckedAt, complete, syncAttempts: (session.syncAttempts || 0) + 1, syncError: null, nextSyncAt: complete ? null : new Date(now + delay).toISOString() };
    await saveUsageSession(updated);
    return updated;
  });
  queues.set(session.id, operation);
  void operation.finally(() => { if (queues.get(session.id) === operation) queues.delete(session.id); }).catch(() => undefined);
  return operation;
}

export function eligibleUsageSessions(sessions: UsageSession[], now = Date.now()) {
  return sessions.filter((session) => (!session.complete || usageSessionNeedsRecheck(session)) && (!session.nextSyncAt ? usageSessionNeedsRecheck(session) || !session.syncedAt || now - Date.parse(session.syncedAt) >= 30_000 : Date.parse(session.nextSyncAt) <= now))
    .sort((a, b) => (a.nextSyncAt || a.syncedAt || a.createdAt).localeCompare(b.nextSyncAt || b.syncedAt || b.createdAt));
}

export function usageSessionNeedsRecheck(session: UsageSession) {
  return Boolean(session.recheckRequestedAt && session.recheckRequestedAt > (session.providerCheckedAt || ""));
}

export async function reconcileUsageSessions(sessions: UsageSession[], fetchImpl: typeof fetch = fetch, limit = 10) {
  const pending = eligibleUsageSessions(sessions);
  const batch = pending.slice(0, limit);
  const results = await Promise.allSettled(batch.map(async (session) => {
    try { return await syncUsageSession(session, undefined, fetchImpl); }
    catch (error) {
      const attempts = (session.syncAttempts || 0) + 1;
      await saveUsageSession({ ...session, syncedAt: new Date().toISOString(), syncAttempts: attempts, syncError: "Provider reconciliation failed. Check conversation read permissions and connectivity.", nextSyncAt: new Date(Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** Math.min(attempts, 6))).toISOString() });
      throw error;
    }
  }));
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  return { checked: batch.length, remaining: Math.max(0, pending.length - batch.length), error: errors.length ? (errors[0].reason instanceof Error ? errors[0].reason.message : "ElevenLabs usage could not be synchronized.") : null };
}

export async function syncWorkspaceUsage(workspaceId: string) {
  await replayUsageOutbox(workspaceId);
  const sessions = await readUsageSessions(workspaceId);
  return reconcileUsageSessions(sessions);
}

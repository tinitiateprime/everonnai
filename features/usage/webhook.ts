import { createHmac, timingSafeEqual } from "node:crypto";
import { enqueueUsage, readUsageSession, recordUsage, removeUsageOutbox, saveUsageSession, saveUsageWebhookReceipt } from "@/lib/usage-store";
import { conversationUsage, type ConversationPayload } from "./elevenlabs";
import { retryUsageWrite } from "./delivery";

export function verifyElevenLabsSignature(raw: string, header: string | null, secret: string, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = header.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signature = parts.find((part) => part.startsWith("v0="))?.slice(3);
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const age = now - Number(timestamp) * 1000;
  if (age > 30 * 60_000 || age < -60_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest();
  return timingSafeEqual(Buffer.from(signature, "hex"), expected);
}

export async function acceptElevenLabsWebhook(input: { type?: string; data?: ConversationPayload }) {
  if (input.type !== "post_call_transcription" || !input.data) return { accepted: true, matched: false };
  const payload = input.data;
  const userId = payload.user_id || payload.conversation_initiation_client_data?.user_id;
  if (typeof userId !== "string") return { accepted: true, matched: false };
  const session = await readUsageSession(userId);
  if (!session) return { accepted: true, matched: false };
  // A signed post-call transcript is final even when its payload omits status.
  // Strip all transcript/customer fields before persisting anything.
  const event = { ...conversationUsage(session, { ...payload, status: payload.status || "done" }), source: "webhook" as const };
  await retryUsageWrite(() => enqueueUsage(event));
  try { await retryUsageWrite(() => recordUsage(event)); await removeUsageOutbox(event); }
  catch { /* The durable journal will be replayed by the worker. */ }
  const recheckRequestedAt = new Date().toISOString();
  await saveUsageSession({ ...session, conversationIds: [...new Set([...session.conversationIds, payload.conversation_id!])], complete: false, nextSyncAt: recheckRequestedAt, recheckRequestedAt, providerCheckedAt: session.providerCheckedAt || session.syncedAt, syncError: null });
  await saveUsageWebhookReceipt(session.workspaceId);
  return { accepted: true, matched: true };
}

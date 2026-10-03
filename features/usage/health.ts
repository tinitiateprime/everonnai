import { readUsageWorkerState, readWorkspaceOutbox, usageStorageKind, readUsageWebhookReceipt } from "@/lib/usage-store";
import { memoryUsageCount } from "./delivery";

export async function usageHealth(workspaceId: string) {
  const [worker, outbox, receipt] = await Promise.all([readUsageWorkerState(), readWorkspaceOutbox(workspaceId), readUsageWebhookReceipt(workspaceId)]);
  const last = worker?.lastFinishedAt || null;
  return {
    storage: usageStorageKind(),
    background: { lastFinishedAt: last, healthy: Boolean(last && Date.now() - Date.parse(last) < 5 * 60_000 && !worker?.error), running: Boolean(worker && !worker.lastFinishedAt && Date.now() - Date.parse(worker.lastStartedAt) < 2 * 60_000), error: worker?.error ? "Background reconciliation needs attention." : null },
    queuedWrites: outbox.length + memoryUsageCount(workspaceId),
    webhookConfigured: Boolean(process.env.ELEVENLABS_WEBHOOK_SECRET),
    webhookLastReceivedAt: receipt?.receivedAt || null,
    elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
    geminiBillingTier: process.env.GEMINI_BILLING_TIER || "list-price",
  };
}

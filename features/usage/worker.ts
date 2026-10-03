import { readAllUsageSessions, saveUsageWorkerState } from "@/lib/usage-store";
import { replayUsageOutbox } from "./delivery";
import { reconcileUsageSessions, usageSessionNeedsRecheck } from "./elevenlabs";
import { syncGeminiBilling } from "./billing";

let running: Promise<Awaited<ReturnType<typeof work>>> | undefined;
async function work(fetchImpl: typeof fetch, limit: number) {
  const lastStartedAt = new Date().toISOString();
  await saveUsageWorkerState({ lastStartedAt, lastFinishedAt: null, error: null, checked: 0 });
  try {
    const [delivery, billing, result] = await Promise.all([replayUsageOutbox(), syncGeminiBilling(fetchImpl), (async () => {
      const sessions = await readAllUsageSessions();
      return process.env.ELEVENLABS_API_KEY ? reconcileUsageSessions(sessions, fetchImpl, limit) : { checked: 0, remaining: sessions.filter((session) => !session.complete || usageSessionNeedsRecheck(session)).length, error: sessions.some((session) => !session.complete || usageSessionNeedsRecheck(session)) ? "ElevenLabs usage synchronization is not configured." : null };
    })()]);
    const error = result.error || billing.error || (delivery.remaining ? "Usage responses remain queued for retry." : null);
    await saveUsageWorkerState({ lastStartedAt, lastFinishedAt: new Date().toISOString(), error, checked: result.checked });
    return { ...result, error, delivered: delivery.delivered, queuedWrites: delivery.remaining };
  } catch (error) {
    await saveUsageWorkerState({ lastStartedAt, lastFinishedAt: new Date().toISOString(), checked: 0, error: "Background usage reconciliation failed. Check storage and provider permissions." }).catch(() => undefined);
    throw error;
  }
}

export function runUsageWorker(fetchImpl: typeof fetch = fetch, limit = 10) {
  if (running) return running;
  const operation = work(fetchImpl, Math.min(25, Math.max(1, limit)));
  running = operation;
  void operation.finally(() => { if (running === operation) running = undefined; }).catch(() => undefined);
  return operation;
}

export function startUsageWorker() {
  const state = globalThis as typeof globalThis & { everonnUsageTimer?: ReturnType<typeof setInterval> };
  if (state.everonnUsageTimer) return;
  const tick = () => { void runUsageWorker().catch(() => console.error("Background usage reconciliation failed. Check usage storage and provider permissions.")); };
  state.everonnUsageTimer = setInterval(tick, 60_000);
  state.everonnUsageTimer.unref();
  const first = setTimeout(tick, 1_000);
  first.unref();
}

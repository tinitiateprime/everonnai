import { enqueueUsage, readUsageOutbox, recordUsage, removeUsageOutbox } from "@/lib/usage-store";
import type { UsageEvent } from "./types";

export async function retryUsageWrite(action: () => Promise<void>, pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { await action(); return; }
    catch (error) { if (attempt === 2) throw error; await pause(50 * 2 ** attempt); }
  }
}

// Retain responses in this process if the storage service is completely down.
// Durable pending records still show the gap if the process is lost as well.
const memory = new Map<string, UsageEvent>();
const key = (event: UsageEvent) => `${event.workspaceId}/${event.id}`;
export const memoryUsageCount = (workspaceId?: string) => [...memory.values()].filter((event) => !workspaceId || event.workspaceId === workspaceId).length;

export async function finalizeUsage(event: UsageEvent, overrides: {
  record?: (event: UsageEvent) => Promise<void>;
  enqueue?: (event: UsageEvent) => Promise<void>;
  remove?: (event: UsageEvent) => Promise<void>;
} = {}) {
  // Injected writers used by provider tests have no real storage side effects.
  if (overrides.record && !overrides.enqueue) {
    await retryUsageWrite(() => overrides.record!(event)).catch(() => console.error("Usage finalization failed; the pending record was retained."));
    return;
  }
  const save = overrides.record || recordUsage;
  let journaled = false;
  try { await retryUsageWrite(() => (overrides.enqueue || enqueueUsage)(event)); journaled = true; } catch { /* Try the ledger independently. */ }
  try {
    await retryUsageWrite(() => save(event));
    memory.delete(key(event));
    if (journaled) await (overrides.remove || removeUsageOutbox)(event).catch(() => undefined);
  } catch {
    if (!journaled) memory.set(key(event), event);
    console.error(journaled ? "Usage response queued for durable retry." : "Usage storage unavailable; response retained in process and pending record retained.");
  }
}

export async function replayUsageOutbox(workspaceId?: string) {
  const events = [...await readUsageOutbox(), ...memory.values()].filter((event) => !workspaceId || event.workspaceId === workspaceId).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const batch = events.slice(0, 100);
  let delivered = 0;
  const results = await Promise.allSettled(batch.map(async (event) => {
    await retryUsageWrite(() => recordUsage(event));
    memory.delete(key(event));
    await removeUsageOutbox(event);
    delivered++;
  }));
  return { delivered, remaining: events.length - batch.length + results.filter((result) => result.status === "rejected").length };
}

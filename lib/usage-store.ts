import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { GeminiBillingReport, UsageContext, UsageEvent, UsageSession, UsageWorkerState } from "@/features/usage/types";
import { usageSupabase, usageSupabaseConfigured } from "./usage-supabase";

const root = () => path.resolve(/*turbopackIgnore: true*/ process.env.EVERONN_USAGE_DIR || path.join(path.dirname(process.env.EVERONN_DATA_FILE || path.join(process.cwd(), "data", "everonn.json")), "usage"));
const blobs = () => process.env.NETLIFY === "true" || Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
const store = () => getStore({ name: "everonn-usage", consistency: "strong" });
const scope = (workspaceId: string) => createHash("sha256").update(workspaceId).digest("hex");
const sessionPattern = /^[a-f0-9]{64}\.[a-f0-9]{48}$/;
function assertStorage() {
  if (!usageSupabaseConfigured() && !blobs() && (process.env.USAGE_REQUIRE_DURABLE_STORAGE === "true" || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME))) throw new Error("Durable usage storage is required. Configure the dedicated Supabase usage schema.");
}

async function read<T>(key: string): Promise<T | null> {
  assertStorage();
  if (usageSupabaseConfigured()) return (await usageSupabase().read<T>(key))?.data || null;
  if (blobs()) return store().get(key, { type: "json", consistency: "strong" }) as Promise<T | null>;
  try { return JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(root(), `${key}.json`), "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function write(key: string, value: unknown) {
  assertStorage();
  if (usageSupabaseConfigured()) { if (!await usageSupabase().write(key, value)) throw new Error("Usage database write was not accepted."); return; }
  if (blobs()) { await store().setJSON(key, value); return; }
  const file = path.join(root(), `${key}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporary, file);
}

async function list<T>(prefix: string): Promise<T[]> {
  assertStorage();
  if (usageSupabaseConfigured()) return usageSupabase().list<T>(prefix);
  if (blobs()) {
    const keys: string[] = [];
    for await (const page of store().list({ prefix: `${prefix}/`, paginate: true })) keys.push(...page.blobs.map((entry) => entry.key));
    return readMany<T>(keys);
  }
  const keys: string[] = [];
  async function visit(directory: string) {
    let entries;
    try { entries = await readdir(/*turbopackIgnore: true*/ path.join(root(), directory), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (entry.isDirectory()) await visit(`${directory}/${entry.name}`);
      // OneDrive hydrated JSON files can be reported as reparse-point links.
      else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".json")) keys.push(`${directory}/${entry.name.slice(0, -5)}`);
    }
  }
  await visit(prefix);
  return readMany<T>(keys);
}

async function readMany<T>(keys: string[]): Promise<T[]> {
  const result: T[] = [];
  // Preserve the entire ledger without opening an unbounded number of files
  // or Blob requests as the workspace's history grows.
  for (let index = 0; index < keys.length; index += 50) {
    const values = await Promise.all(keys.slice(index, index + 50).map((key) => read<T>(key)));
    result.push(...values.filter((value) => value !== null) as T[]);
  }
  return result;
}

const queues = new Map<string, Promise<unknown>>();
function upsert<T>(key: string, value: T, merge: (previous: T | null, next: T) => T) {
  const previous = queues.get(key) || Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    assertStorage();
    if (usageSupabaseConfigured()) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const current = await usageSupabase().read<T>(key);
        if (await usageSupabase().write(key, merge(current?.data || null, value), current ? { revision: current.revision } : { new: true })) return;
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
      }
      throw new Error("Usage changed repeatedly while saving. Please retry.");
    }
    if (blobs()) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await store().getWithMetadata(key, { type: "json", consistency: "strong" });
        const result = await store().setJSON(key, merge(current?.data as T | null, value), current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
        if (result.modified) return;
      }
      throw new Error("Usage changed repeatedly while saving. Please retry.");
    }
    await write(key, merge(await read<T>(key), value));
  });
  queues.set(key, operation);
  void operation.finally(() => { if (queues.get(key) === operation) queues.delete(key); }).catch(() => undefined);
  return operation;
}

export async function recordUsage(event: UsageEvent) {
  if (!event.workspaceId || !/^[a-zA-Z0-9_-]+$/.test(event.id)) throw new Error("Invalid usage record.");
  const identity = event.provider === "elevenlabs" && event.kind === "conversation" ? event.id : event.providerResponseId ? `gr_${createHash("sha256").update(event.providerResponseId).digest("hex")}` : null;
  if (identity) await upsert(`claims/${identity}`, { workspaceId: event.workspaceId, eventId: event.id, feature: event.feature }, (previous, next) => {
    if (previous && (previous.workspaceId !== next.workspaceId || previous.eventId !== next.eventId || (previous.feature && previous.feature !== next.feature))) throw new Error("This provider record is already assigned to another request or workspace.");
    return next;
  });
  return upsert(`events/${scope(event.workspaceId)}/${event.id}`, event, (previous, next) => {
    if (!previous) return next;
    if (previous.workspaceId !== next.workspaceId) throw new Error("Usage workspace scope mismatch.");
    // A slow in-progress read must never erase already-final provider charges.
    if (previous.status !== "pending" && next.status === "pending") return previous;
    // A delayed post-call delivery must not overwrite a later direct provider
    // read. Its session requests a fresh read, which can apply real corrections.
    if (next.source === "webhook" && previous.status !== "pending" && ["reconciliation", "import"].includes(previous.source || "")) return previous;
    if (previous.recordedAt > next.recordedAt) return previous;
    // Reconciliation can arrive before USD billing. Preserve previously
    // reported metrics when a later final provider snapshot omits them.
    const voice = next.voice && previous.voice ? Object.fromEntries(Object.entries(next.voice).map(([key, value]) => [key, value ?? previous.voice?.[key as keyof typeof previous.voice] ?? null])) as UsageEvent["voice"] : next.voice;
    return { ...next, voice, historical: previous.historical || next.historical || undefined };
  });
}

export async function readUsageEvents(workspaceId: string) {
  const events = await list<UsageEvent>(`events/${scope(workspaceId)}`);
  if (events.some((event) => event.workspaceId !== workspaceId)) throw new Error("Usage workspace scope mismatch.");
  return events;
}

export async function createUsageSession(context: UsageContext, agentId: string) {
  if (!context.workspaceId || !agentId) throw new Error("Invalid usage context.");
  const id = `${scope(context.workspaceId)}.${randomBytes(24).toString("hex")}`;
  const session: UsageSession = { ...context, id, agentId, createdAt: new Date().toISOString(), conversationIds: [], syncedAt: null, complete: false };
  await saveUsageSession(session);
  return id;
}

export function saveUsageSession(session: UsageSession) {
  if (!sessionPattern.test(session.id) || session.id.split(".")[0] !== scope(session.workspaceId)) throw new Error("Invalid usage session.");
  const [workspace, id] = session.id.split(".");
  return upsert(`sessions/${workspace}/${id}`, session, (previous, next) => {
    if (!previous) return next;
    if (previous.workspaceId !== next.workspaceId || previous.feature !== next.feature || previous.agentId !== next.agentId) throw new Error("Usage session scope mismatch.");
    const conversationIds = [...new Set([...previous.conversationIds, ...next.conversationIds])];
    const latest = (previous.syncedAt || "") > (next.syncedAt || "") ? previous : next;
    const recheckRequestedAt = [previous.recheckRequestedAt, next.recheckRequestedAt].filter((value): value is string => Boolean(value)).sort().at(-1) || null;
    const providerCheckedAt = [previous.providerCheckedAt, next.providerCheckedAt].filter((value): value is string => Boolean(value)).sort().at(-1) || null;
    return {
      ...latest, conversationIds,
      recheckRequestedAt, providerCheckedAt,
      nextSyncAt: (next.recheckRequestedAt || "") > (previous.recheckRequestedAt || "") ? next.nextSyncAt : latest.nextSyncAt,
      // A final snapshot for an older subset cannot complete newer conversations.
      complete: (previous.complete && conversationIds.every((value) => previous.conversationIds.includes(value))) || (next.complete && conversationIds.every((value) => next.conversationIds.includes(value))),
      trustedUnattributedImport: previous.trustedUnattributedImport || next.trustedUnattributedImport || undefined,
    };
  });
}

export function readUsageSession(id: string) {
  if (!sessionPattern.test(id)) return Promise.resolve(null);
  const [workspace, session] = id.split(".");
  return read<UsageSession>(`sessions/${workspace}/${session}`);
}

export async function readUsageSessions(workspaceId: string) {
  const sessions = await list<UsageSession>(`sessions/${scope(workspaceId)}`);
  if (sessions.some((session) => session.workspaceId !== workspaceId)) throw new Error("Usage workspace scope mismatch.");
  return sessions;
}

export const readAllUsageSessions = () => list<UsageSession>("sessions");
export const readUsageOutbox = () => list<UsageEvent>("outbox");
export const readWorkspaceOutbox = (workspaceId: string) => list<UsageEvent>(`outbox/${scope(workspaceId)}`);
const outboxKey = (event: UsageEvent) => `outbox/${scope(event.workspaceId)}/${event.id}_${createHash("sha256").update(JSON.stringify(event)).digest("hex").slice(0, 24)}`;
export function enqueueUsage(event: UsageEvent) {
  if (!event.workspaceId || !/^[a-zA-Z0-9_-]+$/.test(event.id)) throw new Error("Invalid usage record.");
  return write(outboxKey(event), event);
}
export async function removeUsageOutbox(event: UsageEvent) {
  const key = outboxKey(event);
  assertStorage();
  if (usageSupabaseConfigured()) { await usageSupabase().remove(key); return; }
  if (blobs()) { await store().delete(key); return; }
  await unlink(/*turbopackIgnore: true*/ path.join(root(), `${key}.json`)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}
export const readUsageWorkerState = () => read<UsageWorkerState>("system/worker");
export const saveUsageWorkerState = (state: UsageWorkerState) => write("system/worker", state);
export const usageStorageKind = () => usageSupabaseConfigured() ? "supabase" : blobs() ? "netlify-blobs" : "local-files";
export const readGeminiBilling = (workspaceId: string) => read<GeminiBillingReport>(`billing/${scope(workspaceId)}/gemini`);
export const saveGeminiBilling = (report: GeminiBillingReport) => upsert(`billing/${scope(report.workspaceId)}/gemini`, report, (previous, next) => previous && previous.refreshedAt > next.refreshedAt ? previous : next);
export const saveUsageWebhookReceipt = (workspaceId: string) => write(`system/webhooks/${scope(workspaceId)}`, { receivedAt: new Date().toISOString() });
export const readUsageWebhookReceipt = (workspaceId: string) => read<{ receivedAt: string }>(`system/webhooks/${scope(workspaceId)}`);

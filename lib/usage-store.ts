import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UsageContext, UsageEvent, UsageSession } from "@/features/usage/types";

const root = () => path.resolve(/*turbopackIgnore: true*/ process.env.EVERONN_USAGE_DIR || path.join(path.dirname(process.env.EVERONN_DATA_FILE || path.join(process.cwd(), "data", "everonn.json")), "usage"));
const blobs = () => process.env.NETLIFY === "true" || Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
const store = () => getStore({ name: "everonn-usage", consistency: "strong" });
const scope = (workspaceId: string) => createHash("sha256").update(workspaceId).digest("hex");
const sessionPattern = /^[a-f0-9]{64}\.[a-f0-9]{48}$/;

async function read<T>(key: string): Promise<T | null> {
  if (blobs()) return store().get(key, { type: "json", consistency: "strong" }) as Promise<T | null>;
  try { return JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(root(), `${key}.json`), "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function write(key: string, value: unknown) {
  if (blobs()) { await store().setJSON(key, value); return; }
  const file = path.join(root(), `${key}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporary, file);
}

async function list<T>(prefix: string): Promise<T[]> {
  if (blobs()) {
    const keys: string[] = [];
    for await (const page of store().list({ prefix: `${prefix}/`, paginate: true })) keys.push(...page.blobs.map((entry) => entry.key));
    return readMany<T>(keys);
  }
  let names: string[];
  try { names = await readdir(/*turbopackIgnore: true*/ path.join(root(), prefix)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return readMany<T>(names.filter((name) => name.endsWith(".json")).map((name) => `${prefix}/${name.slice(0, -5)}`));
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

export function recordUsage(event: UsageEvent) {
  if (!event.workspaceId || !/^[a-zA-Z0-9_-]+$/.test(event.id)) throw new Error("Invalid usage record.");
  return upsert(`events/${scope(event.workspaceId)}/${event.id}`, event, (previous, next) => {
    if (!previous) return next;
    if (previous.workspaceId !== next.workspaceId) throw new Error("Usage workspace scope mismatch.");
    // A slow in-progress read must never erase already-final provider charges.
    if (previous.status !== "pending" && next.status === "pending") return previous;
    if (previous.recordedAt > next.recordedAt) return previous;
    return next;
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
  return upsert(`sessions/${workspace}/${id}`, session, (previous, next) => previous ? {
    ...next, conversationIds: [...new Set([...previous.conversationIds, ...next.conversationIds])],
    syncedAt: [previous.syncedAt, next.syncedAt].filter((value): value is string => Boolean(value)).sort().at(-1) || null,
    complete: previous.complete || next.complete,
  } : next);
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

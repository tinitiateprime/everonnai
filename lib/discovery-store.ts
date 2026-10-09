import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { discoverySchema } from "./input";
import {
  MAX_CRAWL_PAGES,
  MAX_CRAWL_URLS,
  MAX_SOURCE_BYTES,
} from "./crawl-limits";
import type { CrawlState, Discovery } from "./types";

const cursorSchema = z.object({
  id: z.uuid(),
  result: discoverySchema,
  root: z.string().max(2048),
  robotsText: z.string().max(3_000_000),
  queue: z.array(z.string().max(2048)).max(MAX_CRAWL_URLS),
  seen: z.array(z.string().max(2048)).max(MAX_CRAWL_PAGES * 3),
});
function filePath(id: string, kind: "crawl" | "snapshot") {
  if (!z.uuid().safeParse(id).success)
    throw new Error("Invalid discovery identity.");
  const root = path.resolve(
    /* turbopackIgnore: true */ process.env.CRAWL_STORAGE_DIR ||
      path.join(process.cwd(), "data", "crawls"),
  );
  return path.join(root, `${kind}-${id}.json`);
}
async function writeRecord(
  id: string,
  kind: "crawl" | "snapshot",
  data: unknown,
) {
  const file = filePath(id, kind);
  const temporary = `${file}.${randomUUID()}.tmp`;
  const payload = JSON.stringify({ version: 1, data });
  if (Buffer.byteLength(payload) > MAX_SOURCE_BYTES)
    throw new Error(
      "Discovery storage reached its 64 MB limit. The last saved pages remain available for generation.",
    );
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } catch {
    throw new Error(
      "Could not save crawl progress. Configure a writable CRAWL_STORAGE_DIR and retry.",
    );
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
async function readRecord(id: string, kind: "crawl" | "snapshot") {
  const file = filePath(id, kind);
  try {
    if ((await stat(file)).size > MAX_SOURCE_BYTES)
      throw new Error("Oversized discovery");
    const record = JSON.parse(await readFile(file, "utf8"));
    if (record.version !== 1) throw new Error("Invalid discovery");
    return record.data;
  } catch {
    throw new Error(
      "Saved website knowledge could not be loaded. Read the website again or use the captured browser knowledge.",
    );
  }
}
export async function saveCrawl(state: CrawlState) {
  await writeRecord(state.id, "crawl", state);
}
export async function readCrawl(id: string): Promise<CrawlState> {
  const state = cursorSchema.parse(await readRecord(id, "crawl"));
  if (state.id !== id || state.result.crawl?.id !== id)
    throw new Error("Invalid crawl identity.");
  return state;
}
export async function snapshotDiscovery(discovery: Discovery) {
  const id = randomUUID();
  await writeRecord(id, "snapshot", discovery);
  return id;
}
export async function readDiscoverySnapshot(id: string): Promise<Discovery> {
  return discoverySchema.parse(await readRecord(id, "snapshot"));
}
export async function generationDiscovery(data: {
  discovery?: Discovery | null;
  discoveryId?: string;
  sourceSnapshotId?: string;
}) {
  if (data.sourceSnapshotId)
    return readDiscoverySnapshot(data.sourceSnapshotId);
  if (data.discoveryId) return (await readCrawl(data.discoveryId)).result;
  return data.discovery ?? null;
}
const running = new Set<string>();
export async function withCrawlLock<T>(id: string, action: () => Promise<T>) {
  if (running.has(id))
    throw new Error(
      "This crawl is already running. Wait for the current batch before continuing.",
    );
  running.add(id);
  try {
    return await action();
  } finally {
    running.delete(id);
  }
}

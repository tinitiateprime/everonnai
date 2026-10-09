import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { Artifact, Discovery, Knowledge, SitePage } from "./types";
import { PAGE_SLUG } from "./site-pages";
import { knowledgePacket } from "./prompts";
import { knowledgeSchema } from "./types";
import { discoverySchema } from "./input";
import { MAX_SOURCE_BYTES } from "./crawl-limits";

export class SiteRevisionConflict extends Error {
  constructor() {
    super(
      "This version has changed in another request. Reload your latest saved design before editing again.",
    );
  }
}
const writes = new Map<string, Promise<void>>();

const validSlug = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}-]{0,99}$/u;
export const isValidSlug = (slug: string) => validSlug.test(slug);
export function businessSlug(businessName: string, description: string) {
  let slug = businessName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  if (!slug || !validSlug.test(slug))
    slug = `business-${createHash("sha256").update(description).digest("hex").slice(0, 10)}`;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug)) slug += "-business";
  return slug;
}
export function websitePath(slug: string, index: number) {
  if (
    !validSlug.test(slug) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 2
  )
    throw new Error("Invalid website address.");
  return `/service/${encodeURIComponent(slug)}/${index + 1}`;
}
function filePath(slug: string, version: string) {
  if (!validSlug.test(slug) || !/^[123]$/.test(version)) return null;
  const root = path.resolve(
    /* turbopackIgnore: true */
    process.env.GENERATED_SITES_DIR ||
      path.join(process.cwd(), "data", "generated-sites"),
  );
  const file = path.resolve(root, slug, `${version}.json`);
  if (!file.startsWith(root + path.sep)) return null;
  return file;
}
// Serializes writes per stored version within this process.
async function locked<T>(file: string, task: () => Promise<T>) {
  const pending = writes.get(file) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = pending.then(() => gate);
  writes.set(file, queued);
  await pending;
  try {
    return await task();
  } finally {
    release();
    if (writes.get(file) === queued) writes.delete(file);
  }
}
async function writeRecord(file: string, record: object) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const payload = JSON.stringify(record);
    if (Buffer.byteLength(payload) > MAX_SOURCE_BYTES)
      throw new Error("Stored website exceeds the size limit.");
    await writeFile(temporary, payload, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, file);
  } catch {
    throw new Error(
      "Could not save the generated website. Configure a writable generated-site storage directory and retry.",
    );
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
export async function saveGeneratedSite(
  knowledge: Knowledge,
  artifact: Artifact,
  discovery: Discovery | null = null,
  expectedRevision?: string,
  // Home-page edits keep the version's built pages; a regenerated design replaces them.
  // A slug list keeps only those pages (a rebuild with a new page plan).
  options: { keepPages?: boolean | string[] } = {},
): Promise<Artifact> {
  const slug = businessSlug(knowledge.businessName, knowledge.description);
  const sitePath = websitePath(slug, artifact.index);
  const version = String(artifact.index + 1);
  const file = filePath(slug, version)!;
  return locked(file, async () => {
    const current = await readGeneratedSite(slug, version).catch(() => null);
    if (expectedRevision && current?.id !== expectedRevision)
      throw new SiteRevisionConflict();
    const { pages: incomingPages, ...rest } = artifact;
    const keep = options.keepPages;
    const pages = !keep
      ? incomingPages
      : current?.pages?.filter((p) => keep === true || keep.includes(p.slug));
    const saved: Artifact = {
      ...rest,
      ...(pages?.length ? { pages } : {}),
      path: sitePath,
    };
    await writeRecord(file, {
      version: 1,
      slug,
      businessName: knowledge.businessName,
      artifact: saved,
      knowledgeJson: knowledgePacket(knowledge, discovery),
      generationContext: { knowledge, discovery },
    });
    return saved;
  });
}
/** Adds or replaces one inner page of a saved version, keeping everything else. */
export async function saveSitePage(
  slug: string,
  version: string,
  page: SitePage,
  expected: { designId: string; pageCreatedAt?: string },
  // During a "Build full site" run, pages outside the new plan are dropped.
  keepOnly?: string[],
): Promise<Artifact> {
  const file = filePath(slug, version);
  if (!file || !PAGE_SLUG.test(page.slug))
    throw new Error("Invalid website address.");
  return locked(file, async () => {
    const record = await readRawRecord(slug, version);
    if (!record) throw new Error("This saved website could not be found.");
    const artifact: Artifact = record.artifact;
    const existing = artifact.pages?.find((p) => p.slug === page.slug);
    if (
      (artifact.designId ?? artifact.id) !== expected.designId ||
      (expected.pageCreatedAt !== undefined &&
        existing?.createdAt !== expected.pageCreatedAt)
    )
      throw new SiteRevisionConflict();
    const pages = [
      ...(artifact.pages ?? []).filter(
        (p) => p.slug !== page.slug && (!keepOnly || keepOnly.includes(p.slug)),
      ),
      page,
    ];
    const saved = { ...artifact, pages };
    await writeRecord(file, { ...record, artifact: saved });
    return saved;
  });
}
export async function readGeneratedSite(
  slug: string,
  version: string,
): Promise<Artifact | null> {
  return (await readGeneratedSiteRecord(slug, version))?.artifact ?? null;
}
async function readRawRecord(slug: string, version: string) {
  const parsed = await readGeneratedSiteRecord(slug, version);
  if (!parsed) return null;
  return JSON.parse(await readFile(filePath(slug, version)!, "utf8"));
}
export async function readGeneratedSiteRecord(
  slug: string,
  version: string,
): Promise<{
  artifact: Artifact;
  businessName: string;
  knowledgeJson: string | null;
  generationContext: {
    knowledge: Knowledge;
    discovery: Discovery | null;
  } | null;
} | null> {
  const file = filePath(slug, version);
  if (!file) return null;
  try {
    if ((await stat(file)).size > MAX_SOURCE_BYTES)
      throw new Error("Stored website exceeds the size limit.");
    const record = JSON.parse(await readFile(file, "utf8"));
    if (
      record.version !== 1 ||
      record.slug !== slug ||
      record.artifact?.index !== Number(version) - 1 ||
      typeof record.artifact?.html !== "string" ||
      typeof record.artifact?.id !== "string" ||
      record.artifact.path !== websitePath(slug, Number(version) - 1)
    )
      throw new Error("Invalid stored website.");
    return {
      artifact: record.artifact,
      businessName:
        typeof record.businessName === "string" ? record.businessName : "",
      knowledgeJson:
        typeof record.knowledgeJson === "string" ? record.knowledgeJson : null,
      generationContext: record.generationContext
        ? {
            knowledge: knowledgeSchema.parse(
              record.generationContext.knowledge,
            ),
            discovery: discoverySchema
              .nullable()
              .parse(record.generationContext.discovery),
          }
        : null,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}

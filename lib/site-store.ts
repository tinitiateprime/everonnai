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
import type { Artifact, Discovery, Knowledge } from "./types";
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
export async function saveGeneratedSite(
  knowledge: Knowledge,
  artifact: Artifact,
  discovery: Discovery | null = null,
  expectedRevision?: string,
): Promise<Artifact> {
  const slug = businessSlug(knowledge.businessName, knowledge.description);
  const sitePath = websitePath(slug, artifact.index);
  const file = filePath(slug, String(artifact.index + 1))!;
  const saved = { ...artifact, path: sitePath };
  const temporary = `${file}.${randomUUID()}.tmp`;
  const pending = writes.get(file) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = pending.then(() => gate);
  writes.set(file, queued);
  await pending;
  try {
    if (
      expectedRevision &&
      (await readGeneratedSite(slug, String(artifact.index + 1)))?.id !==
        expectedRevision
    )
      throw new SiteRevisionConflict();
    await mkdir(path.dirname(file), { recursive: true });
    const payload = JSON.stringify({
      version: 1,
      slug,
      businessName: knowledge.businessName,
      artifact: saved,
      knowledgeJson: knowledgePacket(knowledge, discovery),
      generationContext: { knowledge, discovery },
    });
    if (Buffer.byteLength(payload) > MAX_SOURCE_BYTES)
      throw new Error("Stored website exceeds the size limit.");
    await writeFile(temporary, payload, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, file);
  } catch (error) {
    if (error instanceof SiteRevisionConflict) throw error;
    throw new Error(
      "Could not save the generated website. Configure a writable generated-site storage directory and retry.",
    );
  } finally {
    await unlink(temporary).catch(() => {});
    release();
    if (writes.get(file) === queued) writes.delete(file);
  }
  return saved;
}
export async function readGeneratedSite(
  slug: string,
  version: string,
): Promise<Artifact | null> {
  return (await readGeneratedSiteRecord(slug, version))?.artifact ?? null;
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

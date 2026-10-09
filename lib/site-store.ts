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
): Promise<Artifact> {
  const slug = businessSlug(knowledge.businessName, knowledge.description);
  const sitePath = websitePath(slug, artifact.index);
  const file = filePath(slug, String(artifact.index + 1))!;
  const saved = { ...artifact, path: sitePath };
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      temporary,
      JSON.stringify({
        version: 1,
        slug,
        businessName: knowledge.businessName,
        artifact: saved,
        knowledgeJson: knowledgePacket(knowledge, discovery),
      }),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await rename(temporary, file);
  } catch {
    throw new Error(
      "Could not save the generated website. Configure a writable generated-site storage directory and retry.",
    );
  } finally {
    await unlink(temporary).catch(() => {});
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
} | null> {
  const file = filePath(slug, version);
  if (!file) return null;
  try {
    if ((await stat(file)).size > 8_000_000)
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

import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SKILL_FILES, EVALUATION_FILES, type SkillKey, type EvaluationKey } from "./skill-registry";
import type { SkillTrace } from "./types";

const cache = new Map<string, { text: string; trace: SkillTrace }>();

export function loadSkill(id: SkillKey) {
  if (!Object.hasOwn(SKILL_FILES, id)) throw new Error("Unknown skill; arbitrary paths cannot be loaded.");
  return loadDocument(id, SKILL_FILES[id]);
}

export function loadEvaluation(id: EvaluationKey) {
  if (!Object.hasOwn(EVALUATION_FILES, id)) throw new Error("Unknown evaluation; arbitrary paths cannot be loaded.");
  return loadDocument(`evaluation:${id}`, EVALUATION_FILES[id]);
}

function loadDocument(id: string, file: string) {
  const saved = cache.get(id);
  if (saved && process.env.NODE_ENV === "production") return saved;
  const source = readFileSync(path.join(process.cwd(), "ai", file), "utf8").trim();
  const version = source.match(/^Version: ([\d.]+)$/m)?.[1];
  if (!version || !source || source.length > 24_000) throw new Error(`Invalid or unversioned skill: ${id}.`);
  const loaded = { text: source, trace: { id, version, digest: createHash("sha256").update(source).digest("hex") } };
  cache.set(id, loaded);
  return loaded;
}

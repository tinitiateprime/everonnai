import "server-only";
import { EVALUATION_FILES, type EvaluationKey } from "./skill-registry";
import { loadEvaluation } from "./skill-loader";

const checks = ["runtime-boundaries", "provider-availability", "domain-selection", "memory-lifecycle", "safety", "booking-clarification", "confirmation-filter", "website-grounding", "live-assistant"] as const;
export type EvaluationCase = { id: string; check: typeof checks[number]; message?: string; includes?: string[]; excludes?: string[] };

export function parseEvaluationCases(text: string): EvaluationCase[] {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (blocks.length !== 1) throw new Error("An evaluation document must contain exactly one JSON case block.");
  const input: unknown = JSON.parse(blocks[0][1]);
  if (!Array.isArray(input) || !input.length || input.length > 200) throw new Error("Invalid evaluation case collection.");
  const ids = new Set<string>();
  return input.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid evaluation case.");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["id", "check", "message", "includes", "excludes"].includes(key))
      || typeof row.id !== "string" || !/^[a-z][a-z0-9.-]{3,100}$/.test(row.id) || ids.has(row.id)
      || !checks.includes(row.check as EvaluationCase["check"])) throw new Error("Unknown or duplicate evaluation case.");
    ids.add(row.id);
    if (row.message !== undefined && (typeof row.message !== "string" || !row.message.trim() || row.message.length > 3000)) throw new Error("Invalid evaluation message.");
    if (["safety", "booking-clarification", "confirmation-filter", "live-assistant"].includes(String(row.check)) && !row.message) throw new Error("Evaluation message required.");
    for (const field of ["includes", "excludes"]) {
      if (row[field] !== undefined && (!Array.isArray(row[field]) || row[field].length > 20 || row[field].some((item: unknown) => typeof item !== "string" || !item || item.length > 200))) throw new Error("Invalid evaluation expectations.");
    }
    return row as EvaluationCase;
  });
}

export function loadEvaluationSuite() {
  const documents = (Object.keys(EVALUATION_FILES) as EvaluationKey[]).map((id) => {
    const loaded = loadEvaluation(id);
    return { ...loaded, cases: parseEvaluationCases(loaded.text) };
  });
  const cases = documents.flatMap((document) => document.cases);
  if (new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error("Evaluation IDs must be unique across documents.");
  return { cases, trace: documents.map((document) => document.trace) };
}

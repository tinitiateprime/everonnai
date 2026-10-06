import type { AgentCapability, DomainSkillId } from "./types";

export const DOMAIN_SKILLS: ReadonlyArray<{ id: DomainSkillId; label: string }> = [
  { id: "general", label: "General service business" },
  { id: "hvac", label: "HVAC · Heating & cooling" },
];

export const SKILL_FILES = {
  system: "SYSTEM.md",
  guardrails: "GUARDRAILS.md",
  plugins: "PLUGINS.md",
  memory: "MEMORY.md",
  "domain:hvac": "domains/hvac/SKILL.md",
  "safety:hvac": "domains/hvac/GUARDRAILS.md",
  "sources:hvac": "domains/hvac/SOURCES.md",
  "capability:assistant": "capabilities/assistant/SKILL.md",
  "capability:appointment-booking": "capabilities/appointment-booking/SKILL.md",
  "capability:website-building": "capabilities/website-building/SKILL.md",
} as const;
export type SkillKey = keyof typeof SKILL_FILES;

// Evaluation datasets are deliberately outside the production instruction registry.
export const EVALUATION_FILES = {
  assistant: "capabilities/assistant/EVALS.md",
  "appointment-booking": "capabilities/appointment-booking/EVALS.md",
  "website-building": "capabilities/website-building/EVALS.md",
  hvac: "domains/hvac/EVALS.md",
} as const;
export type EvaluationKey = keyof typeof EVALUATION_FILES;

export function selectedDomains(profile: { skillId?: DomainSkillId; domainSkillIds?: DomainSkillId[] }): DomainSkillId[] {
  const selected = [...new Set([profile.skillId || "general", ...(profile.domainSkillIds || [])])];
  if (selected.some((id) => !DOMAIN_SKILLS.some((skill) => skill.id === id))) throw new Error("Select a registered industry skill.");
  return selected.filter((id) => id !== "general");
}

export function capabilityKeys(capabilities: AgentCapability[]): SkillKey[] {
  return [...new Set(capabilities)].map((id) => {
    const key = `capability:${id}` as SkillKey;
    if (!(key in SKILL_FILES)) throw new Error("Unknown agent capability.");
    return key;
  });
}

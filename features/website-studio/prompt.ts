import "server-only";
import type { BusinessProfile } from "@/features/everonn/types";
import type { ScopedMemory } from "@/features/agent-runtime/types";
import { composeAgentContext } from "@/features/agent-runtime/prompt-composer";
import { normalizeWebsiteBusinessProfile } from "./generator";

export function buildWebsitePrompt(input: BusinessProfile, memory?: ScopedMemory[]) {
  return composeAgentContext({ profile: normalizeWebsiteBusinessProfile(input), capabilities: ["website-building"], memory });
}

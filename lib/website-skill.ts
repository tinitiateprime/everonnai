import { readFile } from "node:fs/promises";
import path from "node:path";

/** Loads a runtime agent skill from ai/capabilities/{name}/SKILL.md. */
export async function readSkill(name: string, label = name) {
  try {
    const skill = await readFile(
      path.join(process.cwd(), "ai", "capabilities", name, "SKILL.md"),
      "utf8",
    );
    if (skill.length < 500 || skill.length > 30000)
      throw new Error("Invalid skill");
    return `${label} SKILL.md instructions:\n${skill}`;
  } catch {
    throw new Error(
      `${label} SKILL.md is missing or invalid. Restore the instructions before retrying.`,
    );
  }
}
export async function readWebsiteSkill() {
  try {
    return await readSkill("website-building", "Website-building");
  } catch {
    throw new Error(
      "Website-building SKILL.md is missing or invalid. Restore the generation instructions before retrying.",
    );
  }
}

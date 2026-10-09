import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readWebsiteSkill() {
  try {
    const skill = await readFile(
      path.join(
        process.cwd(),
        "ai",
        "capabilities",
        "website-building",
        "SKILL.md",
      ),
      "utf8",
    );
    if (skill.length < 500 || skill.length > 30000)
      throw new Error("Invalid skill");
    return `Website-building SKILL.md instructions:\n${skill}`;
  } catch {
    throw new Error(
      "Website-building SKILL.md is missing or invalid. Restore the generation instructions before retrying.",
    );
  }
}

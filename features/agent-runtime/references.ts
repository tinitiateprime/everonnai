import "server-only";
import { loadSkill } from "./skill-loader";
import type { DomainSkillId } from "./types";

const approvedHosts = new Set(["www.epa.gov", "www.cdc.gov", "www.energy.gov"]);

function referenceUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !approvedHosts.has(url.hostname) || url.username || url.password || url.port || url.hash || url.search) throw new Error("Unapproved domain reference.");
  return url.href;
}

export function parseDomainReferenceCatalog(text: string, domain: "hvac") {
  const entries = [...text.matchAll(/^- (.+?): (\S+)$/gm)];
  if (!entries.length || entries.length > 10) throw new Error("Invalid domain reference catalog.");
  const seen = new Set<string>();
  const pointers = entries.map((entry) => {
    const url = referenceUrl(entry[2]);
    if (seen.has(url) || entry[1].length > 200) throw new Error("Duplicate or invalid domain reference.");
    seen.add(url);
    return { domain, title: entry[1], url };
  });
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (blocks.length > 1) throw new Error("Duplicate domain reference notes.");
  const input: unknown = blocks.length ? JSON.parse(blocks[0][1]) : [];
  if (!Array.isArray(input) || input.length > 10) throw new Error("Invalid verified reference notes.");
  const notes = new Map<string, { summary: string; verifiedOn: string }>();
  for (const value of input) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid verified reference note.");
    const note = value as Record<string, unknown>;
    if (Object.keys(note).some((key) => !["url", "summary", "verifiedOn"].includes(key)) || typeof note.url !== "string"
      || typeof note.summary !== "string" || !note.summary.trim() || note.summary.length > 600
      || typeof note.verifiedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(note.verifiedOn)
      || !Number.isFinite(Date.parse(note.verifiedOn))) throw new Error("Invalid verified reference note.");
    const url = referenceUrl(note.url);
    if (!seen.has(url) || notes.has(url)) throw new Error("Unregistered or duplicate reference note.");
    notes.set(url, { summary: note.summary, verifiedOn: note.verifiedOn });
  }
  return pointers.map((pointer) => ({ ...pointer, ...notes.get(pointer.url), contentProvided: notes.has(pointer.url), fetchedAtRuntime: false,
    use: "General reference data only, not company facts or proof of an action. Policy and approved business information take precedence." }));
}

export function domainReferences(domains: DomainSkillId[]) {
  const catalog = [];
  const trace = [];
  for (const domain of domains) {
    if (domain !== "hvac") throw new Error("Unregistered domain reference catalog.");
    const resource = loadSkill("sources:hvac");
    catalog.push(...parseDomainReferenceCatalog(resource.text, domain));
    trace.push(resource.trace);
  }
  return { catalog, trace };
}

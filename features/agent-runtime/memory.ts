import type { BusinessProfile } from "@/features/everonn/types";
import { authorizeWorkspaceAction } from "@/features/auth/rbac";
import type { WorkspaceRole } from "@/features/everonn/types";
import type { ScopedMemory, WebsitePreferences, WebsiteSection } from "./types";

export const MAIN_SITE_PROJECT = "main-site";
export const WEBSITE_SECTIONS: WebsiteSection[] = ["services", "benefits", "about", "process", "gallery", "faq", "contact"];
export const EMPTY_WEBSITE_PREFERENCES: WebsitePreferences = {
  brief: "", accepted: [], rejected: [], primaryColor: "", accentColor: "", heroLayout: "auto", serviceLayout: "auto",
  typography: "auto", density: "auto", imagery: "auto", priorityServiceId: "", hiddenSections: [],
};

function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }

function rejectSecrets(value: string) {
  if (/\b(?:AIza[\w-]{30,}|github_pat_[\w]{20,}|gh[pousr]_[\w]{20,})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[\w.-]{20,}/i.test(value)) {
    invalid("Keep credentials and private keys out of website preferences and remembered requests.");
  }
}

export function validateWebsitePreferences(input: unknown, profile: BusinessProfile): WebsitePreferences {
  return parseWebsitePreferences(input, profile.services);
}

function parseWebsitePreferences(input: unknown, services?: BusinessProfile["services"]): WebsitePreferences {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Website preferences must be an object.");
  const value = input as Record<string, unknown>;
  const string = (key: string, max: number) => {
    const field = value[key] ?? "";
    if (typeof field !== "string" || field.length > max) invalid(`Invalid website preference: ${key}.`);
    rejectSecrets(field);
    return field.trim();
  };
  const choice = <T extends string>(key: string, options: readonly T[]): T => {
    const field = value[key] ?? "auto";
    if (!options.includes(field as T)) invalid(`Invalid website preference: ${key}.`);
    return field as T;
  };
  const rows = (key: string) => {
    const field = value[key] ?? [];
    if (!Array.isArray(field) || field.length > 20 || field.some((row) => typeof row !== "string" || row.length > 300)) invalid(`Invalid website preference: ${key}.`);
    field.forEach((row) => rejectSecrets(row));
    return [...new Set((field as string[]).map((row) => row.trim()).filter(Boolean))];
  };
  const primaryColor = string("primaryColor", 7), accentColor = string("accentColor", 7);
  if ([primaryColor, accentColor].some((color) => color && !/^#[0-9a-f]{6}$/i.test(color))) invalid("Use six-digit hex website colors.");
  const priorityServiceId = string("priorityServiceId", 160);
  if (priorityServiceId && services && !services.some((service) => service.active && service.id === priorityServiceId)) invalid("The priority service must be an active business service.");
  const hiddenSections = rows("hiddenSections");
  if (hiddenSections.some((id) => !WEBSITE_SECTIONS.includes(id as WebsiteSection) || id === "services" || id === "contact")) invalid("Services and contact must remain visible.");
  return {
    brief: string("brief", 3000), accepted: rows("accepted"), rejected: rows("rejected"), primaryColor, accentColor, priorityServiceId,
    heroLayout: choice("heroLayout", ["auto", "split", "immersive", "centered"]),
    serviceLayout: choice("serviceLayout", ["auto", "cards", "editorial", "featured"]),
    typography: choice("typography", ["auto", "editorial", "modern", "technical"]),
    density: choice("density", ["auto", "airy", "compact"]), imagery: choice("imagery", ["auto", "equipment", "people", "none"]),
    hiddenSections: hiddenSections as WebsiteSection[],
  };
}

export function retrieveWebsiteMemory(records: ScopedMemory[] | undefined, workspaceId: string, projectId = MAIN_SITE_PROJECT) {
  return (records || []).filter((record) => record.workspaceId === workspaceId && record.approved === true
    && record.capability === "website-building" && record.key === "website-preferences"
    && (record.scope === "workspace" || (record.scope === "project" && record.projectId === projectId)))
    .sort((left, right) => Number(left.scope === "project") - Number(right.scope === "project") || left.updatedAt.localeCompare(right.updatedAt));
}

export function resolvedWebsitePreferences(records: ScopedMemory[] | undefined, workspaceId: string) {
  const selected = retrieveWebsiteMemory(records, workspaceId);
  return selected.at(-1)?.value || { ...EMPTY_WEBSITE_PREFERENCES };
}

export function saveWebsiteMemory(input: {
  records?: ScopedMemory[]; profile: BusinessProfile; actor: { workspaceId: string; role: WorkspaceRole; userId: string };
  preferences: unknown; changeRequest?: unknown; expectedRevision?: string | null; scope?: "workspace" | "project";
}) {
  authorizeWorkspaceAction(input.actor, input.profile, "website:publish");
  const scope = input.scope || "project";
  const records = input.records || [];
  validateMemoryScope(records, input.profile.workspaceId);
  const current = records.find((record) => record.workspaceId === input.profile.workspaceId && record.scope === scope
    && record.key === "website-preferences" && (scope === "workspace" || record.projectId === MAIN_SITE_PROJECT));
  if (input.expectedRevision !== undefined && input.expectedRevision !== (current?.revision || null)) {
    throw Object.assign(new Error("Website preferences changed. Refresh before saving your changes."), { status: 409 });
  }
  if (input.changeRequest !== undefined && (typeof input.changeRequest !== "string" || input.changeRequest.length > 3000)) invalid("Keep the website change request below 3,000 characters.");
  const value = validateWebsitePreferences(input.preferences, input.profile);
  const now = new Date().toISOString();
  const request = typeof input.changeRequest === "string" ? input.changeRequest.trim() : "";
  rejectSecrets(request);
  // A new owner instruction must not be silently overridden by an older pinned design control.
  // This only changes presentation defaults; the model interprets the full chronological request.
  const unchangedColors = current && value.primaryColor === current.value.primaryColor && value.accentColor === current.value.accentColor;
  if (request && unchangedColors && !/\b(?:keep|preserve|don't change|do not change)\s+(?:the\s+)?(?:colors?|colours?|palette)\b/i.test(request)) {
    if (/\b(?:colors?|colours?|palette|black|gold|green|blue|red|white|purple|orange|navy|beige|teal)\b/i.test(request)) {
      value.primaryColor = ""; value.accentColor = "";
    }
  }
  if (current && value.heroLayout === current.value.heroLayout && /\b(?:hero|banner)\b/i.test(request)) value.heroLayout = "auto";
  if (current && value.typography === current.value.typography && /\b(?:typography|typeface|fonts?)\b/i.test(request)) value.typography = "auto";
  if (current && value.density === current.value.density && /\b(?:spacing|whitespace|spacious|compact)\b/i.test(request)) value.density = "auto";
  if (/\b(?:no|remove|without)\s+(?:all\s+)?(?:photos?|photography|images?)\b/i.test(request)) value.imagery = "none";
  else if (/\b(?:equipment|interior)\s+(?:photos?|photography|images?|imagery)\b|\b(?:no|avoid|without|don't use|do not use)\s+technician\b/i.test(request)) value.imagery = "equipment";
  const record: ScopedMemory = {
    id: current?.id || `memory_${crypto.randomUUID()}`, workspaceId: input.profile.workspaceId, scope,
    ...(scope === "project" ? { projectId: MAIN_SITE_PROJECT } : {}), capability: "website-building", key: "website-preferences", value,
    requests: [...(current?.requests || []), ...(request ? [{ text: request, at: now }] : [])].slice(-20),
    source: "owner-settings", approved: true, updatedBy: input.actor.userId, revision: crypto.randomUUID(), createdAt: current?.createdAt || now, updatedAt: now,
  };
  return [...records.filter((item) => item.id !== record.id), record];
}

export function validateMemoryScope(records: ScopedMemory[] | undefined, workspaceId: string) {
  if (records !== undefined && (!Array.isArray(records) || records.length > 100)) invalid("Invalid AI memory collection.");
  const ids = new Set<string>(), scopes = new Set<string>();
  for (const record of records || []) {
    if (!record || record.workspaceId !== workspaceId || record.key !== "website-preferences" || record.capability !== "website-building"
      || !["workspace", "project"].includes(record.scope) || (record.scope === "project" && record.projectId !== MAIN_SITE_PROJECT)
      || record.approved !== true || record.source !== "owner-settings" || !Array.isArray(record.requests) || record.requests.length > 20
      || !record.value || Object.keys(record.value).some((key) => !Object.hasOwn(EMPTY_WEBSITE_PREFERENCES, key))
      || typeof record.id !== "string" || !record.id || typeof record.revision !== "string" || !record.revision || typeof record.updatedBy !== "string"
      || typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))) invalid("AI memory is outside its approved workspace scope.");
    if (ids.has(record.id) || scopes.has(record.scope)) invalid("Duplicate approved memory scope.");
    ids.add(record.id); scopes.add(record.scope);
    for (const request of record.requests) {
      if (!request || typeof request.text !== "string" || request.text.length > 3000 || typeof request.at !== "string" || !Number.isFinite(Date.parse(request.at))) invalid("Invalid remembered request.");
      rejectSecrets(request.text);
    }
    // A removed priority service must not prevent an owner from reading or forgetting existing preferences.
    parseWebsitePreferences(record.value);
  }
}

export function forgetWebsiteMemory(input: {
  records?: ScopedMemory[]; profile: BusinessProfile; actor: { workspaceId: string; role: WorkspaceRole };
  scope: "workspace" | "project"; expectedRevision: string | null;
}) {
  authorizeWorkspaceAction(input.actor, input.profile, "website:publish");
  const records = input.records || [];
  validateMemoryScope(records, input.profile.workspaceId);
  if (!["workspace", "project"].includes(input.scope)) invalid("Invalid memory scope.");
  const current = records.find((record) => record.scope === input.scope && (record.scope === "workspace" || record.projectId === MAIN_SITE_PROJECT));
  if (input.expectedRevision !== (current?.revision || null)) throw Object.assign(new Error("Website preferences changed. Refresh before forgetting them."), { status: 409 });
  return records.filter((record) => record.id !== current?.id);
}

import { randomUUID } from "node:crypto";
import type { BusinessProfile } from "@/features/everonn/types";
import type { ActionLinks } from "./types";

export function bad(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) bad("Send a JSON object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 2400) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > max) bad("Invalid " + label + ".");
  return value.trim();
}
export function actionLinks(input: unknown): ActionLinks {
  const result: ActionLinks = {};
  for (const [key, value] of Object.entries(object(input ?? {}))) {
    if (!["booking", "chat", "voice"].includes(key)) bad("Unknown action; use booking, chat or voice.");
    if (value === "" || value === null) continue;
    const url = text(value, key + " URL", 2000);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) bad("Action URLs must be full HTTPS URLs without credentials.");
    } catch { bad("Action URLs must be full HTTPS URLs without credentials."); }
    result[key as keyof ActionLinks] = url;
  }
  return result;
}
export function businessProfile(input: unknown, current: BusinessProfile): BusinessProfile {
  const fields = object(input);
  const allowed = ["businessName", "businessType", "description", "phone", "email", "website", "location", "serviceArea", "hours", "timeZone", "skillId", "services", "knowledge", "verified"];
  if (Object.keys(fields).some((key) => !allowed.includes(key))) bad("Profile fields: " + allowed.join(", ") + ".");
  const next = { ...current };
  for (const key of ["businessName", "businessType", "description", "phone", "email", "website", "location", "serviceArea", "hours", "timeZone"] as const) {
    if (key in fields) next[key] = text(fields[key], key, key === "description" ? 2400 : 500);
  }
  if ("skillId" in fields) {
    if (!["general", "hvac"].includes(String(fields.skillId))) bad("skillId must be general or hvac.");
    next.skillId = fields.skillId as "general" | "hvac";
  }
  if ("verified" in fields) {
    if (typeof fields.verified !== "boolean") bad("verified must be a boolean.");
    next.verified = fields.verified;
  }
  if ("services" in fields) {
    if (!Array.isArray(fields.services) || !fields.services.length || fields.services.length > 16) bad("Add 1 to 16 services.");
    next.services = fields.services.map((value) => {
      const service = object(value);
      const id = text(service.id, "service ID", 100) || randomUUID();
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) bad("Service IDs may contain letters, digits, underscores and hyphens.");
      const name = text(service.name, "service name", 120);
      if (!name) bad("Every service needs a name.");
      if (service.active !== undefined && typeof service.active !== "boolean") bad("Service active must be a boolean.");
      return { id, name, description: text(service.description, "service description", 1200), active: service.active !== false };
    });
    if (new Set(next.services.map((service) => service.id)).size !== next.services.length) bad("Service IDs must be unique.");
  }
  if ("knowledge" in fields) {
    if (!Array.isArray(fields.knowledge) || fields.knowledge.length > 50) bad("Add at most 50 knowledge entries.");
    next.knowledge = fields.knowledge.map((value) => {
      const item = object(value);
      if (item.approved !== undefined && typeof item.approved !== "boolean") bad("Knowledge approved must be a boolean.");
      const category = item.category || "faq";
      if (!["service", "faq", "policy", "pricing", "handoff"].includes(String(category))) bad("Invalid knowledge category.");
      return { id: text(item.id, "knowledge ID", 100) || randomUUID(), category: category as "faq", question: text(item.question, "knowledge question", 500), answer: text(item.answer, "knowledge answer", 2400), approved: item.approved === true, updatedAt: new Date().toISOString() };
    });
  }
  if (!next.businessName || !next.businessType || next.description.length < 40 || !next.services.some((service) => service.active)) bad("Add a business name, business type, description of at least 40 characters and an active service.");
  if (!next.email && !next.phone) bad("Add a real email or phone number.");
  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) bad("Invalid business email.");
  if (next.phone && !/^\+?[\d ()-]{5,40}$/.test(next.phone)) bad("Invalid business phone.");
  try { new Intl.DateTimeFormat("en", { timeZone: next.timeZone }).format(); } catch { bad("Use a valid IANA timeZone, such as Asia/Kolkata."); }
  next.updatedAt = new Date().toISOString();
  return next;
}

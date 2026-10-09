import { randomUUID } from "node:crypto";
import { createStarterWorkspace } from "@/features/everonn/starter-workspace";
import { createWebsiteJobRunner } from "@/features/website-studio/jobs";
import { WEBSITE_CONCEPTS } from "@/features/website-studio/generator";
import { publishWebsiteRevision, rollbackWebsiteRelease } from "@/features/website-studio/releases";
import { liveWebsite } from "@/features/website-studio/site-access";
import { saveWebsiteMemory, resolvedWebsitePreferences } from "@/features/agent-runtime/memory";
import { listRecords, readRecord, updateRecord } from "@/lib/record-store";
import { readUsageEvents } from "@/lib/usage-store";
import { replayUsageOutbox } from "@/features/usage/delivery";
import { actionLinks, bad, businessProfile, object } from "./input";
import type { WaasSite } from "./types";

export const siteId = (id: string) => { if (!/^[a-f0-9-]{36}$/.test(id)) bad("Website not found.", 404); return id; };
const actor = (id: string) => ({ workspaceId: id, role: "owner" as const, userId: "waas-operator" });
export async function readSite(id: string) {
  const site = await readRecord<WaasSite>("sites/" + siteId(id));
  if (!site || site.workspaceId !== id) bad("Website not found.", 404);
  return site;
}
export function siteSummary(site: WaasSite) {
  const project = site.websiteProject;
  const live = liveWebsite(site);
  return {
    id: site.workspaceId, revision: site.revision, profile: site.profile, actions: site.actions,
    preferences: resolvedWebsitePreferences(site.aiMemory, site.workspaceId), preferencesRevision: site.aiMemory?.at(-1)?.revision || null,
    draft: project ? { id: project.id, status: project.status, selectedConcept: project.selectedConcept, concepts: project.spec.code ? WEBSITE_CONCEPTS.map((key) => ({ id: key, name: project.spec.code!.concepts[key].name })) : [], qa: project.qa } : null,
    previewUrl: project ? "/preview/" + project.privateToken : null,
    publicUrl: live ? "/sites/" + live.publicSlug : null,
    liveReleaseId: site.publishedWebsite?.id || null,
    releases: (site.websiteReleases || []).map((release) => ({ id: release.id, publishedAt: release.publishedAt, concept: release.project.selectedConcept })),
    job: site.websiteGeneration ? { id: site.websiteGeneration.id, status: site.websiteGeneration.status, progress: site.websiteGeneration.progress, error: site.websiteGeneration.error } : null,
  };
}
export async function listSites() { return (await listRecords<WaasSite>("sites")).map(siteSummary); }
export async function createSite(input: unknown) {
  const body = object(input);
  const id = randomUUID();
  const starter = createStarterWorkspace({ workspaceId: id, memberId: "waas-operator", ownerName: "Site owner", ownerEmail: "", businessName: "", businessType: "", timeZone: "UTC" });
  const profile = businessProfile(body.profile, starter.profile);
  const site: WaasSite = { ...starter, profile, actions: actionLinks(body.actions), revision: randomUUID() };
  if (body.preferences) site.aiMemory = saveWebsiteMemory({ profile, actor: actor(id), preferences: body.preferences });
  await updateRecord<WaasSite>("sites/" + id, (existing) => { if (existing) bad("Website already exists.", 409); return site; });
  return siteSummary(site);
}
export async function updateSite(id: string, input: unknown) {
  siteId(id);
  const body = object(input);
  const site = await updateRecord<WaasSite>("sites/" + id, (current) => {
    if (!current) bad("Website not found.", 404);
    if (body.expectedRevision !== current.revision) bad("Website changed. Fetch its latest revision before saving.", 409);
    const next = { ...current, revision: randomUUID() };
    if (body.profile) next.profile = businessProfile(body.profile, current.profile);
    if ("actions" in body) next.actions = actionLinks(body.actions);
    if ("preferences" in body) next.aiMemory = saveWebsiteMemory({ records: current.aiMemory, profile: next.profile, actor: actor(id), preferences: body.preferences, changeRequest: body.changeRequest, expectedRevision: body.expectedPreferencesRevision as string | null | undefined });
    return next;
  });
  return siteSummary(site);
}
export async function buildSite(id: string, input?: unknown) {
  await readSite(id);
  const body = object(input ?? {});
  const operation = body.operation || "start";
  const runner = createWebsiteJobRunner();
  if (operation === "start") return runner.start(actor(id));
  if ((operation !== "advance" && operation !== "resume") || typeof body.jobId !== "string" || !/^[a-f0-9-]{36}$/.test(body.jobId)) bad("Use start, advance or resume; advance/resume require jobId.");
  return operation === "advance" ? runner.advance(actor(id), body.jobId) : runner.resume(actor(id), body.jobId);
}
export async function buildStatus(id: string, jobId?: string) { await readSite(id); return createWebsiteJobRunner().status(actor(id), jobId); }
export async function publishSite(id: string, input: unknown) {
  siteId(id);
  const body = object(input);
  if (!WEBSITE_CONCEPTS.includes(body.concept as typeof WEBSITE_CONCEPTS[number])) bad("Choose editorial, momentum or aura.");
  if (body.approved !== true) bad("Owner approval (approved: true) is required to publish.");
  const site = await updateRecord<WaasSite>("sites/" + id, (current) => {
    if (!current) bad("Website not found.", 404);
    if (!current.websiteProject || body.draftId !== current.websiteProject.id) bad("Draft changed. Fetch and approve the latest draft.", 409);
    if (body.expectedLiveReleaseId !== (current.publishedWebsite?.id || null)) bad("Live website changed. Fetch its latest release before publishing.", 409);
    if (current.websiteProject.status === "published") bad("Generate a new draft before publishing again.", 409);
    return { ...publishWebsiteRevision(current, { ...current.websiteProject, selectedConcept: body.concept as typeof WEBSITE_CONCEPTS[number], status: "approved" }), actions: current.actions, revision: randomUUID() };
  });
  return siteSummary(site);
}
export async function rollbackSite(id: string, input: unknown) {
  siteId(id);
  const body = object(input);
  const site = await updateRecord<WaasSite>("sites/" + id, (current) => {
    if (!current) bad("Website not found.", 404);
    if (!body.expectedLiveReleaseId || body.expectedLiveReleaseId !== current.publishedWebsite?.id) bad("Live website changed. Fetch its latest release before rollback.", 409);
    if (typeof body.releaseId !== "string") bad("releaseId is required.");
    return { ...rollbackWebsiteRelease(current, body.releaseId), actions: current.actions, revision: randomUUID() };
  });
  return siteSummary(site);
}
export async function siteUsage(id: string) { await readSite(id); await replayUsageOutbox(id); return readUsageEvents(id); }

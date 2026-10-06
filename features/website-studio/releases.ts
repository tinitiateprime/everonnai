import type { EverOnnWorkspace, WebsiteProject, WebsiteRelease } from "@/features/everonn/types";
import { liveWebsite } from "./site-access";
import { runWebsiteQa } from "./generator";
import { normalizeWebsiteCodeConcept } from "./code-validation";

export function publishWebsiteRevision(workspace: EverOnnWorkspace, project: WebsiteProject): EverOnnWorkspace {
  if (project.workspaceId !== workspace.workspaceId || project.status !== "approved" || !project.selectedConcept || !project.spec.code) throw new Error("Approve a generated website before publishing.");
  if (project.profileSnapshot && JSON.stringify(project.profileSnapshot) !== JSON.stringify(workspace.profile)) throw Object.assign(new Error("Business facts changed after generation. Regenerate and review the website before publishing."), { status: 409 });
  const qa = runWebsiteQa(project.spec, workspace.profile);
  if (!qa.passed) throw new Error("Website quality checks must pass before publishing.");
  for (const concept of Object.values(project.spec.code.concepts)) normalizeWebsiteCodeConcept(concept, project.spec, workspace.profile);
  const now = new Date().toISOString();
  const published = { ...project, qa, status: "published" as const, updatedAt: now };
  const release: WebsiteRelease = { id: crypto.randomUUID(), project: structuredClone(published), profile: structuredClone(workspace.profile), publishedAt: now };
  const previous = workspace.publishedWebsite || (liveWebsite(workspace) ? { id: crypto.randomUUID(), project: structuredClone(liveWebsite(workspace)!), profile: structuredClone(workspace.profile), publishedAt: now } : null);
  const history = previous ? [previous, ...(workspace.websiteReleases || [])] : workspace.websiteReleases || [];
  return { ...workspace, websiteProject: published, publishedWebsite: release, websiteReleases: history.slice(0, 3) };
}

export function rollbackWebsiteRelease(workspace: EverOnnWorkspace, releaseId: string): EverOnnWorkspace {
  const release = workspace.websiteReleases?.find((item) => item.id === releaseId);
  if (!release || release.project.workspaceId !== workspace.workspaceId) throw new Error("The requested website release is unavailable.");
  if (release.project.publicSlug !== liveWebsite(workspace)?.publicSlug) throw new Error("The release belongs to a different public address.");
  const current = workspace.publishedWebsite;
  const history = (workspace.websiteReleases || []).filter((item) => item.id !== releaseId);
  if (current) history.unshift(current);
  return { ...workspace, publishedWebsite: structuredClone(release), websiteReleases: history.slice(0, 3) };
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/features/auth/session";
import { hasCapability } from "@/features/auth/rbac";
import { listRepositories } from "@/features/project-workspace/repositories";
import type { RepositorySummary } from "@/features/project-workspace/types";
import { readWorkspaceJson } from "@/lib/json-workspace-store";
import { ProjectWorkspace } from "@/components/project-workspace/project-workspace";
import "./workspace.css";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Project Workspace | EverOnnAI", robots: { index: false, follow: false } };
export default async function ProjectWorkspacePage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login?returnTo=/workspace");
  const workspace = await readWorkspaceJson(actor.workspaceId);
  let repositories: RepositorySummary[] = [], error = "";
  try { repositories = await listRepositories(actor.workspaceId); }
  catch { error = "Project repositories are temporarily unavailable. Contact your workspace administrator."; }
  return <ProjectWorkspace initialRepositories={repositories} initialError={error} businessName={workspace.profile.businessName} canManage={hasCapability(actor.role, "business:configure")} />;
}

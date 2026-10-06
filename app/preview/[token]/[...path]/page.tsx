import { notFound } from "next/navigation";
import { GeneratedWebsite } from "@/components/preview/private-website-preview";
import type { WebsiteProject } from "@/features/everonn/types";
import { getCurrentActor } from "@/features/auth/session";
import { findWorkspaceJson, readWorkspaceJson } from "@/lib/json-workspace-store";
import { websiteRouteExists } from "@/features/website-studio/site-access";

export const dynamic = "force-dynamic";

function routeExists(project: WebsiteProject, route: string[]) {
  return websiteRouteExists(project, route);
}

export default async function PreviewSubpage({ params, searchParams }: { params: Promise<{ token: string; path: string[] }>; searchParams: Promise<{ theme?: string }> }) {
  const { token, path } = await params;
  const query = await searchParams;
  const actor = await getCurrentActor();
  const workspace = token === "demo" && actor
    ? await readWorkspaceJson(actor.workspaceId)
    : await findWorkspaceJson((candidate) => candidate.websiteProject?.privateToken === token);
  if (!workspace) notFound();
  const project = workspace.websiteProject;
  const demoAllowed = token === "demo" && actor?.workspaceId === workspace.workspaceId;
  if (!project || (project.privateToken !== token && !demoAllowed) || !routeExists(project, path)) notFound();
  const theme = query.theme === "momentum" || query.theme === "aura" ? query.theme : "editorial";
  return <GeneratedWebsite project={project} profile={project.profileSnapshot || workspace.profile} theme={theme} previewToken={project.privateToken} route={path} />;
}

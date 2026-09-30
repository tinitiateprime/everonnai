import { notFound } from "next/navigation";
import { GeneratedWebsite } from "@/components/preview/private-website-preview";
import type { WebsiteProject } from "@/features/everonn/types";
import { getCurrentActor } from "@/features/auth/session";
import { readWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

function routeExists(project: WebsiteProject, route: string[]) {
  if (!route.length || (route.length === 1 && ["services", "about", "contact"].includes(route[0]))) return true;
  return route.length === 2 && route[0] === "services" && project.spec.services.some((service) => service.slug === route[1]);
}

export default async function PreviewSubpage({ params, searchParams }: { params: Promise<{ token: string; path: string[] }>; searchParams: Promise<{ theme?: string }> }) {
  const { token, path } = await params;
  const query = await searchParams;
  const [workspace, actor] = await Promise.all([readWorkspaceJson(), getCurrentActor()]);
  const project = workspace.websiteProject;
  const demoAllowed = token === "demo" && actor?.workspaceId === workspace.workspaceId;
  if (!project || (project.privateToken !== token && !demoAllowed) || !routeExists(project, path)) notFound();
  const theme = query.theme === "momentum" || query.theme === "aura" ? query.theme : "editorial";
  return <GeneratedWebsite project={project} profile={workspace.profile} theme={theme} previewToken={project.privateToken} route={path} />;
}

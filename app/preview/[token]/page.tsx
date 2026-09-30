import { notFound } from "next/navigation";
import { GeneratedWebsite } from "@/components/preview/private-website-preview";
import { getCurrentActor } from "@/features/auth/session";
import { readWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

export default async function PreviewPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ theme?: string }> }) {
  const { token } = await params;
  const query = await searchParams;
  const [workspace, actor] = await Promise.all([readWorkspaceJson(), getCurrentActor()]);
  const project = workspace.websiteProject;
  const demoAllowed = token === "demo" && actor?.workspaceId === workspace.workspaceId;
  if (!project || (project.privateToken !== token && !demoAllowed)) notFound();
  const theme = query.theme === "momentum" || query.theme === "aura" ? query.theme : "editorial";
  return <GeneratedWebsite project={project} profile={workspace.profile} theme={theme} previewToken={project.privateToken} />;
}

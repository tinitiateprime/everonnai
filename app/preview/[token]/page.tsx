import { notFound } from "next/navigation";
import { GeneratedWebsite } from "@/components/preview/private-website-preview";
import { getCurrentActor } from "@/features/auth/session";
import { findWorkspaceJson, readWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

export default async function PreviewPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ theme?: string }> }) {
  const { token } = await params;
  const query = await searchParams;
  const actor = await getCurrentActor();
  const workspace = token === "demo" && actor
    ? await readWorkspaceJson(actor.workspaceId)
    : await findWorkspaceJson((candidate) => candidate.websiteProject?.privateToken === token);
  if (!workspace) notFound();
  const project = workspace.websiteProject;
  const demoAllowed = token === "demo" && actor?.workspaceId === workspace.workspaceId;
  if (!project || (project.privateToken !== token && !demoAllowed)) notFound();
  const theme = query.theme === "momentum" || query.theme === "aura" ? query.theme : "editorial";
  return <GeneratedWebsite project={project} profile={workspace.profile} theme={theme} previewToken={project.privateToken} />;
}

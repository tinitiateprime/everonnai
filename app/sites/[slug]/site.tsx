import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GeneratedWebsite } from "@/components/preview/private-website-preview";
import type { WebsiteProject } from "@/features/everonn/types";
import { readWorkspaceJson } from "@/lib/json-workspace-store";

function routeExists(project: WebsiteProject, route: string[]) {
  if (!route.length || (route.length === 1 && ["services", "about", "contact"].includes(route[0]))) return true;
  return route.length === 2 && route[0] === "services" && project.spec.services.some((service) => service.slug === route[1]);
}

async function publishedProject(slug: string, route: string[]) {
  const workspace = await readWorkspaceJson();
  const project = workspace.websiteProject;
  if (!project || project.status !== "published" || project.publicSlug !== slug || !project.selectedConcept || !routeExists(project, route)) notFound();
  return { workspace, project };
}

export async function publishedMetadata(slug: string, route: string[]): Promise<Metadata> {
  const { workspace, project } = await publishedProject(slug, route);
  const service = route[0] === "services" && route[1] ? project.spec.services.find((item) => item.slug === route[1]) : null;
  const title = service ? `${service.name} | ${workspace.profile.businessName}` : project.spec.seo?.title || workspace.profile.businessName;
  const description = service?.pageIntro || project.spec.seo?.description || workspace.profile.description;
  return { title, description, robots: { index: true, follow: true }, openGraph: { title, description, type: "website", images: project.spec.media.hero ? [{ url: project.spec.media.hero.url }] : [] } };
}

export async function PublishedSite({ slug, route = [] }: { slug: string; route?: string[] }) {
  const { workspace, project } = await publishedProject(slug, route);
  return <GeneratedWebsite project={project} profile={workspace.profile} theme={project.selectedConcept!} route={route} />;
}

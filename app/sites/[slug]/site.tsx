import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GeneratedWebsite } from "@/components/preview/private-website-preview";
import type { WebsiteProject } from "@/features/everonn/types";
import { findWorkspaceJson } from "@/lib/json-workspace-store";
import { liveWebsite, websiteRouteExists } from "@/features/website-studio/site-access";

function routeExists(project: WebsiteProject, route: string[]) {
  return websiteRouteExists(project, route);
}

async function publishedProject(slug: string, route: string[]) {
  const workspace = await findWorkspaceJson((candidate) => liveWebsite(candidate)?.publicSlug === slug);
  if (!workspace) notFound();
  const project = liveWebsite(workspace);
  if (!project || project.status !== "published" || project.publicSlug !== slug || !project.selectedConcept || !routeExists(project, route)) notFound();
  return { workspace, project, profile: workspace.publishedWebsite?.profile || workspace.profile };
}

export async function publishedMetadata(slug: string, route: string[]): Promise<Metadata> {
  const { profile, project } = await publishedProject(slug, route);
  const service = route[0] === "services" && route[1] ? project.spec.services.find((item) => item.slug === route[1]) : null;
  const page = project.spec.code?.concepts[project.selectedConcept!].pages.find((item) => item.path === (route.length ? `/${route.join("/")}` : "/"));
  const title = page?.title || (service ? `${service.name} | ${profile.businessName}` : project.spec.seo?.title || profile.businessName);
  const description = page?.description || service?.pageIntro || project.spec.seo?.description || profile.description;
  return { title, description, robots: { index: true, follow: true }, openGraph: { title, description, type: "website", images: project.spec.media.hero ? [{ url: project.spec.media.hero.url }] : [] } };
}

export async function PublishedSite({ slug, route = [] }: { slug: string; route?: string[] }) {
  const { profile, project } = await publishedProject(slug, route);
  return <GeneratedWebsite project={project} profile={profile} theme={project.selectedConcept!} route={route} />;
}

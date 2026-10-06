import type { EverOnnWorkspace, WebsiteProject } from "@/features/everonn/types";

// Legacy publications remain accessible until their first versioned release.
export function liveWebsite(workspace: EverOnnWorkspace) {
  return workspace.publishedWebsite?.project
    || (workspace.websiteProject?.status === "published" ? workspace.websiteProject : null);
}

export function websiteAccess(workspace: EverOnnWorkspace, input: { previewToken?: string; publicSlug?: string }) {
  if (input.previewToken && workspace.websiteProject?.privateToken === input.previewToken) return workspace.websiteProject;
  const live = liveWebsite(workspace);
  return input.publicSlug && live?.publicSlug === input.publicSlug ? live : null;
}

export function websiteRouteExists(project: WebsiteProject, route: string[]) {
  const path = route.length ? `/${route.join("/")}` : "/";
  if (project.spec.code) return project.spec.code.concepts.editorial.pages.some((page) => page.path === path);
  return !route.length || (route.length === 1 && ["services", "about", "contact"].includes(route[0]))
    || (route.length === 2 && route[0] === "services" && project.spec.services.some((service) => service.slug === route[1]));
}

import { notFound } from "next/navigation";
import type { BusinessProfile, WebsiteProject } from "@/features/everonn/types";
import { prepareWebsitePage } from "@/features/website-studio/code-validation";
import { readableInk } from "@/features/website-studio/brand";
import { WebsitePage } from "./website-page";
import { LegacyWebsite } from "./legacy-website-preview";

export type WebsiteTheme = "editorial" | "momentum" | "aura";

export function GeneratedWebsite({ project, profile, theme, previewToken, route = [] }: { project: WebsiteProject; profile: BusinessProfile; theme: WebsiteTheme; previewToken?: string; route?: string[] }) {
  const publicProfile = { ...profile, knowledge: [], emergencyRules: "", pricingRules: "", policies: "", transferNumber: "" };
  if (!project.spec.code) return <LegacyWebsite project={project} profile={publicProfile} theme={theme} previewToken={previewToken} route={route} />;
  const concept = project.spec.code.concepts[theme];
  const page = concept.pages.find((item) => item.path === (route.length ? `/${route.join("/")}` : "/"));
  if (!page) notFound();
  const base = previewToken ? `/preview/${encodeURIComponent(previewToken)}` : `/sites/${encodeURIComponent(project.publicSlug)}`;
  const prepared = prepareWebsitePage(page, concept.css, project.spec, profile, theme, base, Boolean(previewToken));
  const styles = { "--client-primary": project.spec.visualDirection.primaryColor, "--client-accent": project.spec.visualDirection.accentColor, "--client-accent-ink": readableInk(project.spec.visualDirection.accentColor), "--brand-primary": project.spec.visualDirection.primaryColor, "--brand-accent": project.spec.visualDirection.accentColor } as React.CSSProperties;
  return <div className="ai-website" style={styles}>
    {previewToken && <aside className="website-preview-notice"><span>Private preview · {profile.businessName}</span><strong>{concept.name}</strong></aside>}
    <WebsitePage html={prepared.html} css={prepared.css} profile={publicProfile} previewToken={previewToken} publicSlug={previewToken ? undefined : project.publicSlug} />
  </div>;
}

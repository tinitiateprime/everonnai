import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";
import type { WebsiteProject, BusinessProfile } from "@/features/everonn/types";
import type { WebsiteConcept } from "@/features/agent-runtime/types";
import { prepareWebsitePage } from "@/features/website-studio/code-validation";
import { WEBSITE_CONCEPTS } from "@/features/website-studio/generator";
import { liveWebsite } from "@/features/website-studio/site-access";
import { listRecords } from "@/lib/record-store";
import type { WaasSite } from "./types";
import { bad } from "./input";

function escape(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
export function renderPage(site: WaasSite, project: WebsiteProject, profile: BusinessProfile, path: string, concept: WebsiteConcept, basePath: string, preview: boolean, staticExport = false) {
  const design = project.spec.code?.concepts[concept];
  const page = design?.pages.find((candidate) => candidate.path === path);
  if (!page || !design) bad("Page not found.", 404);
  const prepared = prepareWebsitePage(page, design.css, project.spec, profile, concept, basePath, preview);
  const fragment = parseFragment(prepared.html);
  const fallback = profile.email ? "mailto:" + profile.email : "tel:" + profile.phone.replace(/[^\d+]/g, "");
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if ("attrs" in node) {
      const action = node.attrs.find((attr) => attr.name === "data-everonn-action");
      const href = node.attrs.find((attr) => attr.name === "href");
      if (action && href) {
        const key = action.value as "booking" | "chat" | "voice";
        href.value = site.actions[key] || fallback;
        if (!site.actions[key]) {
          const label = key === "voice" && profile.phone ? "Call the team" : "Contact the team";
          if (key === "voice" && profile.phone) href.value = "tel:" + profile.phone.replace(/[^\d+]/g, "");
          node.childNodes = [{ nodeName: "#text", value: label, parentNode: node }];
        }
        node.attrs = node.attrs.filter((attr) => attr.name !== "data-everonn-action");
        node.attrs.push({ name: "target", value: "_blank" }, { name: "rel", value: "noopener noreferrer" });
      }
      if (staticExport && href && (href.value.startsWith("/") || href.value === "")) {
        const [route, hash] = href.value.split("#");
        const depth = path === "/" ? 0 : path.slice(1).split("/").length;
        href.value = "../".repeat(depth) + (!route || route === "/" ? "index.html" : route.slice(1) + "/index.html") + (hash ? "#" + hash : "");
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(fragment);
  const color = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : "#173b35";
  const css = "body{margin:0}#everonn-generated-site{--brand-primary:" + color(project.spec.visualDirection.primaryColor) + ";--brand-accent:" + color(project.spec.visualDirection.accentColor) + "}" + prepared.css;
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + escape(page.title) + "</title><meta name=\"description\" content=\"" + escape(page.description) + "\">" + (preview ? "<meta name=\"robots\" content=\"noindex,nofollow\">" : "") + "<style>" + css.replace(/<\/style/gi, "<\\/style") + "</style></head><body><div id=\"everonn-generated-site\">" + serialize(fragment) + "</div></body></html>";
}

export function pageHeaders(preview: boolean) {
  const configured = process.env.WAAS_EMBED_ORIGINS?.trim();
  const frames = configured ? configured.split(",").map((value) => {
    try { const url = new URL(value.trim()); if (url.protocol !== "https:" || url.origin !== value.trim()) throw new Error(); return url.origin; }
    catch { throw new Error("WAAS_EMBED_ORIGINS must contain comma-separated HTTPS origins."); }
  }).join(" ") + " 'self'" : "*";
  return {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https://images.pexels.com; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors " + (preview ? "'self'" : frames),
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin",
    ...(preview ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
  };
}

export async function servePage(identifier: string, path: string[], preview: boolean, theme?: string | null) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(identifier)) bad("Page not found.", 404);
  const site = (await listRecords<WaasSite>("sites")).find((candidate) => preview ? candidate.websiteProject?.privateToken === identifier : liveWebsite(candidate)?.publicSlug === identifier);
  if (!site) bad("Page not found.", 404);
  const project = preview ? site.websiteProject! : liveWebsite(site)!;
  const profile = preview ? project.profileSnapshot || site.profile : site.publishedWebsite?.profile || site.profile;
  const concept = preview ? (WEBSITE_CONCEPTS.includes(theme as WebsiteConcept) ? theme as WebsiteConcept : "editorial") : project.selectedConcept || "editorial";
  return new Response(renderPage(site, project, profile, path.length ? "/" + path.join("/") : "/", concept, (preview ? "/preview/" : "/sites/") + identifier, preview), { headers: pageHeaders(preview) });
}

export function exportSite(site: WaasSite) {
  const project = liveWebsite(site);
  if (!project?.spec.code || !site.publishedWebsite) bad("Publish an approved website before exporting.");
  const concept = project.selectedConcept!;
  return { siteId: site.workspaceId, releaseId: site.publishedWebsite.id, pages: project.spec.code.concepts[concept].pages.map((page) => ({ path: page.path === "/" ? "index.html" : page.path.slice(1) + "/index.html", html: renderPage(site, project, site.publishedWebsite!.profile, page.path, concept, "", false, true) })) };
}

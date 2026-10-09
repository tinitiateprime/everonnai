import { readGeneratedSite, websitePath } from "./site-store";
import { attachAssistant } from "./assistant-embed";
import { load } from "cheerio";
import { HOME_PAGE, servedPageLinks } from "./site-pages";
import { stripImageCaptions } from "./validation";

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
const text = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
/** Serves a saved version's home page or one of its inner pages as standalone HTML. */
export async function serveGeneratedPage(
  business: string,
  version: string,
  pageSlug: string = HOME_PAGE,
) {
  try {
    const artifact = await readGeneratedSite(business, version);
    if (!artifact)
      return text("This website version has not been generated yet.", 404);
    const page =
      pageSlug === HOME_PAGE
        ? artifact
        : artifact.pages?.find((p) => p.slug === pageSlug);
    if (!page) return text("This page does not exist on this website.", 404);
    // Also cleans sites generated before captions were stripped at generation time.
    const $ = load(page.html);
    stripImageCaptions($);
    const html = servedPageLinks(
      $.html(),
      websitePath(business, artifact.index),
      (artifact.pages ?? []).map((p) => p.slug),
    );
    const served = attachAssistant(html, business, version, artifact.id);
    return new Response(served.html, {
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": served.csp,
        "Permissions-Policy": "microphone=(self)",
      },
    });
  } catch {
    return text("This website is temporarily unavailable.", 503);
  }
}

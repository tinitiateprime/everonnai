import {
  apiKey,
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
import { sitePageBuildInput } from "@/lib/input";
import { makeSitePage, makeWebsite } from "@/lib/generator";
import { readEditableSite, SiteRequestError } from "@/lib/site-editing";
import {
  saveGeneratedSite,
  saveSitePage,
  SiteRevisionConflict,
} from "@/lib/site-store";
import { HOME_PAGE } from "@/lib/site-pages";

export const runtime = "nodejs";
export const maxDuration = 300;
// Builds one planned inner page, or (target "home") links the planned pages from the
// home page. The studio calls this once per target, concurrently ("Build full site", step 2).
export async function POST(request: Request) {
  try {
    protectRequest(request, "site-pages", 30);
    const key = apiKey(request);
    const data = sitePageBuildInput.parse(await readJson(request, 40000));
    const site = await readEditableSite(
      data.business,
      data.version,
      data.revision,
    );
    const { knowledge, discovery } = site.generationContext;
    const home = site.artifact;
    if (data.target === HOME_PAGE) {
      const artifact = await makeWebsite(
        key,
        knowledge,
        discovery,
        home.direction!,
        home.index,
        [],
        request.signal,
        data.model,
        home.photos ?? [],
        {
          artifact: home,
          prompt: `Link the new pages from the navigation: ${data.pages.map((p) => `${p.title} (page:${p.slug})`).join(", ")}. Remove any caption, label or overlay text attached to photographs (keep required photo credits).`,
          pageSlugs: data.pages.map((p) => p.slug),
        },
      );
      request.signal.throwIfAborted();
      return jsonResponse({
        artifact: await saveGeneratedSite(
          knowledge,
          artifact,
          discovery,
          data.revision,
          { keepPages: data.pages.map((p) => p.slug) },
        ),
      });
    }
    const page = data.pages.find((p) => p.slug === data.target);
    if (!page)
      throw new SiteRequestError("Choose one of the planned pages.", 400);
    const built = await makeSitePage(
      key,
      knowledge,
      discovery,
      home,
      data.pages,
      page,
      request.signal,
      data.model,
    );
    request.signal.throwIfAborted();
    return jsonResponse({
      artifact: await saveSitePage(
        data.business,
        data.version,
        built,
        {
          designId: site.designId,
        },
        data.pages.map((p) => p.slug),
      ),
    });
  } catch (error) {
    return jsonResponse(
      { error: errorMessage(error) },
      error instanceof SiteRequestError
        ? error.status
        : error instanceof SiteRevisionConflict
          ? 409
          : 400,
    );
  }
}

import {
  apiKey,
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
import { sitePagesPlanInput } from "@/lib/input";
import { planSitePages } from "@/lib/generator";
import { readEditableSite, SiteRequestError } from "@/lib/site-editing";
import { SiteRevisionConflict } from "@/lib/site-store";

export const runtime = "nodejs";
export const maxDuration = 300;
// Chooses the inner pages for one saved version ("Build full site", step 1).
export async function POST(request: Request) {
  try {
    protectRequest(request, "site-pages", 30);
    const key = apiKey(request);
    const data = sitePagesPlanInput.parse(await readJson(request, 20000));
    const site = await readEditableSite(
      data.business,
      data.version,
      data.revision,
    );
    const { knowledge, discovery } = site.generationContext;
    const pages = await planSitePages(
      key,
      knowledge,
      discovery,
      site.artifact,
      request.signal,
    );
    return jsonResponse({ pages });
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

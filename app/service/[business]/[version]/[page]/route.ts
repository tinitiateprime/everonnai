import { serveGeneratedPage } from "@/lib/site-serving";
import { HOME_PAGE, PAGE_SLUG } from "@/lib/site-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: {
    params: Promise<{ business: string; version: string; page: string }>;
  },
) {
  const { business, version, page } = await context.params;
  if (!PAGE_SLUG.test(page) || page === HOME_PAGE)
    return new Response("This page does not exist on this website.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  return serveGeneratedPage(business, version, page);
}

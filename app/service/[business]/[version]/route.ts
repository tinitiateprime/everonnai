import { serveGeneratedPage } from "@/lib/site-serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ business: string; version: string }> },
) {
  const { business, version } = await context.params;
  return serveGeneratedPage(business, version);
}

import { readGeneratedSite } from "@/lib/site-store";
import { attachAssistant } from "@/lib/assistant-embed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ business: string; version: string }> },
) {
  const { business, version } = await context.params;
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  };
  try {
    const artifact = await readGeneratedSite(business, version);
    if (!artifact)
      return new Response("This website version has not been generated yet.", {
        status: 404,
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
      });
    const page = attachAssistant(artifact.html, business, version, artifact.id);
    return new Response(page.html, {
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": page.csp,
        "Permissions-Policy": "microphone=(self)",
      },
    });
  } catch {
    return new Response("This website is temporarily unavailable.", {
      status: 503,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

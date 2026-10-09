import {
  connectGoogle,
  googleRedirectUri,
  verifyOAuthState,
} from "@/lib/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Google redirects here after consent; the signed state names the business.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (query: Record<string, string>) =>
    Response.redirect(
      new URL(`/?${new URLSearchParams(query)}`, request.url),
      303,
    );
  try {
    if (url.searchParams.get("error"))
      return back({
        google: "error",
        message: "Google access was not granted.",
      });
    const slug = verifyOAuthState(url.searchParams.get("state") ?? "");
    await connectGoogle(
      slug,
      url.searchParams.get("code") ?? "",
      googleRedirectUri(request.url),
    );
    return back({ google: "connected", business: slug });
  } catch (error) {
    return back({
      google: "error",
      message:
        error instanceof Error
          ? error.message.slice(0, 300)
          : "Google connection failed.",
    });
  }
}

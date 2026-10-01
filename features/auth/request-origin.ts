function httpOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(request: Request, appUrl = process.env.NEXT_PUBLIC_APP_URL) {
  const origin = request.headers.get("origin");
  // Preserve requests from non-browser clients that do not send an Origin header.
  if (origin === null) return true;
  const incomingOrigin = httpOrigin(origin);
  if (!incomingOrigin || incomingOrigin !== origin) return false;

  // A configured public origin is authoritative behind a hosting proxy. Do not
  // derive trusted origins from client-supplied Host or X-Forwarded-* headers.
  const configuredUrl = appUrl?.trim();
  const expectedOrigin = configuredUrl ? httpOrigin(configuredUrl) : new URL(request.url).origin;
  return incomingOrigin === expectedOrigin;
}

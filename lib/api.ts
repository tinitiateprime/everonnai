import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";

const requests = new Map<string, { count: number; expires: number }>();
export function protectRequest(request: Request, kind: string, limit = 12) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    throw new Error("This action must come from the website studio.");
  const identity =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${kind}:${identity}`;
  const now = Date.now();
  if (requests.size > 1000)
    for (const [key, item] of requests)
      if (item.expires < now) requests.delete(key);
  const current = requests.get(key);
  if (current && current.expires > now) {
    if (current.count >= limit)
      throw new Error(
        "Too many requests. Please wait a few minutes and try again.",
      );
    current.count++;
  } else requests.set(key, { count: 1, expires: now + 300000 });
}
export function apiKey(request: Request) {
  const ownKey = request.headers.get("x-openrouter-key")?.trim();
  if (ownKey) {
    if (ownKey.length > 256 || !/^sk-or-[\w-]+$/.test(ownKey))
      throw new Error("Enter a valid OpenRouter API key.");
    return ownKey;
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key)
    throw new Error(
      "Add your OpenRouter API key in Connection settings or OPENROUTER_API_KEY in .env.local.",
    );
  if (
    process.env.STUDIO_ACCESS_TOKEN ||
    process.env.NODE_ENV === "production"
  ) {
    const expected = process.env.STUDIO_ACCESS_TOKEN ?? "";
    const provided = request.headers.get("x-studio-token") ?? "";
    if (
      !expected ||
      Buffer.byteLength(expected) !== Buffer.byteLength(provided) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
    )
      throw new Error(
        "A studio access token is required to use the server's OpenRouter key.",
      );
  }
  return key;
}
export async function readJson(request: Request, max = 4_000_000) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body.");
  let total = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) throw new Error("Request is too large.");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(parts).toString());
}
export function errorMessage(error: unknown) {
  if (error instanceof ZodError)
    return error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .slice(0, 3)
      .join("; ");
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
export function jsonResponse(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

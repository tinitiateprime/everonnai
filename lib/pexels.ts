import { createHash } from "node:crypto";
import type { MediaBundle, PhotoAsset } from "./types";

const searchCache = new Map<
  string,
  { expires: number; photos: PhotoAsset[] }
>();
const photoCache = new Map<string, { expires: number; photo: PhotoAsset }>();
const pending = new Map<string, Promise<PhotoAsset[]>>();
const DAY = 24 * 60 * 60 * 1000;
function cacheId(key: string, suffix: string) {
  return `${createHash("sha256").update(key).digest("hex").slice(0, 16)}:${suffix}`;
}
function httpsUrl(value: unknown, host: string) {
  const url = new URL(String(value));
  if (
    url.protocol !== "https:" ||
    url.hostname !== host ||
    url.username ||
    url.password
  )
    throw new Error("Invalid photo URL");
  return url.href;
}
function photoAsset(raw: unknown): PhotoAsset | null {
  try {
    const p = raw as Record<string, unknown>;
    const src = p.src as Record<string, unknown>;
    if (
      !Number.isSafeInteger(p.id) ||
      Number(p.id) < 1 ||
      Number(p.width) < 1000 ||
      Number(p.height) < 500
    )
      return null;
    if (typeof p.photographer !== "string" || !p.photographer.trim())
      return null;
    return {
      id: Number(p.id),
      width: Number(p.width),
      height: Number(p.height),
      url: httpsUrl(src.large2x || src.large, "images.pexels.com"),
      sourceUrl: httpsUrl(p.url, "www.pexels.com"),
      photographerUrl: httpsUrl(p.photographer_url, "www.pexels.com"),
      photographer: p.photographer.trim().slice(0, 300),
      alt:
        typeof p.alt === "string"
          ? p.alt.slice(0, 1500)
          : "Illustrative stock photograph",
    };
  } catch {
    return null;
  }
}
function remember(key: string, photo: PhotoAsset) {
  if (photoCache.size >= 256)
    photoCache.delete(photoCache.keys().next().value!);
  photoCache.set(cacheId(key, String(photo.id)), {
    expires: Date.now() + DAY,
    photo,
  });
}
async function pexelsRequest(url: string, key: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: { Authorization: key },
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
      : AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const reason =
      response.status === 429
        ? "rate limit reached"
        : response.status === 401
          ? "key rejected"
          : `HTTP ${response.status}`;
    throw new Error(`Pexels photography unavailable (${reason}).`);
  }
  const body = await response.text();
  if (body.length > 1000000)
    throw new Error("Pexels response exceeded the size limit.");
  return JSON.parse(body);
}
export async function searchPhotos(
  query: string,
  signal?: AbortSignal,
): Promise<PhotoAsset[]> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) return [];
  query = query.trim().replace(/\s+/g, " ");
  if (query.length < 3 || query.length > 160 || /@|https?:|\d{4}/i.test(query))
    throw new Error(
      "Use a short generic subject for photo searches, without contact details or URLs.",
    );
  const id = cacheId(key, query.toLowerCase());
  const cached = searchCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.photos;
  const running = pending.get(id);
  if (running) return running;
  const request = (async () => {
    const params = new URLSearchParams({
      query,
      orientation: "landscape",
      size: "large",
      per_page: "4",
    });
    const payload = await pexelsRequest(
      `https://api.pexels.com/v1/search?${params}`,
      key,
      signal,
    );
    const photos = (Array.isArray(payload.photos) ? payload.photos : [])
      .map(photoAsset)
      .filter((p: PhotoAsset | null): p is PhotoAsset => !!p);
    photos.forEach((p: PhotoAsset) => remember(key, p));
    if (searchCache.size >= 128)
      searchCache.delete(searchCache.keys().next().value!);
    searchCache.set(id, { expires: Date.now() + DAY, photos });
    return photos;
  })();
  pending.set(id, request);
  try {
    return await request;
  } finally {
    pending.delete(id);
  }
}
export async function prepareMedia(
  queries: string[],
  signal?: AbortSignal,
): Promise<MediaBundle> {
  if (!process.env.PEXELS_API_KEY?.trim())
    return {
      photos: [],
      warnings: [
        "Pexels photography is not configured. Designs can use source images or original graphics.",
      ],
    };
  const results = await Promise.allSettled(
    [...new Set(queries)].slice(0, 2).map((q) => searchPhotos(q, signal)),
  );
  signal?.throwIfAborted();
  const photos = new Map<number, PhotoAsset>();
  const warnings: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled")
      for (const photo of result.value) photos.set(photo.id, photo);
    else
      warnings.push(
        result.reason instanceof Error &&
          result.reason.message.startsWith("Pexels")
          ? result.reason.message
          : "A photography search could not be completed.",
      );
  }
  if (!photos.size && !warnings.length)
    warnings.push("No suitable Pexels photos were found for this direction.");
  return {
    photos: [...photos.values()].slice(0, 8),
    warnings: [...new Set(warnings)],
  };
}
// Resolve provider IDs server-side: client-supplied URLs/credits are never trusted.
export async function resolvePhotos(
  ids: number[],
  signal?: AbortSignal,
): Promise<PhotoAsset[]> {
  const unique = [...new Set(ids)].slice(0, 8);
  if (!unique.length) return [];
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key)
    throw new Error(
      "Configure PEXELS_API_KEY to use the selected photographs.",
    );
  return Promise.all(
    unique.map(async (id) => {
      const cached = photoCache.get(cacheId(key, String(id)));
      if (cached && cached.expires > Date.now()) return cached.photo;
      const photo = photoAsset(
        await pexelsRequest(
          `https://api.pexels.com/v1/photos/${id}`,
          key,
          signal,
        ),
      );
      if (!photo || photo.id !== id)
        throw new Error(
          "The selected Pexels photograph is no longer available. Create a new design plan.",
        );
      remember(key, photo);
      return photo;
    }),
  );
}

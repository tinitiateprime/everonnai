import type { BusinessProfile, WebsiteMediaAsset, WebsiteSpec } from "@/features/everonn/types";

type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  photographer?: string;
  url?: string;
  alt?: string;
  src?: { landscape?: string; large2x?: string; large?: string };
};

function safeHttpsUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function toAsset(photo: PexelsPhoto, alt: string): WebsiteMediaAsset | null {
  const url = safeHttpsUrl(photo.src?.large2x || photo.src?.landscape || photo.src?.large);
  if (!url) return null;
  return {
    id: `pexels_${photo.id}`,
    url,
    alt: alt.trim() || photo.alt?.trim() || "Business service photography",
    photographer: photo.photographer?.trim() || "Pexels contributor",
    sourceUrl: safeHttpsUrl(photo.url),
  };
}

async function searchPexels(query: string, apiKey: string, perPage = 18, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=landscape&size=large&per_page=${Math.min(24, perPage)}`, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Pexels returned HTTP ${response.status}.`);
  const payload = await response.json() as { photos?: PexelsPhoto[] };
  return (payload.photos || []).filter((photo) => photo.width >= 1200 && photo.width > photo.height);
}

function queryWords(value: string) {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
}

function scorePhoto(photo: PexelsPhoto, query: string, index: number, usedPhotographers: Set<string>) {
  const searchable = `${photo.alt || ""} ${photo.url || ""}`.toLowerCase();
  const relevance = [...queryWords(query)].reduce((score, word) => score + (searchable.includes(word) ? 7 : 0), 0);
  const ratio = photo.width / Math.max(photo.height, 1);
  const composition = ratio >= 1.25 && ratio <= 2.2 ? 12 : ratio > 1 ? 5 : -10;
  const resolution = photo.width >= 2200 ? 8 : photo.width >= 1600 ? 4 : 0;
  const variety = photo.photographer && usedPhotographers.has(photo.photographer) ? -18 : 0;
  return relevance + composition + resolution + variety - index * 0.08;
}

function selectUnique(photos: PexelsPhoto[], query: string, used: Set<number>, usedPhotographers: Set<string>, alt: string) {
  const selected = photos
    .filter((photo) => !used.has(photo.id))
    .map((photo, index) => ({ photo, score: scorePhoto(photo, query, index, usedPhotographers) }))
    .sort((left, right) => right.score - left.score)[0]?.photo;
  if (!selected) return null;
  const asset = toAsset(selected, alt);
  if (!asset) return null;
  used.add(selected.id);
  if (selected.photographer) usedPhotographers.add(selected.photographer);
  return asset;
}

export async function resolveWebsiteMedia(spec: WebsiteSpec, profile: BusinessProfile, options: { apiKey?: string; fetchImpl?: typeof fetch } = {}) {
  const apiKey = String(options.apiKey || process.env.PEXELS_API_KEY || "").trim();
  if (!apiKey) return { hero: null, story: null, gallery: [], services: {}, provider: "none" as const, warning: null };
  const fetchImpl = options.fetchImpl || fetch;
  const used = new Set<number>();
  const usedPhotographers = new Set<string>();
  const searches = await Promise.allSettled([
    searchPexels(spec.mediaPlan.heroQuery, apiKey, 20, fetchImpl),
    searchPexels(spec.mediaPlan.galleryQuery, apiKey, 20, fetchImpl),
    ...spec.services.map((service) => searchPexels(service.imageQuery || `${service.name} ${profile.businessType}`, apiKey, 10, fetchImpl)),
  ]);
  const results = searches.map((result) => result.status === "fulfilled" ? result.value : []);
  const [heroCandidates = [], galleryCandidates = [], ...serviceCandidates] = results;
  const sharedFallbacks = [...heroCandidates, ...galleryCandidates];
  const hero = selectUnique([...heroCandidates, ...galleryCandidates], spec.mediaPlan.heroQuery, used, usedPhotographers, spec.mediaPlan.heroAlt);
  const story = selectUnique([...galleryCandidates, ...heroCandidates], spec.mediaPlan.galleryQuery, used, usedPhotographers, spec.mediaPlan.storyAlt) || hero;
  const services = Object.fromEntries(spec.services.map((service, index) => {
    const asset = selectUnique([...(serviceCandidates[index] || []), ...sharedFallbacks], service.imageQuery, used, usedPhotographers, service.imageAlt);
    return asset ? [service.id, asset] : null;
  }).filter((item): item is [string, WebsiteMediaAsset] => Boolean(item)));
  const gallery: WebsiteMediaAsset[] = [];
  while (gallery.length < 6) {
    const asset = selectUnique([...galleryCandidates, ...heroCandidates], spec.mediaPlan.galleryQuery, used, usedPhotographers, spec.mediaPlan.storyAlt);
    if (!asset) break;
    gallery.push(asset);
  }
  const assetCount = Number(Boolean(hero)) + Number(Boolean(story && story.id !== hero?.id)) + gallery.length + Object.keys(services).length;
  const failedSearches = searches.filter((result) => result.status === "rejected").length;
  return {
    hero,
    story,
    gallery,
    services,
    provider: assetCount ? "pexels" as const : "none" as const,
    warning: failedSearches ? `${failedSearches} Pexels search${failedSearches === 1 ? "" : "es"} could not be completed.` : null,
  };
}

export async function verifyWebsiteMedia(media: WebsiteSpec["media"], fetchImpl: typeof fetch = fetch) {
  const assets = [media.hero, media.story, ...media.gallery, ...Object.values(media.services)].filter((asset): asset is WebsiteMediaAsset => Boolean(asset));
  const uniqueAssets = [...new Map(assets.map((asset) => [asset.id, asset])).values()];
  const results = await Promise.all(uniqueAssets.map(async (asset) => {
    try {
      const response = await fetchImpl(asset.url, { method: "HEAD", signal: AbortSignal.timeout(8_000) });
      return { id: asset.id, available: response.ok, contentType: response.headers.get("content-type") || "" };
    } catch {
      return { id: asset.id, available: false, contentType: "" };
    }
  }));
  return { passed: results.length > 0 && results.every((result) => result.available && result.contentType.startsWith("image/")), results };
}

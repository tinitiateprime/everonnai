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
    alt: photo.alt?.trim() || alt,
    photographer: photo.photographer?.trim() || "Pexels contributor",
    sourceUrl: safeHttpsUrl(photo.url),
  };
}

async function searchPexels(query: string, apiKey: string, perPage = 12) {
  const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=landscape&size=large&per_page=${perPage}`, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Pexels returned HTTP ${response.status}.`);
  const payload = await response.json() as { photos?: PexelsPhoto[] };
  return (payload.photos || []).filter((photo) => photo.width >= 1200 && photo.width > photo.height);
}

function selectUnique(photos: PexelsPhoto[], used: Set<number>, alt: string) {
  const selected = photos.find((photo) => !used.has(photo.id));
  if (!selected) return null;
  used.add(selected.id);
  return toAsset(selected, alt);
}

export async function resolveWebsiteMedia(spec: WebsiteSpec, profile: BusinessProfile, options: { apiKey?: string } = {}) {
  const apiKey = String(options.apiKey || process.env.PEXELS_API_KEY || "").trim();
  if (!apiKey) return { hero: null, gallery: [], services: {}, provider: "none" as const };
  const used = new Set<number>();
  const [heroCandidates, galleryCandidates, ...serviceCandidates] = await Promise.all([
    searchPexels(spec.mediaPlan.heroQuery, apiKey),
    searchPexels(spec.mediaPlan.galleryQuery, apiKey),
    ...profile.services.filter((service) => service.active).map((service) => searchPexels(`${service.name} ${profile.businessType}`, apiKey, 8)),
  ]);
  const hero = selectUnique(heroCandidates, used, `${profile.businessName} ${profile.businessType}`);
  const gallery = galleryCandidates.map((photo) => selectUnique([photo], used, `${profile.businessType} work and customer experience`)).filter((item): item is WebsiteMediaAsset => Boolean(item)).slice(0, 3);
  const services = Object.fromEntries(profile.services.filter((service) => service.active).map((service, index) => {
    const asset = selectUnique(serviceCandidates[index] || [], used, service.description || service.name);
    return asset ? [service.id, asset] : null;
  }).filter((item): item is [string, WebsiteMediaAsset] => Boolean(item)));
  return { hero, gallery, services, provider: "pexels" as const };
}

export async function verifyWebsiteMedia(media: WebsiteSpec["media"], fetchImpl: typeof fetch = fetch) {
  const assets = [media.hero, ...media.gallery, ...Object.values(media.services)].filter((asset): asset is WebsiteMediaAsset => Boolean(asset));
  const results = await Promise.all(assets.map(async (asset) => {
    try {
      const response = await fetchImpl(asset.url, { method: "HEAD", signal: AbortSignal.timeout(8_000) });
      return { id: asset.id, available: response.ok, contentType: response.headers.get("content-type") || "" };
    } catch {
      return { id: asset.id, available: false, contentType: "" };
    }
  }));
  return { passed: results.every((result) => result.available && result.contentType.startsWith("image/")), results };
}

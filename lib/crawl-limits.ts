export const MAX_CRAWL_PAGES = 2000;
export const MAX_CRAWL_URLS = 12000;
export const MAX_SOURCE_BYTES = 64_000_000;
function setting(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= min
    ? Math.min(Math.floor(raw), max)
    : fallback;
}
export function crawlSettings() {
  return {
    maxPages: setting("CRAWL_MAX_PAGES", 500, 40, MAX_CRAWL_PAGES),
    batchPages: setting("CRAWL_BATCH_PAGES", 40, 1, 100),
    batchMs: setting("CRAWL_BATCH_SECONDS", 75, 5, 150) * 1000,
    concurrency: setting("CRAWL_CONCURRENCY", 4, 1, 6),
  };
}

import { localPlatformMode } from "../platform/config";
import type { DiscoveryRuntime } from "./service";
import type { safeResource } from "../network";

// Server-only, opt-in deterministic browser fixture. Never a request parameter.
export const fixtureOrigin = "https://platform-discovery.example.com";
export function browserFixtureRuntime(): DiscoveryRuntime {
  if (
    !localPlatformMode() ||
    process.env.PLATFORM_TEST_OUTPUT !== "1" ||
    process.env.PLATFORM_TEST_CRAWL_FIXTURE !== "1"
  )
    return {};
  const resource: typeof safeResource = async (value) => {
    const url = new URL(value);
    if (url.origin !== fixtureOrigin)
      throw new Error(
        "The browser fixture accepts its dedicated test origin only",
      );
    await new Promise((resolve) => setTimeout(resolve, 80));
    let status = 200,
      contentType = "text/html",
      html = "";
    if (url.pathname === "/robots.txt") {
      contentType = "text/plain";
      html = "User-agent: *\nAllow: /\n";
    } else if (url.pathname.includes("sitemap")) {
      status = 404;
      html = "missing";
    } else {
      const index = url.pathname === "/" ? 0 : Number(url.pathname.slice(6));
      if (!Number.isInteger(index) || index < 0 || index > 15) {
        status = 404;
        html = "missing";
      } else
        html = `<html><head><title>Evidence page ${index}</title></head><body><h1>Evidence page ${index}</h1><p>${"Archived source information. ".repeat(650)}FULL_EVIDENCE_END_${index}</p><a href="mailto:hello@example.com">Contact</a>${Array.from({ length: 16 }, (_, n) => `<a href="${n ? `/page-${n}` : "/"}">Page ${n}</a>`).join("")}</body></html>`;
    }
    return {
      url: url.href,
      status,
      headers: { "content-type": contentType },
      body: Buffer.from(html),
    };
  };
  return {
    resource,
    browser: null,
    settings: { maxPages: 40, batchPages: 2, batchMs: 10_000, concurrency: 1 },
    evidenceMode: "fixture",
  };
}

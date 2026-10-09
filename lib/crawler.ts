import { XMLParser } from "fast-xml-parser";
import robotsParser from "robots-parser";
import { chromium, type Browser } from "playwright";
import { safeResource, parsePublicUrl } from "./network";
import { designCues, extractPage, unique } from "./extract";
import type { Discovery } from "./types";

const AGENT = "EverOnnWebsiteStudio";
export const MAX_PAGES = 40;
export function crawlable(value: string, origin: string) {
  try {
    const url = parsePublicUrl(value);
    if (
      url.origin !== origin ||
      /\.(pdf|zip|jpg|jpeg|png|webp|svg|mp4|css|js|xml|woff2?)$/i.test(
        url.pathname,
      )
    )
      return null;
    // Avoid unbounded search/filter/calendar URL spaces.
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|fbclid|gclid)/.test(key)) url.searchParams.delete(key);
    if (
      url.search ||
      /\/(logout|signout|cart|checkout|wp-admin|wp-login)(\/|$)/i.test(
        url.pathname,
      )
    )
      return null;
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.href;
  } catch {
    return null;
  }
}
async function launchBrowser() {
  try {
    return await chromium.launch({
      headless: true,
      args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
      ...(process.env.CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
        : {}),
    });
  } catch {
    return null;
  }
}
async function render(browser: Browser, url: string, signal: AbortSignal) {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 1440, height: 1000 },
  });
  let requests = 0;
  try {
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", async (route) => {
      if (
        ++requests > 80 ||
        !["document", "script", "stylesheet", "xhr", "fetch"].includes(
          route.request().resourceType(),
        ) ||
        route.request().method() !== "GET"
      )
        return route.abort();
      try {
        const response = await safeResource(route.request().url(), {
          signal,
          maxBytes: 3_000_000,
        });
        // Never let the browser perform its own unvalidated network connection.
        await route.fulfill({
          status: response.status,
          contentType: String(
            response.headers["content-type"] ?? "application/octet-stream",
          ),
          body: response.body,
        });
      } catch {
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page
      .waitForLoadState("networkidle", { timeout: 4000 })
      .catch(() => {});
    const colorsAndFonts = await page.evaluate(() => {
      const colors: string[] = [],
        fonts: string[] = [];
      for (const el of [
        ...document.querySelectorAll("body,h1,h2,p,a,button,header,section"),
      ].slice(0, 100)) {
        const css = getComputedStyle(el);
        colors.push(css.color, css.backgroundColor);
        fonts.push(css.fontFamily);
      }
      return {
        colors: [...new Set(colors)].slice(0, 30),
        fonts: [...new Set(fonts)].slice(0, 15),
      };
    });
    return { html: await page.content(), ...colorsAndFonts };
  } finally {
    await context.close();
  }
}
export async function discoverWebsite(
  inputUrl: string,
  onProgress: (message: string) => void,
  externalSignal?: AbortSignal,
  dependencies: {
    resource?: typeof safeResource;
    browser?: Browser | null;
  } = {},
): Promise<Discovery> {
  const fetchResource = dependencies.resource ?? safeResource;
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, AbortSignal.timeout(180000)])
    : AbortSignal.timeout(180000);
  const starting = parsePublicUrl(
    /^https?:\/\//i.test(inputUrl) ? inputUrl : `https://${inputUrl}`,
  );
  onProgress("Reading the website and discovering its pages…");
  const initial = await fetchResource(starting.href, { signal });
  if (initial.status >= 400)
    throw new Error(
      `Website returned HTTP ${initial.status}. Check the link or continue with your description.`,
    );
  if (!String(initial.headers["content-type"]).includes("html"))
    throw new Error("The website link must point to an HTML page.");
  const origin = new URL(initial.url).origin;
  const result: Discovery = {
    inputUrl,
    origin,
    pages: [],
    skipped: [],
    warnings: [],
    discovered: 0,
    complete: false,
    crawledAt: new Date().toISOString(),
  };
  let robotsText = "";
  try {
    const response = await fetchResource(`${origin}/robots.txt`, {
      signal,
      origin,
    });
    if (response.status === 200) robotsText = response.body.toString();
    else if (response.status !== 404)
      throw new Error(`HTTP ${response.status}`);
  } catch {
    throw new Error(
      "Could not verify website crawling permissions (robots.txt). Try again or use description-only generation.",
    );
  }
  const robots = robotsParser(`${origin}/robots.txt`, robotsText);
  const root = crawlable(initial.url, origin);
  if (!root)
    throw new Error(
      "Use a clean website page URL without search/filter parameters.",
    );
  const queue = unique([root, `${origin}/`]);
  const seen = new Set<string>();
  const sitemapQueue = unique([
    ...robots.getSitemaps(),
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ]);
  const xmlParser = new XMLParser({
    ignoreAttributes: true,
    processEntities: false,
  });
  for (let i = 0; i < Math.min(sitemapQueue.length, 6); i++) {
    try {
      const sitemap = parsePublicUrl(sitemapQueue[i]);
      if (
        sitemap.origin !== origin ||
        robots.isAllowed(sitemap.href, AGENT) === false
      )
        continue;
      const response = await fetchResource(sitemap.href, { signal, origin });
      if (response.status !== 200) continue;
      const doc = xmlParser.parse(response.body.toString());
      const entries = [doc.urlset?.url ?? []].flat();
      for (const entry of entries.slice(0, 1200)) {
        const url = crawlable(String(entry.loc), origin);
        if (url && !queue.includes(url)) queue.push(url);
      }
      for (const entry of [doc.sitemapindex?.sitemap ?? []].flat().slice(0, 6))
        if (typeof entry.loc === "string" && !sitemapQueue.includes(entry.loc))
          sitemapQueue.push(entry.loc);
    } catch {
      result.warnings.push(
        "A sitemap could not be read; discovery continued through page links.",
      );
    }
  }
  const browser =
    dependencies.browser === undefined
      ? await launchBrowser()
      : dependencies.browser;
  if (!browser)
    result.warnings.push(
      "Browser rendering is unavailable. HTML pages are read directly; JavaScript-only content may be missing. Run npm run browser:install for full rendering.",
    );
  try {
    // Important business pages before large blog archives.
    const priority = (url: string) =>
      /contact|about|service|pricing|team|location|faq/i.test(url)
        ? 0
        : /blog|news|archive/i.test(url)
          ? 2
          : 1;
    while (
      queue.length &&
      result.pages.length < MAX_PAGES &&
      seen.size < MAX_PAGES * 3
    ) {
      if (signal.aborted) break;
      queue.sort((a, b) => priority(a) - priority(b));
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      if (robots.isAllowed(url, AGENT) === false) {
        result.skipped.push({ url, reason: "Blocked by robots.txt" });
        continue;
      }
      onProgress(
        `Reading page ${result.pages.length + 1}: ${new URL(url).pathname}`,
      );
      try {
        const resource =
          url === root ? initial : await fetchResource(url, { signal, origin });
        if (
          resource.status >= 400 ||
          !String(resource.headers["content-type"]).includes("html")
        ) {
          result.skipped.push({
            url,
            reason: `HTTP ${resource.status} or non-HTML content`,
          });
          continue;
        }
        let page = extractPage(resource.body.toString(), resource.url);
        if (browser) {
          try {
            const rendered = await render(browser, resource.url, signal);
            page = extractPage(rendered.html, resource.url);
            page.design.colors = unique([
              ...rendered.colors,
              ...page.design.colors,
            ]);
            page.design.fonts = unique([
              ...rendered.fonts,
              ...page.design.fonts,
            ]);
          } catch {
            result.warnings.push(
              `Browser rendering failed for ${url}; the original HTML was used.`,
            );
          }
        }
        if (!result.pages.length) {
          let css = page.design.css;
          for (const stylesheet of page.design.stylesheets.slice(0, 4)) {
            try {
              const response = await fetchResource(stylesheet, {
                signal,
                maxBytes: 300000,
              });
              if (response.status === 200)
                css += "\n" + response.body.toString();
            } catch {
              /* Design metadata remains useful without every stylesheet. */
            }
          }
          const cues = designCues(css);
          page.design.colors = unique([
            ...page.design.colors,
            ...cues.colors,
          ]).slice(0, 40);
          page.design.fonts = unique([
            ...page.design.fonts,
            ...cues.fonts,
          ]).slice(0, 20);
          page.design.css = css.slice(0, 10000);
        }
        result.pages.push(page);
        for (const link of page.links) {
          const candidate = crawlable(link, origin);
          if (
            candidate &&
            !seen.has(candidate) &&
            !queue.includes(candidate) &&
            queue.length < 1200
          )
            queue.push(candidate);
        }
        const requestedDelay = (robots.getCrawlDelay(AGENT) ?? 0) * 1000;
        if (requestedDelay > 15000) {
          result.warnings.push(
            "The website requests a long crawl delay; discovery stopped after one page.",
          );
          break;
        }
        const delay = Math.max(requestedDelay, 100);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        if (signal.aborted) break;
        result.skipped.push({
          url,
          reason:
            error instanceof Error ? error.message : "Could not read page",
        });
      }
    }
  } finally {
    await browser?.close();
  }
  if (!result.pages.length)
    throw new Error(
      "No readable public pages were found. Use your description or another website link.",
    );
  result.discovered = unique([...seen, ...queue]).length;
  result.complete =
    queue.length === 0 && result.skipped.length === 0 && !signal.aborted;
  if (queue.length)
    result.warnings.push(
      `Read ${result.pages.length} of ${result.discovered} discovered URLs. The crawl stopped at its page, request or time limit.`,
    );
  if (signal.aborted)
    result.warnings.push(
      "Discovery reached its time limit; captured pages are available, but some content may be missing.",
    );
  if (result.pages.some((p) => p.truncated))
    result.warnings.push(
      "Long page text was shortened to 12,000 characters per page; contacts and structured metadata were retained separately.",
    );
  result.warnings = unique(result.warnings);
  return result;
}

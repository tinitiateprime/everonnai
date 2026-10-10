import { XMLParser } from "fast-xml-parser";
import { randomUUID } from "node:crypto";
import robotsParser from "robots-parser";
import { chromium, type Browser } from "playwright";
import { safeResource, parsePublicUrl } from "./network";
import { designCues, extractPage, unique } from "./extract";
import type { CrawlState, Discovery, SourcePage } from "./types";
import { crawlSettings, MAX_CRAWL_PAGES, MAX_CRAWL_URLS } from "./crawl-limits";

const AGENT = "EverOnnWebsiteStudio";
const FRONTIER_WARNING =
  "The 12,000-URL discovery frontier limit was reached; some source URLs were omitted.";
export const MAX_PAGES = 500;
export interface PageEvidence {
  requestedUrl: string;
  raw: Uint8Array;
  renderedHtml?: string;
  fullPage: SourcePage;
  summary: SourcePage;
  status: number;
  captureStartedAt: string;
  capturedAt: string;
  renderedAt?: string;
}
// Persistence failures must never become ordinary skipped website pages.
export class CrawlPersistenceError extends Error {}
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
    url.hash = "";
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
    resume?: CrawlState;
    previous?: Discovery;
    id?: string;
    maxPages?: number;
    batchPages?: number;
    batchMs?: number;
    concurrency?: number;
    onCheckpoint?: (state: CrawlState) => Promise<void>;
    onCapture?: (evidence: PageEvidence) => Promise<void>;
  } = {},
): Promise<Discovery> {
  const settings = crawlSettings();
  const pageLimit = Math.min(
    MAX_CRAWL_PAGES,
    Math.max(
      1,
      dependencies.maxPages ??
        dependencies.resume?.result.crawl?.pageLimit ??
        settings.maxPages,
    ),
  );
  const fetchResource = dependencies.resource ?? safeResource;
  const signal = externalSignal
    ? AbortSignal.any([
        externalSignal,
        AbortSignal.timeout(dependencies.batchMs ?? settings.batchMs),
      ])
    : AbortSignal.timeout(dependencies.batchMs ?? settings.batchMs);
  const starting = parsePublicUrl(
    /^https?:\/\//i.test(inputUrl) ? inputUrl : `https://${inputUrl}`,
  );
  const prior = dependencies.resume;
  if (
    prior &&
    new URL(
      /^https?:\/\//i.test(prior.result.inputUrl)
        ? prior.result.inputUrl
        : `https://${prior.result.inputUrl}`,
    ).href !== starting.href
  )
    throw new Error("Continue the same website URL or start a new crawl.");
  onProgress(
    prior
      ? `Continuing from ${prior.result.pages.length} saved pages…`
      : "Reading the website and discovering its pages…",
  );
  const initialStartedAt = new Date().toISOString();
  const initial = prior
    ? undefined
    : await fetchResource(starting.href, { signal });
  const initialCapturedAt = new Date().toISOString();
  if (
    initial &&
    (initial.status >= 400 ||
      !String(initial.headers["content-type"]).includes("html"))
  )
    throw new Error(
      `The website must return readable HTML (HTTP ${initial.status}).`,
    );
  const origin = prior?.result.origin ?? new URL(initial!.url).origin;
  const previous = dependencies.previous;
  if (previous && new URL(previous.origin).origin !== origin)
    throw new Error("Captured knowledge belongs to a different website.");
  const result: Discovery =
    prior?.result ??
    (previous
      ? structuredClone(previous)
      : {
          inputUrl,
          origin,
          pages: [],
          skipped: [],
          warnings: [],
          discovered: 0,
          complete: false,
          crawledAt: new Date().toISOString(),
        });
  const startCount = result.pages.length;
  const target = Math.min(
    pageLimit,
    startCount + (dependencies.batchPages ?? settings.batchPages),
  );
  const id = prior?.id ?? dependencies.id ?? randomUUID();
  let robotsText = "";
  try {
    const response = await fetchResource(`${origin}/robots.txt`, {
      signal,
      origin,
    });
    if (response.status === 200) robotsText = response.body.toString();
    else if (response.status !== 404) throw new Error("Robots unavailable");
  } catch {
    throw new Error(
      "Could not verify website crawling permissions (robots.txt). Saved pages remain available; retry discovery later.",
    );
  }
  const robots = robotsParser(`${origin}/robots.txt`, robotsText);
  const root = prior?.root ?? crawlable(initial!.url, origin);
  if (!root)
    throw new Error(
      "Use a clean website page URL without search/filter parameters.",
    );
  const seen = new Set(
    prior?.seen ?? [
      ...result.pages.map((p) => crawlable(p.url, origin) ?? p.url),
      ...result.skipped.map((p) => crawlable(p.url, origin) ?? p.url),
    ],
  );
  const initialQueue = unique(
    [root, `${origin}/`, ...(previous?.pages.flatMap((p) => p.links) ?? [])]
      .map((url) => crawlable(url, origin))
      .filter((url): url is string => !!url && !seen.has(url)),
  );
  const queue = prior?.queue ?? initialQueue.slice(0, MAX_CRAWL_URLS);
  if (!prior && initialQueue.length > MAX_CRAWL_URLS)
    result.warnings.push(FRONTIER_WARNING);
  const known = new Set([...seen, ...queue]);
  const enqueue = (value: string) => {
    const candidate = crawlable(value, origin);
    if (candidate && !known.has(candidate)) {
      if (queue.length >= MAX_CRAWL_URLS) {
        if (!result.warnings.includes(FRONTIER_WARNING))
          result.warnings.push(FRONTIER_WARNING);
        return;
      }
      known.add(candidate);
      queue.push(candidate);
    }
  };
  if (!prior) {
    const sitemapQueue = unique([
      ...robots.getSitemaps(),
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
    ]);
    const xmlParser = new XMLParser({
      ignoreAttributes: true,
      processEntities: false,
    });
    for (
      let i = 0;
      i < Math.min(sitemapQueue.length, 30) && !signal.aborted;
      i++
    ) {
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
        if (entries.length > MAX_CRAWL_URLS)
          result.warnings.push(FRONTIER_WARNING);
        for (const entry of entries.slice(0, MAX_CRAWL_URLS))
          enqueue(String(entry.loc));
        for (const entry of [doc.sitemapindex?.sitemap ?? []]
          .flat()
          .slice(0, 30))
          if (
            typeof entry.loc === "string" &&
            !sitemapQueue.includes(entry.loc)
          )
            sitemapQueue.push(entry.loc);
      } catch {
        result.warnings.push(
          "A sitemap could not be read; discovery continued through page links.",
        );
      }
    }
  }
  let browser: Browser | null = dependencies.browser ?? null;
  let browserChecked = dependencies.browser !== undefined;
  let blockedByDelay = false;
  let savedCount = startCount;
  const requestedDelay = (robots.getCrawlDelay(AGENT) ?? 0) * 1000;
  const concurrency =
    requestedDelay > 0
      ? 1
      : Math.min(
          6,
          Math.max(1, dependencies.concurrency ?? settings.concurrency),
        );
  const priority = (url: string) =>
    url === root && !result.pages.length
      ? -1
      : /contact|about|service|pricing|team|location|faq/i.test(url)
        ? 0
        : /blog|news|archive/i.test(url)
          ? 2
          : 1;
  const checkpoint = async () => {
    result.discovered = known.size;
    result.complete =
      queue.length === 0 &&
      result.skipped.length === 0 &&
      !signal.aborted &&
      !result.warnings.includes(FRONTIER_WARNING);
    result.warnings = unique(result.warnings).slice(0, MAX_CRAWL_PAGES + 20);
    result.crawl = {
      id,
      revision: randomUUID(),
      pageLimit,
      remaining: queue.length,
      canContinue:
        queue.length > 0 &&
        result.pages.length < pageLimit &&
        seen.size < pageLimit * 3 &&
        !blockedByDelay,
      canExtend:
        queue.length > 0 && pageLimit < MAX_CRAWL_PAGES && !blockedByDelay,
      status: !queue.length
        ? "complete"
        : result.pages.length >= pageLimit ||
            seen.size >= pageLimit * 3 ||
            blockedByDelay
          ? "limit"
          : "paused",
    };
    await dependencies.onCheckpoint?.({
      id,
      result,
      root,
      robotsText,
      queue: [...queue],
      seen: [...seen],
    });
    savedCount = result.pages.length;
  };
  const readPage = async (url: string) => {
    seen.add(url);
    if (robots.isAllowed(url, AGENT) === false) {
      result.skipped.push({ url, reason: "Blocked by robots.txt" });
      return;
    }
    onProgress(
      `Reading page ${result.pages.length + 1} (limit ${pageLimit}): ${new URL(url).pathname}`,
    );
    try {
      const captureStartedAt =
        url === root && initial ? initialStartedAt : new Date().toISOString();
      const resource =
        url === root && initial
          ? initial
          : await fetchResource(url, { signal, origin });
      const capturedAt =
        url === root && initial ? initialCapturedAt : new Date().toISOString();
      if (
        resource.status >= 400 ||
        !String(resource.headers["content-type"]).includes("html")
      ) {
        result.skipped.push({
          url,
          reason: `HTTP ${resource.status} or non-HTML content`,
        });
        return;
      }
      let page = extractPage(resource.body.toString(), resource.url);
      let evidenceHtml = resource.body.toString();
      let renderedHtml: string | undefined;
      let renderedAt: string | undefined;
      // Render the first page for design cues; static pages already expose their content.
      const needsRender =
        !result.pages.length ||
        (page.text.length < 250 &&
          /<script\b[^>]*\bsrc\s*=/i.test(resource.body.toString()));
      if (needsRender && !signal.aborted) {
        if (!browserChecked) {
          browserChecked = true;
          browser = await launchBrowser();
        }
        if (browser) {
          try {
            const rendered = await render(browser, resource.url, signal);
            if (Buffer.byteLength(rendered.html) > 3_000_000)
              throw new Error("Rendered HTML exceeds capture limit");
            evidenceHtml = rendered.html;
            renderedHtml = rendered.html;
            renderedAt = new Date().toISOString();
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
        } else
          result.warnings.push(
            "Browser rendering is unavailable. HTML pages are read directly; JavaScript-only content may be missing.",
          );
      }
      if (!result.pages.length) {
        let css = page.design.css;
        for (const stylesheet of page.design.stylesheets.slice(0, 4)) {
          try {
            const response = await fetchResource(stylesheet, {
              signal,
              maxBytes: 300000,
            });
            if (response.status === 200) css += "\n" + response.body.toString();
          } catch {
            /* Source design cues remain useful. */
          }
        }
        const cues = designCues(css);
        page.design.colors = unique([
          ...page.design.colors,
          ...cues.colors,
        ]).slice(0, 40);
        page.design.fonts = unique([...page.design.fonts, ...cues.fonts]).slice(
          0,
          20,
        );
        page.design.css = css.slice(0, 10000);
      }
      if (dependencies.onCapture) {
        try {
          const fullPage = extractPage(evidenceHtml, resource.url, {
            fullText: true,
          });
          fullPage.design = page.design;
          await dependencies.onCapture({
            requestedUrl: url,
            raw: resource.body,
            renderedHtml,
            fullPage,
            summary: page,
            status: resource.status,
            captureStartedAt,
            capturedAt,
            renderedAt,
          });
        } catch (error) {
          throw new CrawlPersistenceError(
            error instanceof Error
              ? error.message
              : "Source evidence could not be saved",
          );
        }
      }
      result.pages.push(page);
      for (const link of page.links) enqueue(link);
    } catch (error) {
      if (error instanceof CrawlPersistenceError) {
        seen.delete(url);
        if (!queue.includes(url)) queue.unshift(url);
        throw error;
      }
      if (signal.aborted) {
        seen.delete(url);
        if (!queue.includes(url)) queue.unshift(url);
        return;
      }
      result.skipped.push({
        url,
        reason: error instanceof Error ? error.message : "Could not read page",
      });
    }
  };
  try {
    if (dependencies.onCapture && !prior) await checkpoint();
    while (
      queue.length &&
      result.pages.length < target &&
      seen.size < pageLimit * 3 &&
      !signal.aborted
    ) {
      queue.sort((a, b) => priority(a) - priority(b));
      const wave = queue.splice(
        0,
        Math.min(
          result.pages.length ? concurrency : 1,
          target - result.pages.length,
          pageLimit * 3 - seen.size,
        ),
      );
      const outcomes = await Promise.allSettled(
        wave.filter((url) => !seen.has(url)).map(readPage),
      );
      const failure = outcomes.find((outcome) => outcome.status === "rejected");
      if (failure?.status === "rejected") {
        await checkpoint();
        throw failure.reason;
      }
      if (
        (!savedCount && result.pages.length) ||
        result.pages.length - savedCount >= 10
      )
        await checkpoint();
      if (requestedDelay > 15000) {
        result.warnings.push(
          "The website requests a long crawl delay; discovery stopped to respect its request.",
        );
        blockedByDelay = true;
        break;
      }
      if (!signal.aborted)
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.max(requestedDelay, 100)),
        );
    }
  } finally {
    await browser?.close();
  }
  if (!result.pages.length)
    throw new Error(
      "No readable public pages were found. Use your entered knowledge or another website link.",
    );
  result.warnings = result.warnings.filter(
    (w) =>
      !/^(Read \d+ of|Discovery reached|This batch ended|Page limit reached)/.test(
        w,
      ),
  );
  if (queue.length)
    result.warnings.push(
      result.pages.length >= pageLimit
        ? `Page limit reached: ${result.pages.length} pages saved. Read more pages to increase the limit, or generate with these pages.`
        : `This batch ended with ${result.pages.length} pages saved; discovery can continue from its checkpoint.`,
    );
  if (result.pages.some((p) => p.truncated))
    result.warnings.push(
      "Long page text was shortened to 12,000 characters per page; contacts and structured metadata were retained separately.",
    );
  await checkpoint();
  return result;
}

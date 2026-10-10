import { chromium, type Browser } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { extractPage } from "../extract";
import { parsePublicUrl, safeResource } from "../network";
import { digest } from "../storage/artifacts";
import { cssTokens } from "./extract";
import type { BrowserObservation, IntelligenceRun, Token } from "./contracts";
export type BrowserEvidence = {
  observation: BrowserObservation;
  artifacts: {
    key: string;
    bytes: Uint8Array;
    mediaType: string;
    resourceUrl?: string;
  }[];
  tokens: Token[];
  renderedHtml: string | null;
};
export type IntelligenceRuntime = {
  resource?: typeof safeResource;
  browser?: Browser | null;
  mode?: "live" | "fixture";
  advice?: "disabled";
};
export async function openIntelligenceBrowser() {
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
export function absentBrowser(): BrowserObservation {
  return {
    status: "inconclusive",
    environment: "guarded_snapshot_replay",
    browserVersion: null,
    axeVersion: null,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    viewports: [],
    interactions: [],
    resources: [],
    accessibility: [],
    performance: {
      domContentLoadedMs: null,
      loadMs: null,
      lcpMs: null,
      cls: null,
      requestCount: 0,
      downloadedBytes: 0,
      profile:
        "Captured HTML replay, fresh public assets, no network/CPU throttling, one run; proxy overhead and blocked requests affect timing.",
    },
    runtimeErrors: 0,
    renderedTextSha256: null,
    matchesCapturedText: null,
    limitations: [
      "Browser inspection was unavailable. Responsive behavior, computed design, accessibility and interactive state remain unassessed.",
    ],
  };
}
export async function inspectInBrowser(
  browser: Browser | null,
  html: string,
  url: string,
  textSha256: string,
  config: IntelligenceRun["config"],
  signal?: AbortSignal,
  resource = safeResource,
): Promise<BrowserEvidence> {
  if (!browser)
    return {
      observation: absentBrowser(),
      artifacts: [],
      tokens: [],
      renderedHtml: null,
    };
  parsePublicUrl(url);
  const observation = absentBrowser();
  observation.limitations = [];
  observation.browserVersion = browser.version();
  const artifacts: BrowserEvidence["artifacts"] = [],
    tokens: Token[] = [],
    responses = new Map<
      string,
      {
        status: number;
        headers: Record<string, string>;
        body: Buffer;
        url: string;
      }
    >();
  let requests = 0,
    totalBytes = 0,
    renderedHtml: string | null = null,
    exceeded = false;
  const active = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(config.pageSeconds * 1000)])
    : AbortSignal.timeout(config.pageSeconds * 1000);
  const context = await browser.newContext({
    serviceWorkers: "block",
    acceptDownloads: false,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    reducedMotion: "reduce",
  });
  const closeOnAbort = () => void context.close().catch(() => {});
  active.addEventListener("abort", closeOnAbort, { once: true });
  try {
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", async (route) => {
      const request = route.request(),
        target = request.url(),
        type = request.resourceType();
      const record = {
        url: target,
        type,
        status: null,
        byteSize: 0,
        sha256: null,
        capturedAt: new Date().toISOString(),
        outcome: "blocked" as const,
        reason: "",
      };
      if (
        request.isNavigationRequest() &&
        type === "document" &&
        request.frame() === context.pages()[0]?.mainFrame() &&
        target === url
      ) {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: html,
        });
        return;
      }
      if (
        ++requests > config.maxRequests ||
        totalBytes >= config.maxNetworkBytes
      ) {
        exceeded = true;
        observation.resources.push({
          ...record,
          reason: "Page request or byte budget reached",
        });
        await route.abort();
        return;
      }
      if (
        request.method() !== "GET" ||
        !["script", "stylesheet", "image", "font", "xhr", "fetch"].includes(
          type,
        ) ||
        /^(blob:|data:|file:)/.test(target)
      ) {
        observation.resources.push({
          ...record,
          reason:
            "Read-only inspection blocks submissions, navigation, media streams and unsupported request types",
        });
        await route.abort();
        return;
      }
      if (["xhr", "fetch"].includes(type)) {
        try {
          const parsed = parsePublicUrl(target);
          if (
            parsed.origin !== new URL(url).origin ||
            /\/(delete|remove|logout|signout|checkout|unsubscribe|confirm|purchase|cancel)(\/|$)/i.test(
              parsed.pathname,
            )
          ) {
            observation.resources.push({
              ...record,
              reason: "Unsupported cross-origin or action request",
            });
            await route.abort();
            return;
          }
        } catch {
          observation.resources.push({
            ...record,
            reason: "Non-public endpoint",
          });
          await route.abort();
          return;
        }
      }
      try {
        let response = responses.get(target);
        if (!response) {
          const result = await resource(target, {
            signal: active,
            maxBytes: Math.min(3_000_000, config.maxNetworkBytes - totalBytes),
          });
          response = {
            status: result.status,
            body: result.body,
            url: result.url,
            headers: {
              "content-type": String(
                result.headers["content-type"] || "application/octet-stream",
              ),
            },
          };
          totalBytes += result.body.length;
          if (totalBytes > config.maxNetworkBytes) {
            exceeded = true;
            throw new Error("Page byte budget reached");
          }
          responses.set(target, response);
          observation.resources.push({
            url: target,
            type,
            status: result.status,
            byteSize: result.body.length,
            sha256: digest(result.body),
            capturedAt: new Date().toISOString(),
            outcome: result.status >= 400 ? "http_error" : "loaded",
            reason: null,
          });
          if (type === "stylesheet" && result.status === 200) {
            artifacts.push({
              key: `stylesheet-${artifacts.length}`,
              bytes: result.body,
              mediaType: "text/css",
              resourceUrl: target,
            });
            const parsed = cssTokens(result.body.toString(), target);
            tokens.push(...parsed.tokens);
            observation.limitations.push(...parsed.limits);
          }
        }
        await route.fulfill({
          status: response.status,
          headers: response.headers,
          body: response.body,
        });
      } catch {
        observation.resources.push({
          ...record,
          outcome: "unavailable",
          reason: "Guarded resource fetch failed or exceeded its budget",
        });
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    page.on("dialog", (dialog) => void dialog.dismiss());
    page.on("pageerror", () => observation.runtimeErrors++);
    await page.addInitScript(
      `(()=>{let lcp=null,cls=0;Object.defineProperty(window,'__everonnObservedPerformance',{get:()=>({lcp,cls})});try{new PerformanceObserver(list=>{for(const item of list.getEntries())lcp=item.startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(list=>{for(const item of list.getEntries())if(!item.hadRecentInput)cls+=item.value;}).observe({type:'layout-shift',buffered:true});}catch{}})();`,
    );
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page
      .waitForLoadState("networkidle", { timeout: 3000 })
      .catch(() => {});
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    renderedHtml = await page.content();
    if (Buffer.byteLength(renderedHtml) > 3_000_000) {
      observation.limitations.push(
        "Rendered DOM exceeds the 3 MB archival limit; rendered inventory is unassessed.",
      );
      renderedHtml = null;
    }
    if (renderedHtml) {
      observation.renderedTextSha256 = digest(
        Buffer.from(extractPage(renderedHtml, url, { fullText: true }).text),
      );
      observation.matchesCapturedText =
        observation.renderedTextSha256 === textSha256;
      artifacts.push({
        key: "rendered-dom",
        bytes: Buffer.from(renderedHtml),
        mediaType: "text/html",
      });
    }
    const timings = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const measured = (
        window as unknown as {
          __everonnObservedPerformance?: { lcp: number | null; cls: number };
        }
      ).__everonnObservedPerformance;
      return {
        domContentLoadedMs: entry?.domContentLoadedEventEnd ?? null,
        loadMs: entry?.loadEventEnd || null,
        lcpMs: measured?.lcp ?? null,
        cls: measured?.cls ?? null,
      };
    });
    Object.assign(observation.performance, timings);
    for (const width of config.viewports) {
      active.throwIfAborted();
      await page.setViewportSize({ width, height: 900 });
      const view = await page.evaluate(() => {
        const tokens: {
            kind:
              | "color"
              | "font"
              | "font_size"
              | "spacing"
              | "radius"
              | "shadow"
              | "layout";
            name: string;
            value: string;
            count: number;
            origin: string;
          }[] = [],
          fonts = new Set<string>(),
          colors = new Set<string>();
        const all = [
          ...document.querySelectorAll(
            "body,header,nav,main,footer,h1,h2,h3,p,a,button,input,select,textarea,section,article",
          ),
        ];
        let visibleControls = 0,
          smallControls = 0,
          hiddenContent = false;
        for (const el of all.slice(0, 2000)) {
          const style = getComputedStyle(el),
            rect = el.getBoundingClientRect();
          if (
            !rect.width ||
            !rect.height ||
            style.display === "none" ||
            style.visibility === "hidden"
          )
            continue;
          fonts.add(style.fontFamily);
          colors.add(style.color);
          colors.add(style.backgroundColor);
          for (const [name, kind] of [
            ["color", "color"],
            ["backgroundColor", "color"],
            ["fontFamily", "font"],
            ["fontSize", "font_size"],
            ["lineHeight", "spacing"],
            ["padding", "spacing"],
            ["margin", "spacing"],
            ["gap", "spacing"],
            ["borderRadius", "radius"],
            ["boxShadow", "shadow"],
            ["display", "layout"],
          ] as const) {
            const value = style[name];
            if (value && value !== "none")
              tokens.push({
                kind,
                name,
                value,
                count: 1,
                origin: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""),
              });
          }
          if (el.matches("button,input:not([type=hidden]),select,textarea")) {
            visibleControls++;
            if (rect.width < 24 || rect.height < 24) smallControls++;
          }
          if (
            el.matches("main,article") &&
            ["hidden", "clip"].includes(style.overflowY) &&
            el.scrollHeight > el.clientHeight + 1
          )
            hiddenContent = true;
        }
        const uniqueTokens = new Map<string, (typeof tokens)[number]>();
        for (const token of tokens) {
          const key = token.kind + ":" + token.name + ":" + token.value,
            entry = uniqueTokens.get(key) ?? { ...token, count: 0 };
          entry.count += token.count;
          uniqueTokens.set(key, entry);
        }
        return {
          width: innerWidth,
          overflowPixels: Math.max(
            0,
            Math.max(
              document.documentElement.scrollWidth,
              document.body.scrollWidth,
            ) - innerWidth,
          ),
          visibleControls,
          smallControls,
          hiddenContent,
          fonts: [...fonts],
          colors: [...colors],
          tokens: [...uniqueTokens.values()].slice(0, 3000),
          sampled: all.length > 2000,
        };
      });
      if (view.sampled)
        observation.limitations.push(
          "Computed design/control sampling covers the first 2,000 matching visible elements per viewport.",
        );
      const { sampled: _, ...viewport } = view;
      void _;
      observation.viewports.push(viewport);
      const image = await page.screenshot({
        type: "png",
        fullPage: false,
        timeout: 10000,
      });
      artifacts.push({
        key: `screenshot-${width}`,
        bytes: image,
        mediaType: "image/png",
      });
      if (width === 1440 || width === 390) {
        try {
          const result = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze();
          observation.axeVersion = result.testEngine.version;
          for (const item of [
            ...result.violations.map((value) => ({
              value,
              inconclusive: false,
            })),
            ...result.incomplete.map((value) => ({
              value,
              inconclusive: true,
            })),
          ])
            observation.accessibility.push({
              rule: item.value.id,
              impact: item.value.impact || "unknown",
              description: item.value.help,
              helpUrl: item.value.helpUrl,
              targets: item.value.nodes
                .slice(0, 200)
                .map((node) => node.target.flat().map(String).join(" ")),
              inconclusive: item.inconclusive,
            });
        } catch {
          observation.limitations.push(
            `Accessibility engine could not complete at width ${width}.`,
          );
        }
      }
    }
    // Native disclosures are local UI state. No source forms or booking actions are submitted.
    for (const summary of (await page.locator("details > summary").all()).slice(
      0,
      8,
    )) {
      try {
        const label =
          (await summary.textContent())?.trim().slice(0, 160) || "Disclosure";
        const before = await summary.evaluate((el) =>
          el.parentElement?.hasAttribute("open"),
        );
        await summary.click({ timeout: 1000 });
        const after = await summary.evaluate((el) =>
          el.parentElement?.hasAttribute("open"),
        );
        observation.interactions.push({
          locator: label,
          kind: "native_disclosure",
          outcome: before !== after ? "revealed" : "unchanged",
          detail:
            "Native disclosure toggled without submitting a source workflow.",
        });
        await summary.click({ timeout: 1000 });
      } catch {
        observation.interactions.push({
          locator: "details > summary",
          kind: "native_disclosure",
          outcome: "unavailable",
          detail: "The sampled disclosure could not be operated.",
        });
      }
    }
    observation.status = "observed";
  } catch {
    observation.limitations.push(
      "Browser inspection did not finish all required viewports/checks. Partial observations are retained.",
    );
  } finally {
    active.removeEventListener("abort", closeOnAbort);
    await context.close().catch(() => {});
  }
  observation.endedAt = new Date().toISOString();
  observation.performance.requestCount = requests;
  observation.performance.downloadedBytes = totalBytes;
  if (exceeded)
    observation.limitations.push(
      "The declared per-page network request/byte budget was reached; some assets or dynamic content are unassessed.",
    );
  observation.limitations.push(
    "HTML is replayed from the frozen capture; public scripts/styles/fonts/images and read-only data are fetched at assessment time and may have changed.",
    "Source forms, login, checkout, email, booking, uploads, consent-changing actions and third-party iframe workflows are not submitted or verified.",
    "Timing observations use a guarded proxy and one sample, not field performance or a comparable improvement benchmark.",
    "Automated accessibility findings cover the sampled states; manual and assistive-technology review remains necessary.",
  );
  return { observation, artifacts, tokens, renderedHtml };
}
